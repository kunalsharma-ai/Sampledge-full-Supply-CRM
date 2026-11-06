'use client';
/**
 * SampAudience audience requests for the SUPPLY360 screens, read through the SUPPLY360 API
 * (`GET /sampaudience/requests`, apps/api/src/integrations/sampleon/requests-proxy.ts), and mapped
 * onto the shapes the allocation, SampTrek and SampCode request, survey, launch, batch and routing
 * screens already use. Decisions (approve, launch, batches, pause) are made by a SampAudience
 * approver in the SampAudience console; these screens link there when live.
 */
import { api } from '../api';
import type { PanelId } from './demo';
import type { Feasibility, FlowEvent, ProjexaRequest, QuotaCell, SampleonRequest, SampleonStatus, ZapxRequest } from './connected';
import { utcOffsetOf, type Batch, type Survey } from './fieldwork';
import { productName } from './screens';

type Criterion = { attribute: string; op: string; value?: unknown; values?: unknown[]; min?: number; max?: number };
type ServerFeasibility = {
  calculatedAt: string; feasible: boolean; eligible: number; reachable: number; estimatedCompletes: number; shortfall: number;
  byCountry: Record<string, { eligible: number; reachable: number; estimatedCompletes: number; byPanel?: Record<string, { reachable: number }> }>;
};
export type LiveSampRequest = {
  audienceRequestId: string; status: SampleonStatus; title: string | null;
  source: { platform: 'PROJEXA' | 'ZAPX' | string; projectId: string; surveyId: string };
  organization: { id: string; name: string };
  spec: {
    countries?: string[]; loiMinutes?: number; expectedIncidence?: number; reward?: { points: number; value?: number };
    fieldwork?: { start: string; end: string }; targeting?: { criteria?: Criterion[]; naturalLanguage?: string };
    quotas?: { id: string; conditions?: Criterion[] }[]; survey?: { language?: string };
  };
  requiredCompletes: number; completes: number; remaining: number;
  approval: { approvedBy: string | null; approvedAt: string | null; note: string | null };
  launch: { mode: string | null; softLaunchTarget: number | null; autoBatches: boolean | null };
  feasibility: ServerFeasibility | null;
  allocation: { country: string; panel: string; target: number }[];
  quotas: { id: string; label: string; country: string | null; target: number; completes: number; hard: boolean; full: boolean }[];
  batches: { id: string; mode: string; size: number; scheduled_at: string; auto: boolean; status: string; selected: number | null; delivered: number | null; suppressed: number | null; error: string | null; sent_at: string | null }[];
  outcomes: Record<string, number>;
  routing: { decisions: number; routed: number };
  createdAt: string; updatedAt: string;
  recorded?: { cards: number; completes: number; points: number };
};
export type SampFeed = { connected: boolean; consoleUrl: string | null; requests: LiveSampRequest[] };

/** The live feed, or null when SampAudience is not connected (screens then keep their demo set). */
export async function loadSampFeed(platform?: 'PROJEXA' | 'ZAPX'): Promise<SampFeed | null> {
  const f = await api<SampFeed>(`/sampaudience/requests${platform ? `?platform=${platform}` : ''}`);
  return f.connected ? f : null;
}

const PANEL: Record<string, PanelId> = { t2o: 't2o', mfr: 'mfr', mho: 'mho', turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
const fmtVal = (v: unknown) => (typeof v === 'string' ? v.replace(/_/g, ' ') : String(v));
/** One criterion in words, e.g. "occupation is nurse", "age 18 to 34". */
export function criterionText(c: Criterion) {
  const a = c.attribute.split('.').pop()!.replace(/_/g, ' ');
  switch (c.op) {
    case 'eq': return `${a} is ${fmtVal(c.value)}`;
    case 'in': return `${a} is ${(c.values ?? []).map(fmtVal).join(' or ')}`;
    case 'nin': return `${a} is not ${(c.values ?? []).map(fmtVal).join(' or ')}`;
    case 'gte': return `${a} ≥ ${c.value}`;
    case 'lte': return `${a} ≤ ${c.value}`;
    case 'between': return `${a} ${c.min} to ${c.max}`;
    default: return `has ${a}`;
  }
}
const isHealth = (cs: Criterion[]) => cs.some((c) => /^(health|hcp|medical|patient|caregiver)|specialty|condition/.test(c.attribute));

export function rel(iso: string | null | undefined) {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (h < 0) return h > -24 ? `in ${-h}h` : `in ${Math.round(-h / 24)}d`;
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function toFeasibility(f: ServerFeasibility | null, required: number): Feasibility {
  if (!f) return { feasible: false, eligible: 0, reachable: 0, estimatedCompletes: 0, shortfall: required, byCountry: {}, byPanel: { t2o: 0, mfr: 0, mho: 0 } };
  const byPanel: Record<PanelId, number> = { t2o: 0, mfr: 0, mho: 0 };
  for (const c of Object.values(f.byCountry)) for (const [p, v] of Object.entries(c.byPanel ?? {})) if (PANEL[p]) byPanel[PANEL[p]] += v.reachable;
  return {
    feasible: f.feasible, eligible: f.eligible, reachable: f.reachable, estimatedCompletes: f.estimatedCompletes, shortfall: f.shortfall, byPanel,
    byCountry: Object.fromEntries(Object.entries(f.byCountry).map(([k, v]) => [k, { eligible: v.eligible, reachable: v.reachable, estimatedCompletes: v.estimatedCompletes }])),
  };
}

/** Allocation targets as whole-number shares of 100 per panel, or null before approval. */
export function allocationShares(a: LiveSampRequest['allocation']): Record<PanelId, number> | null {
  const tot = a.reduce((s, x) => s + x.target, 0);
  if (!tot) return null;
  const by: Record<PanelId, number> = { t2o: 0, mfr: 0, mho: 0 };
  for (const x of a) if (PANEL[x.panel]) by[PANEL[x.panel]] += x.target;
  const t2o = Math.round((by.t2o / tot) * 100), mfr = Math.round((by.mfr / tot) * 100);
  return { t2o, mfr, mho: 100 - t2o - mfr };
}

export function toQuotaCells(v: LiveSampRequest): QuotaCell[] {
  const conds = new Map((v.spec.quotas ?? []).map((q) => [q.id, (q.conditions ?? []).map(criterionText).join(' AND ')]));
  return v.quotas.map((q) => ({ id: q.id, label: q.label, country: q.country, target: q.target, completes: q.completes, full: q.full, condition: conds.get(q.id) || (q.country ? `country is ${q.country}` : 'all respondents'), mapped: true }));
}

/** What happened to the request, from the timestamps SampAudience records. Newest first. */
export function eventsOf(v: LiveSampRequest): FlowEvent[] {
  const out: (FlowEvent & { t: number })[] = [];
  const add = (id: string, type: FlowEvent['type'], iso: string | null | undefined, text: string) => { if (iso) out.push({ id, type, at: rel(iso), text, t: new Date(iso).getTime() }); };
  add('sub', 'audience_request.submitted', v.createdAt, `Submitted by ${productName(v.source.platform)} (${v.source.projectId}) for ${(v.spec.countries ?? []).join(', ')}`);
  if (v.feasibility) add('feas', 'feasibility.calculated', v.feasibility.calculatedAt, `${v.feasibility.estimatedCompletes.toLocaleString('en-US')} estimated completes from ${v.feasibility.reachable.toLocaleString('en-US')} reachable members`);
  const shares = allocationShares(v.allocation);
  if (v.approval.approvedAt) add('appr', 'audience.approved', v.approval.approvedAt, shares ? `Allocation approved: T2O ${shares.t2o}, MFR ${shares.mfr}, MHO ${shares.mho}` : 'Approved');
  for (const b of v.batches) {
    add(`b-${b.id}`, 'batch.scheduled', b.scheduled_at, `${b.mode === 'soft' ? 'Soft-launch' : 'Batch'} of ${b.size.toLocaleString('en-US')} ${b.status === 'scheduled' ? 'scheduled' : b.status}`);
    if (b.sent_at && b.delivered != null) add(`d-${b.id}`, 'invitation.delivered', b.sent_at, `${b.delivered.toLocaleString('en-US')} delivered, ${(b.suppressed ?? 0).toLocaleString('en-US')} suppressed`);
  }
  const full = v.quotas.find((q) => q.full);
  if (full) add('qf', 'quota.full', v.updatedAt, `Quota ${full.label} full`);
  return out.sort((a, b) => b.t - a.t).map(({ t: _t, ...e }) => e);
}

export function toSampleonRequest(v: LiveSampRequest): SampleonRequest {
  const crit = v.spec.targeting?.criteria ?? [];
  const sum = (k: 'delivered' | 'suppressed') => v.batches.reduce((s, b) => s + (b[k] ?? 0), 0);
  return {
    id: v.audienceRequestId, title: v.title ?? `${productName(v.source.platform)} ${v.source.surveyId}`, client: v.organization.name,
    platform: v.source.platform === 'ZAPX' ? 'ZAPX' : 'PROJEXA', projectId: v.source.platform === 'PROJEXA' ? v.source.projectId : v.source.projectId || null, surveyId: v.source.surveyId,
    status: v.status, countries: v.spec.countries ?? [], requiredCompletes: v.requiredCompletes, completes: v.completes,
    ir: v.spec.expectedIncidence ?? 0, loi: v.spec.loiMinutes ?? 0, rewardPoints: v.spec.reward?.points ?? 0, cpi: 0,
    fieldwork: { start: v.spec.fieldwork?.start ?? '', end: v.spec.fieldwork?.end ?? '' },
    naturalLanguage: v.spec.targeting?.naturalLanguage ?? '', criteria: crit.map(criterionText),
    feasibility: toFeasibility(v.feasibility, v.requiredCompletes), allocation: allocationShares(v.allocation), quotas: toQuotaCells(v),
    batches: { sent: v.batches.filter((b) => b.sent_at).length, scheduled: v.batches.filter((b) => b.status === 'scheduled').length, delivered: sum('delivered'), suppressed: sum('suppressed') },
    events: eventsOf(v), healthcare: isHealth(crit),
  };
}

export function toProjexaRequest(v: LiveSampRequest): ProjexaRequest {
  const s = toSampleonRequest(v);
  const state: ProjexaRequest['state'] = v.status === 'rejected' || v.status === 'cancelled' ? 'declined' : v.status === 'submitted' || v.status === 'feasibility_ready' ? 'new' : 'accepted';
  return {
    id: `PX-${v.source.projectId}`, requestId: v.audienceRequestId, projectId: v.source.projectId, project: s.title, client: s.client, manager: '', received: rel(v.createdAt), state,
    budget: { total: 0, spent: 0, cpiCap: 0 },
    milestones: [
      { label: 'Submitted', date: v.createdAt.slice(0, 10), done: true },
      { label: 'Feasibility', date: v.feasibility?.calculatedAt.slice(0, 10) ?? '', done: !!v.feasibility },
      { label: 'Approved', date: v.approval.approvedAt?.slice(0, 10) ?? '', done: !!v.approval.approvedAt },
      { label: 'Fieldwork starts', date: s.fieldwork.start, done: ['soft_launch', 'live', 'paused', 'closed'].includes(v.status) },
      { label: 'Fieldwork closes', date: s.fieldwork.end, done: v.status === 'closed' },
    ],
    ask: { completes: v.requiredCompletes, ir: s.ir, loi: s.loi, countries: s.countries, end: s.fieldwork.end, cpi: 0 },
    quotas: s.quotas,
    risk: v.feasibility && v.feasibility.shortfall > 0 ? `Feasibility shows ${v.feasibility.shortfall.toLocaleString('en-US')} short of target at this IR` : null,
  };
}

export function toZapxRequest(v: LiveSampRequest): ZapxRequest {
  const s = toSampleonRequest(v);
  const status: ZapxRequest['status'] = v.status === 'closed' || v.status === 'cancelled' || v.status === 'rejected' ? 'closed' : v.status === 'live' || v.status === 'soft_launch' || v.status === 'paused' ? 'live' : v.status === 'approved' ? 'approved' : v.status === 'feasibility_ready' ? 'ready' : 'qa';
  return {
    id: `ZX-${v.source.surveyId}`, requestId: v.audienceRequestId, surveyId: v.source.surveyId, title: s.title, owner: s.client, linkedProject: v.source.projectId || null,
    language: v.spec.survey?.language ?? '', status, questions: [], redirects: [], qa: [], testLoi: null, plannedLoi: s.loi, countries: s.countries, completes: v.completes, feasibility: s.feasibility,
  };
}

const SURVEY_STATUS: Record<string, Survey['status']> = { draft: 'draft', submitted: 'draft', feasibility_ready: 'draft', approved: 'scheduled', soft_launch: 'soft-launch', live: 'live', paused: 'paused', closed: 'closed', rejected: 'closed', cancelled: 'closed' };
/** A request as an inventory survey: field time from its fieldwork dates, cells from its quotas, panels from its allocation. */
export function toSurvey(v: LiveSampRequest): Survey {
  const s = toSampleonRequest(v);
  const start = Date.parse(s.fieldwork.start), end = Date.parse(s.fieldwork.end);
  const span = Number.isFinite(start) && Number.isFinite(end) ? Math.max(86400_000, end - start) : 0;
  const shares = s.allocation;
  const panels = shares ? (Object.keys(shares) as PanelId[]).filter((p) => shares[p] > 0) : [];
  return {
    id: v.audienceRequestId, ref: v.source.platform === 'ZAPX' ? v.source.surveyId : v.source.projectId, title: s.title, client: s.client,
    source: s.platform, status: SURVEY_STATUS[v.status] ?? 'draft', panels, countries: s.countries, cpi: 0, ir: s.ir, loi: s.loi,
    target: v.requiredCompletes, completes: v.completes,
    elapsed: span ? Math.min(1, Math.max(0, (Date.now() - start) / span)) : 0, fieldDays: span ? Math.round(span / 86400_000) : 1, priority: 2,
    audience: s.naturalLanguage || s.criteria.join(', '),
    quotas: v.quotas.map((q) => ({ id: q.id, dim: q.country ?? 'All countries', label: q.label, target: q.target, achieved: q.completes, hard: q.hard, history: [] })),
    dropoff: 0, quality: 0,
  };
}

/** Soft-launch read-out from what SampAudience recorded: incidence, drop-off and quality pass from session outcomes. */
export function liveReadout(v: LiveSampRequest) {
  const o = v.outcomes;
  const n = (k: string) => o[k] ?? 0;
  const ended = n('complete') + n('terminate') + n('quota_full') + n('quality_fail');
  const started = Object.values(o).reduce((a, x) => a + x, 0);
  const plan = { ir: v.spec.expectedIncidence ?? 0 };
  const metric = (label: string, planV: number, actual: number, goodWhen: 'up' | 'down', tolerance: number) => {
    const diff = planV ? (actual - planV) / planV : 0;
    return { label, plan: planV, actual, unit: '%' as const, diff, ok: goodWhen === 'up' ? diff >= -tolerance : diff <= tolerance };
  };
  const screened = n('complete') + n('terminate');
  return {
    sample: v.launch.softLaunchTarget ?? Math.max(20, Math.round(v.requiredCompletes * 0.1)), done: n('complete'),
    metrics: started ? [
      metric('Incidence', plan.ir, screened ? n('complete') / screened : 0, 'up', 0.15),
      metric('Drop-off', 0.1, started ? (started - ended) / started : 0, 'down', 0.25),
      metric('Quality pass rate', 0.9, n('complete') + n('quality_fail') ? n('complete') / (n('complete') + n('quality_fail')) : 1, 'up', 0.06),
    ] : [],
    openEndsFlagged: 0,
    dropoffByQuestion: [] as { q: string; drop: number }[],
  };
}

/** Monday 00:00 UTC of the current week, the origin of the batch timeline. */
export function weekStartUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}
/**
 * SampAudience batches placed on this week's timeline (hours from Monday 00:00 UTC). A batch covers
 * the whole request; it is drawn on the request's first country, whose quiet hours it is checked
 * against. Batches in other weeks are counted, not drawn.
 */
export function toBatches(reqs: LiveSampRequest[], now = new Date()) {
  const origin = weekStartUtc(now);
  const out: Batch[] = [];
  let otherWeeks = 0;
  for (const v of reqs) for (const b of v.batches) {
    const t = Date.parse(b.sent_at ?? b.scheduled_at);
    const start = (t - origin) / 3600_000;
    if (!Number.isFinite(start) || start < 0 || start >= 7 * 24) { otherWeeks++; continue; }
    const country = v.spec.countries?.[0] ?? 'US';
    const duration = 2;
    out.push({
      id: b.id, surveyId: v.audienceRequestId, country, utcOffset: utcOffsetOf(country), start: Math.floor(start), duration, invites: b.size,
      throttle: Math.max(10, Math.round(b.size / duration)), status: b.status === 'sent' ? 'sent' : b.status === 'sending' ? 'sending' : b.status === 'scheduled' ? 'scheduled' : 'held',
    });
  }
  return { batches: out, otherWeeks, nowHour: (now.getTime() - origin) / 3600_000 };
}
