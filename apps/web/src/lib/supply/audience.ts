/**
 * Audience definitions: nested AND/OR filter groups over panellist attributes, evaluation against
 * the synthetic sample, a rule-based natural-language translator, and the feasibility model.
 *
 * In production SAMPLEON sends the same structure to SUPPLY360's eligibility API and gets counts
 * back; nothing here needs individual respondent records to leave SUPPLY360.
 */
import {
  AGE_BANDS, COMPANY, CONDITIONS, COUNTRY_CODES, DEVICES, EDUCATION, EMPLOYMENT, GENDERS, INCOME, INDUSTRIES, ROLES, SCALE, SEGMENTS, SENIORITY, SPECIALTIES,
  type Panellist,
} from './panellists';

export type FieldType = 'enum' | 'number' | 'list';
export type FieldDef = { key: string; label: string; type: FieldType; group: 'Panel' | 'Demographic' | 'B2B' | 'Healthcare' | 'Engagement'; options?: readonly string[]; get: (p: Panellist) => string | number | string[] | undefined; unit?: string };

export const fields: FieldDef[] = [
  { key: 'brand', label: 'Panel', type: 'enum', group: 'Panel', options: ['t2o', 'mfr', 'mho'], get: (p) => p.brand },
  { key: 'status', label: 'Status', type: 'enum', group: 'Panel', options: ['active', 'dormant', 'suspended'], get: (p) => p.status },
  { key: 'segment', label: 'Segment', type: 'enum', group: 'Panel', options: SEGMENTS, get: (p) => p.segment },
  { key: 'country', label: 'Country', type: 'enum', group: 'Demographic', options: COUNTRY_CODES, get: (p) => p.country },
  { key: 'ageBand', label: 'Age band', type: 'enum', group: 'Demographic', options: AGE_BANDS, get: (p) => p.ageBand },
  { key: 'gender', label: 'Gender', type: 'enum', group: 'Demographic', options: GENDERS, get: (p) => p.gender },
  { key: 'income', label: 'Household income', type: 'enum', group: 'Demographic', options: INCOME, get: (p) => p.income },
  { key: 'education', label: 'Education', type: 'enum', group: 'Demographic', options: EDUCATION, get: (p) => p.education },
  { key: 'employment', label: 'Employment', type: 'enum', group: 'Demographic', options: EMPLOYMENT, get: (p) => p.employment },
  { key: 'device', label: 'Main device', type: 'enum', group: 'Demographic', options: DEVICES, get: (p) => p.device },
  { key: 'industry', label: 'Industry', type: 'enum', group: 'B2B', options: INDUSTRIES, get: (p) => p.industry },
  { key: 'jobRole', label: 'Job role', type: 'enum', group: 'B2B', options: ROLES, get: (p) => p.jobRole },
  { key: 'companySize', label: 'Company size', type: 'enum', group: 'B2B', options: COMPANY, get: (p) => p.companySize },
  { key: 'seniority', label: 'Seniority', type: 'enum', group: 'B2B', options: SENIORITY, get: (p) => p.seniority },
  { key: 'specialty', label: 'Specialty', type: 'enum', group: 'Healthcare', options: SPECIALTIES, get: (p) => p.specialty },
  { key: 'yearsPractice', label: 'Years in practice', type: 'number', group: 'Healthcare', get: (p) => p.yearsPractice, unit: 'years' },
  { key: 'conditions', label: 'Condition', type: 'list', group: 'Healthcare', options: CONDITIONS, get: (p) => p.conditions },
  { key: 'qualityScore', label: 'Quality score', type: 'number', group: 'Engagement', get: (p) => Math.round(p.qualityScore * 100), unit: '/100' },
  { key: 'profileCompletion', label: 'Profile completion', type: 'number', group: 'Engagement', get: (p) => Math.round(p.profileCompletion * 100), unit: '%' },
  { key: 'surveysCompleted', label: 'Surveys completed', type: 'number', group: 'Engagement', get: (p) => p.surveysCompleted },
];
export const fieldByKey = (k: string) => fields.find((f) => f.key === k)!;

export type Op = 'in' | 'not_in' | 'gte' | 'lte';
export type Condition = { id: string; kind: 'cond'; field: string; op: Op; values: string[]; num?: number };
export type Group = { id: string; kind: 'group'; join: 'AND' | 'OR'; children: Node[] };
export type Node = Condition | Group;

let n = 0;
export const nid = () => `n${Date.now().toString(36)}${(n++).toString(36)}`;
export const cond = (field: string, values: string[] = [], op: Op = 'in', num?: number): Condition => ({ id: nid(), kind: 'cond', field, op, values, num });
export const group = (join: 'AND' | 'OR', children: Node[] = []): Group => ({ id: nid(), kind: 'group', join, children });

/** A condition with no values selected does not filter (it is "incomplete"). */
export const isIncomplete = (c: Condition) => (c.op === 'in' || c.op === 'not_in') ? c.values.length === 0 : c.num === undefined || Number.isNaN(c.num);

export function matches(p: Panellist, node: Node): boolean {
  if (node.kind === 'group') {
    const kids = node.children.filter((k) => k.kind === 'group' || !isIncomplete(k));
    if (!kids.length) return true;
    return node.join === 'AND' ? kids.every((k) => matches(p, k)) : kids.some((k) => matches(p, k));
  }
  if (isIncomplete(node)) return true;
  const f = fieldByKey(node.field);
  const v = f.get(p);
  if (node.op === 'gte' || node.op === 'lte') return typeof v === 'number' && (node.op === 'gte' ? v >= node.num! : v <= node.num!);
  const hit = Array.isArray(v) ? v.some((x) => node.values.includes(x)) : v !== undefined && node.values.includes(String(v));
  return node.op === 'in' ? hit : !hit;
}

export const filterSample = (rows: Panellist[], root: Group) => rows.filter((p) => matches(p, root));

/** Plain-English rendering of a definition, used in summaries and hand-offs. */
export function describe(node: Node): string {
  if (node.kind === 'group') {
    const parts = node.children.map(describe).filter(Boolean);
    if (!parts.length) return '';
    return parts.length === 1 ? parts[0] : `(${parts.join(` ${node.join.toLowerCase()} `)})`;
  }
  if (isIncomplete(node)) return '';
  const f = fieldByKey(node.field);
  if (node.op === 'gte') return `${f.label} ≥ ${node.num}`;
  if (node.op === 'lte') return `${f.label} ≤ ${node.num}`;
  return `${f.label} ${node.op === 'in' ? 'is' : 'is not'} ${node.values.join(' or ')}`;
}

// ─────────────── Natural language → filters (rule based; labelled as such in the UI)
const countryWords: Record<string, string> = {
  usa: 'US', 'u.s.': 'US', 'united states': 'US', america: 'US', us: 'US', uk: 'GB', 'united kingdom': 'GB', britain: 'GB', england: 'GB', germany: 'DE', india: 'IN', canada: 'CA',
  france: 'FR', brazil: 'BR', australia: 'AU', spain: 'ES', mexico: 'MX', italy: 'IT', japan: 'JP',
};
const specialtyWords: Record<string, string> = {
  cardiolog: 'Cardiology', oncolog: 'Oncology', 'general practi': 'General practice', gp: 'General practice', nurse: 'Nursing', nursing: 'Nursing', neurolog: 'Neurology',
  dermatolog: 'Dermatology', endocrin: 'Endocrinology', pharmac: 'Pharmacy', pediatric: 'Pediatrics', paediatric: 'Pediatrics', psychiatr: 'Psychiatry',
};
const roleWords: Record<string, string> = { 'it decision': 'IT decision maker', itdm: 'IT decision maker', 'finance leader': 'Finance leader', cfo: 'Finance leader', 'marketing': 'Marketing leader', 'hr ': 'HR leader', engineer: 'Software engineer', developer: 'Software engineer', procurement: 'Procurement', 'small business': 'Small business owner', 'business owner': 'Small business owner' };
const conditionWords: Record<string, string> = { diabet: 'Type 2 diabetes', hypertens: 'Hypertension', 'high blood pressure': 'Hypertension', asthma: 'Asthma', migraine: 'Migraine', arthrit: 'Arthritis', depress: 'Depression', psoriasis: 'Psoriasis', copd: 'COPD' };

export type Translation = { root: Group; target?: number; notes: string[]; recognised: string[] };

export function translate(text: string): Translation {
  const t = ` ${text.toLowerCase().replace(/[,;]/g, ' ')} `;
  const children: Node[] = [];
  const recognised: string[] = [];
  const notes: string[] = [];
  const countries = [...new Set(Object.entries(countryWords).filter(([w]) => new RegExp(`[\\s(]${w.replace('.', '\\.')}[\\s).]`).test(t)).map(([, c]) => c))];
  if (countries.length) { children.push(cond('country', countries)); recognised.push(`countries ${countries.join(', ')}`); }
  const specs = [...new Set(Object.entries(specialtyWords).filter(([w]) => t.includes(w)).map(([, s]) => s))];
  if (specs.length) { children.push(cond('segment', ['hcp'])); children.push(cond('specialty', specs)); recognised.push(`specialty ${specs.join(', ')}`); }
  const roles = [...new Set(Object.entries(roleWords).filter(([w]) => t.includes(w)).map(([, s]) => s))];
  if (roles.length) { children.push(cond('jobRole', roles)); recognised.push(`role ${roles.join(', ')}`); }
  const conds = [...new Set(Object.entries(conditionWords).filter(([w]) => t.includes(w)).map(([, s]) => s))];
  if (conds.length) { children.push(cond('conditions', conds)); recognised.push(`condition ${conds.join(', ')}`); }
  if (/\b(patients?|people living with|sufferers?)\b/.test(t) && conds.length) children.push(cond('segment', ['patient', 'caregiver']));
  const yrs = t.match(/(\d+)\+?\s*(?:or more\s*)?years?(?:\s+of)?\s+(?:professional\s+)?(?:experience|practice|in practice)|at least (\w+) years/);
  if (yrs) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const v = yrs[1] ? Number(yrs[1]) : words[yrs[2]] ?? Number(yrs[2]);
    if (!Number.isNaN(v)) { children.push(cond('yearsPractice', [], 'gte', v)); recognised.push(`≥ ${v} years in practice`); }
  }
  const age = t.match(/(?:aged?|ages)\s*(\d{2})\s*(?:-|–|to)\s*(\d{2})/);
  if (age) {
    const lo = Number(age[1]), hi = Number(age[2]);
    const bands = AGE_BANDS.filter((b) => { const [a, z] = b === '65+' ? [65, 120] : b.split('-').map(Number); return z >= lo && a <= hi; });
    children.push(cond('ageBand', [...bands])); recognised.push(`age ${lo}–${hi}`);
  } else if (/\bgen ?z\b/.test(t)) { children.push(cond('ageBand', ['18-24'])); recognised.push('Gen Z (18–24)'); }
  else if (/\bmillennials?\b/.test(t)) { children.push(cond('ageBand', ['25-34', '35-44'])); recognised.push('millennials (25–44)'); }
  else if (/\b(seniors?|retirees?|over 65)\b/.test(t)) { children.push(cond('ageBand', ['65+'])); recognised.push('65+'); }
  if (/\b(women|female|mothers|moms)\b/.test(t)) { children.push(cond('gender', ['female'])); recognised.push('women'); }
  else if (/\b(men|male|fathers|dads)\b/.test(t)) { children.push(cond('gender', ['male'])); recognised.push('men'); }
  if (/\bmfr\b|frequent ?rewards/.test(t)) children.push(cond('brand', ['mfr']));
  else if (/\bt2o\b|turn2opinion/.test(t)) children.push(cond('brand', ['t2o']));
  if (/\b(high income|affluent|wealthy)\b/.test(t)) { children.push(cond('income', ['100–150k', '150k+'])); recognised.push('high income'); }
  if (/\b(small business|smb)\b/.test(t)) children.push(cond('companySize', ['1–9', '10–49', '50–249']));
  if (/\b(enterprise|large compan)/.test(t)) children.push(cond('companySize', ['1,000–4,999', '5,000+']));
  children.push(cond('status', ['active']));
  const raw = ` ${text.toLowerCase()} `;
  const target = raw.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,6})\s+(?!years?)(?:[a-z-]+\s){0,3}?(?:respondents?|completes?|people|cardiolog|oncolog|nurses?|doctors?|physicians?|hcps?|patients?|consumers?|women|men|it|decision|owners?|adults?|parents?|shoppers?|drivers?|gp)/);
  const projectRef = text.match(/\b(PRJ-\d+|ZX-S\d+)\b/i);
  if (projectRef) notes.push(`Linked to ${projectRef[1].toUpperCase()}`);
  if (!recognised.length) notes.push('I could not recognise any attributes. Try naming countries, a specialty, a job role, an age range or a condition.');
  if (specs.length && !yrs) notes.push('Years in practice is not set. Add it if the brief needs experienced professionals.');
  return { root: group('AND', children), target: target ? Number(target[1].replace(/,/g, '')) : undefined, notes, recognised };
}

// ─────────────── Feasibility model
export type Scenario = { name: string; completes: number; ir: number; loi: number; days: number; fatigueDays: number; incentive: 'standard' | 'boosted' };
export type FeasibilityResult = {
  eligible: number; reachable: number; invitable: number; starts: number; expected: number; low: number; high: number; perDay: number; daysNeeded: number; feasible: 'yes' | 'tight' | 'no';
  byCountry: { code: string; eligible: number; expected: number }[];
  missingProfile: number;
};

/** Converts sample matches into panel-wide estimates and walks them down to expected completes. */
export function feasibility(sample: Panellist[], s: Scenario): FeasibilityResult {
  const eligibleRows = sample;
  const reachableRows = eligibleRows.filter((p) => p.status === 'active' && p.consents.research_participation && p.risk.length === 0);
  const invitableRows = reachableRows.filter((p) => p.lastInviteDaysAgo >= Math.min(s.fatigueDays, 20));
  const avgResp = invitableRows.length ? invitableRows.reduce((a, p) => a + p.responseRate, 0) / invitableRows.length : 0;
  const lift = s.incentive === 'boosted' ? 1.18 : 1;
  const loiPenalty = s.loi <= 10 ? 1 : s.loi <= 20 ? 0.88 : 0.72;
  const startsRate = Math.min(0.85, avgResp * lift * loiPenalty);
  const cr = 0.86; // completes ÷ qualified starts after drop-off
  const eligible = Math.round(eligibleRows.length * SCALE);
  const reachable = Math.round(reachableRows.length * SCALE);
  const invitable = Math.round(invitableRows.length * SCALE);
  const starts = Math.round(invitable * startsRate);
  const expected = Math.round(starts * s.ir * cr);
  const spread = Math.min(0.35, 0.08 + 6 / Math.sqrt(Math.max(1, invitableRows.length)));
  const perDay = expected / Math.max(5, s.days);
  const daysNeeded = expected > 0 ? Math.ceil((s.completes / expected) * Math.max(5, s.days) * 0.55) : Infinity;
  const ratio = expected / Math.max(1, s.completes);
  const byC = new Map<string, { e: number; x: number }>();
  const inv = new Set(invitableRows);
  for (const p of eligibleRows) { const c = byC.get(p.country) ?? { e: 0, x: 0 }; c.e++; if (inv.has(p)) c.x++; byC.set(p.country, c); }
  return {
    eligible, reachable, invitable, starts, expected, low: Math.round(expected * (1 - spread)), high: Math.round(expected * (1 + spread)), perDay, daysNeeded,
    feasible: ratio >= 1.25 ? 'yes' : ratio >= 0.9 ? 'tight' : 'no',
    byCountry: [...byC.entries()].map(([code, v]) => ({ code, eligible: Math.round(v.e * SCALE), expected: Math.round(v.x * SCALE * startsRate * s.ir * cr) })).sort((a, b) => b.eligible - a.eligible),
    missingProfile: Math.round(eligibleRows.filter((p) => p.profileCompletion < 0.6).length * SCALE),
  };
}

/** Saved segment as stored in user preferences. */
export type SavedSegment = { id: string; name: string; root: Group; createdAt: string };
export const encodeRoot = (g: Group) => (typeof window === 'undefined' ? '' : btoa(unescape(encodeURIComponent(JSON.stringify(g)))));
export const decodeRoot = (s: string): Group | null => { try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as Group; } catch { return null; } };
