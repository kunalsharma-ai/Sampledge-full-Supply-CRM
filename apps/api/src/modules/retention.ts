/**
 * Data retention and workspace settings (Admin & Security).
 *
 * Each workspace chooses how long operational records are kept. Nothing is purged unless a policy is
 * set, and the default for every category is "keep". Research data (responses, surveys, projects),
 * finance records and the audit trail are not covered: they are kept for the life of the workspace.
 *
 * Shortening or turning on a policy deletes data that cannot be recovered, so it is a 'Deleting
 * records' approval that someone other than the requester decides. Lengthening or turning one off
 * applies at once. The worker applies the policies once a day; an administrator can also run them.
 * Every run and change is in the audit trail with the counts.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

type Tx = Prisma.TransactionClient | PrismaService;
const DAY = 86400_000;
export const REDACTED_SUBJECT = '(removed under the retention policy)';

/** What each category covers, and the shortest period allowed (so a slip cannot wipe recent working data). */
export const RETENTION = {
  messages: { label: 'Message content', min: 30, what: 'Subject and body of sent, recorded, failed or cancelled messages. The log row (date, channel, recipient count, status) is kept.' },
  notifications: { label: 'Notifications', min: 30, what: 'In-app notifications and who has read them.' },
  sessions: { label: 'Ended sign-in sessions', min: 7, what: 'Sessions that expired or were revoked. Live sessions are never touched.' },
  ai_calls: { label: 'AI usage log', min: 62, what: 'Per-call AI usage and cost records. At least two months are kept so the monthly cap stays correct.' },
  panel_calls: { label: 'Panel request log', min: 30, what: 'Finished requests to the panel sites (sent, failed or not sent). Calls that need review are kept.' },
} as const;
export type RetentionCategory = keyof typeof RETENTION;
export type RetentionPolicy = Partial<Record<RetentionCategory, number>>;
const categories = Object.keys(RETENTION) as RetentionCategory[];

export function readPolicy(raw: unknown): RetentionPolicy {
  const out: RetentionPolicy = {};
  if (raw && typeof raw === 'object') for (const c of categories) {
    const d = (raw as Record<string, unknown>)[c];
    if (typeof d === 'number' && Number.isInteger(d) && d >= RETENTION[c].min) out[c] = d;
  }
  return out;
}

/** The rows each category would remove or redact, for a cutoff in days. */
function scopes(tenantId: string, c: RetentionCategory, days: number) {
  const before = new Date(Date.now() - days * DAY);
  switch (c) {
    case 'messages': return { model: 'message' as const, where: { tenantId, createdAt: { lt: before }, status: { notIn: ['pending_approval', 'queued'] }, NOT: { subject: REDACTED_SUBJECT } } };
    case 'notifications': return { model: 'notification' as const, where: { tenantId, createdAt: { lt: before } } };
    case 'sessions': return { model: 'session' as const, where: { tenantId, OR: [{ revokedAt: { lt: before } }, { revokedAt: null, expiresAt: { lt: before } }] } };
    case 'ai_calls': return { model: 'aiCall' as const, where: { tenantId, createdAt: { lt: before } } };
    case 'panel_calls': return { model: 'panelCall' as const, where: { tenantId, createdAt: { lt: before }, status: { in: ['sent', 'failed', 'not_sent'] } } };
  }
}

// Prisma delegates differ in type; the scopes above are only ever paired with their own model.
type Delegate = { count(a: { where: unknown }): Promise<number>; deleteMany(a: { where: unknown }): Promise<{ count: number }>; updateMany(a: { where: unknown; data: unknown }): Promise<{ count: number }> };
const delegate = (tx: Tx, m: string) => (tx as unknown as Record<string, Delegate>)[m];

/** Counts what a policy would remove now, per category. */
export async function eligible(tx: Tx, tenantId: string, policy: RetentionPolicy) {
  const out: Partial<Record<RetentionCategory, number>> = {};
  for (const c of categories) {
    const d = policy[c];
    if (d === undefined) continue;
    const s = scopes(tenantId, c, d);
    out[c] = await delegate(tx, s.model).count({ where: s.where });
  }
  return out;
}

/** Applies a workspace's policies. Message content is redacted; everything else is deleted. */
export async function applyRetention(tx: Tx, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { retention: true } });
  const policy = readPolicy(t.retention);
  const counts: Partial<Record<RetentionCategory, number>> = {};
  for (const c of categories) {
    const d = policy[c];
    if (d === undefined) continue;
    const s = scopes(tenantId, c, d);
    counts[c] = c === 'messages'
      ? (await delegate(tx, s.model).updateMany({ where: s.where, data: { subject: REDACTED_SUBJECT, body: '' } })).count
      : (await delegate(tx, s.model).deleteMany({ where: s.where })).count;
  }
  await tx.tenant.update({ where: { id: tenantId }, data: { retentionRunAt: new Date() } });
  return counts;
}

/** Audit entry for a run, by a person or by the worker (actor "system"). */
export function logRun(tx: Tx, tenantId: string, actor: { userId: string | null; name: string }, counts: Record<string, number>) {
  return tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actor: actor.name, action: 'retention.applied', entity: 'Tenant', entityId: tenantId, after: counts as Prisma.InputJsonValue } });
}

const PolicyBody = z.object({ category: z.enum(categories as [RetentionCategory, ...RetentionCategory[]]), days: z.number().int().max(3650).nullable() });
const WorkspaceBody = z.object({ name: z.string().trim().min(2).max(80) });

@ForModule('admin')
@Controller('admin')
export class RetentionController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** The workspace's identity and what it holds. */
  @Get('workspace')
  async workspace(@Caller() ctx: Ctx) {
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { id: true, name: true, slug: true, createdAt: true } });
    const w = { tenantId: ctx.tenantId };
    const [members, clients, vendors, projects, surveys, responses, panelists, messages, invoices, auditEntries] = await Promise.all([
      this.db.membership.count({ where: w }), this.db.client.count({ where: w }), this.db.vendor.count({ where: w }), this.db.project.count({ where: w }),
      this.db.survey.count({ where: w }), this.db.response.count({ where: w }), this.db.panelist.count({ where: w }), this.db.message.count({ where: w }),
      this.db.invoice.count({ where: w }), this.db.auditLog.count({ where: w }),
    ]);
    return { ...t, counts: { members, clients, vendors, projects, surveys, responses, panelists, messages, invoices, auditEntries } };
  }

  @Patch('workspace')
  @Write()
  async rename(@Caller() ctx: Ctx, @Body() body: unknown) {
    const { name } = parse(WorkspaceBody, body);
    return this.db.$transaction(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
      if (t.name === name) return { name, changed: false };
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { name } });
      await this.audit.log(ctx, 'workspace.renamed', 'Tenant', ctx.tenantId, { name: t.name }, { name }, tx);
      return { name, changed: true };
    });
  }

  /** Each category with its policy, what it would remove now, and pending requests. */
  @Get('retention')
  async retention(@Caller() ctx: Ctx) {
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { retention: true, retentionRunAt: true } });
    const policy = readPolicy(t.retention);
    const now = await eligible(this.db, ctx.tenantId, policy);
    const pending = await this.db.approval.findMany({ where: { tenantId: ctx.tenantId, kind: 'Deleting records', status: 'pending' }, select: { id: true, title: true, payload: true, createdAt: true } });
    return {
      lastRun: t.retentionRunAt,
      categories: categories.map((c) => ({
        category: c, ...RETENTION[c], days: policy[c] ?? null, eligibleNow: now[c] ?? 0,
        pending: pending.filter((a) => (a.payload as { retention?: { category?: string } })?.retention?.category === c).map((a) => ({ id: a.id, days: (a.payload as { retention: { days: number } }).retention.days, at: a.createdAt })),
      })),
    };
  }

  /**
   * Sets one category's period. Turning a policy on or shortening it asks for a 'Deleting records'
   * approval (with the number of rows it would remove today); lengthening or turning it off applies now.
   */
  @Put('retention')
  @Write()
  async setPolicy(@Caller() ctx: Ctx, @Body() body: unknown) {
    const { category, days } = parse(PolicyBody, body);
    const spec = RETENTION[category];
    if (days !== null && days < spec.min) throw new BadRequestException(`${spec.label} must be kept at least ${spec.min} days`);
    return this.db.$transaction(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { retention: true } });
      const policy = readPolicy(t.retention);
      const current = policy[category] ?? null;
      if (current === days) return { category, days, changed: false };
      const stricter = days !== null && (current === null || days < current);
      if (stricter) {
        const open = await tx.approval.findFirst({ where: { tenantId: ctx.tenantId, kind: 'Deleting records', status: 'pending', payload: { path: ['retention', 'category'], equals: category } } });
        if (open) throw new BadRequestException('A change to this policy is already waiting for a decision.');
        const n = (await eligible(tx, ctx.tenantId, { [category]: days }))[category] ?? 0;
        const ap = await requestApproval(tx, {
          tenantId: ctx.tenantId, kind: 'Deleting records', requestedBy: ctx.userId,
          title: `Keep ${spec.label.toLowerCase()} for ${days} days (now ${current === null ? 'kept indefinitely' : `${current} days`}); ${n.toLocaleString('en-US')} record(s) would be ${category === 'messages' ? 'redacted' : 'deleted'} at the next run`,
          payload: { retention: { category, days, from: current } },
        });
        await this.audit.log(ctx, 'retention.change_requested', 'Tenant', ctx.tenantId, { [category]: current }, { [category]: days, approvalId: ap.id }, tx);
        return { category, days: current, changed: false, approvalId: ap.id, wouldRemove: n };
      }
      const next = { ...policy };
      if (days === null) delete next[category]; else next[category] = days;
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { retention: next as Prisma.InputJsonValue } });
      await this.audit.log(ctx, 'retention.changed', 'Tenant', ctx.tenantId, { [category]: current }, { [category]: days }, tx);
      return { category, days, changed: true };
    });
  }

  /** Applies the current policies now, instead of waiting for the daily run. */
  @Post('retention/run')
  @Write()
  @HttpCode(200)
  async run(@Caller() ctx: Ctx) {
    return this.db.$transaction(async (tx) => {
      const counts = await applyRetention(tx, ctx.tenantId);
      await logRun(tx, ctx.tenantId, ctx, counts as Record<string, number>);
      return { counts };
    });
  }
}

/** Applies an approved retention change (called from the approvals service). */
export async function applyApprovedRetention(tx: Prisma.TransactionClient, tenantId: string, r: { category: string; days: number }) {
  if (!(r.category in RETENTION)) return 'Unknown category; nothing changed';
  const c = r.category as RetentionCategory;
  if (!Number.isInteger(r.days) || r.days < RETENTION[c].min) return 'Period below the minimum; nothing changed';
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { retention: true } });
  const next = { ...readPolicy(t.retention), [c]: r.days };
  await tx.tenant.update({ where: { id: tenantId }, data: { retention: next as Prisma.InputJsonValue } });
  return `${RETENTION[c].label} now kept for ${r.days} days; applied at the next daily run or when an administrator runs it`;
}
