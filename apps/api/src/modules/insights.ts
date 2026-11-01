/**
 * Business metrics for the Command Center and the CRM forecast, computed from the workspace's own
 * records. Nothing here is simulated:
 *
 *  - KPIs are counted from projects, opportunities, surveys, panelists, allocations and invoices.
 *  - Trends and "vs 30 days ago" comparisons come from MetricSnapshot, one row per metric per day,
 *    recorded by the worker every hour and refreshed whenever the Command Center is opened. A KPI
 *    shows no trend or comparison until there is history to compare with.
 *  - Revenue is invoiced revenue (not void) by month of issue, converted to the base currency at
 *    each invoice's fixed rate; cost is purchase orders raised (not cancelled) by month.
 *  - The forecast is draft invoices (next month) plus the probability-weighted value of open
 *    opportunities, spread over the next three months.
 *  - Daily fieldwork is counted from respondent records: completes and screenouts per day.
 *
 * Cost and margin are removed for roles without view:margins.
 */
import { Controller, Get, Injectable, Logger } from '@nestjs/common';
import { can } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';

const day = 86400_000;
const FIELD = ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'];
const CLOSED = ['Project Closure', 'Invoice'];
const OPEN_BID = ['Quote Sent', 'Negotiation'];
const CLOSED_OPP = ['Won', 'Lost'];

export const KPI_KEYS = [
  'active_projects', 'new_requests', 'pending_bids', 'bids_won', 'active_surveys', 'completes', 'incidence',
  'active_panelists', 'active_vendors', 'monthly_revenue', 'margin', 'pending_invoices', 'quality', 'delivery',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];
/** Metrics only roles with view:margins may see, now or in history. */
const MARGIN_KEYS: KpiKey[] = ['margin'];

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export type Kpis = Record<KpiKey, number> & { pendingInvoiceCount: number; fieldCount: number };

@Injectable()
export class InsightsService {
  private log = new Logger('Insights');
  constructor(private db: PrismaService) {}

  /** Current value of every KPI for one workspace. */
  async kpis(tenantId: string, now = new Date()): Promise<Kpis> {
    const t = { tenantId };
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [projects, oppStages, activeSurveys, activePanelists, vendorRows, monthInvoices, openInvoices] = await Promise.all([
      this.db.project.findMany({ where: t, select: { stage: true, completes: true, target: true, ir: true, quality: true, cpiSell: true, cpiCost: true, start: true, deadline: true } }),
      this.db.opportunity.groupBy({ by: ['stage'], where: t, _count: true }),
      this.db.survey.count({ where: { ...t, status: 'Published' } }),
      this.db.panelist.count({ where: { ...t, status: 'active' } }),
      this.db.allocation.findMany({ where: { ...t, status: { in: ['approved', 'live'] } }, select: { vendorId: true }, distinct: ['vendorId'] }),
      this.db.invoice.findMany({ where: { ...t, status: { in: ['issued', 'paid'] }, issuedAt: { gte: monthStart, lte: now } }, select: { amount: true, fxRate: true } }),
      this.db.invoice.findMany({ where: { ...t, status: { in: ['draft', 'issued'] } }, select: { amount: true, fxRate: true } }),
    ]);
    const stage = (s: string[]) => oppStages.filter((g) => s.includes(g.stage)).reduce((n, g) => n + g._count, 0);
    const field = projects.filter((p) => FIELD.includes(p.stage));
    const fieldCompletes = field.reduce((n, p) => n + p.completes, 0);
    const elapsed = (p: (typeof field)[number]) => {
      const a = p.start.getTime(), b = p.deadline.getTime();
      return Math.min(1, Math.max(0, (now.getTime() - a) / Math.max(1, b - a)));
    };
    const onTrack = field.filter((p) => p.target > 0 && p.completes / p.target >= elapsed(p) - 0.1).length;
    const withCompletes = projects.filter((p) => p.completes > 0 && p.cpiSell > 0);
    return {
      active_projects: projects.filter((p) => !CLOSED.includes(p.stage)).length,
      new_requests: stage(['New RFQ']),
      pending_bids: stage(OPEN_BID),
      bids_won: stage(['Won']),
      active_surveys: activeSurveys,
      completes: projects.reduce((n, p) => n + p.completes, 0),
      incidence: fieldCompletes ? field.reduce((s, p) => s + p.ir * p.completes, 0) / fieldCompletes : 0,
      active_panelists: activePanelists,
      active_vendors: vendorRows.length,
      monthly_revenue: Math.round(monthInvoices.reduce((s, i) => s + i.amount * i.fxRate, 0)),
      margin: avg(withCompletes.map((p) => 1 - p.cpiCost / p.cpiSell)),
      pending_invoices: Math.round(openInvoices.reduce((s, i) => s + i.amount * i.fxRate, 0)),
      quality: avg(field.map((p) => p.quality)),
      delivery: field.length ? onTrack / field.length : 0,
      pendingInvoiceCount: openInvoices.length,
      fieldCount: field.length,
    };
  }

  /** Records today's value of every KPI (idempotent: a later run the same day overwrites it). */
  async snapshot(tenantId: string, now = new Date(), k?: Kpis) {
    const v = k ?? (await this.kpis(tenantId, now));
    const d = utcDay(now);
    await this.db.$transaction(KPI_KEYS.map((key) => this.db.metricSnapshot.upsert({
      where: { tenantId_day_key: { tenantId, day: d, key } },
      create: { tenantId, day: d, key, value: v[key] },
      update: { value: v[key] },
    })));
    return v;
  }

  /** Worker: today's snapshot for every workspace. */
  async snapshotAll(now = new Date()) {
    const tenants = await this.db.tenant.findMany({ select: { id: true } });
    for (const t of tenants) await asTenant(t.id, () => this.snapshot(t.id, now)).catch((e) => this.log.error(e));
    return tenants.length;
  }

  /** Last 14 recorded days per KPI, and the value recorded closest to 30 days ago (within a week). */
  async history(tenantId: string, now = new Date()) {
    const today = utcDay(now);
    const rows = await this.db.metricSnapshot.findMany({ where: { tenantId, day: { gte: new Date(today.getTime() - 37 * day) } }, orderBy: { day: 'asc' } });
    const out = {} as Record<KpiKey, { spark: number[]; prior: number | null; priorDay: string | null }>;
    const target = today.getTime() - 30 * day;
    for (const key of KPI_KEYS) {
      const r = rows.filter((x) => x.key === key);
      const recent = r.filter((x) => x.day.getTime() > today.getTime() - 14 * day).map((x) => x.value);
      const candidates = r.filter((x) => x.day.getTime() <= target && x.day.getTime() >= target - 7 * day);
      const p = candidates[candidates.length - 1];
      out[key] = { spark: recent, prior: p ? p.value : null, priorDay: p ? p.day.toISOString().slice(0, 10) : null };
    }
    return out;
  }

  /** Revenue and cost for the last 12 months, plus a three-month forecast. */
  async revenue(ctx: Ctx, now = new Date()) {
    const t = { tenantId: ctx.tenantId };
    const from = addMonths(now, -11);
    const [inv, pos, drafts, open] = await Promise.all([
      this.db.invoice.findMany({ where: { ...t, status: { in: ['issued', 'paid'] }, issuedAt: { gte: from } }, select: { amount: true, fxRate: true, issuedAt: true } }),
      this.db.purchaseOrder.findMany({ where: { ...t, status: { not: 'cancelled' }, issuedAt: { gte: from } }, select: { amount: true, fxRate: true, issuedAt: true } }),
      this.db.invoice.findMany({ where: { ...t, status: 'draft' }, select: { amount: true, fxRate: true } }),
      this.db.opportunity.findMany({ where: { ...t, stage: { notIn: CLOSED_OPP } }, select: { value: true, probability: true } }),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => monthKey(addMonths(from, i)));
    const sumBy = (rows: { amount: number; fxRate: number; issuedAt: Date | null }[], m: string) =>
      Math.round(rows.filter((r) => r.issuedAt && monthKey(r.issuedAt) === m).reduce((s, r) => s + r.amount * r.fxRate, 0));
    const showCost = can(ctx.role, 'view:margins');
    const draftTotal = Math.round(drafts.reduce((s, i) => s + i.amount * i.fxRate, 0));
    const weighted = Math.round(open.reduce((s, o) => s + o.value * o.probability, 0));
    const ahead = [1, 2, 3].map((i) => monthKey(addMonths(now, i)));
    return {
      currency: (await this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD',
      months: months.map((m) => ({ month: m, revenue: sumBy(inv, m), ...(showCost ? { cost: sumBy(pos, m) } : {}) })),
      forecast: ahead.map((m, i) => ({ month: m, draftInvoices: i === 0 ? draftTotal : 0, weightedPipeline: Math.round(weighted / 3) })),
      draftInvoices: draftTotal,
      weightedPipeline: weighted,
      openOpportunities: open.length,
    };
  }

  /** Completes, screenouts and incidence per day for the last 30 days, from respondent records. */
  async fieldwork(tenantId: string, now = new Date()) {
    const start = new Date(utcDay(now).getTime() - 29 * day);
    const rows = await this.db.$queryRaw<{ d: Date; outcome: string; n: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', "completedAt") AS d, "outcome", count(*) AS n FROM "Response"
      WHERE "tenantId" = ${tenantId} AND "completedAt" >= ${start} AND "outcome" IN ('complete', 'screenout') AND "rejectedAt" IS NULL
      GROUP BY 1, 2`);
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(start.getTime() + i * day);
      const at = (o: string) => Number(rows.find((r) => r.outcome === o && utcDay(new Date(r.d)).getTime() === d.getTime())?.n ?? 0);
      const completes = at('complete'), screenouts = at('screenout');
      return { day: d.toISOString().slice(0, 10), completes, screenouts, incidence: completes + screenouts ? round2(completes / (completes + screenouts)) : null };
    });
  }

  async overview(ctx: Ctx, now = new Date()) {
    // Opening the Command Center refreshes today's snapshot, so the newest point is never stale.
    const k = await this.snapshot(ctx.tenantId, now);
    const [history, revenue, fieldwork] = await Promise.all([this.history(ctx.tenantId, now), this.revenue(ctx, now), this.fieldwork(ctx.tenantId, now)]);
    const margins = can(ctx.role, 'view:margins');
    const kpis = Object.fromEntries(KPI_KEYS.filter((key) => margins || !MARGIN_KEYS.includes(key)).map((key) => {
      const h = history[key];
      const delta = h.prior ? Math.round(((k[key] - h.prior) / Math.abs(h.prior)) * 1000) / 1000 : null;
      return [key, { value: k[key], spark: h.spark.length >= 2 ? h.spark : [], delta, comparedWith: h.priorDay }];
    }));
    return { asOf: now.toISOString(), kpis, pendingInvoiceCount: k.pendingInvoiceCount, fieldCount: k.fieldCount, revenue, fieldwork };
  }
}

@ForModule('command-center')
@Controller('insights')
export class InsightsController {
  constructor(private s: InsightsService) {}
  @Get('overview') overview(@Caller() ctx: Ctx) { return this.s.overview(ctx); }
}

/** The CRM forecast chart: the same revenue series, for roles with CRM access. */
@ForModule('crm')
@Controller('crm/insights')
export class CrmInsightsController {
  constructor(private s: InsightsService) {}
  @Get('revenue') revenue(@Caller() ctx: Ctx) { return this.s.revenue(ctx); }
}
