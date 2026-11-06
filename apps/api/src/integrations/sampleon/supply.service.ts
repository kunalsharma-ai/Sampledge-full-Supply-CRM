/**
 * SUPPLY360 eligibility & delivery API for SAMPLEON (ecosystem contract §5.1).
 *
 * SUPPLY360 is the respondent master: profiles, consent, activity and rewards stay here. SAMPLEON
 * gets counts, pseudonymous respondent ids (Panelist.id) and match/no-match answers, never
 * profiles. Health attributes are evaluated here and only for panelists with health-data consent.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Criteria, evaluate, makeEvent, parseEvent, type Criterion, type Profile } from '@sampledge/contracts';
import { emit } from '../../common/events';
import { PrismaService } from '../../common/prisma.service';
import { enterTenant } from '../../common/tenant-scope';
import { ATTRIBUTE_BY_KEY, BRAND_OF_PANEL, isHealthKey, PANEL_OF_BRAND, SUPPLY_ATTRIBUTES } from './attributes';
import { sampleonConfig } from './s2s';

const Country = z.string().regex(/^[A-Z]{2}$/);
const Ref = z.string().min(1).max(64);
export const CountQuery = z.object({
  country: Country,
  criteria: Criteria.default([]),
  exclude: z.object({ audienceRequestIds: z.array(z.string().max(64)).max(500).optional(), surveyIds: z.array(z.string().max(120)).max(500).optional(), respondentRefs: z.array(Ref).max(10_000).optional() }).default({}),
  fatigue: z.object({ maxInvites: z.number().int().min(1).max(100), windowDays: z.number().int().min(1).max(365) }).optional(),
  activeWithinDays: z.number().int().min(1).max(3650).default(90),
});
export const SelectQuery = CountQuery.extend({ limit: z.number().int().min(1).max(10_000), panel: z.enum(['t2o', 'mfr', 'mho']).optional() });
export const CheckQuery = z.object({ respondentRef: Ref, criteria: Criteria.default([]), quotas: z.array(z.object({ id: z.string().max(60), conditions: Criteria })).max(200).default([]) });
export const DeliveryBody = z.object({
  audienceRequestId: z.string().min(1).max(64),
  surveyId: z.string().min(1).max(120).default('unknown'),
  items: z.array(z.object({
    invitationId: z.string().min(1).max(64),
    respondentRef: Ref,
    panel: z.string().max(10),
    cardUrl: z.string().url().max(2000),
    title: z.string().min(1).max(200),
    loiMinutes: z.number().int().min(1).max(240),
    rewardPoints: z.number().int().min(0).max(1_000_000),
    expiresAt: z.string().datetime(),
    channels: z.array(z.enum(['card', 'email'])).min(1),
  })).max(5000),
});

type Candidate = {
  id: string; brand: string; panel: string; country: string; status: string; lastActiveAt: Date | null;
  research: boolean; health: boolean; profile: Profile;
};

/** Latest consent row per purpose is the current state (consent is append-only). */
function consentState(rows: { purpose: string; granted: boolean; at: Date }[]) {
  const latest = new Map<string, boolean>();
  for (const c of [...rows].sort((a, b) => b.at.getTime() - a.at.getTime())) if (!latest.has(c.purpose)) latest.set(c.purpose, c.granted);
  return { research: latest.get('research_participation') === true, health: latest.get('health_data') === true };
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

@Injectable()
export class SupplyService {
  private log = new Logger('SupplyService');
  constructor(private db: PrismaService) {}

  /** The workspace that owns the panels. Every query after this is scoped to it (row-level security). */
  async tenantId() {
    const t = await this.db.tenant.findUnique({ where: { slug: sampleonConfig().tenant }, select: { id: true } });
    if (!t) throw new NotFoundException('The panel workspace is not set up');
    enterTenant(t.id);
    return t.id;
  }

  attributes() { return { attributes: SUPPLY_ATTRIBUTES }; }

  private async candidates(tenantId: string, where: Prisma.PanelistWhereInput, criteria: Criterion[]): Promise<Candidate[]> {
    for (const c of criteria) if (!ATTRIBUTE_BY_KEY.has(c.attribute)) throw new BadRequestException(`Unknown attribute ${c.attribute}`);
    const extraKeys = criteria.map((c) => c.attribute).filter((k) => !k.startsWith('demo.gender') && k !== 'demo.age_band' && !k.startsWith('panelist.'));
    const rows = await this.db.panelist.findMany({
      where: { tenantId, status: { notIn: ['suspended', 'deletion_requested'] }, ...where },
      select: { id: true, brand: true, country: true, status: true, gender: true, ageBand: true, segment: true, qualityScore: true, lastActiveAt: true, consents: { select: { purpose: true, granted: true, at: true } } },
    });
    const attrs = extraKeys.length
      ? await this.db.panelistAttribute.findMany({ where: { tenantId, key: { in: extraKeys }, panelistId: { in: rows.map((r) => r.id) } }, select: { panelistId: true, key: true, valueText: true, valueNum: true, valueBool: true } })
      : [];
    const byPanelist = new Map<string, typeof attrs>();
    for (const a of attrs) { const l = byPanelist.get(a.panelistId) ?? []; l.push(a); byPanelist.set(a.panelistId, l); }
    return rows.map((r) => {
      const cs = consentState(r.consents);
      const profile: Profile = { 'demo.gender': r.gender, 'demo.age_band': r.ageBand, 'panelist.segment': r.segment, 'panelist.quality_score': r.qualityScore };
      for (const a of byPanelist.get(r.id) ?? []) {
        if (isHealthKey(a.key) && !cs.health) continue;
        profile[a.key] = a.valueNum ?? a.valueBool ?? a.valueText;
      }
      return { id: r.id, brand: r.brand, panel: PANEL_OF_BRAND[r.brand] ?? r.brand, country: r.country, status: r.status, lastActiveAt: r.lastActiveAt, research: cs.research, health: cs.health, profile };
    });
  }

  /** Eligible = matches every criterion; reachable additionally consented, active, recently active, not excluded, under the invitation cap. */
  private async classify(tenantId: string, q: z.infer<typeof CountQuery>, panel?: string) {
    const needsHealth = q.criteria.some((c) => isHealthKey(c.attribute));
    const cands = await this.candidates(tenantId, { country: q.country, ...(panel ? { brand: BRAND_OF_PANEL[panel] } : {}) }, q.criteria);
    const since = new Date(Date.now() - (q.fatigue?.windowDays ?? 7) * 86_400_000);
    const policy = await this.db.panelRewardPolicy.findFirst({ where: { tenantId }, orderBy: { version: 'desc' }, select: { weeklyInviteCap: true } });
    const cap = Math.min(q.fatigue?.maxInvites ?? Infinity, policy?.weeklyInviteCap ?? Infinity);
    const ids = cands.map((c) => c.id);
    const [recent, excludedByRequest, excludedBySurveyCards, excludedBySurveyPart] = await Promise.all([
      this.db.surveyCard.groupBy({ by: ['panelistId'], where: { tenantId, panelistId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      q.exclude.audienceRequestIds?.length ? this.db.surveyCard.findMany({ where: { tenantId, audienceRequestId: { in: q.exclude.audienceRequestIds }, panelistId: { in: ids } }, select: { panelistId: true } }) : [],
      q.exclude.surveyIds?.length ? this.db.surveyCard.findMany({ where: { tenantId, surveyId: { in: q.exclude.surveyIds }, panelistId: { in: ids } }, select: { panelistId: true } }) : [],
      q.exclude.surveyIds?.length ? this.db.participation.findMany({ where: { tenantId, surveyId: { in: q.exclude.surveyIds }, panelistId: { in: ids } }, select: { panelistId: true } }) : [],
    ]);
    const invites = new Map(recent.map((r) => [r.panelistId, r._count._all]));
    const excluded = new Set([...excludedByRequest, ...excludedBySurveyCards, ...excludedBySurveyPart].map((x) => x.panelistId).concat(q.exclude.respondentRefs ?? []));
    const activeSince = Date.now() - q.activeWithinDays * 86_400_000;
    const eligible: Candidate[] = [], reachable: Candidate[] = [];
    const missingProfile: Record<string, number> = {};
    for (const c of cands) {
      if (needsHealth && !c.health) continue;
      const e = evaluate(c.profile, q.criteria);
      if (!e.eligible) {
        // Only panelists who already match at least one criterion and fail none: asking them to
        // complete the missing profile data could make them eligible.
        if (!e.failed.length && e.missing.length < q.criteria.length) for (const m of e.missing) missingProfile[m] = (missingProfile[m] ?? 0) + 1;
        continue;
      }
      eligible.push(c);
      if (c.research && c.status === 'active' && c.lastActiveAt && c.lastActiveAt.getTime() >= activeSince && !excluded.has(c.id) && (invites.get(c.id) ?? 0) < cap) reachable.push(c);
    }
    return { eligible, reachable, missingProfile };
  }

  async count(raw: unknown) {
    const q = CountQuery.parse(raw);
    const t = await this.tenantId();
    const { eligible, reachable, missingProfile } = await this.classify(t, q);
    const byPanel: Record<string, { eligible: number; reachable: number }> = {};
    for (const c of eligible) (byPanel[c.panel] ??= { eligible: 0, reachable: 0 }).eligible++;
    for (const c of reachable) byPanel[c.panel]!.reachable++;
    return { eligible: eligible.length, reachable: reachable.length, missingProfile, byPanel };
  }

  async select(raw: unknown) {
    const q = SelectQuery.parse(raw);
    const t = await this.tenantId();
    const { reachable } = await this.classify(t, q, q.panel);
    return { respondents: shuffle(reachable).slice(0, q.limit).map((c) => ({ respondentRef: c.id, panel: c.panel, country: c.country })) };
  }

  async check(raw: unknown) {
    const q = CheckQuery.parse(raw);
    const t = await this.tenantId();
    const [c] = await this.candidates(t, { id: q.respondentRef }, [...q.criteria, ...q.quotas.flatMap((x) => x.conditions)]);
    if (!c) return { eligible: false, reasons: ['unknown or inactive respondent'], quotaIds: [], country: null, consented: false };
    const needsHealth = q.criteria.some((x) => isHealthKey(x.attribute));
    const e = evaluate(c.profile, q.criteria);
    const consented = c.research && c.status === 'active' && (!needsHealth || c.health);
    return {
      eligible: consented && e.eligible,
      reasons: [...e.missing.map((m) => `missing ${m}`), ...e.failed.map((f) => `does not match ${f}`), ...(consented ? [] : ['no consent or inactive account'])],
      quotaIds: q.quotas.filter((x) => evaluate(c.profile, x.conditions).eligible).map((x) => x.id),
      country: c.country,
      consented,
    };
  }

  /** Survey cards on the panel website, and the permitted e-mail (recorded through the Comms Hub adapter). */
  async deliver(raw: unknown) {
    const b = DeliveryBody.parse(raw);
    const t = await this.tenantId();
    const pans = await this.db.panelist.findMany({ where: { tenantId: t, id: { in: b.items.map((i) => i.respondentRef) } }, select: { id: true, brand: true, status: true, consents: { select: { purpose: true, granted: true, at: true } } } });
    const byId = new Map(pans.map((p) => [p.id, p]));
    const results: { invitationId: string; status: 'delivered' | 'suppressed'; reason?: string }[] = [];
    const emailed = new Map<string, number>();
    await this.db.$transaction(async (tx) => {
      for (const i of b.items) {
        const p = byId.get(i.respondentRef);
        if (!p) { results.push({ invitationId: i.invitationId, status: 'suppressed', reason: 'unknown respondent' }); continue; }
        if (p.status !== 'active') { results.push({ invitationId: i.invitationId, status: 'suppressed', reason: `account ${p.status}` }); continue; }
        if (!consentState(p.consents).research) { results.push({ invitationId: i.invitationId, status: 'suppressed', reason: 'no research consent' }); continue; }
        const email = i.channels.includes('email');
        const existing = await tx.surveyCard.findUnique({ where: { id: i.invitationId }, select: { id: true } });
        if (!existing) {
          await tx.surveyCard.create({ data: { id: i.invitationId, tenantId: t, audienceRequestId: b.audienceRequestId, surveyId: b.surveyId, panelistId: p.id, panel: PANEL_OF_BRAND[p.brand] ?? p.brand, title: i.title, cardUrl: i.cardUrl, loiMinutes: i.loiMinutes, rewardPoints: i.rewardPoints, expiresAt: new Date(i.expiresAt), emailed: email } });
          if (email) emailed.set(p.brand, (emailed.get(p.brand) ?? 0) + 1);
        }
        results.push({ invitationId: i.invitationId, status: 'delivered' });
      }
      // One invitation e-mail record per panel brand and batch. Panelists are pseudonymous here, so the
      // e-mail itself goes through the panel's own mailer; without SMTP it is recorded by the dev adapter.
      for (const [brand, n] of emailed) {
        const msg = await tx.message.create({ data: { tenantId: t, channel: 'email', audience: 'panel', toRef: `panel:${brand}:sampleon`, recipients: n, subject: 'A new survey is waiting for you', body: `You have a new survey on your ${brand} dashboard. Sign in to see it.`, status: 'queued', relatedType: 'AudienceRequest', relatedId: b.audienceRequestId, createdBy: 'sampleon' } });
        await emit(tx, t, 'message.queued', { messageId: msg.id });
      }
    });
    return { results };
  }

  /** Open survey cards for one panelist on one panel website. */
  async cards(panel: string, respondentRef: string, caller: { id: string; kind: string }) {
    if (caller.kind === 'panel' && caller.id !== panel) throw new ForbiddenException('A panel website can only read its own cards');
    const t = await this.tenantId();
    const cards = await this.db.surveyCard.findMany({ where: { tenantId: t, panel, panelistId: respondentRef, status: 'open', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { cards: cards.map((c) => ({ id: c.id, title: c.title, url: c.cardUrl, loiMinutes: c.loiMinutes, rewardPoints: c.rewardPoints, expiresAt: c.expiresAt.toISOString() })) };
  }

  /** SAMPLEON events: participation history, rewards, card states. Applied once per eventId. */
  async receive(raw: unknown) {
    const parsed = parseEvent(raw);
    if (!parsed.ok) throw new BadRequestException(`Invalid event: ${parsed.error}`);
    const e = parsed.event;
    if (e.source !== 'SAMPLEON') throw new ForbiddenException('Only SAMPLEON events are accepted here');
    const t = await this.tenantId();
    return this.db.$transaction(async (tx) => {
      const fresh = await tx.inboundEvent.createMany({ data: [{ eventId: e.eventId, tenantId: t, source: e.source, type: e.type, correlationId: e.correlationId }], skipDuplicates: true });
      if (!fresh.count) return { status: 'duplicate', eventId: e.eventId };
      if (!parsed.known) return { status: 'ignored', eventId: e.eventId };
      const p = e.payload as Record<string, unknown> & { sessionId?: string; respondentRef?: string };
      const ar = e.correlationId;
      const surveyId = e.subject.surveyId ?? 'unknown';
      const panelist = p.respondentRef ? await tx.panelist.findFirst({ where: { tenantId: t, id: p.respondentRef }, select: { id: true } }) : null;
      const card = async (status: string) => { if (panelist) await tx.surveyCard.updateMany({ where: { tenantId: t, audienceRequestId: ar, panelistId: panelist.id, status: { notIn: ['withdrawn'] } }, data: { status } }); };
      const touch = async () => { if (panelist) await tx.panelist.update({ where: { id: panelist.id }, data: { lastActiveAt: new Date() } }); };
      switch (parsed.type) {
        case 'survey.started': {
          if (!panelist) return { status: 'ignored', eventId: e.eventId };
          await tx.participation.upsert({ where: { sessionId: p.sessionId! }, create: { tenantId: t, sessionId: p.sessionId!, audienceRequestId: ar, surveyId, panelistId: panelist.id, status: 'started' }, update: {} });
          await card('started'); await touch();
          break;
        }
        case 'survey.completed': {
          if (!panelist) return { status: 'ignored', eventId: e.eventId };
          const part = await tx.participation.upsert({ where: { sessionId: p.sessionId! }, create: { tenantId: t, sessionId: p.sessionId!, audienceRequestId: ar, surveyId, panelistId: panelist.id, status: 'complete', endedAt: new Date() }, update: { status: 'complete', endedAt: new Date() } });
          await card('completed'); await touch();
          if (part.rewardEntryId) break;
          const points = Number(p.rewardPoints ?? 0);
          const entry = await tx.incentiveEntry.create({ data: { tenantId: t, panelistId: panelist.id, kind: 'earn', points, valueBase: 0, status: 'posted', note: `SAMPLEON ${ar} session ${p.sessionId}`, createdBy: 'sampleon' } });
          await tx.participation.update({ where: { id: part.id }, data: { rewardEntryId: entry.id } });
          await tx.panelist.update({ where: { id: panelist.id }, data: { points: { increment: points }, surveysCompleted: { increment: 1 } } });
          const confirm = makeEvent({ type: 'reward.eligibility_confirmed', source: 'SUPPLY360', correlationId: ar, causationId: e.eventId, subject: e.subject, payload: { sessionId: p.sessionId!, respondentRef: panelist.id, points, ledgerEntryId: entry.id } });
          await emit(tx, t, 'sampleon.event', { envelope: confirm });
          break;
        }
        case 'survey.screenout': {
          if (!panelist) return { status: 'ignored', eventId: e.eventId };
          await tx.participation.upsert({ where: { sessionId: p.sessionId! }, create: { tenantId: t, sessionId: p.sessionId!, audienceRequestId: ar, surveyId, panelistId: panelist.id, status: String(p.outcome), endedAt: new Date() }, update: { status: String(p.outcome), endedAt: new Date() } });
          await card('screened_out'); await touch();
          break;
        }
        case 'quality.failed': {
          if (!panelist) return { status: 'ignored', eventId: e.eventId };
          const part = await tx.participation.findUnique({ where: { sessionId: p.sessionId! } });
          if (part?.rewardEntryId) {
            const earned = await tx.incentiveEntry.findUnique({ where: { id: part.rewardEntryId } });
            if (earned && earned.points > 0) {
              await tx.incentiveEntry.create({ data: { tenantId: t, panelistId: panelist.id, kind: 'adjust', points: -earned.points, valueBase: 0, status: 'posted', note: `Reversed: quality check failed (SAMPLEON ${ar})`, createdBy: 'sampleon' } });
              await tx.panelist.update({ where: { id: panelist.id }, data: { points: { decrement: earned.points }, surveysCompleted: { decrement: 1 } } });
            }
          }
          await tx.participation.upsert({ where: { sessionId: p.sessionId! }, create: { tenantId: t, sessionId: p.sessionId!, audienceRequestId: ar, surveyId, panelistId: panelist.id, status: 'quality_fail', endedAt: new Date() }, update: { status: 'quality_fail', rewardEntryId: null } });
          const q = await tx.panelist.findUniqueOrThrow({ where: { id: panelist.id }, select: { qualityScore: true } });
          await tx.panelist.update({ where: { id: panelist.id }, data: { qualityScore: Math.max(0, +(q.qualityScore - 0.05).toFixed(3)) } });
          break;
        }
        case 'project.closed': {
          await tx.surveyCard.updateMany({ where: { tenantId: t, audienceRequestId: ar, status: 'open' }, data: { status: 'withdrawn' } });
          break;
        }
        default:
          return { status: 'ignored', eventId: e.eventId };
      }
      return { status: 'processed', eventId: e.eventId };
    });
  }

  /** Summary for the SUPPLY360 screens: cards, participation and rewards from SAMPLEON. */
  async overview(tenantId: string) {
    const [cards, parts, rewards] = await Promise.all([
      this.db.surveyCard.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.db.participation.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.db.incentiveEntry.aggregate({ where: { tenantId, createdBy: 'sampleon' }, _sum: { points: true } }),
    ]);
    return {
      cards: Object.fromEntries(cards.map((c) => [c.status, c._count._all])),
      participation: Object.fromEntries(parts.map((c) => [c.status, c._count._all])),
      rewardPointsNet: rewards._sum.points ?? 0,
    };
  }
}
