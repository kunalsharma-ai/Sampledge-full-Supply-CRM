/**
 * SUPPLY360 operations endpoints behind the Audience Orbit X screens:
 *
 * - Outbound event deliveries (`/integrations/deliveries`): the outbox the worker drains, as a
 *   delivery log. An event the worker gave up on (5 attempts) can be retried; payloads are not
 *   returned, only the event type and delivery state.
 * - Points ledger (`/panels/ledger`): incentive entries with the member's pseudonymous handle and
 *   brand, newest first. Read-only: entries are posted in Finance, and corrections are new entries.
 * - Workspace settings (`/admin/settings`): values checked against the shared rules in
 *   @sampledge/core, stored on the tenant, with every change in the audit log. Settings whose
 *   record of truth is elsewhere (the reward policy, Finance's point value) are read through and
 *   refused here, so each value has one place it is edited.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { settingError, settingRule, settingRules, type SettingValue } from '@sampledge/core';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { paged, pageArgs } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { currentRewardPolicy } from './panel-analytics';

export const MAX_ATTEMPTS = 5;
type DeliveryStatus = 'delivered' | 'queued' | 'retrying' | 'failed';
const statusOf = (e: { processedAt: Date | null; attempts: number; lastError: string | null }): DeliveryStatus =>
  e.processedAt ? 'delivered' : e.attempts >= MAX_ATTEMPTS ? 'failed' : e.attempts > 0 && e.lastError ? 'retrying' : 'queued';
const statusWhere: Record<DeliveryStatus, Prisma.OutboxEventWhereInput> = {
  delivered: { processedAt: { not: null } },
  failed: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
  retrying: { processedAt: null, attempts: { gt: 0, lt: MAX_ATTEMPTS }, lastError: { not: null } },
  queued: { processedAt: null, attempts: { lt: MAX_ATTEMPTS }, OR: [{ attempts: 0 }, { lastError: null }] },
};

@ForModule('integrations')
@Controller('integrations/deliveries')
export class DeliveriesController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** Newest first. `status` filters to delivered, queued, retrying or failed; counts per status are at /summary. */
  @Get()
  async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const x = parse(z.object({ status: z.enum(['delivered', 'queued', 'retrying', 'failed']).optional(), type: z.string().max(80).optional() }).passthrough(), q);
    const { want, ...page } = pageArgs(q, 200, 50);
    const rows = await this.db.outboxEvent.findMany({
      where: { tenantId: ctx.tenantId, ...(x.status ? statusWhere[x.status] : {}), ...(x.type ? { type: x.type } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page,
      select: { id: true, type: true, createdAt: true, processedAt: true, attempts: true, lastError: true },
    });
    return paged(rows.map((r) => ({ ...r, status: statusOf(r) })), want, res);
  }

  @Get('summary')
  async summary(@Caller() ctx: Ctx) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const count = (w: Prisma.OutboxEventWhereInput) => this.db.outboxEvent.count({ where: { tenantId: ctx.tenantId, ...w } });
    const [delivered24h, queued, retrying, failed] = await Promise.all([count({ processedAt: { gte: since } }), count(statusWhere.queued), count(statusWhere.retrying), count(statusWhere.failed)]);
    return { delivered24h, queued, retrying, failed };
  }

  /** Puts a failed event back in the queue; the worker delivers it on its next pass. Receivers de-duplicate by event id. */
  @Post(':id/retry') @Write() @HttpCode(200)
  async retry(@Caller() ctx: Ctx, @Param('id') id: string) {
    const e = await this.db.outboxEvent.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!e) throw new NotFoundException('Delivery not found');
    if (statusOf(e) !== 'failed') throw new BadRequestException(e.processedAt ? 'Already delivered' : 'Still being retried automatically');
    await this.db.$transaction(async (tx) => {
      await tx.outboxEvent.update({ where: { id }, data: { attempts: 0, lockedUntil: null } });
      await this.audit.log(ctx, 'delivery.retry', 'OutboxEvent', id, { attempts: e.attempts, lastError: e.lastError }, { attempts: 0 }, tx);
    });
    return { id, status: 'queued' as const };
  }
}

@ForModule('panels')
@Controller('panels')
export class PanelLedgerController {
  constructor(private db: PrismaService) {}

  /** Incentive entries, newest first, with each member's handle and brand. Filters: kind, status, panelistId. */
  @Get('ledger')
  async ledger(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const x = parse(z.object({ kind: z.enum(['earn', 'redeem', 'adjust', 'expire']).optional(), status: z.enum(['posted', 'pending_approval', 'rejected']).optional(), panelistId: z.string().max(40).optional() }).passthrough(), q);
    const { want, ...page } = pageArgs(q, 200, 50);
    const rows = await this.db.incentiveEntry.findMany({
      where: { tenantId: ctx.tenantId, ...(x.kind ? { kind: x.kind } : {}), ...(x.status ? { status: x.status } : {}), ...(x.panelistId ? { panelistId: x.panelistId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page,
    });
    const who = new Map((await this.db.panelist.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.map((r) => r.panelistId))] } }, select: { id: true, handle: true, brand: true } })).map((p) => [p.id, p]));
    return paged(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, kind: r.kind, points: r.points, valueBase: r.valueBase, status: r.status, projectId: r.projectId, note: r.note, createdBy: r.createdBy, panelist: who.get(r.panelistId) ?? null })), want, res);
  }
}

const Changes = z.object({ changes: z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()])).refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 40, 'Send between 1 and 40 changes') });

@ForModule('admin')
@Controller('admin/settings')
export class SettingsController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private async values(tx: Prisma.TransactionClient | PrismaService, tenantId: string) {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, pointValue: true, supplySettings: true } });
    const stored = (t.supplySettings && typeof t.supplySettings === 'object' ? t.supplySettings : {}) as Record<string, SettingValue>;
    const policy = await currentRewardPolicy(tx, tenantId);
    const out: Record<string, SettingValue> = {};
    for (const r of settingRules) out[r.id] = r.id in stored && settingError(r.id, stored[r.id], { ...out, ...stored }) === null ? stored[r.id] : r.default;
    out['tenant.name'] = t.name;
    out['rewards.pointValue'] = Math.round(1 / t.pointValue);
    if (policy) { out['send.weeklyCap'] = policy.weeklyInviteCap; out['rewards.minRedeem'] = policy.redemptionThreshold; }
    return { values: out, stored };
  }

  /** Every setting's current value, which ones are managed elsewhere, and the last 20 changes. */
  @Get()
  async get(@Caller() ctx: Ctx) {
    const { values } = await this.values(this.db, ctx.tenantId);
    const history = await this.db.auditLog.findMany({ where: { tenantId: ctx.tenantId, entity: 'Setting' }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: 20 });
    return {
      values,
      managed: Object.fromEntries(settingRules.filter((r) => r.managedBy).map((r) => [r.id, r.managedBy!])),
      history: history.map((h) => ({ id: h.id, at: h.at, who: h.actor, setting: h.entityId, from: (h.before as { value?: SettingValue } | null)?.value ?? null, to: (h.after as { value?: SettingValue } | null)?.value ?? null })),
    };
  }

  /** Applies all changes or none. Each changed value is one audit entry. */
  @Patch() @Write()
  async patch(@Caller() ctx: Ctx, @Body() body: unknown) {
    const { changes } = parse(Changes, body);
    return this.db.$transaction(async (tx) => {
      const { values, stored } = await this.values(tx, ctx.tenantId);
      const next = { ...values, ...changes };
      const errors: Record<string, string> = {};
      for (const [id, v] of Object.entries(changes)) {
        const r = settingRule(id);
        const err = !r ? 'Unknown setting' : r.managedBy ? `Managed in ${r.managedBy.label}; change it there` : settingError(id, v, next);
        if (err) errors[id] = err;
      }
      if (Object.keys(errors).length) throw new BadRequestException({ message: Object.entries(errors).map(([k, e]) => `${k}: ${e}`).join('; '), errors });
      const changed = Object.entries(changes).filter(([id, v]) => values[id] !== v);
      if (!changed.length) return { values, changed: 0 };
      const keep = { ...stored };
      for (const [id, v] of changed) if (id !== 'tenant.name') keep[id] = v;
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { supplySettings: keep as Prisma.InputJsonValue, ...('tenant.name' in changes ? { name: String(changes['tenant.name']).trim() } : {}) } });
      for (const [id, v] of changed) await this.audit.log(ctx, 'setting.changed', 'Setting', id, { value: values[id] }, { value: v }, tx);
      return { values: (await this.values(tx, ctx.tenantId)).values, changed: changed.length };
    });
  }
}
