/**
 * SUPPLY360 read models and small actions behind the Audience Orbit X screens.
 *
 * - `GET /supply/facts`: the fact rows the analytics report builder pivots, counted from the
 *   workspace's own records for the last N ISO weeks, one row per panel × country × week × source.
 *   Starts and completes are SampAudience sessions (Participation), invitations are survey cards,
 *   sign-ups are panellists who joined, points are posted earn entries. Nothing is estimated.
 * - `GET /supply/weekly-programme`: the weekly rewards weeks with invitations, completes and
 *   reward cost for each week SampAudience has run (linked by audience request id).
 * - `POST /supply/quotas/:id/close` and `/reopen`: an operator closes a quota cell early (routing
 *   treats it as full until reopened). Audited.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { recordView } from './supply-records';

const SHORT: Record<string, string> = { turn2opinion: 'T2O', myfrequentrewards: 'MFR', myhealthopinions: 'MHO' };
const day = 86400_000;

export type Fact = { panel: string; country: string; week: string; source: string; completes: number; starts: number; invites: number; signups: number; points: number };

@ForModule('analytics')
@Controller('supply/facts')
export class SupplyFactsController {
  constructor(private db: PrismaService) {}

  @Get()
  async facts(@Caller() ctx: Ctx, @Query() q: unknown) {
    const { weeks } = parse(z.object({ weeks: z.coerce.number().int().min(1).max(26).default(8) }).passthrough(), q);
    const t = ctx.tenantId;
    const now = new Date();
    const since = new Date(now.getTime() - weeks * 7 * day);
    const wk = (col: Prisma.Sql) => Prisma.sql`to_char(date_trunc('week', ${col}), 'IYYY-"W"IW')`;
    type Row = { brand: string; country: string; week: string; n: bigint | number };
    const [starts, completes, invites, signups, points] = await Promise.all([
      this.db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`x."startedAt"`)} AS week, count(*) AS n FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId"
        WHERE x."tenantId" = ${t} AND x."startedAt" >= ${since} GROUP BY 1, 2, 3`),
      this.db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`coalesce(x."endedAt", x."startedAt")`)} AS week, count(*) AS n FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId"
        WHERE x."tenantId" = ${t} AND x.status = 'complete' AND coalesce(x."endedAt", x."startedAt") >= ${since} GROUP BY 1, 2, 3`),
      this.db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`c."createdAt"`)} AS week, count(*) AS n FROM "SurveyCard" c JOIN "Panelist" p ON p.id = c."panelistId"
        WHERE c."tenantId" = ${t} AND c."createdAt" >= ${since} GROUP BY 1, 2, 3`),
      this.db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`p."joinedAt"`)} AS week, count(*) AS n FROM "Panelist" p
        WHERE p."tenantId" = ${t} AND p."joinedAt" >= ${since} GROUP BY 1, 2, 3`),
      this.db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`e."createdAt"`)} AS week, coalesce(sum(e.points), 0) AS n FROM "IncentiveEntry" e JOIN "Panelist" p ON p.id = e."panelistId"
        WHERE e."tenantId" = ${t} AND e.kind = 'earn' AND e.status = 'posted' AND e."createdAt" >= ${since} GROUP BY 1, 2, 3`),
    ]);
    const out = new Map<string, Fact>();
    const add = (rows: Row[], k: 'starts' | 'completes' | 'invites' | 'signups' | 'points') => {
      for (const r of rows) {
        const panel = SHORT[r.brand] ?? r.brand;
        const key = `${panel}|${r.country}|${r.week}`;
        const f = out.get(key) ?? { panel, country: r.country, week: r.week, source: 'SampAudience', completes: 0, starts: 0, invites: 0, signups: 0, points: 0 };
        f[k] += Number(r.n);
        out.set(key, f);
      }
    };
    add(starts, 'starts'); add(completes, 'completes'); add(invites, 'invites'); add(signups, 'signups'); add(points, 'points');
    const tenant = await this.db.tenant.findUniqueOrThrow({ where: { id: t }, select: { pointValue: true, baseCurrency: true } });
    const weekList = Array.from({ length: weeks }, (_, i) => isoWeekOf(new Date(now.getTime() - (weeks - 1 - i) * 7 * day)));
    return { asOf: now.toISOString(), weeks: weekList, pointValue: tenant.pointValue, currency: tenant.baseCurrency, facts: [...out.values()].filter((f) => weekList.includes(f.week)) };
  }
}

/** ISO week label (2026-W45) of a date, matching Postgres IYYY-"W"IW. */
export function isoWeekOf(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / day + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

@ForModule('panels')
@Controller('supply/weekly-programme')
export class WeeklyProgrammeController {
  constructor(private db: PrismaService) {}

  /** Every programme week, oldest first, with what SampAudience recorded for the weeks it ran. */
  @Get()
  async list(@Caller() ctx: Ctx) {
    const rows = await this.db.supplyRecord.findMany({ where: { tenantId: ctx.tenantId, kind: 'weekly' }, take: 200 });
    const views = rows.map(recordView).sort((a, b) => String(a.data.week).localeCompare(String(b.data.week)));
    const ars = views.map((v) => v.data.audienceRequestId).filter((x): x is string => typeof x === 'string');
    const [cards, parts] = ars.length
      ? await Promise.all([
          this.db.surveyCard.groupBy({ by: ['audienceRequestId'], where: { tenantId: ctx.tenantId, audienceRequestId: { in: ars } }, _count: true }),
          this.db.participation.findMany({ where: { tenantId: ctx.tenantId, audienceRequestId: { in: ars }, status: 'complete' }, select: { audienceRequestId: true, rewardEntryId: true } }),
        ])
      : [[], []];
    const entryIds = parts.map((p) => p.rewardEntryId).filter((x): x is string => !!x);
    const entries = entryIds.length ? await this.db.incentiveEntry.findMany({ where: { tenantId: ctx.tenantId, id: { in: entryIds }, status: 'posted' }, select: { id: true, valueBase: true } }) : [];
    const value = new Map(entries.map((e) => [e.id, e.valueBase]));
    return views.map((v) => {
      const ar = v.data.audienceRequestId as string | undefined;
      const done = ar ? parts.filter((p) => p.audienceRequestId === ar) : [];
      return {
        ...v,
        invites: ar ? cards.find((c) => c.audienceRequestId === ar)?._count ?? 0 : 0,
        completes: done.length,
        cost: Math.round(done.reduce((s, p) => s + (p.rewardEntryId ? value.get(p.rewardEntryId) ?? 0 : 0), 0) * 100) / 100,
      };
    });
  }
}

@ForModule('projects')
@Controller('supply/quotas')
export class SupplyQuotasController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private async cell(ctx: Ctx, id: string) {
    const c = await this.db.quotaCell.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundException('Quota cell not found');
    return c;
  }

  /** Stops new completes counting into this cell; respondents who match it are sent the over-quota end. */
  @Post(':id/close') @Write() @HttpCode(200)
  async close(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Say why the cell is closing').max(300) }).strict(), b);
    const c = await this.cell(ctx, id);
    if (c.closedAt) throw new BadRequestException('This cell is already closed');
    return this.db.$transaction(async (tx) => {
      const u = await tx.quotaCell.update({ where: { id }, data: { closedAt: new Date() } });
      await this.audit.log(ctx, 'quota.closed', 'QuotaCell', id, { closedAt: null, count: c.count, target: c.target }, { closedAt: u.closedAt, reason }, tx);
      return u;
    });
  }

  @Post(':id/reopen') @Write() @HttpCode(200)
  async reopen(@Caller() ctx: Ctx, @Param('id') id: string) {
    const c = await this.cell(ctx, id);
    if (!c.closedAt) throw new BadRequestException('This cell is open');
    return this.db.$transaction(async (tx) => {
      const u = await tx.quotaCell.update({ where: { id }, data: { closedAt: null } });
      await this.audit.log(ctx, 'quota.reopened', 'QuotaCell', id, { closedAt: c.closedAt }, { closedAt: null }, tx);
      return u;
    });
  }
}

/**
 * Lifecycle journeys from recorded activity, per panel brand, for members who joined in the last
 * `days` days (default 90). Stages SUPPLY360 records: Registered (joined), Profiled (profile at
 * least 60% complete), First survey (started one), Active (completed one in the last 30 days),
 * Loyal (3 or more completes). Visits and verification are not recorded here, so they are absent.
 */
@ForModule('panels')
@Controller('supply/journeys')
export class JourneysController {
  constructor(private db: PrismaService) {}

  @Get()
  async get(@Caller() ctx: Ctx, @Query() q: unknown) {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(730).default(90) }).passthrough(), q);
    const now = new Date();
    const since = new Date(now.getTime() - days * day);
    const active = new Date(now.getTime() - 30 * day);
    type Row = { brand: string; registered: bigint; profiled: bigint; first: bigint; active: bigint; loyal: bigint; days_to_first: number | null };
    const rows = await this.db.$queryRaw<Row[]>(Prisma.sql`
      WITH m AS (
        SELECT p.id, p.brand, p."joinedAt", p."profileCompletion",
          (SELECT min(x."startedAt") FROM "Participation" x WHERE x."panelistId" = p.id AND x."tenantId" = p."tenantId") AS first_at,
          (SELECT count(*) FROM "Participation" x WHERE x."panelistId" = p.id AND x."tenantId" = p."tenantId" AND x.status = 'complete') AS completes,
          EXISTS (SELECT 1 FROM "Participation" x WHERE x."panelistId" = p.id AND x."tenantId" = p."tenantId" AND x.status = 'complete' AND coalesce(x."endedAt", x."startedAt") >= ${active}) AS recent
        FROM "Panelist" p WHERE p."tenantId" = ${ctx.tenantId} AND p."joinedAt" >= ${since} AND p.status <> 'deletion_requested')
      SELECT brand, count(*) AS registered, count(*) FILTER (WHERE "profileCompletion" >= 0.6) AS profiled,
        count(*) FILTER (WHERE first_at IS NOT NULL) AS first, count(*) FILTER (WHERE recent) AS active, count(*) FILTER (WHERE completes >= 3) AS loyal,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at - "joinedAt") / 86400) FILTER (WHERE first_at IS NOT NULL) AS days_to_first
      FROM m GROUP BY brand`);
    const short: Record<string, string> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
    const panels = Object.fromEntries(Object.values(short).map((p) => [p, [0, 0, 0, 0, 0]]));
    const medianDaysToFirst: Record<string, number | null> = Object.fromEntries(Object.values(short).map((p) => [p, null]));
    for (const r of rows) {
      const p = short[r.brand];
      if (!p) continue;
      panels[p] = [r.registered, r.profiled, r.first, r.active, r.loyal].map(Number);
      medianDaysToFirst[p] = r.days_to_first == null ? null : Math.round(Number(r.days_to_first) * 10) / 10;
    }
    return { asOf: now.toISOString(), days, stages: ['Registered', 'Profiled', 'First survey', 'Active', 'Loyal'], notTracked: ['Visitor', 'Verified'], counts: panels, medianDaysToFirst };
  }
}
