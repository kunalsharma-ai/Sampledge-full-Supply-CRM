/**
 * Synthetic panellists for the Audience Orbit X respondent screens. Shape follows the API's
 * Panelist model (pseudonymous handle, no names or contact details) plus profiling attributes the
 * API does not store yet, which are marked `demoOnly` in `fields`. Seeded, identical on every load.
 *
 * The sample stands for the full panel: `SCALE` converts a sample count into a panel-wide estimate.
 */
import { rng } from '../utils';
import { totals, type PanelId } from './demo';

const r = rng(7);
const pick = <T,>(a: readonly T[], w?: readonly number[]) => {
  if (!w) return a[Math.floor(r() * a.length)];
  const t = w.reduce((s, x) => s + x, 0);
  let x = r() * t;
  for (let i = 0; i < a.length; i++) { x -= w[i]; if (x <= 0) return a[i]; }
  return a[a.length - 1];
};

export const SAMPLE_SIZE = 12000;
export const SCALE = totals.members / SAMPLE_SIZE;

export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export const GENDERS = ['female', 'male', 'nonbinary', 'undisclosed'] as const;
export const STATUSES = ['active', 'dormant', 'suspended', 'deletion_requested'] as const;
export const SEGMENTS = ['consumer', 'professional', 'hcp', 'patient', 'caregiver'] as const;
export const COUNTRY_CODES = ['US', 'GB', 'DE', 'IN', 'CA', 'FR', 'BR', 'AU', 'ES', 'MX', 'IT', 'JP'] as const;
export const COUNTRY_W = [31, 14, 10, 9, 7, 6, 5, 4.5, 4, 3.5, 3, 3];
export const LANG: Record<string, string> = { US: 'en', GB: 'en', DE: 'de', IN: 'en', CA: 'en', FR: 'fr', BR: 'pt', AU: 'en', ES: 'es', MX: 'es', IT: 'it', JP: 'ja' };
export const INCOME = ['< 25k', '25–50k', '50–75k', '75–100k', '100–150k', '150k+'] as const;
export const EDUCATION = ['Secondary', 'Vocational', 'Bachelor', 'Master', 'Doctorate'] as const;
export const EMPLOYMENT = ['Full-time', 'Part-time', 'Self-employed', 'Student', 'Retired', 'Not working'] as const;
export const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Public sector', 'Media'] as const;
export const ROLES = ['IT decision maker', 'Finance leader', 'Marketing leader', 'HR leader', 'Operations manager', 'Software engineer', 'Procurement', 'Small business owner'] as const;
export const COMPANY = ['1–9', '10–49', '50–249', '250–999', '1,000–4,999', '5,000+'] as const;
export const SENIORITY = ['Individual contributor', 'Manager', 'Director', 'VP', 'C-level', 'Owner'] as const;
export const SPECIALTIES = ['Cardiology', 'Oncology', 'General practice', 'Nursing', 'Neurology', 'Dermatology', 'Endocrinology', 'Pharmacy', 'Pediatrics', 'Psychiatry'] as const;
export const CONDITIONS = ['Type 2 diabetes', 'Hypertension', 'Asthma', 'Migraine', 'Arthritis', 'Depression', 'Psoriasis', 'COPD'] as const;
export const DEVICES = ['Mobile', 'Desktop', 'Tablet'] as const;
export const RISKS = ['duplicate-device', 'speeder', 'straight-liner', 'geo-mismatch'] as const;

export type Panellist = {
  id: string; brand: PanelId; handle: string; country: string; language: string; ageBand: string; gender: string; segment: string; status: string;
  qualityScore: number; points: number; profileCompletion: number; surveysCompleted: number; joinedAt: string; lastActiveAt: string | null;
  income: string; education: string; employment: string;
  industry?: string; jobRole?: string; companySize?: string; seniority?: string;
  specialty?: string; yearsPractice?: number; conditions: string[];
  device: string; verified: { email: boolean; device: boolean; identity: boolean; credential?: boolean };
  risk: string[]; consents: { research_participation: boolean; health_data: boolean; marketing_email: boolean };
  responseRate: number; lastInviteDaysAgo: number;
};

const adjectives = ['amber', 'brisk', 'cobalt', 'dusky', 'ember', 'fable', 'gilded', 'harbor', 'ivory', 'jade', 'kindle', 'lunar', 'maple', 'nova', 'opal', 'pine', 'quartz', 'rapid', 'sable', 'tidal'];
const nouns = ['otter', 'falcon', 'meadow', 'comet', 'willow', 'harbor', 'pixel', 'river', 'summit', 'beacon', 'cedar', 'orbit', 'lantern', 'canyon', 'sparrow', 'glacier'];
const day = 86400000;
const now = Date.UTC(2026, 10, 6);

function make(i: number): Panellist {
  const brand = pick(['t2o', 'mfr', 'mho'] as const, [55, 37, 8]);
  const country = pick(COUNTRY_CODES, COUNTRY_W);
  const segment = brand === 'mho' ? pick(['hcp', 'patient', 'caregiver'] as const, [45, 40, 15]) : pick(['consumer', 'professional'] as const, [72, 28]);
  const status = pick(STATUSES, [68, 26, 4, 2]);
  const ageBand = segment === 'hcp' ? pick(AGE_BANDS, [1, 18, 30, 27, 18, 6]) : pick(AGE_BANDS, [14, 22, 20, 17, 15, 12]);
  const employed = segment === 'professional' || segment === 'hcp';
  const pc = Math.min(1, Math.max(0.12, (brand === 'mho' ? 0.82 : 0.68) + (r() - 0.5) * 0.6));
  const joined = now - Math.floor(r() * 1400) * day;
  const lastActive = status === 'active' ? now - Math.floor(r() * 30) * day : status === 'dormant' ? now - (60 + Math.floor(r() * 300)) * day : null;
  const risk = r() < 0.06 ? [pick(RISKS)] : [];
  return {
    id: `pn_${(100000 + i * 7919).toString(36)}`,
    brand, handle: `${pick(adjectives)}-${pick(nouns)}-${(i * 37) % 997}`, country, language: LANG[country], ageBand, gender: pick(GENDERS, [50, 46, 2, 2]), segment, status,
    qualityScore: +Math.min(0.99, Math.max(0.35, 0.82 + (r() - 0.5) * 0.35 - risk.length * 0.25)).toFixed(2),
    points: Math.floor(r() * (brand === 'mfr' ? 9000 : 4000)), profileCompletion: +pc.toFixed(2), surveysCompleted: Math.floor(r() * 140),
    joinedAt: new Date(joined).toISOString().slice(0, 10), lastActiveAt: lastActive ? new Date(lastActive).toISOString().slice(0, 10) : null,
    income: pick(INCOME, [14, 22, 21, 17, 15, 11]), education: pick(EDUCATION, [26, 16, 34, 18, 6]),
    employment: employed ? pick(['Full-time', 'Self-employed'] as const, [85, 15]) : pick(EMPLOYMENT, [40, 14, 8, 12, 16, 10]),
    ...(segment === 'professional' ? { industry: pick(INDUSTRIES), jobRole: pick(ROLES), companySize: pick(COMPANY), seniority: pick(SENIORITY, [30, 30, 18, 10, 6, 6]) } : {}),
    ...(segment === 'hcp' ? { specialty: pick(SPECIALTIES, [9, 7, 22, 24, 5, 5, 5, 10, 7, 6]), yearsPractice: 1 + Math.floor(r() * 32) } : {}),
    conditions: segment === 'patient' || segment === 'caregiver' ? [pick(CONDITIONS)].concat(r() < 0.3 ? [pick(CONDITIONS)] : []).filter((x, k, a) => a.indexOf(x) === k) : r() < 0.15 ? [pick(CONDITIONS)] : [],
    device: pick(DEVICES, [62, 31, 7]),
    verified: { email: r() < 0.97, device: r() < 0.9, identity: r() < (brand === 'mho' ? 0.8 : 0.42), ...(segment === 'hcp' ? { credential: r() < 0.84 } : {}) },
    risk, consents: { research_participation: status !== 'deletion_requested', health_data: brand === 'mho' ? r() < 0.92 : r() < 0.2, marketing_email: r() < 0.71 },
    responseRate: +(0.15 + r() * 0.55).toFixed(2), lastInviteDaysAgo: Math.floor(r() * 21),
  };
}

let cache: Panellist[] | null = null;
export const panellists = () => (cache ??= Array.from({ length: SAMPLE_SIZE }, (_, i) => make(i)));
export const panellistById = (id: string) => panellists().find((p) => p.id === id);

const brandFromApi: Record<string, PanelId> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
export const brandToApi: Record<PanelId, string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };

/** API Panelist row → screen shape. Attributes the API does not store yet stay empty. */
export function fromApiPanelist(a: { id: string; brand: string; handle: string; country: string; ageBand: string; gender: string; segment: string; status: string; qualityScore: number; points: number; profileCompletion: number; surveysCompleted: number; joinedAt: string; lastActiveAt: string | null; consents?: { purpose: string; granted: boolean }[] }): Panellist {
  const consent = (p: string) => a.consents?.find((c) => c.purpose === p)?.granted ?? false;
  return {
    id: a.id, brand: brandFromApi[a.brand] ?? 't2o', handle: a.handle, country: a.country, language: LANG[a.country] ?? 'en', ageBand: a.ageBand, gender: a.gender, segment: a.segment, status: a.status,
    qualityScore: a.qualityScore, points: a.points, profileCompletion: a.profileCompletion, surveysCompleted: a.surveysCompleted, joinedAt: a.joinedAt.slice(0, 10), lastActiveAt: a.lastActiveAt?.slice(0, 10) ?? null,
    income: '—', education: '—', employment: '—', conditions: [], device: '—', verified: { email: true, device: false, identity: false }, risk: [],
    consents: { research_participation: consent('research_participation'), health_data: consent('health_data'), marketing_email: consent('marketing_email') },
    responseRate: 0, lastInviteDaysAgo: 99,
  };
}

/** Deterministic per-panellist history for the 360° profile. */
export function historyFor(p: Panellist) {
  const h = rng(p.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0));
  const outcomes = ['complete', 'complete', 'complete', 'screenout', 'quota-full', 'dropout'] as const;
  const surveys = Array.from({ length: 14 }, (_, i) => {
    const o = outcomes[Math.floor(h() * outcomes.length)];
    const loi = 5 + Math.floor(h() * 20);
    return { id: `sv-${i}`, at: new Date(now - (i * 4 + Math.floor(h() * 3)) * day).toISOString().slice(0, 10), title: ['Streaming habits tracker', 'Grocery basket pulse', 'EV purchase intent', 'Holiday travel planner', 'Weekly rewards check-in', 'Profile: household'][Math.floor(h() * 6)], source: h() < 0.6 ? 'PROJEXA' : 'ZAPX', outcome: o, loi, points: o === 'complete' ? loi * 10 : o === 'screenout' ? 10 : 0 };
  });
  const monthly = Array.from({ length: 12 }, () => Math.floor(h() * 9));
  let bal = p.points;
  const ledger = Array.from({ length: 10 }, (_, i) => {
    const kind = i === 3 || i === 8 ? 'redeem' : i === 6 ? 'bonus' : 'earn';
    const amount = kind === 'redeem' ? -1000 * (1 + Math.floor(h() * 3)) : kind === 'bonus' ? 250 : 50 + Math.floor(h() * 200);
    const row = { id: `tx-${p.id}-${i}`, at: new Date(now - i * 9 * day).toISOString().slice(0, 10), kind, amount, balance: bal, status: kind === 'redeem' && i === 3 ? 'pending' : 'settled', memo: kind === 'redeem' ? ['PayPal', 'Amazon gift card', 'Charity donation'][Math.floor(h() * 3)] : kind === 'bonus' ? 'Profile completion bonus' : 'Survey complete' };
    bal -= amount;
    return row;
  });
  const events = [
    { at: p.joinedAt, text: `Registered on ${p.brand === 't2o' ? 'Turn2Opinion' : p.brand === 'mfr' ? 'MyFrequentRewards' : 'MyHealthOpinions'}` },
    { at: p.joinedAt, text: 'Email verified' },
    ...(p.verified.identity ? [{ at: p.joinedAt, text: 'Identity check passed' }] : []),
    ...surveys.slice(0, 4).map((s) => ({ at: s.at, text: `${s.outcome === 'complete' ? 'Completed' : s.outcome === 'screenout' ? 'Screened out of' : s.outcome === 'quota-full' ? 'Quota full on' : 'Dropped out of'} “${s.title}”` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { surveys, monthly, ledger, events };
}
