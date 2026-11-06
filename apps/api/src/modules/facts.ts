/**
 * Analytics facts counted from recorded activity: one row per panel × country × ISO week, with
 * starts, completes, invitations, sign-ups and points earned. Used by GET /supply/facts and by
 * scheduled saved reports.
 */
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma.service';

const SHORT: Record<string, string> = { turn2opinion: 'T2O', myfrequentrewards: 'MFR', myhealthopinions: 'MHO' };
const day = 86400_000;

export type Fact = { panel: string; country: string; week: string; source: string; completes: number; starts: number; invites: number; signups: number; points: number };

export async function loadFacts(db: Prisma.TransactionClient | PrismaService, tenantId: string, weeks: number, now = new Date()) {
  const t = tenantId;
  const since = new Date(now.getTime() - weeks * 7 * day);
  const wk = (col: Prisma.Sql) => Prisma.sql`to_char(date_trunc('week', ${col}), 'IYYY-"W"IW')`;
  type Row = { brand: string; country: string; week: string; n: bigint | number };
  const [starts, completes, invites, signups, points] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`x."startedAt"`)} AS week, count(*) AS n FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId"
      WHERE x."tenantId" = ${t} AND x."startedAt" >= ${since} GROUP BY 1, 2, 3`),
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`coalesce(x."endedAt", x."startedAt")`)} AS week, count(*) AS n FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId"
      WHERE x."tenantId" = ${t} AND x.status = 'complete' AND coalesce(x."endedAt", x."startedAt") >= ${since} GROUP BY 1, 2, 3`),
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`c."createdAt"`)} AS week, count(*) AS n FROM "SurveyCard" c JOIN "Panelist" p ON p.id = c."panelistId"
      WHERE c."tenantId" = ${t} AND c."createdAt" >= ${since} GROUP BY 1, 2, 3`),
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`p."joinedAt"`)} AS week, count(*) AS n FROM "Panelist" p
      WHERE p."tenantId" = ${t} AND p."joinedAt" >= ${since} GROUP BY 1, 2, 3`),
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.brand, p.country, ${wk(Prisma.sql`e."createdAt"`)} AS week, coalesce(sum(e.points), 0) AS n FROM "IncentiveEntry" e JOIN "Panelist" p ON p.id = e."panelistId"
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
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: t }, select: { pointValue: true, baseCurrency: true } });
  const weekList = Array.from({ length: weeks }, (_, i) => isoWeekOf(new Date(now.getTime() - (weeks - 1 - i) * 7 * day)));
  return { asOf: now.toISOString(), weeks: weekList, pointValue: tenant.pointValue, currency: tenant.baseCurrency, facts: [...out.values()].filter((f) => weekList.includes(f.week)) };
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

