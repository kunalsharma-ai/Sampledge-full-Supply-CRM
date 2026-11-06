/**
 * SUPPLY360 demonstration data. Every value here is synthetic, generated from a fixed seed so it is
 * identical on every load, and every surface that shows it carries a "Demo data" badge.
 * Replace with the API calls in ./data.ts as each endpoint is connected.
 */
import { rng } from '../utils';

const r = rng(360);
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
const walk = (n: number, start: number, vol: number, drift = 0) => {
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) { v = Math.max(0, v * (1 + drift) + (r() - 0.5) * vol); out.push(Math.round(v)); }
  return out;
};

export type PanelId = 't2o' | 'mfr' | 'mho';
export const panelBrands: { id: PanelId; name: string; short: string; focus: string; color: string }[] = [
  { id: 't2o', name: 'Turn2Opinion', short: 'T2O', focus: 'General consumer', color: '#4D86FF' },
  { id: 'mfr', name: 'MyFrequentRewards', short: 'MFR', focus: 'Rewards-led consumer', color: '#A855F7' },
  { id: 'mho', name: 'MyHealthOpinions', short: 'MHO', focus: 'Healthcare professionals & patients', color: '#10B981' },
];

export const panelStats = panelBrands.map((b, i) => {
  const members = [1_284_310, 846_902, 192_455][i];
  const active30 = Math.round(members * [0.31, 0.38, 0.27][i]);
  return {
    ...b,
    members,
    active30,
    verified: Math.round(members * [0.82, 0.77, 0.93][i]),
    profileCompletion: [0.74, 0.68, 0.86][i],
    completionRate: [0.41, 0.46, 0.33][i],
    rewardLiability: [182_400, 241_950, 96_300][i],
    openTickets: [64, 91, 22][i],
    trend: walk(14, active30 / 30, active30 / 400, 0.004),
  };
});

const sumBy = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
export const totals = {
  members: sumBy(panelStats, (p) => p.members),
  active30: sumBy(panelStats, (p) => p.active30),
  verified: sumBy(panelStats, (p) => p.verified),
  liability: sumBy(panelStats, (p) => p.rewardLiability),
  tickets: sumBy(panelStats, (p) => p.openTickets),
};

/** Supply Orbit: each ring is a stage of the respondent funnel. */
export const funnel = [
  { key: 'registered', label: 'Registered', value: totals.members, color: 'var(--chart-1)' },
  { key: 'verified', label: 'Verified', value: totals.verified, color: 'var(--chart-2)' },
  { key: 'profiled', label: 'Profile ≥ 80%', value: Math.round(totals.members * 0.58), color: 'var(--chart-3)' },
  { key: 'active', label: 'Active 30 days', value: totals.active30, color: 'var(--chart-4)' },
  { key: 'reachable', label: 'Reachable today', value: Math.round(totals.active30 * 0.34), color: 'var(--chart-5)' },
];

export type Kpi = { id: string; label: string; value: number; format: 'int' | 'pct' | 'money'; delta: number; spark: number[]; hint: string; good: 'up' | 'down' };
export const kpis: Kpi[] = [
  { id: 'active', label: 'Active panellists (30d)', value: totals.active30, format: 'int', delta: 0.034, spark: walk(14, 700, 40, 0.003), hint: 'Took a survey or completed profiling in the last 30 days', good: 'up' },
  { id: 'reach', label: 'Reachable today', value: funnel[4].value, format: 'int', delta: 0.012, spark: walk(14, 240, 30), hint: 'Active, consented, not fatigued, not on cooldown', good: 'up' },
  { id: 'completes', label: 'Completes today', value: 18_426, format: 'int', delta: 0.081, spark: walk(14, 16000, 1800, 0.01), hint: 'Validated completes returned by survey hosts since 00:00 UTC', good: 'up' },
  { id: 'cr', label: 'Completion rate', value: 0.418, format: 'pct', delta: -0.006, spark: walk(14, 42, 2), hint: 'Completes ÷ survey starts, all panels', good: 'up' },
  { id: 'liability', label: 'Reward liability', value: totals.liability, format: 'money', delta: 0.022, spark: walk(14, 500, 20, 0.004), hint: 'Earned, unredeemed rewards across all wallets', good: 'down' },
  { id: 'tickets', label: 'Open support tickets', value: totals.tickets, format: 'int', delta: -0.11, spark: walk(14, 200, 18, -0.01), hint: 'Respondent tickets not yet resolved', good: 'down' },
];

export type Source = 'PROJEXA' | 'ZAPX';
export type RequestStatus = 'live' | 'soft-launch' | 'scheduled' | 'pending' | 'paused';
export type AudienceRequest = {
  id: string; source: Source; sourceRef: string; title: string; client: string; countries: string[];
  target: number; completes: number; ir: number; loi: number; elapsed: number; status: RequestStatus;
  quotas: { label: string; target: number; achieved: number }[]; panels: Record<PanelId, number>; eta: string;
};
const titles = [
  ['Streaming habits tracker Q4', 'Northwind Media'], ['Cardiologist treatment preferences', 'Helix Pharma'], ['SMB cloud buyer study', 'Contoso Cloud'],
  ['Grocery basket pulse', 'Fresh & Co'], ['EV purchase intent wave 3', 'Voltaro Motors'], ['Oncology nurse workload', 'Meridian Health'],
  ['Gen Z banking attitudes', 'Fintrail'], ['Holiday travel planner', 'Skyroute'],
] as const;
const countrySets = [['US'], ['US', 'GB', 'DE'], ['US', 'CA'], ['GB'], ['DE', 'FR', 'ES', 'IT'], ['US', 'GB'], ['IN', 'SG'], ['US', 'MX', 'BR']];
const statuses: RequestStatus[] = ['live', 'live', 'soft-launch', 'live', 'scheduled', 'pending', 'live', 'paused'];
export const audienceRequests: AudienceRequest[] = titles.map(([title, client], i) => {
  const target = [1500, 450, 800, 2000, 1200, 300, 1000, 900][i];
  const elapsed = [0.62, 0.4, 0.12, 0.81, 0, 0, 0.55, 0.3][i];
  const status = statuses[i];
  const completes = status === 'scheduled' || status === 'pending' ? 0 : Math.round(target * elapsed * (0.75 + r() * 0.45));
  const quotas = ['18–34', '35–54', '55+'].map((label, k) => {
    const t = Math.round(target * [0.35, 0.4, 0.25][k]);
    return { label, target: t, achieved: Math.min(t, Math.round(completes * [0.33, 0.42, 0.25][k] * (0.8 + r() * 0.4))) };
  });
  const src: Source = i % 3 === 2 ? 'ZAPX' : 'PROJEXA';
  return {
    id: `AR-${(24100 + i * 37).toString()}`, source: src, sourceRef: src === 'PROJEXA' ? `PRJ-${1040 + i}` : `ZX-S${880 + i * 3}`,
    title, client, countries: countrySets[i], target, completes, ir: [0.32, 0.08, 0.18, 0.55, 0.22, 0.12, 0.4, 0.28][i], loi: [12, 20, 15, 8, 14, 18, 10, 12][i],
    elapsed, status, quotas, panels: i === 1 || i === 5 ? { t2o: 0, mfr: 0, mho: 1 } : { t2o: 0.55, mfr: 0.45, mho: 0 },
    eta: ['in 2d', 'in 5d', 'in 6d', 'today', 'starts Mon', 'awaiting approval', 'in 3d', 'paused'][i],
  };
});

export type DecisionKind = 'allocation' | 'redemption' | 'quality' | 'launch';
export type Decision = { id: string; kind: DecisionKind; title: string; detail: string; amount?: number; risk?: 'low' | 'medium' | 'high'; requestId?: string };
export const decisions: Decision[] = [
  { id: 'dc-1', kind: 'allocation', title: 'Allocate 300 oncology nurses to PRJ-1045', detail: 'MHO · US, GB · feasibility 92% · est. 6 days', requestId: audienceRequests[5].id, risk: 'low' },
  { id: 'dc-2', kind: 'launch', title: 'Full launch: SMB cloud buyer study', detail: 'Soft launch IR 19% vs 18% planned, LOI 14.2 min, drop-off 9%', requestId: audienceRequests[2].id, risk: 'low' },
  { id: 'dc-3', kind: 'redemption', title: '42 PayPal redemptions over $50', detail: 'MyFrequentRewards · 3 share a device fingerprint', amount: 2_940, risk: 'medium' },
  { id: 'dc-4', kind: 'quality', title: 'Suspend 18 accounts flagged for straight-lining', detail: 'Turn2Opinion · 4+ flagged surveys in 14 days', risk: 'high' },
  { id: 'dc-5', kind: 'redemption', title: 'Gift card batch · Amazon UK', detail: 'Turn2Opinion · 128 redemptions, all low risk', amount: 3_210, risk: 'low' },
];

export const hourlyCompletes = panelBrands.map((b, i) => ({
  panel: b.short, color: b.color,
  data: Array.from({ length: 24 }, (_, h) => Math.round([520, 410, 90][i] * (0.35 + 0.65 * Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2) * 0.5 + 0.5)) * (0.85 + r() * 0.3))),
}));

export const countries = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['IN', 'India'], ['CA', 'Canada'], ['FR', 'France'], ['BR', 'Brazil'], ['AU', 'Australia'], ['ES', 'Spain'], ['MX', 'Mexico'],
].map(([code, name], i) => ({ code, name, reachable: Math.round(funnel[4].value * [0.31, 0.14, 0.1, 0.09, 0.07, 0.06, 0.05, 0.045, 0.04, 0.035][i]), completes: Math.round(18426 * [0.33, 0.15, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03][i]), delta: (r() - 0.4) * 0.2 }));

export const qualitySignals = [
  { id: 'dup', label: 'Duplicate devices', value: between(110, 180), trend: walk(10, 140, 20) },
  { id: 'speed', label: 'Speeders', value: between(300, 420), trend: walk(10, 360, 40) },
  { id: 'straight', label: 'Straight-liners', value: between(80, 140), trend: walk(10, 110, 16) },
  { id: 'geo', label: 'Geo mismatch', value: between(40, 80), trend: walk(10, 60, 10) },
];

export const supportSla = { withinSla: 0.93, firstResponseMin: 38, backlog: totals.tickets, csat: 4.6 };

export const activityFeed = Array.from({ length: 8 }, (_, i) => ({
  id: `ev-${i}`,
  at: `${between(1, 59)}m ago`,
  text: pick([
    'Batch 3 sent to 4,200 US panellists for AR-24137',
    'Quota 55+ closed on Streaming habits tracker',
    'SAMPLEON accepted audience request from ZAPX survey ZX-S886',
    'Redemption batch #882 paid (612 transactions)',
    'Profile nudge raised B2B completion by 3.2 pts',
    'Routing recovered 1,140 screen-outs into other surveys',
    '18 accounts moved to quality review',
  ]),
}));
