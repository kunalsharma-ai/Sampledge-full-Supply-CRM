/**
 * SUPPLY360 working records: the things people plan and track on the SUPPLY360 screens that have no
 * dedicated table (weekly programme weeks, saved reports, campaign drafts, journeys, support
 * tickets, quality cases, workflows, overrides ...). One table, `SupplyRecord`, with a registry of
 * kinds below. Each kind says:
 *
 * - which module's role access governs it (read needs any access, changes need 'full'; scoped
 *   roles such as vendors and clients never see supply records),
 * - the zod shape of its `data`, checked on every create and update,
 * - its statuses and which status changes are allowed (actions),
 * - an optional effect that runs in the same transaction as an action (for example suspending a
 *   panellist when a quality case is decided), so the record and its effect commit together.
 *
 * Every create, update and action is one audit entry (entity `SupplyRecord`). Updates carry the
 * version the person last saw; a stale version is refused (409) instead of overwriting someone
 * else's change.
 */
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, type SupplyRecord } from '@prisma/client';
import { access, type ModuleId } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

type Tx = Prisma.TransactionClient;
export type RecordAction = {
  /** statuses the action can start from */
  from: string[];
  to: string;
  /** extra body the action takes (validated), e.g. a reason */
  body?: z.ZodType<Record<string, unknown>>;
  /** runs in the action's transaction; may return data fields to merge into the record */
  effect?: (tx: Tx, ctx: Ctx, rec: SupplyRecord, body: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
};
export type RecordKind = {
  label: string;
  module: ModuleId;
  /** prefix of the human reference, e.g. TCK-1001 */
  prefix: string;
  data: z.ZodType<Record<string, unknown>>;
  /** title shown in lists, from the data */
  title: (d: Record<string, unknown>) => string;
  statuses: readonly string[];
  initial: string;
  /** statuses in which the data can still be edited (default: all but the last listed status) */
  editableIn?: readonly string[];
  actions?: Record<string, RecordAction>;
  /** checks across records, e.g. one weekly programme entry per week */
  unique?: (d: Record<string, unknown>) => string | null;
};

const kinds = new Map<string, RecordKind>();
/** Kinds register themselves from their own module files (see supply-kinds.ts). */
export function registerKind(id: string, k: RecordKind) {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) throw new Error(`Bad record kind id ${id}`);
  kinds.set(id, k);
}
export const recordKind = (id: string) => kinds.get(id);
export const recordKinds = () => [...kinds.entries()];

const ListQuery = z.object({ status: z.string().max(40).optional(), q: z.string().max(100).optional(), take: z.coerce.number().int().min(1).max(500).default(200) }).passthrough();
const CreateBody = z.object({ data: z.record(z.string(), z.unknown()) }).strict();
const UpdateBody = z.object({ data: z.record(z.string(), z.unknown()), version: z.number().int().min(1) }).strict();
const ActionBody = z.object({ version: z.number().int().min(1) }).passthrough();

export const recordView = (r: SupplyRecord) => ({ id: r.id, ref: r.ref, kind: r.kind, status: r.status, title: r.title, data: r.data as Record<string, unknown>, version: r.version, createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt });
export type RecordView = ReturnType<typeof recordView>;

const zodMessage = (e: z.ZodError) => e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

@Injectable()
export class SupplyRecordsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  kind(ctx: Ctx, id: string, write: boolean) {
    const k = kinds.get(id);
    if (!k) throw new NotFoundException(`Unknown record kind ${id}`);
    const a = access(ctx.role, k.module);
    if (a === 'none' || a === 'scoped') throw new ForbiddenException(`Your role has no access to ${k.label.toLowerCase()}`);
    if (write && a !== 'full') throw new ForbiddenException(`Your role has read-only access to ${k.label.toLowerCase()}`);
    return k;
  }

  private check(k: RecordKind, data: unknown) {
    const r = k.data.safeParse(data);
    if (!r.success) throw new BadRequestException(zodMessage(r.error));
    return r.data;
  }

  private async unique(tx: Tx, ctx: Ctx, kindId: string, k: RecordKind, data: Record<string, unknown>, exceptId?: string) {
    const key = k.unique?.(data);
    if (!key) return;
    const others = await tx.supplyRecord.findMany({ where: { tenantId: ctx.tenantId, kind: kindId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { data: true, ref: true } });
    const clash = others.find((o) => k.unique!(o.data as Record<string, unknown>) === key);
    if (clash) throw new ConflictException(`${clash.ref} already covers this`);
  }

  private async nextRef(tx: Tx, tenantId: string, prefix: string) {
    const last = await tx.supplyRecord.findMany({ where: { tenantId, ref: { startsWith: `${prefix}-` } }, select: { ref: true } });
    const n = last.reduce((m, r) => Math.max(m, Number(r.ref.slice(prefix.length + 1)) || 0), 1000);
    return `${prefix}-${n + 1}`;
  }

  async list(ctx: Ctx, kindId: string, q: z.infer<typeof ListQuery>) {
    this.kind(ctx, kindId, false);
    const rows = await this.db.supplyRecord.findMany({
      where: { tenantId: ctx.tenantId, kind: kindId, ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { ref: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: q.take,
    });
    return rows.map(recordView);
  }

  async get(ctx: Ctx, kindId: string, id: string) {
    this.kind(ctx, kindId, false);
    const r = await this.db.supplyRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: kindId, OR: [{ id }, { ref: id }] } });
    if (!r) throw new NotFoundException('Record not found');
    return recordView(r);
  }

  async create(ctx: Ctx, kindId: string, b: z.infer<typeof CreateBody>, tx?: Tx) {
    const k = this.kind(ctx, kindId, true);
    const data = this.check(k, b.data);
    const status = k.initial;
    const run = async (t: Tx) => {
      await this.unique(t, ctx, kindId, k, data);
      const r = await t.supplyRecord.create({ data: { tenantId: ctx.tenantId, kind: kindId, ref: await this.nextRef(t, ctx.tenantId, k.prefix), status, title: k.title(data).slice(0, 200), data: data as Prisma.InputJsonValue, createdBy: ctx.name, createdById: ctx.userId } });
      await this.audit.log(ctx, `${kindId}.created`, 'SupplyRecord', r.id, null, { ref: r.ref, status, data }, t);
      return recordView(r);
    };
    return tx ? run(tx) : this.db.$transaction(run);
  }

  async update(ctx: Ctx, kindId: string, id: string, b: z.infer<typeof UpdateBody>) {
    const k = this.kind(ctx, kindId, true);
    return this.db.$transaction(async (tx) => {
      const r = await tx.supplyRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: kindId, id } });
      if (!r) throw new NotFoundException('Record not found');
      if (r.version !== b.version) throw new ConflictException(`${r.ref} was changed by ${r.createdBy === ctx.name ? 'you in another tab' : 'someone else'} since you opened it; reload to see the latest`);
      const editable = k.editableIn ?? k.statuses.slice(0, -1);
      if (!editable.includes(r.status)) throw new BadRequestException(`A ${r.status} ${k.label.toLowerCase()} can no longer be edited`);
      const data = this.check(k, { ...(r.data as object), ...b.data });
      await this.unique(tx, ctx, kindId, k, data, r.id);
      const n = await tx.supplyRecord.updateMany({ where: { id: r.id, version: r.version }, data: { data: data as Prisma.InputJsonValue, title: k.title(data).slice(0, 200), version: { increment: 1 } } });
      if (!n.count) throw new ConflictException('Changed by someone else just now; reload to see the latest');
      await this.audit.log(ctx, `${kindId}.updated`, 'SupplyRecord', r.id, { data: r.data }, { data }, tx);
      return recordView(await tx.supplyRecord.findUniqueOrThrow({ where: { id: r.id } }));
    });
  }

  async act(ctx: Ctx, kindId: string, id: string, action: string, body: unknown) {
    const k = this.kind(ctx, kindId, true);
    const a = k.actions?.[action];
    if (!a) throw new NotFoundException(`${k.label} has no action ${action}`);
    const { version, ...rest } = parse(ActionBody, body);
    const extra = a.body ? (() => { const p = a.body!.safeParse(rest); if (!p.success) throw new BadRequestException(zodMessage(p.error)); return p.data; })() : {};
    return this.db.$transaction(async (tx) => {
      const r = await tx.supplyRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: kindId, id } });
      if (!r) throw new NotFoundException('Record not found');
      if (r.version !== version) throw new ConflictException(`${r.ref} was changed since you opened it; reload to see the latest`);
      if (!a.from.includes(r.status)) throw new BadRequestException(`A ${r.status} ${k.label.toLowerCase()} cannot be ${a.to}`);
      const merged = { ...(r.data as object), ...((await a.effect?.(tx, ctx, r, extra)) ?? {}) };
      const n = await tx.supplyRecord.updateMany({ where: { id: r.id, version: r.version }, data: { status: a.to, data: merged as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (!n.count) throw new ConflictException('Changed by someone else just now; reload to see the latest');
      await this.audit.log(ctx, `${kindId}.${action}`, 'SupplyRecord', r.id, { status: r.status }, { status: a.to, ...extra }, tx);
      return recordView(await tx.supplyRecord.findUniqueOrThrow({ where: { id: r.id } }));
    });
  }
}

/** Access is checked per kind in the service (each kind belongs to a module), so no @ForModule here. */
@Controller('supply/records')
export class SupplyRecordsController {
  constructor(private s: SupplyRecordsService) {}

  /** The kinds this caller can read, with their statuses and actions. */
  @Get()
  kinds(@Caller() ctx: Ctx) {
    return recordKinds().filter(([, k]) => !['none', 'scoped'].includes(access(ctx.role, k.module))).map(([id, k]) => ({
      id, label: k.label, module: k.module, statuses: k.statuses, initial: k.initial, canWrite: access(ctx.role, k.module) === 'full',
      actions: Object.fromEntries(Object.entries(k.actions ?? {}).map(([n, a]) => [n, { from: a.from, to: a.to }])),
    }));
  }

  @Get(':kind') list(@Caller() ctx: Ctx, @Param('kind') kind: string, @Query() q: unknown) { return this.s.list(ctx, kind, parse(ListQuery, q)); }
  @Get(':kind/:id') get(@Caller() ctx: Ctx, @Param('kind') kind: string, @Param('id') id: string) { return this.s.get(ctx, kind, id); }
  @Post(':kind') create(@Caller() ctx: Ctx, @Param('kind') kind: string, @Body() b: unknown) { return this.s.create(ctx, kind, parse(CreateBody, b)); }
  @Patch(':kind/:id') update(@Caller() ctx: Ctx, @Param('kind') kind: string, @Param('id') id: string, @Body() b: unknown) { return this.s.update(ctx, kind, id, parse(UpdateBody, b)); }
  @Post(':kind/:id/:action') @HttpCode(200)
  act(@Caller() ctx: Ctx, @Param('kind') kind: string, @Param('id') id: string, @Param('action') action: string, @Body() b: unknown) { return this.s.act(ctx, kind, id, action, b); }
}
