import { BadRequestException, Body, Controller, Get, Injectable, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { paged, pageArgs } from '../common/paging';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { deliveryAdapter, SMS_MAX } from './delivery';

/** Sends to more recipients than this wait for a 'High-volume communications' approval. */
export const HIGH_VOLUME = Number(process.env.COMMS_HIGH_VOLUME ?? 100);

const Compose = z.object({
  channel: z.enum(['email', 'sms', 'in_app']),
  audience: z.enum(['client', 'vendor', 'panel', 'internal']),
  /** client:<id> | vendor:<id> | panel:<brand>:<status> | role:<role> */
  target: z.string().min(3).max(120),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);

type Db = Prisma.TransactionClient | PrismaService;

/** Recipients a target resolves to, after consent filtering. */
export async function resolveTarget(db: Db, ctx: Ctx, audience: string, target: string): Promise<{ recipients: number; label: string }> {
  const [kind, a, b] = target.split(':');
  if (kind !== audience && !(audience === 'internal' && (kind === 'role' || kind === 'users')) && !(audience === 'panel' && kind === 'panelist')) throw new BadRequestException('Target does not match audience');
  // Named members of this workspace (comma-separated user ids), e.g. a scheduled report's recipients.
  if (kind === 'users') {
    const ids = [...new Set((a ?? '').split(',').filter(Boolean))].slice(0, 50);
    const n = await db.membership.count({ where: { tenantId: ctx.tenantId, userId: { in: ids } } });
    if (!n) throw new BadRequestException('None of these people is a member of this workspace');
    return { recipients: n, label: `${n} team member${n === 1 ? '' : 's'}` };
  }
  if (kind === 'client') {
    const c = await db.client.findFirst({ where: { id: a, tenantId: ctx.tenantId } });
    if (!c) throw new BadRequestException('Unknown client');
    return { recipients: 1, label: `${c.name} (primary contact)` };
  }
  if (kind === 'vendor') {
    const v = await db.vendor.findFirst({ where: { id: a, tenantId: ctx.tenantId } });
    if (!v) throw new BadRequestException('Unknown vendor');
    return { recipients: 1, label: `${v.name} (account contact)` };
  }
  // One member, for a support reply: transactional, so marketing consent does not apply, but
  // members who asked to be deleted get nothing.
  if (kind === 'panelist' && audience === 'panel') {
    const p = await db.panelist.findFirst({ where: { id: a, tenantId: ctx.tenantId }, select: { handle: true, status: true } });
    if (!p) throw new BadRequestException('Unknown panel member');
    return { recipients: p.status === 'deletion_requested' ? 0 : 1, label: `${p.handle} (support reply)` };
  }
  if (kind === 'panel') {
    const where: Prisma.PanelistWhereInput = {
      tenantId: ctx.tenantId, brand: a, ...(b && b !== 'all' ? { status: b } : { status: { in: ['active', 'dormant'] } }),
      NOT: { consents: { some: { purpose: 'marketing_email', granted: false } } },
    };
    return { recipients: await db.panelist.count({ where }), label: `${a} members (${b ?? 'active+dormant'}), consent-filtered` };
  }
  if (kind === 'role') return { recipients: await db.membership.count({ where: { tenantId: ctx.tenantId, role: a as never } }), label: `${a} team` };
  throw new BadRequestException('Unknown target');
}

/**
 * Writes one outbound message inside the caller's transaction: queued for the delivery worker, or
 * held behind a 'High-volume communications' approval above HIGH_VOLUME recipients. The caller
 * writes the audit entry.
 */
export async function queueMessage(
  tx: Prisma.TransactionClient, ctx: Ctx,
  b: { channel: string; audience: string; target: string; subject: string; body: string },
  r: { recipients: number; label: string },
  o: { agentId?: string; relatedType?: string; relatedId?: string } = {},
) {
  const big = r.recipients > HIGH_VOLUME;
  const m = await tx.message.create({
    data: { tenantId: ctx.tenantId, channel: b.channel, audience: b.audience, toRef: b.target, recipients: r.recipients, subject: b.subject, body: b.body, status: big ? 'pending_approval' : 'queued', createdBy: ctx.name, relatedType: o.relatedType, relatedId: o.relatedId },
  });
  if (big) {
    const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'High-volume communications', ...(o.agentId ? { agentId: o.agentId } : {}), title: `${b.channel.toUpperCase()} "${b.subject}" to ${r.recipients.toLocaleString('en-US')} recipients (${r.label})`, requestedBy: ctx.userId, payload: { messageId: m.id } });
    await tx.message.update({ where: { id: m.id }, data: { approvalId: ap.id } });
  } else {
    await emit(tx, ctx.tenantId, 'message.queued', { messageId: m.id });
  }
  return { message: m, recipients: r.recipients, needsApproval: big };
}

/**
 * Comms Hub. Every outbound message is a row with a status; delivery goes through the adapter in
 * delivery.ts (development adapter unless SMTP_* or SMS_* is set; see there). Panel sends count
 * only members who have not withdrawn marketing consent and are not suspended or pending deletion.
 */
@Injectable()
export class CommsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private scope(ctx: Ctx): Prisma.MessageWhereInput {
    if (ctx.role === 'vendor') return { tenantId: ctx.tenantId, OR: [{ toRef: `vendor:${ctx.vendorId}` }, { createdBy: ctx.name, audience: 'internal' }] };
    if (ctx.role === 'client') return { tenantId: ctx.tenantId, OR: [{ toRef: `client:${ctx.clientId}` }, { createdBy: ctx.name, audience: 'internal' }] };
    return { tenantId: ctx.tenantId };
  }

  async messages(ctx: Ctx, q: unknown, res?: Response) {
    const { want, ...page } = pageArgs(q, 200, 50);
    return paged(await this.db.message.findMany({ where: this.scope(ctx), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page }), want, res);
  }

  templates(ctx: Ctx) {
    return this.db.messageTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
  }

  /** Recipients a target resolves to, after consent filtering. */
  resolve(ctx: Ctx, audience: string, target: string) { return resolveTarget(this.db, ctx, audience, target); }

  async preview(ctx: Ctx, audience: string, target: string) {
    const r = await this.resolve(ctx, audience, target);
    return { ...r, needsApproval: r.recipients > HIGH_VOLUME, threshold: HIGH_VOLUME, adapter: deliveryAdapter.name };
  }

  async send(ctx: Ctx, b: z.infer<typeof Compose>) {
    // External users may only write to the internal team.
    if ((ctx.role === 'vendor' || ctx.role === 'client') && b.audience !== 'internal') throw new BadRequestException('You can message the Sampledge team only');
    if (b.channel === 'sms' && b.body.length > SMS_MAX) throw new BadRequestException(`An SMS can be at most ${SMS_MAX.toLocaleString('en-US')} characters`);
    const r = await this.resolve(ctx, b.audience, b.target);
    if (r.recipients === 0) throw new BadRequestException('No eligible recipients (after consent filtering)');
    return this.db.$transaction(async (tx) => {
      const q = await queueMessage(tx, ctx, b, r);
      await this.audit.log(ctx, 'message.create', 'Message', q.message.id, undefined, { to: b.target, recipients: r.recipients, status: q.message.status }, tx);
      return { ...q, adapter: deliveryAdapter.name };
    });
  }

  /**
   * A message drafted by an automation agent, inside the agent run's transaction. Same consent
   * filtering and high-volume approval as a person's message; the approval names the agent.
   * Returns null when nobody is eligible.
   */
  async sendAsAgent(tx: Prisma.TransactionClient, agent: { id: string; tenantId: string; name: string }, b: { channel: 'email'; audience: 'panel' | 'internal'; target: string; subject: string; body: string }) {
    const ctx: Ctx = { userId: `agent:${agent.id}`, sessionId: 'agent', tenantId: agent.tenantId, role: 'platform_admin', name: agent.name, email: '', vendorId: null, clientId: null };
    const r = await this.resolve(ctx, b.audience, b.target);
    if (r.recipients === 0) return null;
    const q = await queueMessage(tx, ctx, b, r, { agentId: agent.id });
    await this.audit.log(ctx, 'message.create', 'Message', q.message.id, undefined, { to: b.target, recipients: r.recipients, status: q.message.status, agent: agent.name }, tx);
    return q;
  }

  async render(ctx: Ctx, key: string, vars: Record<string, string>) {
    const t = await this.db.messageTemplate.findFirst({ where: { tenantId: ctx.tenantId, key } });
    if (!t) throw new BadRequestException('Unknown template');
    return { channel: t.channel, subject: fill(t.subject, vars), body: fill(t.body, vars) };
  }
}

@ForModule('communications')
@Controller('comms')
export class CommsController {
  constructor(private s: CommsService) {}
  @Get('messages') messages(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { return this.s.messages(ctx, q, res); }
  @Get('templates') templates(@Caller() ctx: Ctx) { return this.s.templates(ctx); }
  /** Which delivery adapter is active. Never returns credentials. */
  @Get('adapter') adapter() { return { mode: deliveryAdapter.mode, name: deliveryAdapter.name, channels: deliveryAdapter.channels }; }
  @Get('preview') preview(@Caller() ctx: Ctx, @Query() q: unknown) {
    const x = parse(z.object({ audience: z.string(), target: z.string() }), q);
    return this.s.preview(ctx, x.audience, x.target);
  }
  @Post('render') render(@Caller() ctx: Ctx, @Body() b: unknown) {
    const x = parse(z.object({ key: z.string(), vars: z.record(z.string(), z.string().max(500)).default({}) }), b);
    return this.s.render(ctx, x.key, x.vars);
  }
  @Write({ allowScoped: true }) @Post('messages')
  send(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.send(ctx, parse(Compose, b)); }
}
