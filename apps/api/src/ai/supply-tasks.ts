/**
 * SUPPLY360 AI tasks: the copilot's question parser, survey drafting and support reply drafts.
 * Each has a rule-based implementation, so the screens work the same with no model connected.
 * What reaches a model: the copilot question (never data rows: numbers are counted afterwards from
 * the database), the survey brief, and a support ticket's text with the member's pseudonymous handle
 * and recent ledger lines. Every result is a draft that a person reviews.
 */
import { countries, draftSurvey, questionFlags, type DraftBrief } from '@sampledge/core';
import { z } from 'zod/v4';
import type { AiTask } from './gateway';

// ───────────────────────── Copilot: question → intent
export const copilotIntents = ['reachable', 'quota_pace', 'completes_by_country', 'winback', 'redemptions_held', 'liability', 'unknown'] as const;
const Intent = z.object({
  intent: z.enum(copilotIntents),
  country: z.string().nullable().describe('ISO 3166-1 alpha-2 code named in the question, else null'),
  panel: z.enum(['t2o', 'mfr', 'mho']).nullable().describe('t2o = Turn2Opinion, mfr = MyFrequentRewards, mho = MyHealthOpinions'),
  segment: z.enum(['hcp', 'professional', 'gen_z']).nullable().describe('hcp = any healthcare professional or doctor specialty, professional = B2B / IT decision makers, gen_z = aged 18-24'),
});
export type IntentOut = z.infer<typeof Intent>;
export type IntentIn = { question: string; context: { country?: string; panel?: string; segment?: string } };

const countryWords: Record<string, string> = Object.fromEntries(countries.flatMap((c) => [[c.name.toLowerCase(), c.code], [c.code.toLowerCase(), c.code]]));
Object.assign(countryWords, { uk: 'GB', britain: 'GB', usa: 'US', america: 'US', germany: 'DE' });
const panelWords: Record<string, 't2o' | 'mfr' | 'mho'> = { turn2opinion: 't2o', t2o: 't2o', myfrequentrewards: 'mfr', mfr: 'mfr', myhealthopinions: 'mho', mho: 'mho' };
const segmentWords: Record<string, 'hcp' | 'professional' | 'gen_z'> = {
  cardiolog: 'hcp', dermatolog: 'hcp', oncolog: 'hcp', nurse: 'hcp', gp: 'hcp', doctor: 'hcp', physician: 'hcp', hcp: 'hcp', healthcare: 'hcp',
  'it decision': 'professional', b2b: 'professional', 'decision maker': 'professional', professional: 'professional', 'gen z': 'gen_z',
};
function find<T>(q: string, dict: Record<string, T>) {
  const k = Object.keys(dict).sort((a, b) => b.length - a.length).find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(q));
  return k ? dict[k] : undefined;
}
const asPanel = (v?: string) => (v === 't2o' || v === 'mfr' || v === 'mho' ? v : null);
const asSegment = (v?: string) => (v === 'hcp' || v === 'professional' || v === 'gen_z' ? v : null);

/** The keyword router, also the fallback when the model's answer is unusable. */
export function routeQuestion({ question, context }: IntentIn): IntentOut {
  const q = question.toLowerCase();
  const country = find(q, countryWords) ?? context.country ?? null;
  const panel = find(q, panelWords) ?? asPanel(context.panel);
  const seg = find(q, segmentWords);
  const segment = seg ?? asSegment(context.segment);
  const intent: IntentOut['intent'] =
    /dormant|win back|win-back|re-?engage|nudge/.test(q) ? 'winback'
    : /quota|pace|behind/.test(q) ? 'quota_pace'
    : /redemption|held|fraud|hold/.test(q) ? 'redemptions_held'
    : /liabilit|owe|wallet|outstanding points/.test(q) ? 'liability'
    : /complete|by country|today/.test(q) ? 'completes_by_country'
    : seg || /how many|reachable|count|members in|panellists in/.test(q) ? 'reachable'
    : 'unknown';
  return { intent, country, panel, segment };
}

export const copilotIntent: AiTask<IntentIn, IntentOut> = {
  name: 'copilot.intent',
  version: 1,
  description: 'Copilot question → which supply question it is, with country, panel and segment',
  schema: Intent,
  maxTokens: 1000,
  system: [
    'You route questions from a market-research supply team to one of a fixed set of answers.',
    'reachable: how many members can be reached (optionally in a country, panel or segment).',
    'quota_pace: quota cells behind pace. completes_by_country: completes today by country.',
    'winback: re-engaging dormant members. redemptions_held: why reward redemptions are waiting.',
    'liability: outstanding reward points owed. unknown: anything else.',
    'Use the conversation context for follow-ups that do not name a country, panel or segment. Never answer the question itself.',
  ].join('\n'),
  render: ({ question, context }) => `<context>${JSON.stringify(context)}</context>\n<question>\n${question}\n</question>`,
  rules: routeQuestion,
};

// ───────────────────────── Survey drafting
const Draft = z.object({
  questions: z.array(z.object({
    type: z.enum(['single', 'multi', 'scale', 'open', 'grid', 'numeric']),
    text: z.string(),
    options: z.array(z.string()).optional().describe('answer options in order; omit for open and numeric'),
    rationale: z.string().describe('one sentence on why the question is in the survey'),
  })).describe('screening first, an attention check in the middle, at most two open ends'),
});
export type DraftOut = { questions: { id: string; type: 'single' | 'multi' | 'scale' | 'open' | 'grid' | 'numeric'; text: string; options?: string[]; rationale: string; flags: string[] }[] };

export const surveyDraft: AiTask<DraftBrief, z.infer<typeof Draft>> = {
  name: 'survey.draft',
  version: 1,
  description: 'Survey brief → first-draft questions with the reason for each',
  schema: Draft,
  maxTokens: 8000,
  system: [
    'You draft short online surveys for a research panel. Members answer on phones.',
    'Start with screening and profile questions for the audience, then the questions that serve the goal.',
    'Include exactly one attention check asking the member to select "Somewhat agree", placed near the middle.',
    'Use at most two open-ended questions and at most 8 options per list. Multi-select lists end with "None of these".',
    'Neutral, single-barrelled wording. No personal identifiers such as name, e-mail, phone or address.',
    'Fit the target length: about 12 s per single choice, 18 s per multi choice, 8 s per scale, 45 s per open end.',
  ].join('\n'),
  render: (b) => `<brief>\nTopic: ${b.topic}\nAudience: ${b.audience}\nGoal: ${b.goal}\nTarget length: ${b.length} minutes\n</brief>`,
  rules: (b) => ({ questions: draftSurvey(b).map(({ type, text, options, rationale }) => ({ type, text, ...(options ? { options } : {}), rationale })) }),
};
/** Numbers the questions and adds the wording checks, for either provider's draft. */
export const finishDraft = (d: z.infer<typeof Draft>): DraftOut => ({
  questions: d.questions.slice(0, 40).map((q, i) => ({ id: `Q${i + 1}`, type: q.type, text: q.text, ...(q.options?.length ? { options: q.options } : {}), rationale: q.rationale, flags: questionFlags(q) })),
});

// ───────────────────────── Support reply drafts
export type ReplyIn = {
  subject: string; category: string; panel: string;
  messages: { from: string; text: string }[];
  ledger: { kind: string; points: number; note: string | null; date: string }[];
  balance: number;
};
const Reply = z.object({
  reply: z.string().describe('the e-mail reply to the member, plain text, no greeting by name, no signature'),
  confidence: z.enum(['high', 'medium', 'low']),
  sources: z.array(z.string()).describe('which policies or ledger lines the reply relies on'),
  goodwill: z.number().int().nullable().describe('bonus points to offer (0 to 100), only for a survey that closed or failed through no fault of the member'),
  escalate: z.boolean().describe('true when a person must investigate before anyone replies'),
});
export type ReplyOut = z.infer<typeof Reply>;

const policies = {
  overquota: 'Over-quota compensation: up to 50 points when a survey closes while the member is in it',
  reversal: 'Quality and point reversals: points can be reversed when the client’s quality checks flag a response',
  payout: 'Redemptions: paid within 3 working days; held redemptions are reviewed by the rewards team',
  deletion: 'Deletion requests: completed within 30 days, invitations stop at once',
  technical: 'Known issues: blank survey pages on old app versions; ask for the device model',
};
export function ruleReply(x: ReplyIn): ReplyOut {
  const text = `${x.subject} ${x.messages.filter((m) => m.from === 'member').map((m) => m.text).join(' ')}`.toLowerCase();
  const reversal = x.ledger.find((e) => e.points < 0 && /revers|quality/i.test(e.note ?? ''));
  if (/full|closed|quota|kicked out|ended/.test(text)) return { reply: 'Sorry about that. The survey reached its quota while you were completing it, so it closed before the end. We have added 50 bonus points to your balance as a thank-you for your time.', confidence: 'high', sources: [policies.overquota], goodwill: 50, escalate: false };
  if (reversal || /revers|disappear|missing|removed/.test(text)) return { reply: `${reversal ? `I can see a ${Math.abs(reversal.points)}-point reversal on ${reversal.date}. ` : ''}Points from a survey can be reversed when the client’s quality checks flag the response, for example when it was answered much faster than average. This keeps rewards fair for every member. Your balance is now ${x.balance.toLocaleString('en-US')} points and ready to redeem.`, confidence: reversal ? 'high' : 'medium', sources: [policies.reversal, ...(reversal ? [`Ledger: ${reversal.kind} ${reversal.points} on ${reversal.date}`] : [])], goodwill: null, escalate: false };
  if (/delete|remove my (account|data)|unsubscribe/.test(text) || x.category === 'Privacy') return { reply: 'We have received your request. Your account and data will be deleted within 30 days and we will e-mail you when it is done. You will not receive any more invitations.', confidence: 'medium', sources: [policies.deletion], goodwill: null, escalate: true };
  if (/redeem|gift card|paypal|payout|voucher/.test(text) || x.category === 'Rewards') return { reply: 'Thanks for your patience. Redemptions are usually paid within 3 working days. I have checked yours and passed it to the rewards team, and you will get an e-mail as soon as it is paid.', confidence: 'medium', sources: [policies.payout], goodwill: null, escalate: true };
  if (/load|blank|error|crash|app|android|iphone/.test(text) || x.category === 'Technical') return { reply: 'Thanks for letting us know. Please update the app to the latest version, which fixes blank survey pages on some phones. If it still happens, reply with your phone model and we will look into it.', confidence: 'medium', sources: [policies.technical], goodwill: null, escalate: false };
  return { reply: 'Thanks for getting in touch. I am looking into this and will come back to you shortly.', confidence: 'low', sources: [], goodwill: null, escalate: true };
}

export const supportReply: AiTask<ReplyIn, ReplyOut> = {
  name: 'support.reply',
  version: 1,
  description: 'Support ticket → draft reply, confidence, sources and any goodwill points',
  schema: Reply,
  maxTokens: 2000,
  system: [
    'You draft replies for a survey panel’s member support team. A person reviews every draft before it is sent.',
    'Be brief, warm and specific. Use only the facts given: the ticket, the member’s recent ledger lines and these policies:',
    ...Object.values(policies).map((p) => `- ${p}`),
    'Never promise anything outside these policies, never ask for passwords or personal identifiers, and do not address the member by name.',
    'Offer goodwill points (at most 100) only when a survey closed or failed through no fault of the member. Escalate when the facts are missing.',
  ].join('\n'),
  render: (x) => [
    `<ticket panel="${x.panel}" category="${x.category}">`, `Subject: ${x.subject}`,
    ...x.messages.slice(-6).map((m) => `[${m.from}] ${m.text}`), '</ticket>',
    `<ledger balance="${x.balance}">`, ...x.ledger.map((e) => `${e.date} ${e.kind} ${e.points} ${e.note ?? ''}`), '</ledger>',
  ].join('\n'),
  rules: ruleReply,
};

export const supplyTasks = [copilotIntent, surveyDraft, supportReply];
