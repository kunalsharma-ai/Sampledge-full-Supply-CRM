/**
 * SUPPLY360 demonstration data and local logic for wave 6b: AI copilot, analytics and reporting,
 * API integration hub, roles and permissions, and system settings. Every value is synthetic.
 *
 * The copilot router is deterministic and local in demo mode: it reads the same seeded data the
 * screens show, so every number it gives can be checked on the screen it links to. In live mode it
 * would call the AI gateway (`POST /ai/copilot`, planned) with the same answer-card shapes.
 */
import { rng } from '../utils';
import { panelBrands, type PanelId } from './demo';
import { markets, sampleonRequests, totalMembers } from './connected';
import { paceBand, surveys } from './fieldwork';
import { liability, POINT_USD, redemptions, riskSignals } from './operations';

const r = rng(616);
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

// ───────────────────────── Copilot
export type ContextChip = { kind: 'country' | 'panel' | 'request' | 'segment' | 'survey'; value: string; label: string };
export type ProposedAction = { id: string; title: string; detail: string; impact: string; risk: 'low' | 'medium' | 'high'; href: string };
export type AnswerCard =
  | { kind: 'count'; title: string; value: number; unit: string; breakdown: { label: string; value: number; color: string }[]; note: string; href: string }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][]; note: string; href: string }
  | { kind: 'bars'; title: string; bars: { label: string; value: number }[]; unit: string; note: string; href: string }
  | { kind: 'text'; title: string; body: string[]; sources: string[]; href?: string };
export type CopilotReply = { text: string; cards: AnswerCard[]; actions: ProposedAction[]; context: ContextChip[] };

export const copilotStarters = [
  'How many reachable cardiologists are there in Germany?',
  'Which quotas are behind pace?',
  'Show completes by country today',
  'Win back dormant MyFrequentRewards members',
  'Why are redemptions being held?',
  'What is our reward liability?',
];

const countryWords: Record<string, string> = Object.fromEntries(markets.flatMap((m) => [[m.name.toLowerCase(), m.code], [m.code.toLowerCase(), m.code]]));
countryWords.uk = 'GB'; countryWords.britain = 'GB'; countryWords.usa = 'US'; countryWords.america = 'US';
const panelWords: Record<string, PanelId> = { turn2opinion: 't2o', t2o: 't2o', myfrequentrewards: 'mfr', mfr: 'mfr', myhealthopinions: 'mho', mho: 'mho' };
const professions: Record<string, { label: string; share: number; hc: boolean }> = {
  cardiolog: { label: 'cardiologists', share: 0.0032, hc: true }, dermatolog: { label: 'dermatologists', share: 0.0026, hc: true }, nurse: { label: 'nurses', share: 0.011, hc: true },
  oncolog: { label: 'oncologists', share: 0.0018, hc: true }, gp: { label: 'GPs', share: 0.0041, hc: true }, 'it decision': { label: 'IT decision makers', share: 0.034, hc: false },
  parent: { label: 'parents', share: 0.29, hc: false }, gamer: { label: 'gamers', share: 0.21, hc: false }, 'gen z': { label: 'Gen Z adults', share: 0.18, hc: false },
};

function find<T>(q: string, dict: Record<string, T>) {
  const k = Object.keys(dict).sort((a, b) => b.length - a.length).find((w) => new RegExp(`\\b${w}`, 'i').test(q));
  return k ? dict[k] : undefined;
}

export function copilot(qRaw: string, ctx: ContextChip[]): CopilotReply {
  const q = qRaw.toLowerCase();
  const country = find(q, countryWords) ?? ctx.find((c) => c.kind === 'country')?.value;
  const panel = find(q, panelWords) ?? (ctx.find((c) => c.kind === 'panel')?.value as PanelId | undefined);
  const prof = find(q, professions);

  if (prof || /how many|reachable|count/.test(q)) {
    const ms = country ? markets.filter((m) => m.code === country) : markets;
    const share = prof?.share ?? 1;
    const breakdown = panelBrands.filter((b) => !panel || b.id === panel).map((b) => ({
      label: b.short, color: b.color,
      value: Math.round(ms.reduce((a, m) => a + m.reachable * (m.members[b.id] / totalMembers(m)), 0) * share * (prof?.hc ? (b.id === 'mho' ? 9 : 0.08) : 1)),
    }));
    const value = breakdown.reduce((a, b) => a + b.value, 0);
    const where = country ? markets.find((m) => m.code === country)!.name : 'all markets';
    const ctxOut: ContextChip[] = [...(country ? [{ kind: 'country' as const, value: country, label: where }] : []), ...(panel ? [{ kind: 'panel' as const, value: panel, label: panelBrands.find((b) => b.id === panel)!.short }] : []), ...(prof ? [{ kind: 'segment' as const, value: prof.label, label: prof.label }] : [])];
    return {
      text: `${value.toLocaleString('en-US')} ${prof?.label ?? 'panellists'} are reachable today in ${where}${panel ? ` on ${panelBrands.find((b) => b.id === panel)!.name}` : ''}.`,
      cards: [{ kind: 'count', title: `Reachable ${prof?.label ?? 'panellists'}, ${where}`, value, unit: prof?.label ?? 'panellists', breakdown, note: prof?.hc ? 'Health attributes only match panellists with health-data consent; counts come back as numbers only.' : 'Active in 30 days, research consent, not fatigued, not on cooldown.', href: '/supply/segmentation' }],
      actions: value > 0 ? [{ id: `seg-${Date.now()}`, title: `Save “${prof?.label ?? 'Reachable'}${country ? ` · ${country}` : ''}” as an audience`, detail: 'Creates a saved segment you can use in feasibility and campaigns.', impact: `${value.toLocaleString('en-US')} panellists`, risk: 'low', href: '/supply/segmentation' }] : [],
      context: ctxOut,
    };
  }

  if (/quota|pace|behind/.test(q)) {
    const rows = surveys.filter((s) => s.status === 'live' || s.status === 'soft-launch').flatMap((s) => s.quotas.map((c) => ({ s, c, band: paceBand(c.achieved, c.target, s.elapsed) })))
      .filter((x) => x.band === 'behind' || x.band === 'risk').slice(0, 8);
    return {
      text: `${rows.length} quota cells in live surveys are behind pace. The worst are listed first.`,
      cards: [{ kind: 'table', title: 'Quota cells behind pace', columns: ['Survey', 'Cell', 'Achieved', 'Target', 'State'], rows: rows.map((x) => [x.s.ref, x.c.label, x.c.achieved, x.c.target, x.band === 'risk' ? 'At risk' : 'Behind']), note: 'Pace is the share of target achieved divided by the share of field time passed.', href: '/supply/quotas' }],
      actions: rows.slice(0, 2).map((x, i) => ({ id: `boost-${i}-${Date.now()}`, title: `Boost invitations for ${x.s.ref} · ${x.c.label}`, detail: 'Adds a targeted batch for this cell at the next send window.', impact: `about ${Math.round((x.c.target - x.c.achieved) * 4)} invitations`, risk: 'low' as const, href: '/supply/batches' })),
      context: rows.slice(0, 1).map((x) => ({ kind: 'survey' as const, value: x.s.id, label: x.s.ref })),
    };
  }

  if (/complete|by country|today/.test(q)) {
    const bars = [...markets].sort((a, b) => b.completesToday - a.completesToday).slice(0, 10).map((m) => ({ label: m.code, value: m.completesToday }));
    return { text: `Completes today total ${markets.reduce((a, m) => a + m.completesToday, 0).toLocaleString('en-US')}. The United States leads.`, cards: [{ kind: 'bars', title: 'Completes today by country (top 10)', bars, unit: 'completes', note: 'Verified completes since 00:00 UTC.', href: '/supply/global-intelligence' }], actions: [], context: [] };
  }

  if (/dormant|win back|re-?engage|nudge/.test(q)) {
    const p = panel ?? 'mfr';
    const n = Math.round(liability.find((l) => l.panel === p)!.members * 0.18);
    return {
      text: `${n.toLocaleString('en-US')} ${panelBrands.find((b) => b.id === p)!.short} members have not taken a survey in 60–180 days and still have research consent. I drafted a win-back e-mail with a 100-point bonus for the first survey.`,
      cards: [{ kind: 'text', title: 'Draft: “We saved a survey for you”', body: ['Subject: Your next survey is worth double points', 'Hi {first_name}, it has been a while. Take one survey this week and we add 100 bonus points to your wallet.', 'Button: See my surveys'], sources: ['Win-back template v3', 'Reward policy: bonuses up to 200 points', 'Consent: research_participation and marketing_email'] }],
      actions: [{ id: `wb-${Date.now()}`, title: `Send the win-back e-mail to ${n.toLocaleString('en-US')} dormant ${panelBrands.find((b) => b.id === p)!.short} members`, detail: 'Goes out through the Email Campaign Designer at each member’s best send hour. Members without marketing consent are skipped.', impact: `up to ${(n * 100 * POINT_USD * 0.12).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} in bonus points at 12% uptake`, risk: 'medium', href: '/supply/email' }],
      context: [{ kind: 'panel', value: p, label: panelBrands.find((b) => b.id === p)!.short }, { kind: 'segment', value: 'dormant', label: 'Dormant 60–180 days' }],
    };
  }

  if (/redemption|held|fraud|hold/.test(q)) {
    const held = redemptions.filter((x) => x.risk >= 0.6);
    const counts = new Map<string, number>();
    held.forEach((x) => x.signals.forEach((sg) => counts.set(sg, (counts.get(sg) ?? 0) + 1)));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const rising = riskSignals.filter((s) => s.rate > s.prev).map((s) => s.label.toLowerCase());
    return {
      text: `${held.length} of ${redemptions.length} redemptions in the queue are held because their risk score is 0.6 or more.`,
      cards: [{ kind: 'text', title: 'Why redemptions are held', body: [...top.map(([sg, n]) => `${sg}: ${n} held redemption${n === 1 ? '' : 's'}`), `Rising this week across the panel: ${rising.join(', ')}.`], sources: ['Quality & risk model', 'Redemption policy: hold at risk ≥ 0.6'], href: '/supply/redemptions' }],
      actions: [], context: [],
    };
  }

  if (/liabilit|owe|wallet|points/.test(q)) {
    const bars = liability.map((l) => ({ label: panelBrands.find((b) => b.id === l.panel)!.short, value: Math.round(l.points * POINT_USD) }));
    return { text: `Outstanding reward liability is ${bars.reduce((a, b) => a + b.value, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} across all wallets.`, cards: [{ kind: 'bars', title: 'Liability by panel (USD)', bars, unit: 'USD', note: '100 points = $1. From the append-only ledger.', href: '/supply/rewards' }], actions: [], context: [] };
  }

  const req = sampleonRequests.find((s) => q.includes(s.id.toLowerCase()));
  if (req) {
    return { text: `${req.id} “${req.title}” is ${req.status.replace('_', ' ')} with ${req.completes} of ${req.requiredCompletes} completes.`, cards: [], actions: [], context: [{ kind: 'request', value: req.id, label: req.id }] };
  }

  return { text: 'I can answer questions about reachable audiences, quotas, completes, rewards, redemptions and requests, and propose actions for you to approve. Try one of these:', cards: [], actions: [], context: [] };
}

// ───────────────────────── Analytics
export const metricsCatalog = [
  { id: 'completes', label: 'Completes', unit: 'int', agg: 'sum' },
  { id: 'starts', label: 'Survey starts', unit: 'int', agg: 'sum' },
  { id: 'cr', label: 'Completion rate', unit: 'pct', agg: 'ratio' },
  { id: 'invites', label: 'Invitations', unit: 'int', agg: 'sum' },
  { id: 'signups', label: 'New sign-ups', unit: 'int', agg: 'sum' },
  { id: 'points', label: 'Points issued', unit: 'int', agg: 'sum' },
  { id: 'cpc', label: 'Reward cost per complete', unit: 'money', agg: 'ratio' },
] as const;
export type MetricId = (typeof metricsCatalog)[number]['id'];
export const dimensions = [{ id: 'panel', label: 'Panel' }, { id: 'country', label: 'Country' }, { id: 'week', label: 'Week' }, { id: 'source', label: 'Request source' }] as const;
export type DimId = (typeof dimensions)[number]['id'];

const weeksLbl = Array.from({ length: 8 }, (_, i) => `W${38 + i}`);
const dimValues: Record<DimId, string[]> = { panel: panelBrands.map((b) => b.short), country: markets.slice(0, 8).map((m) => m.code), week: weeksLbl, source: ['PROJEXA', 'ZAPX', 'Partner'] };
/** Fact rows: one per panel × country × week × source, seeded. */
export const facts = (() => {
  const out: { panel: string; country: string; week: string; source: string; completes: number; starts: number; invites: number; signups: number; points: number }[] = [];
  for (const p of dimValues.panel) for (const c of dimValues.country) for (const w of dimValues.week) for (const s of dimValues.source) {
    const m = markets.find((x) => x.code === c)!;
    const pid = panelBrands.find((b) => b.short === p)!.id;
    const base = (m.completesToday * 7 * (m.members[pid] / totalMembers(m))) / 3 * (s === 'PROJEXA' ? 1.4 : s === 'ZAPX' ? 1 : 0.6) * (0.85 + r() * 0.3) * (1 + weeksLbl.indexOf(w) * 0.015);
    const completes = Math.round(base);
    const starts = Math.round(completes / (0.36 + r() * 0.12));
    out.push({ panel: p, country: c, week: w, source: s, completes, starts, invites: Math.round(starts / (0.12 + r() * 0.05)), signups: Math.round(completes * (0.05 + r() * 0.04)), points: Math.round(completes * between(90, 260)) });
  }
  return out;
})();
export const dimOrder = dimValues;
export function pivot(metric: MetricId, rowsDim: DimId, colsDim: DimId | null, panelFilter: string[]) {
  const f = facts.filter((x) => !panelFilter.length || panelFilter.includes(x.panel));
  const rowsV = dimValues[rowsDim], colsV = colsDim ? dimValues[colsDim] : ['Total'];
  const val = (sub: typeof facts) => {
    const s = (k: 'completes' | 'starts' | 'invites' | 'signups' | 'points') => sub.reduce((a, x) => a + x[k], 0);
    if (metric === 'cr') return s('completes') / (s('starts') || 1);
    if (metric === 'cpc') return (s('points') * POINT_USD) / (s('completes') || 1);
    return s(metric);
  };
  const cells = rowsV.map((rv) => colsV.map((cv) => val(f.filter((x) => x[rowsDim] === rv && (!colsDim || x[colsDim] === cv)))));
  return { rows: rowsV, cols: colsV, cells, total: val(f), rowTotals: rowsV.map((rv) => val(f.filter((x) => x[rowsDim] === rv))) };
}
export type SavedReport = { id: string; name: string; metric: MetricId; rows: DimId; cols: DimId | null; chart: 'bar' | 'line' | 'table'; panels: string[]; schedule: 'off' | 'daily' | 'weekly' | 'monthly'; recipients: string[]; owner: string };
export const starterReports: SavedReport[] = [
  { id: 'rp-1', name: 'Weekly completes by panel', metric: 'completes', rows: 'week', cols: 'panel', chart: 'line', panels: [], schedule: 'weekly', recipients: ['supply-leads@sampledge.example'], owner: 'Avery Chen (Demo)' },
  { id: 'rp-2', name: 'Completion rate by country', metric: 'cr', rows: 'country', cols: null, chart: 'bar', panels: [], schedule: 'off', recipients: [], owner: 'Hana Sato (Demo)' },
  { id: 'rp-3', name: 'Reward cost per complete', metric: 'cpc', rows: 'panel', cols: 'source', chart: 'bar', panels: [], schedule: 'monthly', recipients: ['finance@sampledge.example'], owner: 'Grace Okafor (Demo)' },
  { id: 'rp-4', name: 'Sign-ups by country, MHO', metric: 'signups', rows: 'country', cols: null, chart: 'table', panels: ['MHO'], schedule: 'off', recipients: [], owner: 'Hana Sato (Demo)' },
];

// ───────────────────────── API hub
export type Connection = { id: string; name: string; kind: 'product' | 'panel' | 'service'; direction: 'in' | 'out' | 'both'; status: 'healthy' | 'degraded' | 'down'; latencyMs: number; events24h: number; errorRate: number; auth: string; lastSeen: string; endpoint: string };
export const connections: Connection[] = [
  { id: 'sampleon', name: 'SampAudience', kind: 'product', direction: 'both', status: 'healthy', latencyMs: 84, events24h: 48_210, errorRate: 0.0006, auth: 'HMAC-SHA256 (v1), client “sampleon”', lastSeen: '12s ago', endpoint: '/api/v1/s2s/supply' },
  { id: 'projexa', name: 'PROJEXA', kind: 'product', direction: 'out', status: 'healthy', latencyMs: 132, events24h: 1_904, errorRate: 0.001, auth: 'via SampAudience events', lastSeen: '3m ago', endpoint: 'project.quota_updated → PROJEXA' },
  { id: 'zapx', name: 'ZAPX', kind: 'product', direction: 'both', status: 'degraded', latencyMs: 640, events24h: 22_480, errorRate: 0.021, auth: 'via SampAudience survey-host adapter', lastSeen: '40s ago', endpoint: 'survey.* events' },
  { id: 't2o', name: 'Turn2Opinion site', kind: 'panel', direction: 'in', status: 'healthy', latencyMs: 61, events24h: 96_300, errorRate: 0.0004, auth: 'PANEL_CARDS_SECRET_T2O', lastSeen: '2s ago', endpoint: '/panel/t2o/cards' },
  { id: 'mfr', name: 'MyFrequentRewards site', kind: 'panel', direction: 'in', status: 'healthy', latencyMs: 58, events24h: 71_820, errorRate: 0.0003, auth: 'PANEL_CARDS_SECRET_MFR', lastSeen: '4s ago', endpoint: '/panel/mfr/cards' },
  { id: 'mho', name: 'MyHealthOpinions site', kind: 'panel', direction: 'in', status: 'healthy', latencyMs: 66, events24h: 14_950, errorRate: 0.0005, auth: 'PANEL_CARDS_SECRET_MHO', lastSeen: '9s ago', endpoint: '/panel/mho/cards' },
  { id: 'payouts', name: 'Payout provider', kind: 'service', direction: 'out', status: 'healthy', latencyMs: 410, events24h: 2_118, errorRate: 0.004, auth: 'OAuth client credentials', lastSeen: '1m ago', endpoint: 'POST /payouts' },
  { id: 'email', name: 'E-mail delivery', kind: 'service', direction: 'out', status: 'healthy', latencyMs: 190, events24h: 184_200, errorRate: 0.0012, auth: 'API key', lastSeen: '1s ago', endpoint: 'Comms Hub' },
];
export type Delivery = { id: string; at: string; event: string; target: string; status: 'delivered' | 'retrying' | 'failed'; attempts: number; code: number; ms: number };
const evs = ['survey.completed', 'survey.started', 'survey.screenout', 'quality.failed', 'reward.eligibility_confirmed', 'project.quota_updated', 'invitation.delivered', 'quota.full'];
export const deliveries: Delivery[] = Array.from({ length: 36 }, (_, i) => {
  const target = ['sampleon', 'projexa', 'zapx', 'sampleon', 'sampleon', 'projexa'][i % 6];
  const failed = target === 'zapx' && i % 4 === 2;
  const retry = !failed && target === 'zapx' && i % 4 === 0;
  return { id: `dl-${9000 + i}`, at: `${Math.floor(i * 1.7)}m ago`, event: evs[i % evs.length], target, status: failed ? 'failed' : retry ? 'retrying' : 'delivered', attempts: failed ? 5 : retry ? 2 : 1, code: failed ? 504 : retry ? 502 : 200, ms: failed ? 30000 : between(40, 700) };
});
export type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; created: string; lastUsed: string; expires: string; owner: string };
export const apiKeys: ApiKey[] = [
  { id: 'k1', name: 'BI warehouse export', prefix: 'sk_live_7Hq2', scopes: ['panels:read', 'analytics:read'], created: '2026-06-02', lastUsed: '2h ago', expires: '2027-06-02', owner: 'Grace Okafor (Demo)' },
  { id: 'k2', name: 'Partner sample exchange', prefix: 'sk_live_Pm9x', scopes: ['surveys:read', 'surveys:write'], created: '2026-08-19', lastUsed: '5m ago', expires: '2026-12-01', owner: 'Sam Rivera (Demo)' },
  { id: 'k3', name: 'Legacy CSV uploader', prefix: 'sk_live_a01Z', scopes: ['panels:write'], created: '2025-11-30', lastUsed: '74d ago', expires: '2026-11-30', owner: 'Hana Sato (Demo)' },
];
export const scopes = ['panels:read', 'panels:write', 'surveys:read', 'surveys:write', 'rewards:read', 'analytics:read', 'events:subscribe'];

// ───────────────────────── Roles
export type Level = 'none' | 'view' | 'edit' | 'approve';
export const levels: Level[] = ['none', 'view', 'edit', 'approve'];
export const capabilities = [
  { id: 'panellists', label: 'Panellist records', group: 'Respondents', hint: 'Pseudonymous profiles, activity and consent' },
  { id: 'health', label: 'Health attributes', group: 'Respondents', hint: 'Only match / no match; values need health-data consent' },
  { id: 'quality', label: 'Quality cases and suspensions', group: 'Respondents', hint: 'Suspend, watch, clear' },
  { id: 'allocation', label: 'SampAudience allocation', group: 'Fieldwork', hint: 'Approve panel splits for audience requests' },
  { id: 'launch', label: 'Soft and full launch', group: 'Fieldwork', hint: 'Start fieldwork and scale to full launch' },
  { id: 'campaigns', label: 'E-mail and newsletters', group: 'Engagement', hint: 'Anything that messages members' },
  { id: 'automation', label: 'Automations', group: 'Engagement', hint: 'Activate and pause workflows' },
  { id: 'points', label: 'Points adjustments', group: 'Rewards', hint: 'New ledger rows that change a balance' },
  { id: 'redemptions', label: 'Redemptions', group: 'Rewards', hint: 'Approve, hold or reject payouts' },
  { id: 'api', label: 'API keys and webhooks', group: 'Platform', hint: 'Create and revoke keys' },
  { id: 'settings', label: 'System settings', group: 'Platform', hint: 'Tenant-wide limits and policies' },
] as const;
export type CapId = (typeof capabilities)[number]['id'];
export const supplyRoles = [
  { id: 'platform_admin', label: 'Platform admin', people: 2 },
  { id: 'executive', label: 'Executive', people: 4 },
  { id: 'panel_manager', label: 'Panel manager', people: 9 },
  { id: 'project_manager', label: 'Project manager', people: 14 },
  { id: 'support_agent', label: 'Support agent', people: 18 },
  { id: 'finance', label: 'Finance & ops', people: 5 },
] as const;
export type SupplyRole = (typeof supplyRoles)[number]['id'];
const L = (s: string) => s.split('').map((c) => ({ n: 'none', v: 'view', e: 'edit', a: 'approve' })[c] as Level);
// columns follow `capabilities` order
export const roleMatrix: Record<SupplyRole, Record<CapId, Level>> = Object.fromEntries(([
  ['platform_admin', 'eeaaaeeaaee'],
  ['executive', 'vvvavvvvavv'],
  ['panel_manager', 'evaeveeevnv'],
  ['project_manager', 'vnnvvnnnnnn'],
  ['support_agent', 'vnvnnnnevnn'],
  ['finance', 'vnnnnnnaavv'],
] as const).map(([role, s]) => [role, Object.fromEntries(capabilities.map((c, i) => [c.id, L(s)[i]]))])) as Record<SupplyRole, Record<CapId, Level>>;
export type Override = { id: string; person: string; role: SupplyRole; cap: CapId; level: Level; reason: string; expires: string };
export const overrides: Override[] = [
  { id: 'ov-1', person: 'Jonas Weber (Demo)', role: 'project_manager', cap: 'launch', level: 'approve', reason: 'Covering launches during Q4 peak', expires: '2026-11-30' },
  { id: 'ov-2', person: 'Mia Lund (Demo)', role: 'support_agent', cap: 'redemptions', level: 'edit', reason: 'Redemption backlog after PayPal outage', expires: '2026-11-12' },
];

// ───────────────────────── Settings
export type Setting = { id: string; section: string; label: string; help: string; kind: 'number' | 'toggle' | 'select' | 'text'; value: string | number | boolean; unit?: string; options?: string[]; min?: number; max?: number; risky?: string };
export const settings: Setting[] = [
  { id: 'tenant.name', section: 'Workspace', label: 'Workspace name', help: 'Shown in e-mails and the panel websites’ footers.', kind: 'text', value: 'Sampledge (Demo)' },
  { id: 'tenant.timezone', section: 'Workspace', label: 'Reporting time zone', help: 'Days in reports start at midnight in this zone.', kind: 'select', value: 'UTC', options: ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata'] },
  { id: 'locale.default', section: 'Locales', label: 'Default language', help: 'Used when a panellist has not chosen one.', kind: 'select', value: 'en', options: ['en', 'de', 'fr', 'es', 'pt', 'it', 'ja'] },
  { id: 'locale.currency', section: 'Locales', label: 'Reward display currency', help: 'Points stay the unit of record; this only changes how values are shown.', kind: 'select', value: 'USD', options: ['USD', 'GBP', 'EUR', 'INR'] },
  { id: 'send.windowStart', section: 'Invitations', label: 'Send window opens', help: 'Local time. Batches never start before this hour.', kind: 'number', value: 8, unit: ':00', min: 6, max: 12 },
  { id: 'send.windowEnd', section: 'Invitations', label: 'Send window closes', help: 'Local time. Batches never run past this hour.', kind: 'number', value: 21, unit: ':00', min: 17, max: 23 },
  { id: 'send.weeklyCap', section: 'Invitations', label: 'Weekly invitation cap per panellist', help: 'The fatigue cap SUPPLY360 applies before delivering any invitation.', kind: 'number', value: 5, min: 1, max: 14, risky: 'Raising the cap increases unsubscribes. Reach rises immediately for every live request.' },
  { id: 'send.activeWithin', section: 'Invitations', label: 'Counts as active within', help: 'Days since last activity for a panellist to be reachable.', kind: 'number', value: 30, unit: 'days', min: 7, max: 180 },
  { id: 'rewards.pointValue', section: 'Rewards', label: 'Points per US dollar', help: 'Changing this re-values every unredeemed balance.', kind: 'number', value: 100, min: 50, max: 1000, risky: 'Re-values the whole outstanding liability. Finance must sign off.' },
  { id: 'rewards.minRedeem', section: 'Rewards', label: 'Minimum redemption', help: 'Smallest payout a panellist can request.', kind: 'number', value: 500, unit: 'points', min: 100, max: 5000 },
  { id: 'rewards.expiry', section: 'Rewards', label: 'Points expire after inactivity', help: 'Months without activity before points expire.', kind: 'number', value: 18, unit: 'months', min: 6, max: 36 },
  { id: 'rewards.autoHold', section: 'Rewards', label: 'Hold redemptions at risk score', help: 'Redemptions at or above this score wait for a person.', kind: 'number', value: 0.6, min: 0.3, max: 0.95 },
  { id: 'quality.speeder', section: 'Quality', label: 'Speeder threshold', help: 'Share of median LOI below which a complete is flagged.', kind: 'number', value: 40, unit: '%', min: 20, max: 60 },
  { id: 'quality.autoSuspend', section: 'Quality', label: 'Auto-suspend repeat offenders', help: 'Suspend after 4 flagged surveys in 14 days, without review.', kind: 'toggle', value: false, risky: 'Suspensions would happen without a person reviewing the evidence.' },
  { id: 'privacy.retention', section: 'Privacy', label: 'Delete closed accounts after', help: 'Days between a deletion request and permanent erasure.', kind: 'number', value: 30, unit: 'days', min: 7, max: 30 },
  { id: 'privacy.healthOnlyMatch', section: 'Privacy', label: 'Health attributes leave SUPPLY360 only as match / no match', help: 'Required for MyHealthOpinions consent terms.', kind: 'toggle', value: true, risky: 'Turning this off would send health values to SampAudience and survey hosts. It breaks the consent terms.' },
  { id: 'limits.apiRate', section: 'Limits', label: 'API rate limit per key', help: 'Requests per minute.', kind: 'number', value: 600, unit: '/min', min: 60, max: 6000 },
];
export type ChangeEntry = { id: string; at: string; who: string; setting: string; from: string; to: string };
export const settingHistory: ChangeEntry[] = [
  { id: 'h1', at: '2026-11-04 16:20', who: 'Sam Rivera (Demo)', setting: 'Weekly invitation cap per panellist', from: '4', to: '5' },
  { id: 'h2', at: '2026-10-28 09:02', who: 'Grace Okafor (Demo)', setting: 'Minimum redemption', from: '1000', to: '500' },
  { id: 'h3', at: '2026-10-15 11:45', who: 'Hana Sato (Demo)', setting: 'Speeder threshold', from: '35', to: '40' },
];
