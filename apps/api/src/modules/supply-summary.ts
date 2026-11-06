/**
 * SUPPLY360 summary views counted from recorded tables (no samples, no scaling):
 * - POST /supply/audience/count: an audience definition (the segmentation screen's rule tree)
 *   counted against members, with reach, invitability and breakdowns, for segmentation and
 *   feasibility;
 * - GET /supply/markets: members, activity and completes per country, for the global and
 *   distribution screens;
 * - GET /panels/events: the last 24 hours of member activity for the activity timeline.
 * Rules on fields SUPPLY360 does not record (income, education, device, ...) are reported back as
 * unsupported and left out of the count rather than guessed.
 */
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const day = 86400_000;
const brandOf: Record<string, string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };
const panelOf: Record<string, string> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Screen labels → recorded attribute values. */
const roleSlug: Record<string, string> = { 'IT decision maker': 'it_decision_maker', 'Finance leader': 'finance', 'Marketing leader': 'marketing', 'HR leader': 'hr', 'Operations manager': 'operations' };
const companyRange: Record<string, [number, number]> = { '1–9': [0, 9], '10–49': [10, 49], '50–249': [50, 249], '250–999': [250, 999], '1,000–4,999': [1000, 4999], '5,000+': [5000, 1e9] };
const conditionKey: Record<string, string> = { 'Type 2 diabetes': 'health.diabetes', Hypertension: 'health.hypertension', Asthma: 'health.asthma' };
const labels: Record<string, string> = { income: 'Household income', education: 'Education', employment: 'Employment', device: 'Main device', seniority: 'Seniority', yearsPractice: 'Years in practice' };

type Cond = { kind: 'cond'; field: string; op: 'in' | 'not_in' | 'gte' | 'lte'; values: string[]; num?: number };
type Group = { kind: 'group'; join: 'AND' | 'OR'; children: Node[] };
type Node = Cond | Group;
const NodeSchema: z.ZodType<Node> = z.lazy(() => z.union([
  z.object({ kind: z.literal('cond'), id: z.string().optional(), field: z.string().max(40), op: z.enum(['in', 'not_in', 'gte', 'lte']), values: z.array(z.string().max(80)).max(60), num: z.number().optional() }),
  z.object({ kind: z.literal('group'), id: z.string().optional(), join: z.enum(['AND', 'OR']), children: z.array(NodeSchema).max(40) }),
])) as z.ZodType<Node>;

const incomplete = (c: Cond) => (c.op === 'in' || c.op === 'not_in' ? !c.values.length : c.num === undefined || Number.isNaN(c.num));

/** Builds a Prisma filter from the rule tree; attribute rules become id lists. */
export async function audienceWhere(db: PrismaService, tenantId: string, root: Node) {
  const unsupported = new Set<string>();
  const ids = async (where: Prisma.PanelistAttributeWhereInput) => (await db.panelistAttribute.findMany({ where: { tenantId, ...where }, select: { panelistId: true }, distinct: ['panelistId'], take: 100_000 })).map((a) => a.panelistId);
  const healthOk = async () => (await db.consent.findMany({ where: { purpose: 'health_data', granted: true, panelist: { tenantId } }, select: { panelistId: true }, take: 100_000 })).map((c) => c.panelistId);
  const walk = async (n: Node): Promise<Prisma.PanelistWhereInput | null> => {
    if (n.kind === 'group') {
      const kids = (await Promise.all(n.children.map(walk))).filter((x): x is Prisma.PanelistWhereInput => !!x);
      return kids.length ? (n.join === 'AND' ? { AND: kids } : { OR: kids }) : null;
    }
    if (incomplete(n)) return null;
    const neg = (w: Prisma.PanelistWhereInput): Prisma.PanelistWhereInput => (n.op === 'not_in' ? { NOT: w } : w);
    const num = (col: 'qualityScore' | 'profileCompletion' | 'surveysCompleted', scale = 1): Prisma.PanelistWhereInput => ({ [col]: n.op === 'gte' ? { gte: n.num! / scale } : { lte: n.num! / scale } });
    switch (n.field) {
      case 'brand': return neg({ brand: { in: n.values.map((v) => brandOf[v] ?? v) } });
      case 'status': case 'segment': case 'country': case 'ageBand': case 'gender': return neg({ [n.field]: { in: n.values } });
      case 'qualityScore': return num('qualityScore', 100);
      case 'profileCompletion': return num('profileCompletion', 100);
      case 'surveysCompleted': return num('surveysCompleted');
      case 'industry': return neg({ id: { in: await ids({ key: 'b2b.industry', valueText: { in: n.values.map(slug) } }) } });
      case 'specialty': return neg({ id: { in: await ids({ key: 'hcp.specialty', valueText: { in: n.values.map(slug) } }) } });
      case 'jobRole': {
        const known = n.values.filter((v) => roleSlug[v]);
        n.values.filter((v) => !roleSlug[v]).forEach((v) => unsupported.add(`Job role “${v}”`));
        return known.length ? neg({ id: { in: await ids({ key: 'b2b.role', valueText: { in: known.map((v) => roleSlug[v]) } }) } }) : null;
      }
      case 'companySize': return neg({ id: { in: await ids({ key: 'b2b.company_size', OR: n.values.filter((v) => companyRange[v]).map((v) => ({ valueNum: { gte: companyRange[v][0], lte: companyRange[v][1] } })) }) } });
      case 'conditions': {
        const keys = n.values.filter((v) => conditionKey[v]).map((v) => conditionKey[v]);
        n.values.filter((v) => !conditionKey[v]).forEach((v) => unsupported.add(`Condition “${v}”`));
        if (!keys.length) return null;
        const ok = new Set(await healthOk());
        return neg({ id: { in: (await ids({ key: { in: keys }, valueBool: true })).filter((x) => ok.has(x)) } });
      }
      default: unsupported.add(labels[n.field] ?? n.field); return null;
    }
  };
  const w = await walk(root);
  return { where: { tenantId, status: { not: 'deletion_requested' }, ...(w ?? {}) } as Prisma.PanelistWhereInput, unsupported: [...unsupported] };
}

@Controller()
export class SupplySummaryController {
  constructor(private db: PrismaService) {}

  /** Counts an audience definition: eligible, reachable, invitable, with breakdowns and the panels' response rates. */
  @ForModule('panels') @Post('supply/audience/count') @HttpCode(200)
  async count(@Caller() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ root: NodeSchema, fatigueDays: z.number().int().min(0).max(60).default(7) }).strict(), body);
    const t = ctx.tenantId, now = Date.now();
    const { where, unsupported } = await audienceWhere(this.db, t, b.root);
    const blocked = new Set([
      ...(await this.db.consent.findMany({ where: { purpose: 'research_participation', granted: false, panelist: { tenantId: t } }, select: { panelistId: true }, take: 100_000 })).map((c) => c.panelistId),
      ...(await this.db.supplyRecord.findMany({ where: { tenantId: t, kind: 'quality_case', status: { in: ['open', 'watching'] } }, select: { data: true }, take: 10_000 })).map((r) => String((r.data as { panelistId?: string }).panelistId)),
    ]);
    const invited = new Set((await this.db.surveyCard.findMany({ where: { tenantId: t, createdAt: { gte: new Date(now - b.fatigueDays * day) } }, select: { panelistId: true }, distinct: ['panelistId'], take: 100_000 })).map((c) => c.panelistId));
    const rows = await this.db.panelist.findMany({ where, select: { id: true, brand: true, country: true, ageBand: true, segment: true, status: true, profileCompletion: true }, take: 200_000 });
    const reach = rows.filter((p) => p.status === 'active' && !blocked.has(p.id));
    const inv = reach.filter((p) => !invited.has(p.id));
    const tally = <T extends { [k: string]: unknown }>(xs: T[], k: keyof T) => xs.reduce<Record<string, number>>((a, x) => { const v = String(x[k]); a[v] = (a[v] ?? 0) + 1; return a; }, {});
    const invC = tally(inv, 'country');
    const since = new Date(now - 90 * day);
    const [cards, starts] = await Promise.all([
      this.db.surveyCard.groupBy({ by: ['panel'], where: { tenantId: t, createdAt: { gte: since } }, _count: true }),
      this.db.participation.count({ where: { tenantId: t, startedAt: { gte: since } } }),
    ]);
    const cardN = cards.reduce((a, c) => a + c._count, 0);
    return {
      eligible: rows.length, reachable: reach.length, invitable: inv.length,
      missingProfile: rows.filter((p) => p.profileCompletion < 0.6).length,
      byCountry: Object.entries(tally(rows, 'country')).sort((a, c) => c[1] - a[1]).map(([code, eligible]) => ({ code, eligible, invitable: invC[code] ?? 0 })),
      byPanel: Object.fromEntries(Object.entries(tally(rows, 'brand')).map(([k, v]) => [panelOf[k] ?? k, v])),
      byAge: tally(rows, 'ageBand'), bySegment: tally(rows, 'segment'),
      responseRate: cardN ? Math.min(1, starts / cardN) : null,
      unsupported,
      capped: rows.length >= 200_000,
    };
  }

  /** Per-country members, activity and completes from recorded tables. */
  @ForModule('panels') @Get('supply/markets')
  async markets(@Caller() ctx: Ctx) {
    const t = ctx.tenantId, now = Date.now();
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const [members, active, reach, blocked, comp, starts, recent] = await Promise.all([
      this.db.panelist.groupBy({ by: ['country', 'brand'], where: { tenantId: t, status: { not: 'deletion_requested' } }, _count: true }),
      this.db.panelist.groupBy({ by: ['country'], where: { tenantId: t, status: 'active', lastActiveAt: { gte: new Date(now - 30 * day) } }, _count: true }),
      this.db.panelist.groupBy({ by: ['country'], where: { tenantId: t, status: 'active', NOT: { consents: { some: { purpose: 'research_participation', granted: false } } } }, _count: true }),
      this.db.panelist.groupBy({ by: ['country'], where: { tenantId: t, status: { not: 'deletion_requested' }, consents: { some: { purpose: 'research_participation', granted: false } } }, _count: true }),
      this.db.$queryRaw<{ country: string; d: number; n: bigint }[]>`SELECT p.country, floor(extract(epoch from (${today}::timestamp - date_trunc('day', coalesce(x."endedAt", x."startedAt")))) / 86400)::int AS d, count(*) AS n
        FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId" WHERE x."tenantId" = ${t} AND x.status = 'complete' AND coalesce(x."endedAt", x."startedAt") >= ${new Date(today.getTime() - 13 * day)} GROUP BY 1, 2`,
      this.db.$queryRaw<{ country: string; s: bigint; c: bigint }[]>`SELECT p.country, count(*) AS s, count(*) FILTER (WHERE x.status = 'complete') AS c FROM "Participation" x JOIN "Panelist" p ON p.id = x."panelistId"
        WHERE x."tenantId" = ${t} AND x."startedAt" >= ${new Date(now - 30 * day)} GROUP BY 1`,
      this.db.surveyCard.findMany({ where: { tenantId: t, status: 'open', expiresAt: { gt: new Date() } }, select: { surveyId: true, panelistId: true }, distinct: ['surveyId', 'panelistId'], take: 50_000 }),
    ]);
    const live = new Map<string, Set<string>>();
    if (recent.length) {
      const who = new Map((await this.db.panelist.findMany({ where: { tenantId: t, id: { in: [...new Set(recent.map((r) => r.panelistId))] } }, select: { id: true, country: true } })).map((p) => [p.id, p.country]));
      for (const r of recent) { const c = who.get(r.panelistId); if (c) { const s = live.get(c) ?? new Set(); s.add(r.surveyId); live.set(c, s); } }
    }
    const countries = [...new Set(members.map((m) => m.country))];
    return {
      asOf: new Date().toISOString(),
      markets: countries.map((code) => {
        const by = (p: string) => members.find((m) => m.country === code && m.brand === brandOf[p])?._count ?? 0;
        const days = Array.from({ length: 14 }, (_, i) => Number(comp.find((x) => x.country === code && x.d === i)?.n ?? 0));
        const st = starts.find((x) => x.country === code);
        const total = by('t2o') + by('mfr') + by('mho');
        return {
          code, members: { t2o: by('t2o'), mfr: by('mfr'), mho: by('mho') }, active: active.find((x) => x.country === code)?._count ?? 0,
          consented: total - (blocked.find((x) => x.country === code)?._count ?? 0), reachable: reach.find((x) => x.country === code)?._count ?? 0,
          completesToday: days[0], liveSurveys: live.get(code)?.size ?? 0, ir: st && Number(st.s) ? Number(st.c) / Number(st.s) : 0,
          delta: days[1] ? (days[0] - days[1]) / days[1] : 0, trend: days.slice(0, 7).reverse(),
        };
      }).sort((a, c) => c.members.t2o + c.members.mfr + c.members.mho - (a.members.t2o + a.members.mfr + a.members.mho)),
    };
  }

  /** Member activity in the last `hours` (default 24): sign-ups, profile answers, completes, redemptions, tickets, quality flags. */
  @ForModule('panels') @Get('panels/events')
  async events(@Caller() ctx: Ctx, @Query() q: unknown) {
    const { hours } = parse(z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).passthrough(), q);
    const t = ctx.tenantId, since = new Date(Date.now() - hours * 3600_000), take = 400;
    const [signups, profile, completes, redeems, tickets, cases] = await Promise.all([
      this.db.panelist.findMany({ where: { tenantId: t, joinedAt: { gte: since } }, select: { id: true, joinedAt: true, brand: true, country: true }, orderBy: { joinedAt: 'desc' }, take }),
      this.db.panelistAttribute.findMany({ where: { tenantId: t, updatedAt: { gte: since } }, select: { id: true, panelistId: true, key: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take }),
      this.db.participation.findMany({ where: { tenantId: t, status: 'complete', endedAt: { gte: since } }, select: { id: true, panelistId: true, endedAt: true }, orderBy: { endedAt: 'desc' }, take }),
      this.db.incentiveEntry.findMany({ where: { tenantId: t, kind: 'redeem', createdAt: { gte: since } }, select: { id: true, panelistId: true, points: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
      this.db.supplyRecord.findMany({ where: { tenantId: t, kind: 'ticket', createdAt: { gte: since } }, select: { id: true, ref: true, title: true, data: true, createdAt: true }, take }),
      this.db.supplyRecord.findMany({ where: { tenantId: t, kind: 'quality_case', createdAt: { gte: since } }, select: { id: true, ref: true, title: true, data: true, createdAt: true }, take }),
    ]);
    const name: Record<string, string> = { turn2opinion: 'Turn2Opinion', myfrequentrewards: 'MyFrequentRewards', myhealthopinions: 'MyHealthOpinions' };
    const pid = (d: unknown) => String((d as { panelistId?: string }).panelistId ?? '');
    const events = [
      ...signups.map((p) => ({ id: `s-${p.id}`, type: 'signup', at: p.joinedAt, panelistId: p.id, text: `Joined ${name[p.brand] ?? p.brand} from ${p.country}` })),
      ...profile.filter((a) => !a.key.startsWith('tag:')).map((a) => ({ id: `p-${a.id}`, type: 'profile', at: a.updatedAt, panelistId: a.panelistId, text: `Answered a profile question (${a.key.split('.')[0]})` })),
      ...completes.map((x) => ({ id: `c-${x.id}`, type: 'survey', at: x.endedAt!, panelistId: x.panelistId, text: 'Completed a survey' })),
      ...redeems.map((e) => ({ id: `r-${e.id}`, type: 'reward', at: e.createdAt, panelistId: e.panelistId, text: `Redeemed ${Math.abs(e.points).toLocaleString('en-US')} points${e.status === 'pending_approval' ? ' (held for approval)' : ''}` })),
      ...tickets.map((r) => ({ id: `t-${r.id}`, type: 'support', at: r.createdAt, panelistId: pid(r.data), text: `Opened ${r.ref}: ${r.title}` })),
      ...cases.map((r) => ({ id: `q-${r.id}`, type: 'risk', at: r.createdAt, panelistId: pid(r.data), text: `${r.ref}: ${r.title}` })),
    ].filter((e) => e.panelistId).sort((a, c) => c.at.getTime() - a.at.getTime()).slice(0, 1500);
    return { since: since.toISOString(), hours, events };
  }
}
