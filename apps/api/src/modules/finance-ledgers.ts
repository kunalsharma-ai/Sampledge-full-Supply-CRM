/**
 * Finance ledgers beyond invoices and payables:
 * - Multi-currency: the workspace reports in a base currency. Clients and vendors can be billed in
 *   their own currency at a rate finance records (no market feed is connected). Each invoice and PO
 *   keeps the rate it was raised at, so totals do not move when rates change later.
 * - Reconciliation: each PO's ordered completes against the completes Sampledge recorded from that
 *   vendor, and the count finance accepts. Accepting fewer adjusts the open payable before payment.
 * - Incentives ledger: panel points earned, redeemed, adjusted and expired, with the liability in
 *   the base currency. A redemption is paid out, so it is an 'Issuing payments' approval.
 * - Forecast vs actuals: revenue and cost planned on projects against what was invoiced and ordered.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { can } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

type Tx = Prisma.TransactionClient | PrismaService;
const Currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO 4217 code, such as EUR');

/** The latest recorded rate (base currency per unit), 1 for the base currency, or null if none is recorded. */
export async function rateFor(tx: Tx, tenantId: string, currency: string): Promise<number | null> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } });
  if (currency === t.baseCurrency) return 1;
  const r = await tx.exchangeRate.findFirst({ where: { tenantId, currency, effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
  return r?.rate ?? null;
}

/**
 * The currency and rate a new document to this party uses. Without a recorded rate for the party's
 * currency, the document is raised in the base currency (and says so) rather than at a guessed rate.
 */
export async function documentCurrency(tx: Tx, tenantId: string, partyCurrency: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } });
  const rate = await rateFor(tx, tenantId, partyCurrency);
  return rate ? { currency: partyCurrency, fxRate: rate } : { currency: t.baseCurrency, fxRate: 1 };
}

/** Converts a base-currency price into the document's currency. */
export const toDoc = (base: number, fxRate: number) => base / fxRate;

/** Invoice fields for a project's delivered completes, in the client's currency when a rate is recorded. */
export async function invoiceTerms(tx: Tx, tenantId: string, pr: { id: string; clientId: string; completes: number; cpiSell: number }) {
  const c = await tx.client.findUniqueOrThrow({ where: { id: pr.clientId }, select: { currency: true } });
  const fx = await documentCurrency(tx, tenantId, c.currency);
  const cpi = Math.round(toDoc(pr.cpiSell, fx.fxRate) * 100) / 100;
  return { clientId: pr.clientId, projectId: pr.id, completes: pr.completes, cpi, amount: Math.round(pr.completes * cpi), currency: fx.currency, fxRate: fx.fxRate };
}

const internal = (ctx: Ctx) => {
  if (ctx.role === 'vendor' || ctx.role === 'client') throw new ForbiddenException('Internal finance only');
};
const month = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

@ForModule('finance')
@Controller('finance')
export class FinanceLedgersController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  // ---- Currencies -------------------------------------------------------------------------------

  @Get('currencies')
  async currencies(@Caller() ctx: Ctx) {
    internal(ctx);
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { baseCurrency: true, pointValue: true } });
    const all = await this.db.exchangeRate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const latest = new Map<string, (typeof all)[number]>();
    for (const r of all) if (!latest.has(r.currency) && r.effectiveFrom <= new Date()) latest.set(r.currency, r);
    const [clients, vendors] = await Promise.all([
      this.db.client.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, currency: true }, orderBy: { name: 'asc' } }),
      this.db.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, currency: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      base: t.baseCurrency, pointValue: t.pointValue,
      rates: [...latest.values()].map((r) => ({ currency: r.currency, rate: r.rate, effectiveFrom: r.effectiveFrom, setBy: r.setBy, history: all.filter((x) => x.currency === r.currency).length })),
      clients, vendors,
    };
  }

  /** Records a rate (base currency per unit). Applies to documents raised from now on. */
  @Post('rates')
  @Write()
  async setRate(@Caller() ctx: Ctx, @Body() body: unknown) {
    internal(ctx);
    const b = parse(z.object({ currency: Currency, rate: z.number().positive().max(1e6) }), body);
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { baseCurrency: true } });
    if (b.currency === t.baseCurrency) throw new BadRequestException(`${b.currency} is the base currency; its rate is always 1`);
    return this.db.$transaction(async (tx) => {
      const before = await rateFor(tx, ctx.tenantId, b.currency);
      const r = await tx.exchangeRate.create({ data: { tenantId: ctx.tenantId, currency: b.currency, rate: b.rate, setBy: ctx.name } });
      await this.audit.log(ctx, 'fx.rate_set', 'ExchangeRate', r.id, { currency: b.currency, rate: before }, { currency: b.currency, rate: b.rate }, tx);
      return r;
    });
  }

  /** Changes the base currency, only while no invoice or purchase order exists (amounts would otherwise change meaning). */
  @Put('currencies/base')
  @Write()
  async setBase(@Caller() ctx: Ctx, @Body() body: unknown) {
    internal(ctx);
    const { currency } = parse(z.object({ currency: Currency }), body);
    const docs = (await this.db.invoice.count({ where: { tenantId: ctx.tenantId } })) + (await this.db.purchaseOrder.count({ where: { tenantId: ctx.tenantId } }));
    if (docs) throw new BadRequestException('The base currency is fixed once invoices or purchase orders exist.');
    return this.db.$transaction(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { baseCurrency: true } });
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { baseCurrency: currency } });
      await this.audit.log(ctx, 'fx.base_changed', 'Tenant', ctx.tenantId, { baseCurrency: t.baseCurrency }, { baseCurrency: currency }, tx);
      return { base: currency };
    });
  }

  /** Sets the currency a client is invoiced in, or a vendor is ordered from. Needs a recorded rate unless it is the base. */
  @Put('currencies/party')
  @Write()
  async setParty(@Caller() ctx: Ctx, @Body() body: unknown) {
    internal(ctx);
    const b = parse(z.object({ kind: z.enum(['client', 'vendor']), id: z.string(), currency: Currency }), body);
    if ((await rateFor(this.db, ctx.tenantId, b.currency)) === null) throw new BadRequestException(`Record a ${b.currency} rate first`);
    return this.db.$transaction(async (tx) => {
      const where = { id: b.id, tenantId: ctx.tenantId };
      const before = b.kind === 'client' ? await tx.client.findFirst({ where }) : await tx.vendor.findFirst({ where });
      if (!before) throw new NotFoundException(`${b.kind} not found`);
      if (b.kind === 'client') await tx.client.update({ where: { id: b.id }, data: { currency: b.currency } });
      else await tx.vendor.update({ where: { id: b.id }, data: { currency: b.currency } });
      await this.audit.log(ctx, 'fx.party_currency', b.kind === 'client' ? 'Client' : 'Vendor', b.id, { currency: before.currency }, { currency: b.currency }, tx);
      return { ...b };
    });
  }

  // ---- Reconciliation ---------------------------------------------------------------------------

  @Get('reconciliation')
  async reconciliation(@Caller() ctx: Ctx) {
    internal(ctx);
    if (!can(ctx.role, 'view:vendor_bids')) throw new ForbiddenException('Needs view:vendor_bids');
    const pos = await this.db.purchaseOrder.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'cancelled' } }, include: { payables: true }, orderBy: { issuedAt: 'desc' } });
    const vendors = new Map((await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    const projects = new Map((await this.db.project.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
    // Completes Sampledge itself recorded from each vendor, per project: usable completes tagged with the vendor as source.
    const recorded = await this.db.$queryRaw<{ projectId: string; source: string; n: bigint }[]>`
      SELECT s."projectId", r."source", count(*) AS n FROM "Response" r JOIN "Survey" s ON s."id" = r."surveyId"
      WHERE r."tenantId" = ${ctx.tenantId} AND r."outcome" = 'complete' AND r."rejectedAt" IS NULL AND r."source" LIKE 'vendor:%'
      GROUP BY s."projectId", r."source"`;
    const rec = new Map(recorded.map((r) => [`${r.projectId}|${r.source}`, Number(r.n)]));
    return pos.map((po) => {
      const pay = po.payables[0];
      const recordedCompletes = rec.get(`${po.projectId}|vendor:${po.vendorId}`) ?? 0;
      const accepted = po.acceptedCompletes;
      return {
        id: po.id, number: po.number, vendorId: po.vendorId, vendorName: vendors.get(po.vendorId), projectCode: projects.get(po.projectId),
        currency: po.currency, cpi: po.cpi, ordered: po.completes, recordedCompletes, accepted,
        orderedAmount: po.amount, payableAmount: pay?.amount ?? null, payableStatus: pay?.status ?? null,
        variance: accepted === null ? null : accepted - po.completes,
        reconciledAt: po.reconciledAt, note: po.reconcileNote, status: po.status,
      };
    });
  }

  /** Records the completes accepted against a PO and adjusts its open payable. Closes the PO. */
  @Post('reconciliation/:id')
  @Write()
  async reconcile(@Caller() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    internal(ctx);
    const b = parse(z.object({ acceptedCompletes: z.number().int().min(0), note: z.string().trim().max(500).optional() }), body);
    return this.db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { payables: true } });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.reconciledAt) throw new BadRequestException('Already reconciled');
      if (b.acceptedCompletes > po.completes) throw new BadRequestException(`More than the ${po.completes} completes ordered; raise a new PO for extra completes`);
      if (b.acceptedCompletes < po.completes && !b.note) throw new BadRequestException('Say why fewer completes were accepted');
      const pay = po.payables[0];
      if (pay && pay.status !== 'open') throw new BadRequestException(pay.status === 'paid' ? 'Already paid; record a credit with the vendor instead' : 'Payment is awaiting approval; decide it first');
      const amount = Math.round(b.acceptedCompletes * po.cpi);
      await tx.purchaseOrder.update({ where: { id }, data: { acceptedCompletes: b.acceptedCompletes, reconciledAt: new Date(), reconcileNote: b.note ?? null, status: 'closed' } });
      if (pay && pay.amount !== amount) {
        await tx.payable.update({ where: { id: pay.id }, data: { amount } });
        await tx.vendor.update({ where: { id: po.vendorId }, data: { pendingPayment: { decrement: Math.round((pay.amount - amount) * po.fxRate) } } });
      }
      await this.audit.log(ctx, 'po.reconciled', 'PurchaseOrder', id, { completes: po.completes, payable: pay?.amount }, { acceptedCompletes: b.acceptedCompletes, payable: amount, note: b.note }, tx);
      return { id, acceptedCompletes: b.acceptedCompletes, payableAmount: amount, currency: po.currency };
    });
  }

  // ---- Incentives -------------------------------------------------------------------------------

  @Get('incentives')
  async incentives(@Caller() ctx: Ctx) {
    internal(ctx);
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { baseCurrency: true, pointValue: true } });
    const outstanding = await this.db.panelist.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { points: true } });
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const byKind = await this.db.incentiveEntry.groupBy({ by: ['kind'], where: { tenantId: ctx.tenantId, status: 'posted', createdAt: { gte: since } }, _sum: { points: true, valueBase: true } });
    const pending = await this.db.incentiveEntry.aggregate({ where: { tenantId: ctx.tenantId, status: 'pending_approval' }, _sum: { points: true, valueBase: true }, _count: true });
    const entries = await this.db.incentiveEntry.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const handles = new Map((await this.db.panelist.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.panelistId))] } }, select: { id: true, handle: true, brand: true, points: true } })).map((p) => [p.id, p]));
    const points = outstanding._sum.points ?? 0;
    return {
      base: t.baseCurrency, pointValue: t.pointValue, outstandingPoints: points, liability: points * t.pointValue,
      thisMonth: Object.fromEntries(byKind.map((k) => [k.kind, { points: k._sum.points ?? 0, value: k._sum.valueBase ?? 0 }])),
      pendingRedemptions: { count: pending._count, points: -(pending._sum.points ?? 0), value: -(pending._sum.valueBase ?? 0) },
      entries: entries.map((e) => ({ ...e, panelist: handles.get(e.panelistId) ?? null })),
    };
  }

  /**
   * Posts an entry. earn adds points; expire removes them; adjust is signed. A redemption is cash out,
   * so it waits for an 'Issuing payments' approval and the points leave the balance only when approved.
   */
  @Post('incentives')
  @Write()
  async post(@Caller() ctx: Ctx, @Body() body: unknown) {
    internal(ctx);
    const b = parse(z.object({ panelistId: z.string(), kind: z.enum(['earn', 'redeem', 'adjust', 'expire']), points: z.number().int().refine((n) => n !== 0, 'Points cannot be zero').refine((n) => Math.abs(n) <= 1_000_000), projectId: z.string().optional(), note: z.string().trim().max(500).optional() }), body);
    if (b.kind !== 'adjust' && b.points < 0) throw new BadRequestException('Give a positive number of points; only adjustments are signed');
    if (b.kind === 'adjust' && !b.note) throw new BadRequestException('Say why the balance is adjusted');
    const delta = b.kind === 'earn' || b.kind === 'adjust' ? b.points : -b.points;
    return this.db.$transaction(async (tx) => {
      const p = await tx.panelist.findFirst({ where: { id: b.panelistId, tenantId: ctx.tenantId } });
      if (!p) throw new NotFoundException('Panel member not found');
      if (b.projectId && !(await tx.project.findFirst({ where: { id: b.projectId, tenantId: ctx.tenantId } }))) throw new NotFoundException('Project not found');
      const reserved = -((await tx.incentiveEntry.aggregate({ where: { tenantId: ctx.tenantId, panelistId: p.id, status: 'pending_approval' }, _sum: { points: true } }))._sum.points ?? 0);
      if (delta < 0 && p.points - reserved + delta < 0) throw new BadRequestException(`Only ${p.points - reserved} point(s) available${reserved ? ` (${reserved} awaiting a redemption decision)` : ''}`);
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { pointValue: true, baseCurrency: true } });
      const valueBase = Math.round(delta * t.pointValue * 100) / 100;
      if (b.kind === 'redeem') {
        const e = await tx.incentiveEntry.create({ data: { tenantId: ctx.tenantId, panelistId: p.id, kind: 'redeem', points: delta, valueBase, status: 'pending_approval', projectId: b.projectId, note: b.note, createdBy: ctx.name } });
        const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Issuing payments', title: `Incentive redemption: ${p.handle} (${p.brand}), ${b.points.toLocaleString('en-US')} points = ${t.baseCurrency} ${(-valueBase).toFixed(2)}`, amount: Math.round(-valueBase), projectId: b.projectId ?? null, requestedBy: ctx.userId, payload: { incentiveEntryId: e.id } });
        await tx.incentiveEntry.update({ where: { id: e.id }, data: { approvalId: ap.id } });
        await this.audit.log(ctx, 'incentive.redeem_requested', 'IncentiveEntry', e.id, undefined, { panelist: p.handle, points: delta, valueBase, approvalId: ap.id }, tx);
        return { ...e, approvalId: ap.id };
      }
      const e = await tx.incentiveEntry.create({ data: { tenantId: ctx.tenantId, panelistId: p.id, kind: b.kind, points: delta, valueBase, projectId: b.projectId, note: b.note, createdBy: ctx.name } });
      await tx.panelist.update({ where: { id: p.id }, data: { points: { increment: delta } } });
      await this.audit.log(ctx, `incentive.${b.kind}`, 'IncentiveEntry', e.id, { points: p.points }, { panelist: p.handle, points: p.points + delta, delta }, tx);
      return e;
    });
  }

  /** Panel members by pseudonymous handle, for picking whom an entry is for. */
  @Get('incentives/members')
  async members(@Caller() ctx: Ctx, @Query() q: unknown) {
    internal(ctx);
    const { q: text } = parse(z.object({ q: z.string().trim().max(60).default('') }), q);
    return this.db.panelist.findMany({ where: { tenantId: ctx.tenantId, ...(text ? { handle: { contains: text, mode: 'insensitive' } } : {}) }, select: { id: true, handle: true, brand: true, points: true, status: true }, orderBy: { handle: 'asc' }, take: 20 });
  }

  /** The cash value of a point, for entries posted from now on. */
  @Put('incentives/point-value')
  @Write()
  async pointValue(@Caller() ctx: Ctx, @Body() body: unknown) {
    internal(ctx);
    const { value } = parse(z.object({ value: z.number().positive().max(1000) }), body);
    return this.db.$transaction(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { pointValue: true } });
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { pointValue: value } });
      await this.audit.log(ctx, 'incentive.point_value', 'Tenant', ctx.tenantId, { pointValue: t.pointValue }, { pointValue: value }, tx);
      return { pointValue: value };
    });
  }

  // ---- Forecast vs actuals ----------------------------------------------------------------------

  /**
   * Per month, planned revenue (each project's target × sell CPI, in its deadline month) against
   * invoiced revenue (by issue date), and, for roles that see margins, planned cost (target × cost CPI)
   * against ordered cost (POs by issue date). All in the base currency. Plus the same per project.
   */
  @Get('forecast')
  async forecast(@Caller() ctx: Ctx) {
    internal(ctx);
    const margins = can(ctx.role, 'view:margins');
    const t = await this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { baseCurrency: true } });
    const [projects, invoices, pos] = await Promise.all([
      this.db.project.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true, name: true, stage: true, deadline: true, target: true, cpiSell: true, cpiCost: true } }),
      this.db.invoice.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['issued', 'paid'] } }, select: { projectId: true, amount: true, fxRate: true, issuedAt: true } }),
      this.db.purchaseOrder.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'cancelled' } }, include: { payables: { select: { amount: true } } } }),
    ]);
    const now = new Date();
    const months: string[] = [];
    for (let i = -6; i <= 3; i++) months.push(month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))));
    const row = () => ({ forecastRevenue: 0, actualRevenue: 0, forecastCost: 0, actualCost: 0 });
    const byMonth = new Map(months.map((m) => [m, row()]));
    const byProject = new Map(projects.map((p) => [p.id, row()]));
    for (const p of projects) {
      const m = byMonth.get(month(p.deadline)); const r = byProject.get(p.id)!;
      r.forecastRevenue = p.target * p.cpiSell; r.forecastCost = p.target * p.cpiCost;
      if (m) { m.forecastRevenue += r.forecastRevenue; m.forecastCost += r.forecastCost; }
    }
    for (const i of invoices) {
      const v = i.amount * i.fxRate;
      if (i.issuedAt) { const m = byMonth.get(month(i.issuedAt)); if (m) m.actualRevenue += v; }
      const r = byProject.get(i.projectId); if (r) r.actualRevenue += v;
    }
    for (const po of pos) {
      // Cost is what is owed after reconciliation (the payable), or the PO amount before it.
      const v = (po.payables[0]?.amount ?? po.amount) * po.fxRate;
      const m = byMonth.get(month(po.issuedAt)); if (m) m.actualCost += v;
      const r = byProject.get(po.projectId); if (r) r.actualCost += v;
    }
    const round = (r: ReturnType<typeof row>) => ({
      forecastRevenue: Math.round(r.forecastRevenue), actualRevenue: Math.round(r.actualRevenue),
      ...(margins ? { forecastCost: Math.round(r.forecastCost), actualCost: Math.round(r.actualCost) } : {}),
    });
    return {
      base: t.baseCurrency, current: month(now), margins,
      months: months.map((m) => ({ month: m, ...round(byMonth.get(m)!) })),
      projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, stage: p.stage, deadline: p.deadline, ...round(byProject.get(p.id)!) })).sort((a, b) => b.forecastRevenue - a.forecastRevenue),
      note: 'Forecast is each project\'s target × CPI in its deadline month; actual revenue is invoices issued, actual cost is purchase orders after reconciliation.',
    };
  }
}

/** Applies a decided incentive redemption (called from the approvals service). */
export async function applyRedemption(tx: Prisma.TransactionClient, tenantId: string, entryId: string, ok: boolean) {
  const e = await tx.incentiveEntry.findFirst({ where: { id: entryId, tenantId } });
  if (!e || e.status !== 'pending_approval') return 'Redemption no longer pending; nothing changed';
  if (!ok) {
    await tx.incentiveEntry.update({ where: { id: e.id }, data: { status: 'rejected' } });
    return 'Redemption rejected; points stay with the member';
  }
  const p = await tx.panelist.findUniqueOrThrow({ where: { id: e.panelistId } });
  if (p.points + e.points < 0) {
    await tx.incentiveEntry.update({ where: { id: e.id }, data: { status: 'rejected', note: `${e.note ? `${e.note}. ` : ''}Balance too low when approved` } });
    return 'Balance too low; redemption not posted';
  }
  await tx.incentiveEntry.update({ where: { id: e.id }, data: { status: 'posted' } });
  await tx.panelist.update({ where: { id: p.id }, data: { points: { increment: e.points } } });
  return `Redemption posted: ${-e.points} points. No money moves: payment rails are not connected.`;
}
