/**
 * Rewards, support and quality demonstration data for wave 5. Synthetic and seeded. Panellist
 * references point at the seeded sample in ./panellists.ts, so every row links to a real 360° page.
 *
 * Integration points: ledger and liability from the API points ledger (planned
 * `GET /panels/ledger`), payout policy from `GET /panels/reward-policy` (available), tickets from
 * `GET /support/tickets` (planned), redemption decisions through `POST /approvals/:id/decision`.
 */
import { rng } from '../utils';
import type { PanelId } from './demo';
import { panellists, type Panellist } from './panellists';

const r = rng(5505);
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
const people = () => panellists().filter((p) => p.status !== 'deletion_requested');
const person = (k: number): Panellist => people()[(k * 397) % people().length];

/** Points to dollars: 100 points = $1 across all three panels. */
export const POINT_USD = 0.01;
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0').slice(0, 8);

// ───────────────────────── Ledger
export type TxType = 'earn' | 'bonus' | 'redeem' | 'reversal' | 'expiry' | 'adjust';
export type TxStatus = 'posted' | 'pending' | 'held' | 'failed';
export type Tx = { id: string; at: string; minutesAgo: number; panellist: Panellist; type: TxType; points: number; status: TxStatus; ref: string; hash: string; prev: string };
const txTypes: TxType[] = ['earn', 'earn', 'earn', 'earn', 'bonus', 'redeem', 'redeem', 'reversal', 'expiry', 'adjust'];
let prev = 'genesis0';
export const ledger: Tx[] = Array.from({ length: 80 }, (_, i) => {
  const type = txTypes[Math.floor(r() * txTypes.length)];
  const p = person(i + 3);
  const pts = type === 'earn' ? between(50, 600) : type === 'bonus' ? pick([25, 50, 100, 250]) : type === 'redeem' ? -pick([500, 1000, 2500, 5000]) : type === 'reversal' ? -between(50, 400) : type === 'expiry' ? -between(100, 900) : pick([-200, 150, 300]);
  const status: TxStatus = type === 'redeem' ? pick(['posted', 'posted', 'pending', 'held', 'failed'] as const) : r() < 0.06 ? 'pending' : 'posted';
  const minutesAgo = i * 7 + between(0, 6);
  const hash = hex(Math.imul(i + 1, 2654435761) ^ (pts * 40503));
  const tx = { id: `tx-${(880000 + 80 - i).toString()}`, at: minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`, minutesAgo, panellist: p, type, points: pts, status, ref: type === 'earn' ? `sv-${5200 + (i % 24) * 11}` : type === 'redeem' ? `rd-${7100 + i}` : type === 'adjust' ? 'manual · ops' : type === 'reversal' ? 'quality reversal' : type === 'bonus' ? 'automation' : 'policy: 18 months', hash, prev };
  prev = hash;
  return tx;
});

export const liability: { panel: PanelId; points: number; members: number; expiring90d: number; trend: number[] }[] = [
  { panel: 't2o', points: 24_180_000, members: 1_244_000, expiring90d: 1_920_000, trend: [21.1, 21.9, 22.4, 22.8, 23.5, 24.18] },
  { panel: 'mfr', points: 26_420_000, members: 812_000, expiring90d: 2_640_000, trend: [23.0, 23.6, 24.4, 25.1, 25.9, 26.42] },
  { panel: 'mho', points: 1_465_000, members: 184_000, expiring90d: 88_000, trend: [1.21, 1.26, 1.31, 1.37, 1.42, 1.465] },
];

export const reconciliation = [
  { provider: 'PayPal', ledgerUsd: 41_820.5, statementUsd: 41_820.5, items: 1_204 },
  { provider: 'Tango gift cards', ledgerUsd: 63_410, statementUsd: 63_385, items: 2_877, note: '1 card voided by provider after issue ($25)' },
  { provider: 'Charity (GiveDirect)', ledgerUsd: 5_120, statementUsd: 5_120, items: 391 },
  { provider: 'Bank transfer (IN)', ledgerUsd: 8_940, statementUsd: 8_905.4, items: 318, note: 'FX difference on 12 transfers' },
];

// ───────────────────────── Redemptions
export type Redemption = { id: string; panellist: Panellist; method: 'PayPal' | 'Amazon gift card' | 'Bank transfer' | 'Charity'; usd: number; risk: number; signals: string[]; requestedAgo: string; tenureDays: number; pastRedemptions: number; earnedLast30: number };
const methods = ['PayPal', 'Amazon gift card', 'Bank transfer', 'Charity'] as const;
const sigBank = ['Shares a device fingerprint with 2 other accounts', 'Earned 70% of balance in the last 7 days', 'New payout email added yesterday', 'VPN at request time', 'Speeder flags on 3 recent surveys', 'Country of payout differs from profile'];
export const redemptions: Redemption[] = Array.from({ length: 18 }, (_, i) => {
  const p = person(i * 5 + 11);
  const nSig = i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
  const signals = Array.from({ length: nSig }, (_, k) => sigBank[(i + k * 2) % sigBank.length]);
  const tenureDays = Math.max(4, Math.round((Date.UTC(2026, 10, 6) - new Date(p.joinedAt).getTime()) / 86400000));
  return {
    id: `rd-${7200 + i}`, panellist: p, method: methods[i % 4], usd: pick([5, 10, 25, 25, 50, 50, 75, 100]), requestedAgo: `${1 + i * 13}m ago`,
    risk: Math.min(0.97, 0.06 + nSig * 0.33 + r() * 0.12 + (tenureDays < 30 ? 0.15 : 0)), signals, tenureDays, pastRedemptions: Math.floor(r() * 14), earnedLast30: between(200, 4200),
  };
});

// ───────────────────────── Support
export type TicketStatus = 'new' | 'open' | 'waiting' | 'solved';
export type Msg = { from: 'member' | 'agent' | 'note'; author: string; text: string; at: string };
export type Ticket = { id: string; subject: string; category: 'Rewards' | 'Survey issue' | 'Account' | 'Privacy' | 'Technical'; status: TicketStatus; priority: 'urgent' | 'high' | 'normal' | 'low'; panellist: Panellist; slaMinutesLeft: number; messages: Msg[]; channel: 'Email' | 'In app' | 'Chat' };
const ticketSeed: [string, Ticket['category'], Ticket['priority'], string][] = [
  ['My PayPal redemption has been pending for 6 days', 'Rewards', 'high', 'Hi, I redeemed 2,500 points to PayPal last week and it still says pending. Can you check?'],
  ['Survey closed before I finished, no points', 'Survey issue', 'normal', 'I was on the last page of the streaming survey and it said the survey was full. I spent 15 minutes on it.'],
  ['Please delete my account and data', 'Privacy', 'urgent', 'I want my account and all my data deleted under GDPR.'],
  ['Can’t log in after changing phone', 'Account', 'high', 'New phone, the app keeps saying my device is not recognised.'],
  ['Points disappeared from my balance', 'Rewards', 'high', 'I had 3,200 points yesterday and now I have 2,700. What happened?'],
  ['Survey page won’t load on Android', 'Technical', 'normal', 'The survey link opens a blank page in the app. Chrome works.'],
  ['Why was I screened out so fast?', 'Survey issue', 'low', 'Every survey screens me out after 2 questions. Is something wrong with my profile?'],
  ['Change my country, I moved to Canada', 'Account', 'normal', 'I moved from the US to Canada. How do I update this?'],
  ['Gift card code doesn’t work', 'Rewards', 'urgent', 'The Amazon code you sent says it has already been redeemed.'],
  ['Unsubscribe from newsletters only', 'Account', 'low', 'I still want surveys but no newsletters please.'],
];
export const tickets: Ticket[] = ticketSeed.map(([subject, category, priority, text], i) => {
  const status: TicketStatus = (['new', 'open', 'new', 'open', 'waiting', 'open', 'solved', 'waiting', 'new', 'solved'] as const)[i];
  const p = person(i * 9 + 2);
  const messages: Msg[] = [{ from: 'member', author: p.handle, text, at: `${2 + i * 17}m ago` }];
  if (status !== 'new') messages.push({ from: 'agent', author: 'Priya (Support)', text: 'Thanks for getting in touch. I’m looking into this now and will update you shortly.', at: `${1 + i * 15}m ago` });
  if (i === 4) messages.push({ from: 'note', author: 'Priya', text: 'Ledger shows a 500-point quality reversal on Nov 4 (speeder flags on sv-5244). Explain the policy; no refund.', at: '6m ago' });
  if (status === 'waiting') messages.push({ from: 'agent', author: 'Priya (Support)', text: 'Could you confirm the email address on your payout account? Then I can trace the payment.', at: '30m ago' });
  return { id: `TK-${41200 + i}`, subject, category, status, priority, panellist: p, slaMinutesLeft: priority === 'urgent' ? 25 - i : priority === 'high' ? 140 - i * 9 : 600 - i * 20, messages, channel: (['Email', 'In app', 'Chat'] as const)[i % 3] };
});
export const macros = [
  { id: 'm1', name: 'Pending redemption: checking', text: 'Thanks for your patience. Redemptions are usually paid within 3 working days. I’ve checked yours and it is with the payment provider; you’ll get an email as soon as it lands.' },
  { id: 'm2', name: 'Quality reversal explained', text: 'Points from a survey can be reversed when the client’s quality checks flag the response (for example answers given too quickly). This keeps the panel fair for everyone. You can read our quality policy in Help.' },
  { id: 'm3', name: 'Over-quota apology', text: 'Sorry about that. The survey filled while you were taking it. We’ve added 50 bonus points to your balance as a thank-you for your time.' },
  { id: 'm4', name: 'Deletion request received', text: 'We’ve received your request. Your account and data will be deleted within 30 days and we’ll email you when it’s done. You won’t receive any more invitations.' },
];

// ───────────────────────── AI support
export type Suggestion = { id: string; ticketId: string; question: string; draft: string; confidence: number; sources: { title: string; kind: 'Help article' | 'Policy' | 'Ledger' | 'Past ticket' }[]; action?: string };
export const suggestions: Suggestion[] = [
  { id: 'ai1', ticketId: 'TK-41204', question: 'Points disappeared from my balance', confidence: 0.91, draft: 'I can see a 500-point reversal on 4 November. The client’s quality check flagged that survey because it was completed much faster than average. Reversals like this are part of our quality policy, which keeps rewards fair for every member. Your other 2,700 points are safe and ready to redeem.', sources: [{ title: 'Ledger tx-880072 · quality reversal', kind: 'Ledger' }, { title: 'Quality and point reversals', kind: 'Policy' }] },
  { id: 'ai2', ticketId: 'TK-41201', question: 'Survey closed before I finished, no points', confidence: 0.84, draft: 'Sorry about that. The survey reached its quota while you were completing it. We’ve added 50 bonus points to your account as a thank-you for your time.', sources: [{ title: 'Over-quota compensation', kind: 'Policy' }, { title: 'TK-39811 (same survey, resolved)', kind: 'Past ticket' }], action: 'Grant 50 bonus points' },
  { id: 'ai3', ticketId: 'TK-41205', question: 'Survey page won’t load on Android', confidence: 0.62, draft: 'Thanks for letting us know. Please update the app to version 5.8 or later, which fixes blank survey pages on some Android phones. If it still happens, reply with your phone model and we’ll look further.', sources: [{ title: 'Known issue: Android WebView blank page', kind: 'Help article' }] },
  { id: 'ai4', ticketId: 'TK-41208', question: 'Gift card code doesn’t work', confidence: 0.48, draft: 'I’m sorry the code isn’t working. I’ve asked our gift card provider to check it and will send a replacement as soon as they confirm.', sources: [{ title: 'Gift card replacement', kind: 'Policy' }], action: 'Escalate to rewards team' },
  { id: 'ai5', ticketId: 'TK-41207', question: 'Change my country, I moved to Canada', confidence: 0.88, draft: 'Congratulations on the move! For security, country changes are made by our team. I’ve updated your country to Canada; you’ll start seeing Canadian surveys within 24 hours. Your points balance stays the same.', sources: [{ title: 'Changing country', kind: 'Help article' }], action: 'Update country to CA' },
];
export const deflection = { last7: [0.31, 0.33, 0.34, 0.36, 0.35, 0.38, 0.41], autoResolved: 1_284, reviewed: 3_102, acceptedAsIs: 0.64, edited: 0.27, rejected: 0.09 };

// ───────────────────────── Quality & risk
export const riskSignals = [
  { key: 'duplicate', label: 'Duplicate device', rate: 0.021, prev: 0.018 },
  { key: 'speeder', label: 'Speeding', rate: 0.034, prev: 0.039 },
  { key: 'straight', label: 'Straight-lining', rate: 0.027, prev: 0.025 },
  { key: 'geo', label: 'Geo mismatch', rate: 0.016, prev: 0.012 },
  { key: 'vpn', label: 'VPN / proxy', rate: 0.023, prev: 0.022 },
  { key: 'gibberish', label: 'Open-end gibberish', rate: 0.011, prev: 0.014 },
];
export type RiskCase = { id: string; panellist: Panellist; score: number; signals: string[]; opened: string; status: 'open' | 'suspended' | 'cleared' | 'watch'; evidence: { at: string; text: string; kind: 'survey' | 'device' | 'reward' | 'login' }[] };
export const riskCases: RiskCase[] = Array.from({ length: 12 }, (_, i) => {
  const p = person(i * 13 + 7);
  const sigs = riskSignals.filter((_, k) => (i + k) % 4 === 0 || (i * k) % 7 === 1).slice(0, 3).map((s) => s.label);
  return {
    id: `RC-${3300 + i}`, panellist: p, score: Math.min(0.98, 0.42 + sigs.length * 0.16 + r() * 0.1), signals: sigs.length ? sigs : ['Speeding'], opened: `${1 + i * 3}h ago`, status: 'open',
    evidence: ([
      { at: '14 days ago', kind: 'login', text: 'Login from a new device (Android 15), IP in NG; profile country US' },
      { at: '9 days ago', kind: 'survey', text: 'Completed sv-5233 in 2m 41s; median is 11m 20s' },
      { at: '6 days ago', kind: 'device', text: 'Device fingerprint now matches 2 other accounts' },
      { at: '3 days ago', kind: 'survey', text: 'Straight-lined a 12-row grid in sv-5244' },
      { at: '1 day ago', kind: 'reward', text: 'Requested $50 PayPal redemption to a new payout email' },
    ] as RiskCase['evidence']).slice(0, 3 + (i % 3)),
  };
});
/** Backtest: share of last month's confirmed fraud caught (recall) and share of flags that were fraud (precision), by score threshold. */
export const backtest = Array.from({ length: 11 }, (_, i) => {
  const t = 0.3 + i * 0.06;
  return { threshold: Number(t.toFixed(2)), recall: Number(Math.max(0.2, 1 - Math.pow(t, 2.4)).toFixed(3)), precision: Number(Math.min(0.98, 0.35 + t * 0.7).toFixed(3)), flagged: Math.round(4200 * Math.pow(1 - t, 1.7)) };
});

// ───────────────────────── Activity timeline
export const eventTypes = [
  { key: 'signup', label: 'Sign-ups', color: 'rgb(var(--chart-1))' },
  { key: 'profile', label: 'Profile updates', color: 'rgb(var(--chart-2))' },
  { key: 'survey', label: 'Survey completes', color: 'rgb(var(--chart-3))' },
  { key: 'reward', label: 'Rewards', color: 'rgb(var(--chart-4))' },
  { key: 'support', label: 'Support', color: 'rgb(var(--chart-5))' },
  { key: 'risk', label: 'Risk flags', color: 'rgb(var(--danger))' },
] as const;
export type EventKey = (typeof eventTypes)[number]['key'];
export type ActivityEvent = { id: string; type: EventKey; minute: number; panellist: Panellist; text: string };
const evText: Record<EventKey, (p: Panellist) => string> = {
  signup: (p) => `Joined ${({ t2o: 'Turn2Opinion', mfr: 'MyFrequentRewards', mho: 'MyHealthOpinions' } as const)[p.brand]} from ${p.country}`,
  profile: () => pick(['Completed household section', 'Updated employment', 'Answered 12 profile questions', 'Verified email']),
  survey: () => `Completed ${pick(['sv-5211', 'sv-5222', 'sv-5233', 'sv-5244', 'sv-5255'])} (+${pick([150, 200, 300, 450])} pts)`,
  reward: () => pick(['Redeemed $10 Amazon gift card', 'Redeemed $25 PayPal', 'Donated $5 to charity', 'Received 50 bonus points']),
  support: () => pick(['Opened a ticket: rewards', 'Replied to TK-41203', 'Rated support 5/5']),
  risk: () => pick(['Speeder flag on sv-5233', 'Device shared with 2 accounts', 'VPN detected at login']),
};
const weights: [EventKey, number][] = [['survey', 46], ['profile', 20], ['reward', 14], ['signup', 10], ['support', 6], ['risk', 4]];
export const activity: ActivityEvent[] = Array.from({ length: 360 }, (_, i) => {
  let x = r() * 100, type: EventKey = 'survey';
  for (const [k, w] of weights) { x -= w; if (x <= 0) { type = k; break; } }
  const p = person(i * 7 + 1);
  // more activity in the evening (UTC 14–22)
  const minute = Math.floor(((i / 360) * 1440 + Math.sin(i) * 20 + 1440) % 1440);
  return { id: `ev-${i}`, type, minute, panellist: p, text: evText[type](p) };
}).sort((a, b) => a.minute - b.minute);
