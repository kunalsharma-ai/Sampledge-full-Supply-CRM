/**
 * SUPPLY360 demonstration data for wave 6a: geography (global intelligence, distribution) and the
 * connected products (SAMPLEON allocation, PROJEXA and ZAPX audience requests).
 *
 * Every value is synthetic and seeded. Request statuses, event names and feasibility fields follow
 * the SAMPLEON contracts (`packages/contracts` in the Sampleon repository): request statuses
 * draft → submitted → feasibility_ready → approved → soft_launch → live → closed, plus paused,
 * rejected and cancelled; feasibility is `eligible`, `reachable`, `estimatedCompletes`, `shortfall`
 * and `byCountry`; allocation is points of 100 per panel.
 */
import { countries as coreCountries, countryByCode } from '../core';
import { rng } from '../utils';
import { audienceRequests, funnel, panelBrands, type PanelId } from './demo';
import { utcOffsetOf } from './fieldwork';
import { productName } from './screens';

const r = rng(606);
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
const PANELS: PanelId[] = ['t2o', 'mfr', 'mho'];

// ───────────────────────── Geography
export type Market = {
  code: string; name: string; lat: number; lon: number; region: 'Americas' | 'EMEA' | 'APAC'; utcOffset: number;
  members: Record<PanelId, number>; active: number; consented: number; reachable: number;
  completesToday: number; liveSurveys: number; ir: number; delta: number; trend: number[];
};

const weights: Record<string, number> = { US: 31, GB: 14, DE: 10, IN: 9, CA: 7, FR: 6, BR: 5, AU: 4.5, ES: 4, MX: 3.5, IT: 3, JP: 3, NL: 1.6, SE: 1.1, AE: 0.9, ZA: 1.2, CN: 0.6, KR: 1, SG: 1.4, ID: 1.5 };
const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
const mhoHeavy = new Set(['US', 'GB', 'DE', 'CA', 'FR']);

export const markets: Market[] = coreCountries.map((c) => {
  const w = (weights[c.code] ?? 1) / totalW;
  const members = {
    t2o: Math.round(1_284_310 * w * (0.8 + r() * 0.4)),
    mfr: Math.round(846_902 * w * (0.7 + r() * 0.6)),
    mho: Math.round(192_455 * w * (mhoHeavy.has(c.code) ? 1.6 : 0.35) * (0.8 + r() * 0.4)),
  };
  const all = members.t2o + members.mfr + members.mho;
  const active = Math.round(all * (0.26 + r() * 0.12));
  const consented = Math.round(active * (0.86 + r() * 0.1));
  const reachable = Math.round(consented * (0.3 + r() * 0.12));
  const liveSurveys = audienceRequests.filter((a) => a.countries.includes(c.code) && (a.status === 'live' || a.status === 'soft-launch')).length + between(0, 6);
  const completesToday = Math.round(reachable * (0.035 + r() * 0.03) * (liveSurveys ? 1 : 0.3));
  let v = completesToday * 0.9;
  const trend = Array.from({ length: 14 }, () => (v = Math.max(0, v * (1 + (r() - 0.45) * 0.12))));
  return { ...c, utcOffset: utcOffsetOf(c.code), members, active, consented, reachable, completesToday, liveSurveys, ir: 0.12 + r() * 0.4, delta: (r() - 0.4) * 0.18, trend: trend.map(Math.round) };
});
// Scale so the totals match the executive dashboard (reachable today and completes today).
{
  const rs = funnel[4].value / markets.reduce((a, m) => a + m.reachable, 0);
  const cs = 18_426 / markets.reduce((a, m) => a + m.completesToday, 0);
  for (const m of markets) { m.reachable = Math.round(m.reachable * rs); m.completesToday = Math.round(m.completesToday * cs); m.trend = m.trend.map((x) => Math.round(x * cs)); }
}
export const marketByCode = Object.fromEntries(markets.map((m) => [m.code, m])) as Record<string, Market>;
export const totalMembers = (m: Market) => m.members.t2o + m.members.mfr + m.members.mho;

/** Client headquarters, used to draw request arcs from where the demand is to where fieldwork runs. */
const clientHq: Record<string, string> = { 'Northwind Media': 'US', 'Helix Pharma': 'DE', 'Contoso Cloud': 'US', 'Fresh & Co': 'GB', 'Voltaro Motors': 'DE', 'Meridian Health': 'US', Fintrail: 'SG', Skyroute: 'GB' };
export type TrafficArc = { id: string; from: string; to: string; requestId: string; title: string; live: boolean; weight: number };
export const trafficArcs: TrafficArc[] = audienceRequests.flatMap((a) =>
  a.countries.map((to) => ({ id: `${a.id}-${to}`, from: clientHq[a.client] ?? 'US', to, requestId: a.id, title: a.title, live: a.status === 'live' || a.status === 'soft-launch', weight: Math.min(1, a.target / 1500) })),
).filter((x) => x.from !== x.to);
export const arcCoords = (a: TrafficArc) => ({ from: [countryByCode[a.from].lat, countryByCode[a.from].lon] as [number, number], to: [countryByCode[a.to].lat, countryByCode[a.to].lon] as [number, number], weight: a.weight });

/** Share of a market's reachable audience awake and inside the send window (08:00–21:00 local) at a UTC hour. */
export const inSendWindow = (utcHour: number, m: Pick<Market, 'utcOffset'>) => {
  const l = (((utcHour + m.utcOffset) % 24) + 24) % 24;
  return l >= 8 && l < 21;
};
/** Rough hourly responsiveness curve (local hour → relative likelihood of opening an invite). */
export const wakeCurve = (localHour: number) => (localHour < 7 || localHour >= 23 ? 0.05 : localHour < 9 ? 0.45 : localHour < 12 ? 0.8 : localHour < 17 ? 0.7 : localHour < 21 ? 1 : 0.35);

// ───────────────────────── SAMPLEON requests (contract statuses)
export type SampleonStatus = 'draft' | 'submitted' | 'feasibility_ready' | 'approved' | 'soft_launch' | 'live' | 'paused' | 'closed' | 'rejected' | 'cancelled';
export const pipelineStages: { key: SampleonStatus; label: string; hint: string }[] = [
  { key: 'submitted', label: 'Submitted', hint: 'Waiting for feasibility from SUPPLY360 counts' },
  { key: 'feasibility_ready', label: 'Feasibility ready', hint: 'Counts are back; allocation needs a person' },
  { key: 'approved', label: 'Approved', hint: 'Allocation approved; soft launch can be scheduled' },
  { key: 'soft_launch', label: 'Soft launch', hint: 'First batch in field, read-out pending' },
  { key: 'live', label: 'Live', hint: 'Full fieldwork' },
  { key: 'closed', label: 'Closed', hint: 'Target met or project closed' },
];

export type Feasibility = {
  feasible: boolean; eligible: number; reachable: number; estimatedCompletes: number; shortfall: number;
  byCountry: Record<string, { eligible: number; reachable: number; estimatedCompletes: number }>;
  byPanel: Record<PanelId, number>;
};
export type QuotaCell = { id: string; label: string; country: string | null; target: number; completes: number; full: boolean; condition: string; mapped: boolean; question?: string };
export type FlowEvent = { id: string; type: 'audience_request.submitted' | 'feasibility.calculated' | 'audience.approved' | 'batch.scheduled' | 'invitation.delivered' | 'survey.completed' | 'quota.full' | 'quality.failed' | 'project.quota_updated'; at: string; text: string };
export type SampleonRequest = {
  id: string; title: string; client: string; platform: 'PROJEXA' | 'ZAPX'; projectId: string | null; surveyId: string;
  status: SampleonStatus; countries: string[]; requiredCompletes: number; completes: number; ir: number; loi: number;
  rewardPoints: number; cpi: number; fieldwork: { start: string; end: string }; naturalLanguage: string;
  criteria: string[]; feasibility: Feasibility; allocation: Record<PanelId, number> | null; quotas: QuotaCell[];
  batches: { sent: number; scheduled: number; delivered: number; suppressed: number }; events: FlowEvent[]; healthcare: boolean;
};

const extraTitles: [string, string, 'PROJEXA' | 'ZAPX', string[]][] = [
  ['Plant-based protein trial', 'Fresh & Co', 'ZAPX', ['GB', 'NL']],
  ['Dermatologist biologics usage', 'Helix Pharma', 'PROJEXA', ['US', 'DE', 'FR']],
  ['Smart home installer survey', 'Contoso Cloud', 'PROJEXA', ['US', 'CA', 'AU']],
  ['Commuter app satisfaction', 'Skyroute', 'ZAPX', ['IN']],
  ['Pet insurance concept test', 'Northwind Media', 'ZAPX', ['US']],
  ['Caregiver burden index', 'Meridian Health', 'PROJEXA', ['US', 'GB']],
];
const statusMap: Record<string, SampleonStatus> = { live: 'live', 'soft-launch': 'soft_launch', scheduled: 'approved', pending: 'feasibility_ready', paused: 'paused' };
const extraStatus: SampleonStatus[] = ['submitted', 'feasibility_ready', 'submitted', 'live', 'closed', 'feasibility_ready'];
const crit = (hc: boolean, i: number, title = '') => hc
  ? /nurse/i.test(title) ? ['occupation is nurse', 'role in oncology'] : /caregiver/i.test(title) ? ['caregiver for a family member', 'hours per week ≥ 10'] : ['occupation is physician', `specialty in ${/derma/i.test(title) ? 'dermatology' : 'cardiology'}`, 'patients per week ≥ 20']
  : [['age 18–64'], ['household income ≥ 50k', 'decision maker for IT'], ['owns a car', 'plans to buy in 12 months'], ['age 18–34', 'has a bank account'], ['shops for groceries weekly']][i % 5];

function feasibilityFor(countries: string[], required: number, ir: number, hc: boolean): Feasibility {
  const byCountry: Feasibility['byCountry'] = {};
  let eligible = 0, reachable = 0, est = 0;
  const byPanel = { t2o: 0, mfr: 0, mho: 0 } as Record<PanelId, number>;
  for (const c of countries) {
    const m = marketByCode[c];
    const share = hc ? 0.012 + r() * 0.01 : 0.08 + r() * 0.2;
    const e = Math.round((m ? totalMembers(m) : 20000) * share);
    const re = Math.round(e * (0.22 + r() * 0.12));
    const ec = Math.round(re * ir * (0.35 + r() * 0.2));
    byCountry[c] = { eligible: e, reachable: re, estimatedCompletes: ec };
    eligible += e; reachable += re; est += ec;
    if (m) for (const p of PANELS) byPanel[p] += Math.round(re * (m.members[p] / totalMembers(m)) * (hc ? (p === 'mho' ? 3.2 : 0.15) : p === 'mho' ? 0.05 : 1));
  }
  return { feasible: est >= required, eligible, reachable, estimatedCompletes: est, shortfall: Math.max(0, required - est), byCountry, byPanel };
}

const dayStr = (d: number) => new Date(Date.UTC(2026, 10, 6 + d)).toISOString().slice(0, 10);

export const sampleonRequests: SampleonRequest[] = [
  ...audienceRequests.map((a, i) => ({ title: a.title, client: a.client, platform: a.source, countries: a.countries, status: statusMap[a.status], required: a.target, completes: a.completes, ir: a.ir, loi: a.loi, hc: i === 1 || i === 5, ref: a.sourceRef, id: a.id })),
  ...extraTitles.map(([title, client, platform, countries], k) => {
    const hc = /Dermatologist|Caregiver/.test(title);
    const status = extraStatus[k];
    const required = [600, 250, 400, 1200, 800, 350][k];
    return { title, client, platform, countries, status, required, completes: status === 'live' ? Math.round(required * 0.47) : status === 'closed' ? required : 0, ir: [0.35, 0.06, 0.14, 0.48, 0.3, 0.2][k], loi: [10, 22, 14, 7, 9, 16][k], hc, ref: platform === 'PROJEXA' ? `PRJ-${1060 + k}` : `ZX-S${910 + k * 4}`, id: `AR-${24420 + k * 29}` };
  }),
].map((x, i): SampleonRequest => {
  const feasibility = feasibilityFor(x.countries, x.required, x.ir, x.hc);
  const allocated = !['submitted', 'feasibility_ready', 'draft'].includes(x.status);
  const tot = feasibility.byPanel.t2o + feasibility.byPanel.mfr + feasibility.byPanel.mho || 1;
  const t2o = Math.round((feasibility.byPanel.t2o / tot) * 100), mfr = Math.round((feasibility.byPanel.mfr / tot) * 100);
  const allocation = allocated ? { t2o, mfr, mho: 100 - t2o - mfr } : null;
  const cellLabels = x.hc ? ['Hospital-based', 'Private practice'] : ['18–34', '35–54', '55+'];
  const quotas: QuotaCell[] = x.countries.slice(0, 2).flatMap((c) => cellLabels.map((l, k) => {
    const target = Math.round((x.required / Math.min(2, x.countries.length)) / cellLabels.length);
    const completes = Math.min(target, Math.round((x.completes / Math.min(2, x.countries.length) / cellLabels.length) * (0.75 + r() * 0.5)));
    const mapped = !(x.platform === 'PROJEXA' && x.status === 'submitted' && k === cellLabels.length - 1);
    return { id: `q-${c}-${k}`, label: `${c} · ${l}`, country: c, target, completes, full: completes >= target, condition: x.hc ? `practice_setting = ${l.toLowerCase()}` : `age in ${l.replace('+', '–99')}`, mapped, question: x.platform === 'PROJEXA' ? (x.hc ? 'S4. Where do you mainly practise?' : 'S1. What is your age?') : undefined };
  }));
  const sent = allocated ? between(2, 6) : 0;
  const delivered = Math.round((x.completes / Math.max(0.05, x.ir)) * (1.8 + r()));
  const t = (h: number) => (h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`);
  const events: FlowEvent[] = [
    { id: 'e1', type: 'audience_request.submitted' as const, at: t(between(80, 200)), text: `Submitted by ${productName(x.platform)} (${x.ref}) for ${x.countries.join(', ')}` },
    ...(x.status !== 'submitted' ? [{ id: 'e2', type: 'feasibility.calculated' as const, at: t(between(60, 79)), text: `${feasibility.estimatedCompletes.toLocaleString('en-US')} estimated completes from ${feasibility.reachable.toLocaleString('en-US')} reachable` }] : []),
    ...(allocated ? [{ id: 'e3', type: 'audience.approved' as const, at: t(between(40, 59)), text: `Allocation approved: T2O ${allocation!.t2o}, MFR ${allocation!.mfr}, MHO ${allocation!.mho}` }, { id: 'e4', type: 'batch.scheduled' as const, at: t(between(30, 39)), text: `Batch 1 scheduled (soft, ${between(200, 900)} invitations)` }] : []),
    ...(x.completes ? [{ id: 'e5', type: 'invitation.delivered' as const, at: t(between(10, 29)), text: `${delivered.toLocaleString('en-US')} delivered, ${Math.round(delivered * 0.04)} suppressed (no consent or fatigue cap)` }, { id: 'e6', type: 'survey.completed' as const, at: t(between(0, 3) || 1), text: `Verified complete in ${x.countries[0]}; ${x.completes} of ${x.required}` }] : []),
    ...(quotas.some((q) => q.full) ? [{ id: 'e7', type: 'quota.full' as const, at: t(between(4, 9)), text: `Quota ${quotas.find((q) => q.full)!.label} full` }] : []),
    ...(x.completes > 100 ? [{ id: 'e8', type: 'quality.failed' as const, at: t(between(2, 8)), text: 'One complete reversed: speeder flagged by SampCode' }] : []),
  ].reverse();
  return {
    id: x.id, title: x.title, client: x.client, platform: x.platform, projectId: x.platform === 'PROJEXA' ? x.ref : i % 2 ? `PRJ-${1080 + i}` : null, surveyId: x.platform === 'ZAPX' ? x.ref : `ZX-S${700 + i * 7}`,
    status: x.status, countries: x.countries, requiredCompletes: x.required, completes: x.completes, ir: x.ir, loi: x.loi,
    rewardPoints: Math.round(x.loi * (x.hc ? 60 : 12) / 10) * 10, cpi: Math.round((x.hc ? 38 : 2.2) * (x.loi / 12) * (0.25 / Math.max(0.05, x.ir)) ** 0.3 * 100) / 100,
    fieldwork: { start: dayStr(-between(2, 12)), end: dayStr(between(4, 20)) },
    naturalLanguage: x.hc ? `${crit(true, i, x.title).join(', ')} in ${x.countries.join(', ')}` : `Adults ${crit(false, i).join(', ')} in ${x.countries.join(', ')}`,
    criteria: crit(x.hc, i, x.title), feasibility, allocation, quotas,
    batches: { sent, scheduled: allocated ? between(1, 4) : 0, delivered, suppressed: Math.round(delivered * 0.04) },
    events, healthcare: x.hc,
  };
});

// ───────────────────────── PROJEXA request inbox
export type ProjexaRequest = {
  id: string; requestId: string; projectId: string; project: string; client: string; manager: string; received: string;
  state: 'new' | 'accepted' | 'countered' | 'declined';
  budget: { total: number; spent: number; cpiCap: number };
  milestones: { label: string; date: string; done: boolean }[];
  ask: { completes: number; ir: number; loi: number; countries: string[]; end: string; cpi: number };
  quotas: QuotaCell[]; risk: string | null;
};
const managers = ['A. Okafor', 'R. Lindqvist', 'M. Tanaka', 'S. Mehta', 'J. Moreau', 'L. Fischer'];
export const projexaRequests: ProjexaRequest[] = sampleonRequests.filter((s) => s.platform === 'PROJEXA').map((s, i) => {
  const ask = { completes: s.requiredCompletes, ir: s.ir, loi: s.loi, countries: s.countries, end: s.fieldwork.end, cpi: s.cpi };
  const total = Math.round(ask.completes * ask.cpi * (1.05 + r() * 0.3));
  const short = s.feasibility.shortfall > 0;
  return {
    id: `PX-${s.projectId}`, requestId: s.id, projectId: s.projectId!, project: s.title, client: s.client, manager: managers[i % managers.length], received: `${between(1, 30)}h ago`,
    state: s.status === 'submitted' || s.status === 'feasibility_ready' ? 'new' : 'accepted',
    budget: { total, spent: Math.round(s.completes * s.cpi), cpiCap: Math.round(s.cpi * 1.15 * 100) / 100 },
    milestones: [
      { label: 'Kick-off', date: s.fieldwork.start, done: true },
      { label: 'Questionnaire signed off', date: dayStr(-between(0, 2)), done: s.status !== 'submitted' },
      { label: 'Soft launch', date: dayStr(between(0, 3)), done: ['soft_launch', 'live', 'closed'].includes(s.status) },
      { label: 'Fieldwork closes', date: s.fieldwork.end, done: s.status === 'closed' },
      { label: 'Data delivery', date: dayStr(between(21, 28)), done: false },
    ],
    ask, quotas: s.quotas,
    risk: short ? `Feasibility shows ${s.feasibility.shortfall.toLocaleString('en-US')} short of target at this IR` : s.quotas.some((q) => !q.mapped) ? 'One quota question is not mapped to a SUPPLY360 attribute yet' : null,
  };
});

// ───────────────────────── ZAPX survey-first requests
export type RedirectCheck = { kind: 'complete' | 'screenout' | 'overquota' | 'quality'; url: string; state: 'passed' | 'failed' | 'untested' };
export type ZapxRequest = {
  id: string; requestId: string; surveyId: string; title: string; owner: string; linkedProject: string | null; language: string;
  status: 'qa' | 'ready' | 'approved' | 'live' | 'closed';
  questions: { n: number; text: string; kind: 'single' | 'multi' | 'grid' | 'open' | 'nps' }[];
  redirects: RedirectCheck[];
  qa: { id: string; label: string; ok: boolean; detail: string }[];
  testLoi: number | null; plannedLoi: number; countries: string[]; completes: number; feasibility: Feasibility;
};
const qBank: Record<string, ZapxRequest['questions']> = {
  default: [
    { n: 1, text: 'Which of these have you bought in the past month?', kind: 'multi' },
    { n: 2, text: 'How often do you shop for this category?', kind: 'single' },
    { n: 3, text: 'Rate each brand on value for money', kind: 'grid' },
    { n: 4, text: 'How likely are you to recommend it to a friend?', kind: 'nps' },
    { n: 5, text: 'What, if anything, would make you switch?', kind: 'open' },
  ],
  healthcare: [
    { n: 1, text: 'What is your current role?', kind: 'single' },
    { n: 2, text: 'How many patients do you see in a typical week?', kind: 'single' },
    { n: 3, text: 'Rate how each task affects your workload', kind: 'grid' },
    { n: 4, text: 'Which of these resources do you use?', kind: 'multi' },
    { n: 5, text: 'What one change would help most?', kind: 'open' },
  ],
};
export const zapxRequests: ZapxRequest[] = sampleonRequests.filter((s) => s.platform === 'ZAPX').map((s, i) => {
  const status: ZapxRequest['status'] = s.status === 'live' || s.status === 'soft_launch' ? 'live' : s.status === 'closed' ? 'closed' : s.status === 'approved' || s.status === 'paused' ? 'approved' : i % 2 ? 'qa' : 'ready';
  const base = `https://zapx.sampledge.example/s/${s.surveyId.toLowerCase()}`;
  const tested = status !== 'qa';
  const redirects: RedirectCheck[] = (['complete', 'screenout', 'overquota', 'quality'] as const).map((k, j) => ({ kind: k, url: `https://sampleon.sampledge.example/r/${k}?sid={session}`, state: tested ? 'passed' : j < 2 ? 'passed' : j === 2 ? 'failed' : 'untested' }));
  const testLoi = tested ? Math.round(s.loi * (0.9 + r() * 0.25) * 10) / 10 : i % 3 === 0 ? null : Math.round(s.loi * 1.4 * 10) / 10;
  return {
    id: `ZQ-${s.surveyId}`, requestId: s.id, surveyId: s.surveyId, title: s.title, owner: managers[(i + 2) % managers.length], linkedProject: s.projectId, language: 'en',
    status, questions: s.healthcare ? qBank.healthcare : qBank.default, redirects,
    qa: [
      { id: 'test', label: 'Test link completes end to end', ok: tested, detail: tested ? 'Last run 2h ago' : 'Not run since the last edit' },
      { id: 'redirects', label: 'All four redirects return to SampAudience', ok: redirects.every((x) => x.state === 'passed'), detail: redirects.every((x) => x.state === 'passed') ? '4 of 4 passed' : `${redirects.filter((x) => x.state === 'passed').length} of 4 passed` },
      { id: 'loi', label: 'Tested LOI within 25% of plan', ok: testLoi != null && testLoi <= s.loi * 1.25, detail: testLoi == null ? 'No timed test yet' : `${testLoi} min vs ${s.loi} planned` },
      { id: 'quality', label: 'Attention check and speeder rule present', ok: true, detail: 'Q3 grid has a trap row; speeder at 40% of median' },
      { id: 'translations', label: 'Every country has its language version', ok: s.countries.length === 1 || tested, detail: s.countries.length === 1 ? 'Single language' : tested ? 'All versions reviewed' : `${s.countries[s.countries.length - 1]} version not reviewed` },
    ],
    testLoi, plannedLoi: s.loi, countries: s.countries, completes: s.completes, feasibility: s.feasibility,
  };
});

export const panelName = (p: PanelId) => panelBrands.find((b) => b.id === p)!.short;
