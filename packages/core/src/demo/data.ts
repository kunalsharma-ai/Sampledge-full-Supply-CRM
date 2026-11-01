/**
 * DEMO DATA. Every record here is fictional and generated deterministically from a seed.
 * No real people, clients, suppliers or health information. Panel brand names are the
 * Sampledge-owned brands; their metrics are simulated.
 */
import { rng } from '../utils';

const r = rng(20261031);
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
const between = (lo: number, hi: number) => lo + r() * (hi - lo);
const int = (lo: number, hi: number) => Math.round(between(lo, hi));

export const DEMO_NOW = new Date('2026-10-31T09:00:00Z');
const dayMs = 86400000;
const addDays = (d: number) => new Date(DEMO_NOW.getTime() + d * dayMs).toISOString().slice(0, 10);

// ───────────────────────── Geography
export type Country = { code: string; name: string; lat: number; lon: number; region: 'Americas' | 'EMEA' | 'APAC' };
export const countries: Country[] = [
  { code: 'US', name: 'United States', lat: 39.8, lon: -98.6, region: 'Americas' },
  { code: 'CA', name: 'Canada', lat: 56.1, lon: -106.3, region: 'Americas' },
  { code: 'BR', name: 'Brazil', lat: -14.2, lon: -51.9, region: 'Americas' },
  { code: 'MX', name: 'Mexico', lat: 23.6, lon: -102.5, region: 'Americas' },
  { code: 'GB', name: 'United Kingdom', lat: 55.4, lon: -3.4, region: 'EMEA' },
  { code: 'DE', name: 'Germany', lat: 51.2, lon: 10.4, region: 'EMEA' },
  { code: 'FR', name: 'France', lat: 46.2, lon: 2.2, region: 'EMEA' },
  { code: 'ES', name: 'Spain', lat: 40.5, lon: -3.7, region: 'EMEA' },
  { code: 'IT', name: 'Italy', lat: 41.9, lon: 12.6, region: 'EMEA' },
  { code: 'NL', name: 'Netherlands', lat: 52.1, lon: 5.3, region: 'EMEA' },
  { code: 'SE', name: 'Sweden', lat: 60.1, lon: 18.6, region: 'EMEA' },
  { code: 'AE', name: 'United Arab Emirates', lat: 23.4, lon: 53.8, region: 'EMEA' },
  { code: 'ZA', name: 'South Africa', lat: -30.6, lon: 22.9, region: 'EMEA' },
  { code: 'IN', name: 'India', lat: 20.6, lon: 78.9, region: 'APAC' },
  { code: 'JP', name: 'Japan', lat: 36.2, lon: 138.3, region: 'APAC' },
  { code: 'CN', name: 'China', lat: 35.9, lon: 104.2, region: 'APAC' },
  { code: 'KR', name: 'South Korea', lat: 35.9, lon: 127.8, region: 'APAC' },
  { code: 'SG', name: 'Singapore', lat: 1.35, lon: 103.8, region: 'APAC' },
  { code: 'AU', name: 'Australia', lat: -25.3, lon: 133.8, region: 'APAC' },
  { code: 'ID', name: 'Indonesia', lat: -0.8, lon: 113.9, region: 'APAC' },
];
export const countryByCode = Object.fromEntries(countries.map((c) => [c.code, c])) as Record<string, Country>;

// ───────────────────────── Clients
export const clients = [
  { id: 'cl-01', name: 'Northwind Brands', sector: 'CPG' },
  { id: 'cl-02', name: 'Helio Pharma Group', sector: 'Healthcare' },
  { id: 'cl-03', name: 'Quanta Cloud Systems', sector: 'Technology' },
  { id: 'cl-04', name: 'Lumen Mobility', sector: 'Automotive' },
  { id: 'cl-05', name: 'Bluecrest Financial', sector: 'Financial Services' },
  { id: 'cl-06', name: 'Arbor & Vale Retail', sector: 'Retail' },
  { id: 'cl-07', name: 'Kestrel Insights Agency', sector: 'Agency' },
  { id: 'cl-08', name: 'Orion Telecom', sector: 'Telecom' },
].map((c) => ({ ...c, demo: true as const }));

// ───────────────────────── Vendors
export type Vendor = {
  id: string; name: string; hq: string; coverage: string[]; audiences: ('B2B' | 'B2C' | 'Healthcare')[];
  cpiB2C: number; cpiB2B: number; cpiHC: number; quality: number; reliability: number; responseRate: number;
  speed: number; activeAllocations: number; delivered: number; pendingPayment: number; bidWinRate: number; verified: boolean;
};
const vendorNames = ['Atlas Sample Co.', 'Meridian Panels', 'Vertex Respondent Network', 'Nimbus Audience Labs', 'Polaris Field Partners', 'Cobalt B2B Exchange', 'Solstice Health Panels', 'Granite Consumer Voices', 'Aurora Mobile Sample', 'Tidewater Research Supply'];
export const vendors: Vendor[] = vendorNames.map((name, i) => {
  const cov = countries.filter(() => r() > 0.42).map((c) => c.code);
  const aud: Vendor['audiences'] = i === 5 ? ['B2B'] : i === 6 ? ['Healthcare'] : r() > 0.5 ? ['B2C', 'B2B'] : ['B2C'];
  return {
    id: `vd-${String(i + 1).padStart(2, '0')}`,
    name,
    hq: pick(['US', 'GB', 'DE', 'IN', 'SG', 'NL', 'CA']),
    coverage: cov.length ? cov : ['US', 'GB'],
    audiences: aud,
    cpiB2C: +between(1.6, 4.2).toFixed(2),
    cpiB2B: +between(9, 34).toFixed(2),
    cpiHC: +between(28, 95).toFixed(2),
    quality: +between(0.71, 0.97).toFixed(3),
    reliability: +between(0.74, 0.98).toFixed(3),
    responseRate: +between(0.06, 0.24).toFixed(3),
    speed: +between(0.55, 0.95).toFixed(3),
    activeAllocations: int(1, 9),
    delivered: int(1800, 26000),
    pendingPayment: int(4000, 68000),
    bidWinRate: +between(0.18, 0.62).toFixed(3),
    verified: r() > 0.2,
  };
});

// ───────────────────────── Projects
export const opsStages = [
  'Client Request', 'AI Feasibility', 'Quotation', 'Survey Programming', 'Survey QA', 'Sample Allocation',
  'Fieldwork', 'Data Processing', 'Analytics', 'Client Delivery', 'Invoicing',
] as const;
export type OpsStage = (typeof opsStages)[number];

export const lifecycle = [
  'RFQ Received', 'Feasibility', 'Quotation', 'Client Approval', 'Project Setup', 'Survey Programming', 'QA',
  'Sample Allocation', 'Soft Launch', 'Full Launch', 'Fieldwork Monitoring', 'Data Processing', 'Reporting',
  'Client Sign-off', 'Invoice', 'Project Closure',
] as const;
export type LifecycleStage = (typeof lifecycle)[number];
/** Maps the 16-step PM lifecycle onto the 11-step executive ops flow. */
export const lifecycleToOps: Record<LifecycleStage, OpsStage> = {
  'RFQ Received': 'Client Request', Feasibility: 'AI Feasibility', Quotation: 'Quotation', 'Client Approval': 'Quotation',
  'Project Setup': 'Survey Programming', 'Survey Programming': 'Survey Programming', QA: 'Survey QA',
  'Sample Allocation': 'Sample Allocation', 'Soft Launch': 'Fieldwork', 'Full Launch': 'Fieldwork', 'Fieldwork Monitoring': 'Fieldwork',
  'Data Processing': 'Data Processing', Reporting: 'Analytics', 'Client Sign-off': 'Client Delivery', Invoice: 'Invoicing', 'Project Closure': 'Invoicing',
};

export const team = ['Priya Nair', 'Daniel Moreau', 'Aiko Tanaka', 'Rafael Costa', 'Jonas Weber', 'Mei Lin', 'Omar Haddad', 'Sofia Lindqvist'];

export type Quota = { id: string; label: string; target: number; achieved: number };
export type Project = {
  id: string; code: string; name: string; clientId: string; type: 'B2B' | 'B2C' | 'Healthcare'; countries: string[];
  stage: LifecycleStage; owner: string; start: string; deadline: string; target: number; completes: number;
  ir: number; loi: number; dropout: number; quality: number; cpiSell: number; cpiCost: number; budget: number;
  costIncurred: number; vendors: string[]; quotas: Quota[]; blockers: string[]; surveyId?: string; demo: true;
};

const projectSeeds: [string, Project['type']][] = [
  ['Brand Health Tracker Q4', 'B2C'], ['Cloud Security Buyer Study', 'B2B'], ['Oncology HCP Message Test', 'Healthcare'],
  ['EV Purchase Journey', 'B2C'], ['SME Banking Needs', 'B2B'], ['Holiday Shopper Pulse', 'B2C'],
  ['Diabetes Patient Experience', 'Healthcare'], ['5G Switching Drivers', 'B2C'], ['IT Decision-Maker MaxDiff', 'B2B'],
  ['Pack Design Concept Test', 'B2C'], ['Caregiver Burden Survey', 'Healthcare'], ['Fintech App Usability', 'B2C'],
  ['Data Center Procurement', 'B2B'], ['Snack Pricing Van Westendorp', 'B2C'], ['Cardiology KOL Perceptions', 'Healthcare'],
  ['Retail Media Effectiveness', 'B2B'], ['Streaming Bundle Conjoint', 'B2C'], ['HR Software Satisfaction', 'B2B'],
  ['Rare Disease Awareness', 'Healthcare'], ['Sustainable Packaging U&A', 'B2C'], ['CX Benchmark Telecom', 'B2C'],
  ['Cybersecurity Budget Outlook', 'B2B'], ['Pharmacy Channel Study', 'Healthcare'], ['Gen Z Media Habits', 'B2C'],
];
const stageWeights: LifecycleStage[] = [
  'RFQ Received', 'Feasibility', 'Quotation', 'Client Approval', 'Project Setup', 'Survey Programming', 'Survey Programming', 'QA',
  'Sample Allocation', 'Soft Launch', 'Full Launch', 'Fieldwork Monitoring', 'Fieldwork Monitoring', 'Fieldwork Monitoring', 'Fieldwork Monitoring',
  'Data Processing', 'Data Processing', 'Reporting', 'Client Sign-off', 'Invoice', 'Fieldwork Monitoring', 'Full Launch', 'Survey Programming', 'Project Closure',
];
const fieldIdx = lifecycle.indexOf('Soft Launch');

export const projects: Project[] = projectSeeds.map(([name, type], i) => {
  const stage = stageWeights[i];
  const sIdx = lifecycle.indexOf(stage);
  const target = type === 'Healthcare' ? int(80, 400) : type === 'B2B' ? int(200, 800) : int(600, 3000);
  const progress = sIdx < fieldIdx ? 0 : sIdx > lifecycle.indexOf('Fieldwork Monitoring') ? 1 : between(0.12, 0.92);
  const completes = Math.round(target * progress);
  const cpiSell = type === 'Healthcare' ? between(70, 180) : type === 'B2B' ? between(22, 65) : between(3.5, 9);
  const cpiCost = cpiSell * between(0.48, 0.74);
  const mk = (n: number) => countries.filter(() => r() > 0.8).slice(0, n).map((c) => c.code);
  const ctry = mk(int(1, 4));
  const startOffset = -int(4, 45);
  const quotas: Quota[] =
    type === 'B2B'
      ? [['Company 1–99', 0.3], ['Company 100–999', 0.4], ['Company 1000+', 0.3]].map(([l, s], k) => ({ id: `q${k}`, label: l as string, target: Math.round(target * (s as number)), achieved: Math.round(completes * (s as number) * between(0.7, 1.25)) }))
      : type === 'Healthcare'
        ? [['Oncologists', 0.4], ['Hematologists', 0.25], ['Nurses (Onc.)', 0.35]].map(([l, s], k) => ({ id: `q${k}`, label: l as string, target: Math.round(target * (s as number)), achieved: Math.round(completes * (s as number) * between(0.6, 1.2)) }))
        : [['Age 18–34', 0.35], ['Age 35–54', 0.35], ['Age 55+', 0.3]].map(([l, s], k) => ({ id: `q${k}`, label: l as string, target: Math.round(target * (s as number)), achieved: Math.round(completes * (s as number) * between(0.65, 1.2)) }));
  quotas.forEach((q) => (q.achieved = Math.min(q.achieved, q.target)));
  const blockers: string[] = [];
  const ir = type === 'Healthcare' ? between(0.04, 0.22) : type === 'B2B' ? between(0.08, 0.35) : between(0.2, 0.8);
  if (ir < 0.1) blockers.push('Incidence below 10%; feasibility at risk');
  if (r() > 0.78) blockers.push('Awaiting client questionnaire sign-off');
  if (r() > 0.85) blockers.push('Vendor delivery behind plan');
  return {
    id: `pr-${String(i + 1).padStart(3, '0')}`,
    code: `SE-26${String(100 + i)}`,
    name,
    clientId: type === 'Healthcare' ? (r() > 0.5 ? 'cl-02' : 'cl-07') : type === 'B2B' ? pick(['cl-03', 'cl-05', 'cl-07', 'cl-08']) : pick(['cl-01', 'cl-04', 'cl-06', 'cl-08', 'cl-05']),
    type,
    countries: ctry.length ? ctry : [pick(['US', 'GB', 'DE'])],
    stage,
    owner: pick(team),
    start: addDays(startOffset),
    deadline: addDays(int(-2, 40)),
    target,
    completes,
    ir: +ir.toFixed(3),
    loi: int(8, 28),
    dropout: +between(0.06, 0.34).toFixed(3),
    quality: +between(0.78, 0.98).toFixed(3),
    cpiSell: +cpiSell.toFixed(2),
    cpiCost: +cpiCost.toFixed(2),
    budget: Math.round(target * cpiCost * 1.1),
    costIncurred: Math.round(completes * cpiCost * between(0.95, 1.18)),
    vendors: vendors.filter(() => r() > 0.72).slice(0, 3).map((v) => v.id),
    quotas,
    blockers,
    surveyId: i === 1 ? 'sv-cloud' : undefined,
    demo: true,
  };
});

// ───────────────────────── CRM opportunities
export const crmStages = ['New RFQ', 'Qualifying', 'Feasibility', 'Quote Sent', 'Negotiation', 'Won', 'Lost'] as const;
export type CrmStage = (typeof crmStages)[number];
export type Opportunity = {
  id: string; title: string; clientId: string; stage: CrmStage; owner: string; value: number; margin: number; probability: number;
  type: Project['type']; countries: string[]; sampleSize: number; ir: number; loi: number; created: string; lastTouch: string; lossReason?: string; demo: true;
};
const oppTitles = ['Q1 Brand Lift Wave', 'CIO Priorities 2027', 'Biosimilar Uptake HCP', 'Grocery Delivery U&A', 'Insurance Switching', 'Smart Home Concept', 'Payments Fraud Perceptions', 'Neurology Patient Journey', 'B2B SaaS Pricing', 'Beverage Flavor Test', 'Fleet Electrification', 'Wealth Advisor Study', 'Ad Recall Tracker', 'Supply Chain Leaders', 'OTC Pain Relief', 'Gaming Habits APAC', 'Luxury Shopper Sentiment', 'Dermatology HCP Tracker'];
export const opportunities: Opportunity[] = oppTitles.map((title, i) => {
  const stage = crmStages[[0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 0, 3][i]];
  const type: Project['type'] = /HCP|Patient|Biosimilar|OTC|Neurology|Dermatology/.test(title) ? 'Healthcare' : /CIO|B2B|Supply|Fleet|Advisor|Payments/.test(title) ? 'B2B' : 'B2C';
  const sampleSize = type === 'Healthcare' ? int(100, 400) : type === 'B2B' ? int(200, 600) : int(500, 2500);
  const value = Math.round(sampleSize * (type === 'Healthcare' ? between(90, 160) : type === 'B2B' ? between(30, 60) : between(5, 10)));
  return {
    id: `op-${String(i + 1).padStart(3, '0')}`,
    title,
    clientId: pick(clients).id,
    stage,
    owner: pick(['Lena Ortiz', 'Kofi Mensah', 'Elena Petrova', 'Marcus Hill']),
    value,
    margin: +between(0.28, 0.52).toFixed(3),
    probability: { 'New RFQ': 0.1, Qualifying: 0.2, Feasibility: 0.35, 'Quote Sent': 0.5, Negotiation: 0.7, Won: 1, Lost: 0 }[stage],
    type,
    countries: [pick(countries).code, pick(countries).code].filter((v, k, a) => a.indexOf(v) === k),
    sampleSize,
    ir: +between(0.05, 0.6).toFixed(2),
    loi: int(8, 25),
    created: addDays(-int(1, 60)),
    lastTouch: addDays(-int(0, 14)),
    lossReason: stage === 'Lost' ? pick(['Price', 'Timeline', 'Feasibility']) : undefined,
    demo: true,
  };
});

// ───────────────────────── Surveys
export type SurveySummary = {
  id: string; name: string; projectId?: string; status: 'Draft' | 'In QA' | 'Published' | 'Closed'; questions: number; complexity: number | null;
  loi: number; completionRate: number | null; programmer: string; hoursSpent: number; alerts: number; languages: string[]; demo: true;
};
export const surveys: SurveySummary[] = [
  ['Cloud Security Buyer Study', 'In QA', 'pr-002'], ['Brand Health Tracker Q4', 'Published', 'pr-001'], ['Oncology HCP Message Test', 'Published', 'pr-003'],
  ['EV Purchase Journey', 'Published', 'pr-004'], ['IT Decision-Maker MaxDiff', 'Draft', 'pr-009'], ['Pack Design Concept Test', 'In QA', 'pr-010'],
  ['Streaming Bundle Conjoint', 'Draft', 'pr-017'], ['Snack Pricing Van Westendorp', 'Published', 'pr-014'], ['HR Software Satisfaction', 'Closed', 'pr-018'],
  ['Gen Z Media Habits', 'Draft', 'pr-024'], ['Caregiver Burden Survey', 'Published', 'pr-011'], ['CX Benchmark Telecom', 'Closed', 'pr-021'],
].map(([name, status, projectId], i) => ({
  id: i === 0 ? 'sv-cloud' : `sv-${String(i + 1).padStart(3, '0')}`,
  name, projectId, status: status as SurveySummary['status'],
  questions: int(18, 72), complexity: +between(0.2, 0.95).toFixed(2), loi: int(8, 25), completionRate: +between(0.62, 0.92).toFixed(3),
  programmer: pick(['Jonas Weber', 'Mei Lin', 'Omar Haddad']), hoursSpent: +between(4, 38).toFixed(1), alerts: int(0, 5),
  languages: r() > 0.6 ? ['en', 'de', 'fr'] : ['en'], demo: true,
}));

// ───────────────────────── Panels (Sampledge-owned brands; metrics simulated)
export type PanelBrand = {
  id: 'turn2opinion' | 'myfrequentrewards' | 'myhealthopinions'; name: string; domain: string; focus: string; color: string;
  registered: number; active: number; newThisMonth: number; profileCompletion: number; churn: number; retention90: number;
  rewardLiability: number; avgQuality: number; integration: 'Not connected' | 'CSV import' | 'Adapter configured';
};
export const panels: PanelBrand[] = [
  { id: 'turn2opinion', name: 'Turn2Opinion', domain: 'Turn2Opinion.com', focus: 'General consumer (B2C)', color: '#246BFD', registered: 412_380, active: 148_920, newThisMonth: 11_240, profileCompletion: 0.71, churn: 0.046, retention90: 0.58, rewardLiability: 186_400, avgQuality: 0.88, integration: 'Not connected' },
  { id: 'myfrequentrewards', name: 'MyFrequentRewards', domain: 'MyFrequentRewards.com', focus: 'Rewards-driven consumer + B2B professionals', color: '#713BFF', registered: 268_150, active: 97_310, newThisMonth: 7_860, profileCompletion: 0.64, churn: 0.058, retention90: 0.52, rewardLiability: 141_900, avgQuality: 0.85, integration: 'Not connected' },
  { id: 'myhealthopinions', name: 'MyHealthOpinions', domain: 'MyHealthOpinions.com', focus: 'HCPs, patients and caregivers', color: '#13C996', registered: 58_740, active: 21_480, newThisMonth: 1_920, profileCompletion: 0.82, churn: 0.031, retention90: 0.67, rewardLiability: 92_300, avgQuality: 0.93, integration: 'Not connected' },
];

// ───────────────────────── Automation agents
export const agents = ([
  ['Survey Programming Agent', 'survey-programming'], ['Survey QA Agent', 'survey-qa'], ['Research Feasibility Agent', 'feasibility'], ['Vendor Recommendation Agent', 'supplier-delivery'],
  ['Panel Engagement Agent', 'panel-engagement'], ['Respondent Quality Agent', 'respondent-quality'], ['Project Management Agent', 'project-health'], ['Data Processing Agent', 'data-processing'],
  ['Reporting Agent', 'reporting'], ['CRM and Bidding Agent', 'pipeline-followup'], ['Finance Reconciliation Agent', 'finance-overdue'], ['Executive Intelligence Agent', 'executive-digest'],
] as const).map(([name, key], i) => ({
  id: `ag-${String(i + 1).padStart(2, '0')}`,
  key,
  name,
  // Agents start paused; they run only once someone turns them on (see apps/api/src/modules/agents.ts).
  enabled: false,
  requiresApprovalFor: ([
    ['Publishing surveys'], ['Publishing surveys'], ['Purchasing sample'], ['Purchasing sample'], ['High-volume communications'], ['Rejecting respondents'],
    [], ['Releasing sensitive datasets'], ['Releasing sensitive datasets'], ['Sending binding quotations'], ['Issuing payments'], [],
  ] as string[][])[i],
}));

export const approvals = [
  { id: 'ap-01', agentId: 'ag-04', kind: 'Purchasing sample', title: 'Issue PO: 320 completes from Cobalt B2B Exchange', projectId: 'pr-002', amount: 7_936, requested: '2026-10-31T07:42:00Z' },
  { id: 'ap-02', agentId: 'ag-10', kind: 'Sending binding quotations', title: 'Send quote to Bluecrest Financial: Wealth Advisor Study', projectId: undefined, amount: 21_480, requested: '2026-10-31T06:15:00Z' },
  { id: 'ap-03', agentId: 'ag-06', kind: 'Rejecting respondents', title: 'Reject 46 respondents flagged for speeding (Brand Health Q4)', projectId: 'pr-001', amount: undefined, requested: '2026-10-30T22:03:00Z' },
  { id: 'ap-04', agentId: 'ag-05', kind: 'High-volume communications', title: 'Re-engagement email to 18,400 dormant Turn2Opinion members', projectId: undefined, amount: undefined, requested: '2026-10-30T18:30:00Z' },
  { id: 'ap-05', agentId: 'ag-02', kind: 'Publishing surveys', title: 'Publish Pack Design Concept Test v3 after QA pass', projectId: 'pr-010', amount: undefined, requested: '2026-10-30T16:10:00Z' },
  { id: 'ap-06', agentId: 'ag-09', kind: 'Releasing sensitive datasets', title: 'Release Oncology HCP topline to Helio Pharma Group', projectId: 'pr-003', amount: undefined, requested: '2026-10-30T12:44:00Z' },
].map((a) => ({ ...a, status: 'pending' as 'pending' | 'approved' | 'rejected', demo: true as const }));

// ───────────────────────── Time series (12 months, 30 days)
export const months = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
export const monthlyRevenue = months.map((_, i) => Math.round(410_000 + i * 21_000 + Math.sin(i / 1.7) * 48_000 + between(-20_000, 20_000)));
export const monthlyCost = monthlyRevenue.map((v) => Math.round(v * between(0.55, 0.66)));
export const monthlyForecast = monthlyRevenue.map((v, i) => (i < 9 ? null : Math.round(v * between(0.95, 1.08))));
export const dailyCompletes = Array.from({ length: 30 }, (_, i) => Math.round(1400 + i * 22 + Math.sin(i / 2.2) * 260 + between(-120, 120)));
export const dailyIR = Array.from({ length: 30 }, (_, i) => +(0.31 + Math.sin(i / 4) * 0.03 + between(-0.015, 0.015)).toFixed(3));

/** Per-country live activity, derived from projects + vendors so the globe is grounded in records. */
export function countryActivity(ps: Project[] = projects) {
  return countries.map((c) => {
    const ps2 = ps.filter((p) => p.countries.includes(c.code));
    const live = ps2.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
    return {
      ...c,
      projects: ps2.length,
      live: live.length,
      completes: ps2.reduce((s, p) => s + Math.round(p.completes / p.countries.length), 0),
      target: ps2.reduce((s, p) => s + Math.round(p.target / p.countries.length), 0),
      suppliers: vendors.filter((v) => v.coverage.includes(c.code)).length,
      demand: ps2.reduce((s, p) => s + p.budget / p.countries.length, 0),
      projectIds: ps2.map((p) => p.id),
    };
  });
}

export const notificationsSeed = [
  { id: 'n1', title: 'Quota "Company 1000+" is 92% full', body: 'Cloud Security Buyer Study · consider closing the cell', module: 'projects', time: '8m', read: false },
  { id: 'n2', title: 'QA found 2 routing issues', body: 'Cloud Security Buyer Study v4 · unreachable Q12', module: 'survey-studio', time: '21m', read: false },
  { id: 'n3', title: 'New RFQ from Orion Telecom', body: 'Ad Recall Tracker · 1,500 B2C · US, GB', module: 'crm', time: '46m', read: false },
  { id: 'n4', title: 'Approval needed: purchase order', body: '320 completes · Cobalt B2B Exchange · $7.9K', module: 'automation', time: '1h', read: true },
  { id: 'n5', title: 'Vendor delivery behind plan', body: 'Meridian Panels · EV Purchase Journey · -18% vs plan', module: 'marketplace', time: '3h', read: true },
].map((n) => ({ ...n, demo: true as const }));
