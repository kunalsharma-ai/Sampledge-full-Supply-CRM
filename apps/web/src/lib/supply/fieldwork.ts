/**
 * Fieldwork demonstration data for wave 3 (survey inventory, routing, launch, batches, quotas).
 * Synthetic and seeded, so every load is identical. Every screen that shows it carries a demo badge.
 *
 * Integration points (see ./data.ts `endpoints`): surveys come from PROJEXA projects and ZAPX
 * studies through SAMPLEON, quota cells map to the API `QuotaCell` model (target, count, hard).
 */
import { rng } from '../utils';
import { audienceRequests, type PanelId } from './demo';

export type SurveySource = 'PROJEXA' | 'ZAPX' | 'Partner';
export type SurveyStatus = 'draft' | 'scheduled' | 'soft-launch' | 'live' | 'paused' | 'closed';
export type QuotaCell = { id: string; dim: string; label: string; target: number; achieved: number; hard: boolean; /** cumulative completes per field day */ history: number[] };
export type Survey = {
  id: string; ref: string; title: string; client: string; source: SurveySource; partner?: string; status: SurveyStatus;
  panels: PanelId[]; countries: string[]; cpi: number; ir: number; loi: number; target: number; completes: number;
  /** share of the field period that has passed, 0 to 1 */ elapsed: number; fieldDays: number; priority: 1 | 2 | 3;
  audience: string; quotas: QuotaCell[]; dropoff: number; quality: number;
};

const r = rng(2403);
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];

const extra = [
  ['Smart home device owners', 'Lumio', 'ZAPX'], ['Pet food switching study', 'Pawsome', 'PROJEXA'], ['Payroll software decision makers', 'Ledgerly', 'PROJEXA'],
  ['Dermatologist biologics awareness', 'Helix Pharma', 'PROJEXA'], ['Mobile gaming spend', 'Pixelforge', 'ZAPX'], ['Coffee concept test', 'Brewhaus', 'ZAPX'],
  ['IT security budget 2027', 'Contoso Cloud', 'PROJEXA'], ['Retail banking NPS', 'Fintrail', 'Partner'], ['Diabetes patient journey', 'Meridian Health', 'PROJEXA'],
  ['Sports streaming churn', 'Northwind Media', 'ZAPX'], ['Home insurance renewal', 'Shieldline', 'Partner'], ['GP prescribing habits', 'Helix Pharma', 'PROJEXA'],
  ['Fast fashion sustainability', 'Threadly', 'ZAPX'], ['B2B travel managers', 'Skyroute', 'PROJEXA'], ['Beauty subscription box', 'Glowbox', 'ZAPX'],
  ['Weekly rewards pulse #46', 'Sampledge', 'Partner'],
] as const;
const partners = ['Cint exchange', 'PureSpectrum', 'Internal'];
const hcp = new Set(['Cardiologist treatment preferences', 'Oncology nurse workload', 'Dermatologist biologics awareness', 'Diabetes patient journey', 'GP prescribing habits']);
const b2b = new Set(['SMB cloud buyer study', 'Payroll software decision makers', 'IT security budget 2027', 'B2B travel managers']);

function quotasFor(id: string, target: number, completes: number, elapsed: number, days: number, healthcare: boolean, business: boolean): QuotaCell[] {
  const dims: [string, string[], number[]][] = healthcare
    ? [['Specialty', ['Cardiology', 'Oncology', 'General practice'], [0.4, 0.35, 0.25]], ['Practice', ['Hospital', 'Private'], [0.55, 0.45]]]
    : business
      ? [['Company size', ['1–49', '50–249', '250+'], [0.4, 0.35, 0.25]], ['Role', ['IT decision maker', 'Finance'], [0.6, 0.4]]]
      : [['Age', ['18–34', '35–54', '55+'], [0.34, 0.38, 0.28]], ['Gender', ['Female', 'Male'], [0.5, 0.5]], ['Region', ['North', 'South', 'East', 'West'], [0.25, 0.25, 0.25, 0.25]]];
  const daysSoFar = Math.max(1, Math.round(days * elapsed));
  return dims.flatMap(([dim, labels, shares]) => labels.map((label, k) => {
    const t = Math.max(5, Math.round(target * shares[k]));
    const speed = 0.55 + r() * 0.75; // some cells run hot, some lag
    const achieved = Math.min(t, Math.round(completes * shares[k] * speed));
    const history = Array.from({ length: daysSoFar }, (_, d) => Math.round(achieved * Math.pow((d + 1) / daysSoFar, 0.9 + r() * 0.3)));
    return { id: `${id}-${dim}-${k}`, dim, label, target: t, achieved, hard: dim !== 'Region', history };
  }));
}

export const surveys: Survey[] = [
  ...audienceRequests.map((a, i) => ({
    ref: a.sourceRef, title: a.title, client: a.client, source: a.source as SurveySource, countries: a.countries, target: a.target, completes: a.completes,
    ir: a.ir, loi: a.loi, elapsed: a.elapsed, panels: (Object.entries(a.panels).filter(([, v]) => v > 0).map(([k]) => k) as PanelId[]),
    status: (a.status === 'pending' ? 'draft' : a.status) as SurveyStatus, i,
  })),
  ...extra.map(([title, client, source], k) => {
    const status = pick(['live', 'live', 'live', 'scheduled', 'soft-launch', 'paused', 'closed', 'draft'] as const);
    const target = pick([200, 300, 500, 800, 1000, 1500]);
    const elapsed = status === 'closed' ? 1 : status === 'draft' || status === 'scheduled' ? 0 : status === 'soft-launch' ? 0.06 + r() * 0.06 : 0.2 + r() * 0.7;
    const completes = status === 'closed' ? target : Math.round(target * elapsed * (0.7 + r() * 0.5));
    const isHcp = hcp.has(title);
    return {
      ref: source === 'PROJEXA' ? `PRJ-${1100 + k * 3}` : source === 'ZAPX' ? `ZX-S${920 + k * 5}` : `EXT-${300 + k}`,
      title, client, source: source as SurveySource, countries: pick([['US'], ['GB'], ['US', 'CA'], ['DE', 'FR'], ['US', 'GB', 'DE'], ['IN']]),
      target, completes: Math.min(target, completes), ir: isHcp ? 0.05 + r() * 0.1 : 0.15 + r() * 0.6, loi: between(5, 22), elapsed,
      panels: (isHcp ? ['mho'] : pick([['t2o'], ['mfr'], ['t2o', 'mfr']])) as PanelId[], status: status as SurveyStatus, i: 8 + k,
    };
  }),
].map((s) => {
  const id = `sv-${5200 + s.i * 11}`;
  const fieldDays = s.loi > 15 ? 14 : 10;
  const healthcare = hcp.has(s.title), business = b2b.has(s.title);
  return {
    id, ref: s.ref, title: s.title, client: s.client, source: s.source, partner: s.source === 'Partner' ? partners[s.i % 3] : undefined, status: s.status,
    panels: s.panels.length ? s.panels : ['t2o'], countries: s.countries, cpi: Number((healthcare ? 28 + r() * 40 : business ? 9 + r() * 12 : 1.2 + (s.loi / 10) * (1.5 + r()) / Math.max(0.2, s.ir)).toFixed(2)),
    ir: s.ir, loi: s.loi, target: s.target, completes: s.completes, elapsed: s.elapsed, fieldDays, priority: (s.i % 5 === 0 ? 1 : s.i % 3 === 0 ? 3 : 2) as 1 | 2 | 3,
    audience: healthcare ? 'Healthcare professionals' : business ? 'B2B decision makers' : 'Gen pop 18+',
    quotas: quotasFor(id, s.target, s.completes, Math.max(0.05, s.elapsed), fieldDays, healthcare, business),
    dropoff: 0.05 + r() * 0.18, quality: 0.78 + r() * 0.2,
  } satisfies Survey;
});

export const surveyById = (id: string) => surveys.find((s) => s.id === id);

/** Pace of a cell or survey: achieved share of target divided by share of the field period passed. */
export function pace(achieved: number, target: number, elapsed: number) {
  if (target <= 0) return 1;
  return achieved / target / Math.max(0.05, elapsed);
}
export type PaceBand = 'full' | 'ahead' | 'on' | 'behind' | 'risk' | 'idle';
export function paceBand(achieved: number, target: number, elapsed: number): PaceBand {
  if (achieved >= target) return 'full';
  if (elapsed <= 0) return 'idle';
  const p = pace(achieved, target, elapsed);
  return p >= 1.15 ? 'ahead' : p >= 0.92 ? 'on' : p >= 0.7 ? 'behind' : 'risk';
}
export const paceMeta: Record<PaceBand, { label: string; cls: string; text: string }> = {
  full: { label: 'Full', cls: 'bg-ink-3/25', text: 'text-ink-2' },
  ahead: { label: 'Ahead', cls: 'bg-cyan/30', text: 'text-cyan' },
  on: { label: 'On pace', cls: 'bg-emerald/30', text: 'text-emerald' },
  behind: { label: 'Behind', cls: 'bg-warn/35', text: 'text-warn' },
  risk: { label: 'At risk', cls: 'bg-danger/35', text: 'text-danger' },
  idle: { label: 'Not started', cls: 'bg-ink-3/10', text: 'text-ink-3' },
};

/** Soft-launch read-out: what was planned vs what the first completes show. */
export function softLaunchReadout(s: Survey) {
  const rr = rng(s.id.length * 97 + s.loi);
  const n = Math.max(20, Math.round(s.target * 0.1));
  const done = Math.min(n, Math.max(s.completes, Math.round(n * (0.6 + rr() * 0.5))));
  const metric = (label: string, plan: number, actual: number, unit: '%' | 'min', goodWhen: 'up' | 'down' | 'near', tolerance: number) => {
    const diff = (actual - plan) / plan;
    const ok = goodWhen === 'near' ? Math.abs(diff) <= tolerance : goodWhen === 'up' ? diff >= -tolerance : diff <= tolerance;
    return { label, plan, actual, unit, diff, ok };
  };
  return {
    sample: n, done,
    metrics: [
      metric('Incidence', s.ir, s.ir * (0.78 + rr() * 0.4), '%', 'up', 0.15),
      metric('Length of interview', s.loi, s.loi * (0.85 + rr() * 0.45), 'min', 'near', 0.2),
      metric('Drop-off', 0.1, s.dropoff, '%', 'down', 0.25),
      metric('Quality pass rate', 0.9, s.quality, '%', 'up', 0.06),
    ],
    openEndsFlagged: Math.round(done * (0.01 + rr() * 0.05)),
    dropoffByQuestion: Array.from({ length: 12 }, (_, q) => ({ q: `Q${q + 1}`, drop: Number((rr() * (q === 7 ? 6 : 1.6)).toFixed(1)) })),
  };
}

export const launchChecklist = [
  { id: 'links', label: 'Survey links tested on desktop and mobile', auto: true },
  { id: 'redirects', label: 'Complete, screen-out and over-quota redirects return correctly', auto: true },
  { id: 'quotas', label: 'Quota cells match the client brief', auto: false },
  { id: 'translations', label: 'All country versions reviewed', auto: false },
  { id: 'incentive', label: 'Incentive set and within the rate card', auto: true },
  { id: 'fraud', label: 'Fraud checks and speeder thresholds on', auto: true },
  { id: 'client', label: 'Client signed off the soft-launch data', auto: false },
] as const;

/** Invitation batches (Gantt rows). Hours are relative to Monday 00:00 UTC of the plan week. */
export type Batch = { id: string; surveyId: string; country: string; utcOffset: number; start: number; duration: number; invites: number; throttle: number; status: 'sent' | 'sending' | 'scheduled' | 'held' };
const tz: Record<string, number> = { US: -5, CA: -5, MX: -6, BR: -3, GB: 0, DE: 1, FR: 1, ES: 1, IT: 1, NL: 1, SE: 1, ZA: 2, AE: 4, IN: 5.5, ID: 7, SG: 8, CN: 8, JP: 9, KR: 9, AU: 10 };
export const utcOffsetOf = (c: string) => tz[c] ?? 0;
export const NOW_HOUR = 2 * 24 + 15; // Wednesday 15:00 UTC in the demo week

export const batches: Batch[] = surveys
  .filter((s) => s.status === 'live' || s.status === 'soft-launch' || s.status === 'scheduled')
  .slice(0, 9)
  .flatMap((s, si) => s.countries.flatMap((c, ci) => {
    const off = utcOffsetOf(c);
    return [0, 1, 2].map((w) => {
      const localStart = 9 + Math.floor(r() * 8); // 09:00–17:00 local
      const day = Math.min(6, (si % 3) + w * 2 + (s.status === 'scheduled' ? 2 : 0));
      const duration = between(2, 6);
      const start = Math.min(7 * 24 - duration, day * 24 + localStart - off);
      const invites = Math.round((s.target / Math.max(0.05, s.ir)) * 0.35 / s.countries.length / 3 / 10) * 10;
      const status: Batch['status'] = start + duration <= NOW_HOUR ? 'sent' : start <= NOW_HOUR ? 'sending' : s.status === 'paused' ? 'held' : 'scheduled';
      return { id: `b-${s.id}-${c}-${w}`, surveyId: s.id, country: c, utcOffset: off, start: Math.max(0, start), duration, invites: Math.max(50, invites), throttle: Math.max(20, Math.round(invites / duration / 10) * 10), status };
    });
  }).slice(0, 6));

/** Local hour (0–23.99) for a UTC plan hour in a country. */
export const localHour = (h: number, c: string) => (((h + utcOffsetOf(c)) % 24) + 24) % 24;
/** Quiet hours: no invitations between 21:00 and 08:00 local time. */
export const inQuietHours = (start: number, duration: number, c: string) => {
  for (let h = start; h < start + duration; h += 0.5) { const l = localHour(h, c); if (l >= 21 || l < 8) return true; }
  return false;
};
