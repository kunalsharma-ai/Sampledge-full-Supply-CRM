/**
 * Engagement demonstration data for wave 4: automations, email, newsletters, lifecycle journeys,
 * notifications, weekly rewards surveys and the AI survey drafter. Synthetic and seeded.
 *
 * Integration points (see ./data.ts `endpoints`): automations and journeys map to the API agent
 * runs (`/automation/*`), sends go through `/communications/*`, and AI drafting will use a new
 * `/ai/survey-draft` route next to the existing `/ai/questionnaire` structurer.
 */
import { rng } from '../utils';
import type { PanelId } from './demo';

const r = rng(4404);
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

// ───────────────────────── Automation workflows
export type WfKind = 'trigger' | 'condition' | 'delay' | 'action';
export type WfNode = { id: string; kind: WfKind; type: string; config: Record<string, string | number>; x: number; y: number };
export type WfEdge = { id: string; from: string; to: string; branch?: 'yes' | 'no' };
export type Workflow = { id: string; name: string; panel: PanelId | 'all'; status: 'active' | 'paused' | 'draft'; nodes: WfNode[]; edges: WfEdge[]; runs7d: number; conversion: number };

/** Palette of building blocks: what each node type needs to be configured. */
export const blocks: Record<WfKind, { type: string; label: string; fields: { key: string; label: string; kind: 'text' | 'number' | 'select'; options?: string[]; unit?: string }[] }[]> = {
  trigger: [
    { type: 'signup', label: 'Member signs up', fields: [{ key: 'panel', label: 'Panel', kind: 'select', options: ['Any', 'Turn2Opinion', 'MyFrequentRewards', 'MyHealthOpinions'] }] },
    { type: 'inactive', label: 'Member inactive', fields: [{ key: 'days', label: 'Inactive for', kind: 'number', unit: 'days' }] },
    { type: 'profile_gap', label: 'Profile below threshold', fields: [{ key: 'pct', label: 'Completion below', kind: 'number', unit: '%' }] },
    { type: 'points', label: 'Points balance reached', fields: [{ key: 'points', label: 'Balance', kind: 'number', unit: 'pts' }] },
  ],
  condition: [
    { type: 'segment', label: 'Is in segment', fields: [{ key: 'segment', label: 'Segment', kind: 'select', options: ['Healthcare professionals', 'B2B decision makers', 'Gen Z', 'High quality score'] }] },
    { type: 'opened', label: 'Opened last message', fields: [] },
    { type: 'country', label: 'Country is', fields: [{ key: 'country', label: 'Country', kind: 'select', options: ['US', 'GB', 'DE', 'IN', 'Any EU'] }] },
  ],
  delay: [{ type: 'wait', label: 'Wait', fields: [{ key: 'hours', label: 'Wait for', kind: 'number', unit: 'hours' }] }, { type: 'window', label: 'Wait for send window', fields: [{ key: 'from', label: 'Local time from', kind: 'number', unit: ':00' }] }],
  action: [
    { type: 'email', label: 'Send email', fields: [{ key: 'template', label: 'Template', kind: 'select', options: ['Welcome', 'Finish your profile', 'We miss you', 'Points reminder', 'Survey invite'] }] },
    { type: 'push', label: 'Send push', fields: [{ key: 'text', label: 'Message', kind: 'text' }] },
    { type: 'bonus', label: 'Grant bonus points', fields: [{ key: 'points', label: 'Points', kind: 'number', unit: 'pts' }] },
    { type: 'tag', label: 'Add tag', fields: [{ key: 'tag', label: 'Tag', kind: 'text' }] },
  ],
};
export const blockLabel = (kind: WfKind, type: string) => blocks[kind].find((b) => b.type === type)?.label ?? type;

/** Seeds are written as step (left to right) and lane; the canvas flows top to bottom, so they are swapped here. */
const n = (id: string, kind: WfKind, type: string, config: WfNode['config'], step: number, lane: number): WfNode => ({ id, kind, type, config, x: lane * 1.4, y: step * 0.45 });
export const workflows: Workflow[] = [
  {
    id: 'wf-onboard', name: 'New member onboarding', panel: 'all', status: 'active', runs7d: 4_812, conversion: 0.41,
    nodes: [
      n('t', 'trigger', 'signup', { panel: 'Any' }, 0, 120), n('a1', 'action', 'email', { template: 'Welcome' }, 260, 120),
      n('d1', 'delay', 'wait', { hours: 48 }, 520, 120), n('c1', 'condition', 'opened', {}, 780, 120),
      n('a2', 'action', 'email', { template: 'Finish your profile' }, 1040, 30), n('a3', 'action', 'push', { text: 'Your first survey is waiting' }, 1040, 220),
      n('a4', 'action', 'bonus', { points: 50 }, 1300, 30),
    ],
    edges: [{ id: 'e1', from: 't', to: 'a1' }, { id: 'e2', from: 'a1', to: 'd1' }, { id: 'e3', from: 'd1', to: 'c1' }, { id: 'e4', from: 'c1', to: 'a2', branch: 'yes' }, { id: 'e5', from: 'c1', to: 'a3', branch: 'no' }, { id: 'e6', from: 'a2', to: 'a4' }],
  },
  {
    id: 'wf-winback', name: 'Win back dormant members', panel: 'mfr', status: 'active', runs7d: 2_106, conversion: 0.12,
    nodes: [
      n('t', 'trigger', 'inactive', { days: 45 }, 0, 120), n('c1', 'condition', 'segment', { segment: 'High quality score' }, 260, 120),
      n('a1', 'action', 'email', { template: 'We miss you' }, 520, 40), n('a2', 'action', 'tag', { tag: 'dormant-low-value' }, 520, 220),
      n('d1', 'delay', 'window', { from: 9 }, 780, 40), n('a3', 'action', 'bonus', { points: 100 }, 1040, 40),
    ],
    edges: [{ id: 'e1', from: 't', to: 'c1' }, { id: 'e2', from: 'c1', to: 'a1', branch: 'yes' }, { id: 'e3', from: 'c1', to: 'a2', branch: 'no' }, { id: 'e4', from: 'a1', to: 'd1' }, { id: 'e5', from: 'd1', to: 'a3' }],
  },
  {
    id: 'wf-hcp', name: 'HCP profile completion', panel: 'mho', status: 'paused', runs7d: 388, conversion: 0.27,
    nodes: [n('t', 'trigger', 'profile_gap', { pct: 60 }, 0, 120), n('d1', 'delay', 'wait', { hours: 24 }, 260, 120), n('a1', 'action', 'email', { template: 'Finish your profile' }, 520, 120)],
    edges: [{ id: 'e1', from: 't', to: 'd1' }, { id: 'e2', from: 'd1', to: 'a1' }],
  },
  { id: 'wf-points', name: 'Points balance nudge', panel: 't2o', status: 'draft', runs7d: 0, conversion: 0, nodes: [n('t', 'trigger', 'points', { points: 1000 }, 0, 120)], edges: [] },
];

export type RunLog = { id: string; workflow: string; member: string; at: string; path: string[]; outcome: 'completed' | 'waiting' | 'exited' | 'failed'; note: string };
export const runLogs: RunLog[] = Array.from({ length: 14 }, (_, i) => {
  const wf = workflows[i % 3];
  const outcome = (['completed', 'completed', 'waiting', 'exited', 'completed', 'failed'] as const)[i % 6];
  return {
    id: `run-${9100 + i}`, workflow: wf.id, member: `member-${(i * 677) % 9000 + 1000}`, at: `${2 + i * 9}m ago`,
    path: wf.nodes.slice(0, outcome === 'waiting' ? 3 : wf.nodes.length - (i % 2)).map((x) => x.id), outcome,
    note: { completed: 'Reached the last step', waiting: 'Waiting on a delay step', exited: 'Left the segment, so the run stopped', failed: 'Email bounced (hard)' }[outcome],
  };
});

// ───────────────────────── Email
export type EmailBlock = { id: string; kind: 'heading' | 'text' | 'button' | 'image' | 'survey' | 'divider'; text: string };
export const starterBlocks: EmailBlock[] = [
  { id: 'b1', kind: 'image', text: 'Header image · panel brand' },
  { id: 'b2', kind: 'heading', text: 'New surveys picked for you, {{first_name}}' },
  { id: 'b3', kind: 'text', text: 'We found 3 surveys that match your profile this week. Each one takes about 10 minutes and pays points as soon as you finish.' },
  { id: 'b4', kind: 'survey', text: '3 matched surveys · up to 450 points' },
  { id: 'b5', kind: 'button', text: 'See my surveys' },
  { id: 'b6', kind: 'divider', text: '' },
  { id: 'b7', kind: 'text', text: 'You get this email because you joined {{panel_name}}. Change your email settings any time.' },
];
/** Opens by local hour for the send-time optimiser (share of the day’s opens). */
export const opensByHour = Array.from({ length: 24 }, (_, h) => Number((Math.exp(-((h - 19) ** 2) / 8) * 0.09 + Math.exp(-((h - 8) ** 2) / 4) * 0.05 + 0.006 + r() * 0.004).toFixed(4)));

// ───────────────────────── Newsletters
export type IssueStatus = 'draft' | 'review' | 'scheduled' | 'sent';
export type Issue = { id: string; panel: PanelId; title: string; status: IssueStatus; date: string; stories: string[]; openRate?: number; clickRate?: number; owner: string };
const issueTitles: [PanelId, string][] = [['t2o', 'Your opinion shaped these products'], ['mfr', 'Double points weekend recap'], ['mho', 'Research that changed practice in 2026'], ['t2o', 'Meet the panel: 2 million voices'], ['mfr', 'New gift cards in the store'], ['mho', 'CME-eligible studies this month'], ['t2o', 'How we keep your data safe'], ['mfr', 'Tier upgrades explained'], ['mho', 'Specialist roundtables open'], ['t2o', 'Winter survey season']];
export const issues: Issue[] = issueTitles.map(([panel, title], i) => {
  const status = (['sent', 'sent', 'sent', 'scheduled', 'review', 'review', 'draft', 'draft', 'scheduled', 'sent'] as const)[i];
  return {
    id: `nl-${300 + i}`, panel, title, status, date: status === 'sent' ? `Oct ${28 - i * 2}` : status === 'scheduled' ? `Nov ${10 + i}` : '—',
    stories: ['Lead story', 'Survey of the month', 'Rewards update', 'Community'].slice(0, 2 + (i % 3)),
    openRate: status === 'sent' ? 0.24 + r() * 0.2 : undefined, clickRate: status === 'sent' ? 0.03 + r() * 0.05 : undefined,
    owner: ['Priya', 'Tom', 'Ana', 'Jun'][i % 4],
  };
});
export const contentLibrary = [
  { id: 'cl1', kind: 'Story', title: 'Behind the scenes: how a survey is built' }, { id: 'cl2', kind: 'Story', title: 'Member spotlight: 5 years on the panel' },
  { id: 'cl3', kind: 'Rewards', title: 'Gift card catalogue refresh' }, { id: 'cl4', kind: 'Rewards', title: 'Charity donations matched in December' },
  { id: 'cl5', kind: 'Research', title: 'Results: streaming habits 2026' }, { id: 'cl6', kind: 'Research', title: 'Results: what clinicians want from AI' },
  { id: 'cl7', kind: 'Safety', title: 'Spotting phishing that pretends to be us' },
];

// ───────────────────────── Lifecycle journeys
export const stages = ['Visitor', 'Registered', 'Verified', 'Profiled', 'First survey', 'Active', 'Loyal'] as const;
export type Stage = (typeof stages)[number];
export const journeyCounts: Record<PanelId, number[]> = {
  t2o: [96_000, 11_800, 10_300, 8_100, 5_600, 3_900, 1_700],
  mfr: [71_000, 8_700, 7_600, 6_200, 4_000, 2_700, 1_350],
  mho: [15_400, 1_460, 1_280, 900, 640, 520, 310],
};
export const stageAutomations: Record<Stage, { name: string; workflow?: string; lift?: number }[]> = {
  Visitor: [{ name: 'Retargeting landing pages', lift: 0.04 }],
  Registered: [{ name: 'Email verification reminder', lift: 0.09 }],
  Verified: [{ name: 'New member onboarding', workflow: 'wf-onboard', lift: 0.14 }],
  Profiled: [{ name: 'HCP profile completion', workflow: 'wf-hcp', lift: 0.11 }, { name: 'Profile gap nudges', lift: 0.08 }],
  'First survey': [{ name: 'First-survey bonus', lift: 0.17 }],
  Active: [{ name: 'Weekly rewards surveys', lift: 0.06 }, { name: 'Points balance nudge', workflow: 'wf-points' }],
  Loyal: [{ name: 'Win back dormant members', workflow: 'wf-winback', lift: 0.05 }],
};
export const stageDays: Record<Stage, number> = { Visitor: 0, Registered: 0.2, Verified: 0.6, Profiled: 2.4, 'First survey': 4.1, Active: 12, Loyal: 90 };

// ───────────────────────── Notifications
export type Lane = 'act' | 'review' | 'fyi';
export type Notice = { id: string; lane: Lane; title: string; detail: string; source: string; at: string; href?: string; action?: string };
export const notices: Notice[] = [
  { id: 'n1', lane: 'act', title: 'Quota cell at risk: 35–54 in Sports streaming churn', detail: '47% of pace with 6 field days left', source: 'Quotas', at: '4m ago', href: '/supply/quotas', action: 'Add a batch' },
  { id: 'n2', lane: 'act', title: '42 PayPal redemptions over $50 need approval', detail: '3 share a device fingerprint', source: 'Rewards', at: '12m ago', href: '/supply/executive', action: 'Review' },
  { id: 'n3', lane: 'act', title: 'Soft launch read-out ready: SMB cloud buyer study', detail: '2 metrics off plan', source: 'Launch', at: '25m ago', href: '/supply/launch', action: 'Open read-out' },
  { id: 'n4', lane: 'act', title: 'Email bounce rate 4.1% on “We miss you”', detail: 'Above the 2% threshold; sending paused automatically', source: 'Email', at: '41m ago', href: '/supply/email', action: 'Check list' },
  { id: 'n5', lane: 'review', title: 'Newsletter “CME-eligible studies” waiting for review', detail: 'Ana asked you to review', source: 'Newsletters', at: '1h ago', href: '/supply/newsletters' },
  { id: 'n6', lane: 'review', title: '12 registrations flagged for document check', detail: 'MyHealthOpinions · GB', source: 'Registration', at: '1h ago', href: '/supply/registration' },
  { id: 'n7', lane: 'review', title: 'AI drafted a profiling survey for B2B travel', detail: '14 questions · 2 quality warnings', source: 'AI drafts', at: '2h ago', href: '/supply/survey-generation' },
  { id: 'n8', lane: 'review', title: 'Automation “HCP profile completion” paused by Tom', detail: 'Reason: template update', source: 'Automation', at: '3h ago', href: '/supply/automation' },
  { id: 'n9', lane: 'fyi', title: 'Weekly rewards survey #46 closed', detail: '9,214 completes · $0.31 per complete', source: 'Weekly rewards', at: '5h ago', href: '/supply/weekly-rewards' },
  { id: 'n10', lane: 'fyi', title: 'Onboarding conversion up 3.1 points this week', detail: 'New member onboarding · 41%', source: 'Journeys', at: '6h ago', href: '/supply/journeys' },
  { id: 'n11', lane: 'fyi', title: 'PROJEXA synced 4 new audience requests', detail: 'PRJ-1104 to PRJ-1107', source: 'PROJEXA', at: '8h ago' },
  { id: 'n12', lane: 'fyi', title: 'Theme preferences now sync across devices', detail: 'Product update', source: 'SUPPLY360', at: '1d ago' },
];
export const channels = ['In app', 'Email', 'Slack', 'Mobile push'] as const;
export const deliveryRules: { source: string; channels: Record<(typeof channels)[number], boolean>; digest: boolean }[] = ['Quotas', 'Rewards', 'Launch', 'Email', 'Registration', 'Automation', 'Newsletters'].map((source, i) => ({
  source, channels: { 'In app': true, Email: i % 2 === 0, Slack: i < 3, 'Mobile push': i === 0 }, digest: i >= 4,
}));

// ───────────────────────── Weekly rewards surveys
export type Week = { week: number; label: string; status: 'sent' | 'live' | 'scheduled' | 'planned'; template: string; invites: number; completes: number; cost: number; topics: string[] };
export const weeklyTemplates = [
  { id: 'wt1', name: 'Quick pulse', questions: 6, loi: 3, desc: 'Six current-affairs and brand questions. Good for engagement.' },
  { id: 'wt2', name: 'Profile refresh', questions: 10, loi: 5, desc: 'Refreshes demographics that go stale: job, household, income.' },
  { id: 'wt3', name: 'Lifestyle deep-dive', questions: 14, loi: 7, desc: 'Rotating topic each month: travel, money, health, tech.' },
  { id: 'wt4', name: 'Prediction game', questions: 5, loi: 2, desc: 'Members predict outcomes and earn bonus points when right.' },
  { id: 'wt5', name: 'Product feedback', questions: 8, loi: 4, desc: 'Members rate the panel app and rewards. Feeds product work.' },
];
export const weeks: Week[] = Array.from({ length: 10 }, (_, i) => {
  const wk = 40 + i;
  const status: Week['status'] = i < 6 ? 'sent' : i === 6 ? 'live' : i === 7 ? 'scheduled' : 'planned';
  const invites = between(38_000, 46_000);
  const completes = status === 'sent' ? Math.round(invites * (0.19 + r() * 0.06)) : status === 'live' ? Math.round(invites * 0.11) : 0;
  return {
    week: wk, label: `Week ${wk}`, status, template: weeklyTemplates[i % weeklyTemplates.length].name, invites, completes,
    cost: completes * (0.27 + r() * 0.08), topics: [['Streaming', 'Holidays'], ['Banking', 'AI tools'], ['Grocery prices'], ['Elections', 'Sport'], ['Travel'], ['Health apps', 'Sleep']][i % 6],
  };
});

// ───────────────────────── AI survey drafting (local, deterministic demo generator)
export type DraftQuestion = { id: string; type: 'single' | 'multi' | 'scale' | 'open' | 'grid' | 'numeric'; text: string; options?: string[]; rationale: string; flags: string[] };
const topicBank: Record<string, { q: string; type: DraftQuestion['type']; options?: string[]; why: string }[]> = {
  b2b: [
    { q: 'Which best describes your role in buying {topic}?', type: 'single', options: ['I make the final decision', 'I recommend', 'I influence', 'Not involved'], why: 'Screens for decision authority, which drives eligibility for most B2B studies.' },
    { q: 'How many people work at your organisation?', type: 'single', options: ['1–49', '50–249', '250–999', '1,000+'], why: 'Company size is the most requested B2B quota.' },
    { q: 'Which industry is your organisation in?', type: 'single', options: ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Public sector', 'Other'], why: 'Maps to the B2B taxonomy so answers flow into targeting.' },
    { q: 'What is your annual budget for {topic}?', type: 'single', options: ['Under $10k', '$10k–$50k', '$50k–$250k', 'Over $250k', 'Don’t know'], why: 'Budget bands let clients size the opportunity; includes a “don’t know” escape.' },
  ],
  health: [
    { q: 'What is your primary specialty?', type: 'single', options: ['Cardiology', 'Oncology', 'General practice', 'Dermatology', 'Neurology', 'Other'], why: 'Specialty is required to route to almost every HCP study.' },
    { q: 'How many years have you been in practice?', type: 'numeric', why: 'Experience quotas are common; numeric keeps it precise.' },
    { q: 'Roughly how many patients with {topic} do you see in a typical month?', type: 'numeric', why: 'Patient volume is the strongest predictor of HCP survey incidence.' },
  ],
  consumer: [
    { q: 'How often do you use {topic}?', type: 'single', options: ['Every day', 'A few times a week', 'A few times a month', 'Rarely', 'Never'], why: 'Frequency splits heavy and light users for later targeting.' },
    { q: 'Which of these {topic} brands have you used in the last 3 months?', type: 'multi', options: ['Brand A', 'Brand B', 'Brand C', 'Brand D', 'None of these'], why: 'Brand usage is reusable profile data; “None” keeps it honest.' },
    { q: 'How satisfied are you with your current {topic}?', type: 'scale', options: ['1', '2', '3', '4', '5'], why: 'A 5-point scale is quick on mobile.' },
  ],
};
const common: { q: string; type: DraftQuestion['type']; options?: string[]; why: string }[] = [
  { q: 'Please select “Somewhat agree” for this question.', type: 'single', options: ['Strongly disagree', 'Somewhat disagree', 'Somewhat agree', 'Strongly agree'], why: 'Attention check. Failing it flags the response for quality review.' },
  { q: 'Is there anything else you would like to tell us about {topic}?', type: 'open', why: 'One open end at the end gives colour without raising drop-off.' },
];
const secs: Record<DraftQuestion['type'], number> = { single: 12, multi: 18, scale: 8, open: 45, grid: 40, numeric: 10 };
const drivers = ['price', 'quality', 'convenience', 'trust', 'speed', 'customer support', 'ease of use', 'recommendations from others'];
/** Screening and profile questions first, then rotating driver questions until the target length, an attention check in the middle and one open end last. */
export function draftSurvey(brief: { topic: string; audience: 'consumer' | 'b2b' | 'health'; goal: string; length: number }): DraftQuestion[] {
  const topic = brief.topic || 'this product';
  const raw = [...topicBank[brief.audience], ...(brief.audience !== 'consumer' ? topicBank.consumer.slice(0, 1) : [])];
  const cost = (t: { type: DraftQuestion['type']; options?: string[] }) => secs[t.type] + (t.options?.length ?? 0) * 1.5;
  const budget = brief.length * 60 - cost(common[0]) - cost(common[1]);
  let used = raw.reduce((a, t) => a + cost(t), 0);
  for (let k = 0; used < budget && k < drivers.length * 2; k++) {
    const t = { q: `How important is ${drivers[k % drivers.length]} when choosing {topic}?`, type: 'scale' as const, options: ['1', '2', '3', '4', '5'], why: 'Driver question; the set of drivers rotates so members do not see the same one twice in a row.' };
    raw.push(t); used += cost(t);
  }
  raw.splice(Math.ceil(raw.length / 2), 0, common[0]);
  raw.push(common[1]);
  return raw.map((t, i) => {
    const text = t.q.replaceAll('{topic}', topic);
    const flags: string[] = [];
    if (text.length > 90) flags.push('Long question text; may read poorly on mobile');
    if (t.type === 'multi' && !(t.options ?? []).some((o) => /none/i.test(o))) flags.push('Multi-select has no “None” option');
    if (/ and /i.test(text) && t.type === 'scale') flags.push('Possibly double-barrelled');
    return { id: `Q${i + 1}`, type: t.type, text, options: t.options, rationale: t.why, flags };
  });
}
