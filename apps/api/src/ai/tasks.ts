/**
 * Prompt registry. Each task: versioned prompt, typed output, and the rule-based implementation
 * used when no model is connected or the model's answer is unusable.
 */
import { countries, extractRfq, parseQuestionnaire, suggestCodeframe } from '@sampledge/core';
import { z } from 'zod/v4';
import type { AiTask } from './gateway';
import { supplyTasks } from './supply-tasks';

const countryCodes = countries.map((c) => c.code);

// ───────────────────────── RFQ extraction
const Rfq = z.object({
  audience: z.enum(['B2C', 'B2B', 'Healthcare']).nullable(),
  countries: z.array(z.string()).describe('ISO 3166-1 alpha-2 codes, only from the supported list'),
  sampleSize: z.number().int().nullable(),
  incidence: z.number().nullable().describe('fraction between 0 and 1'),
  loi: z.number().int().nullable().describe('length of interview in minutes'),
  title: z.string().nullable(),
  missing: z.array(z.string()).describe('requirements the text does not state'),
});
export type RfqOut = z.infer<typeof Rfq>;

export const rfqExtract: AiTask<{ text: string }, RfqOut> = {
  name: 'rfq.extract',
  version: 1,
  description: 'RFQ e-mail → audience, markets, sample size, incidence, LOI',
  schema: Rfq,
  system: [
    'You extract market-research sample requirements from a client request for quotation.',
    `Supported markets (ISO codes): ${countryCodes.join(', ')}. Ignore markets outside this list and mention them in "missing".`,
    'Use null for anything the text does not state. Never guess a sample size, incidence or interview length.',
    'Audience: B2C for consumers, B2B for professionals and decision makers, Healthcare for HCPs, patients or caregivers.',
  ].join('\n'),
  render: ({ text }) => `<rfq>\n${text}\n</rfq>`,
  rules: ({ text }) => {
    const r = extractRfq(text, countries);
    const missing = [!r.audience && 'audience', !r.countries.length && 'markets', !r.n && 'sample size', !r.ir && 'incidence', !r.loi && 'interview length'].filter(Boolean) as string[];
    return { audience: r.audience ?? null, countries: r.countries, sampleSize: r.n ?? null, incidence: r.ir ?? null, loi: r.loi ?? null, title: null, missing };
  },
};

// ───────────────────────── Questionnaire structure
const Q = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(['single', 'multi', 'numeric', 'text', 'nps', 'matrix', 'ranking']),
  options: z.array(z.object({ code: z.string(), label: z.string(), exclusive: z.boolean().optional() })),
  notes: z.array(z.string()),
  ambiguous: z.array(z.string()),
  terminate: z.string().optional().describe('comma-separated option codes that screen the respondent out'),
  displayIf: z.string().optional(),
  randomize: z.boolean().optional(),
});
const Questionnaire = z.object({ questions: z.array(Q) });
export type QuestionnaireOut = z.infer<typeof Questionnaire>;

export const questionnaireStructure: AiTask<{ text: string }, QuestionnaireOut> = {
  name: 'questionnaire.structure',
  version: 1,
  description: 'Questionnaire document text → questions, types, options, logic notes',
  schema: Questionnaire,
  maxTokens: 32000,
  system: [
    'You convert a market-research questionnaire into structured questions for a survey programmer to review.',
    'Keep the original question ids (S1, Q1, …) and wording. Answer option codes are 1, 2, 3 … in the order given.',
    'Mark "none of these", "don\'t know" and "prefer not to say" options as exclusive.',
    'Put skip/ask-if instructions in displayIf as written, termination options in terminate, quota and piping instructions in notes.',
    'Anything unclear, contradictory or marked for clarification goes in ambiguous. Do not invent questions or options.',
  ].join('\n'),
  render: ({ text }) => `<questionnaire>\n${text}\n</questionnaire>`,
  rules: ({ text }) => ({ questions: parseQuestionnaire(text) }),
};

// ───────────────────────── Project summary
export type ProjectFacts = {
  code: string; name: string; stage: string; audience: string; countries: string[];
  target: number; completes: number; daysLeft: number; daysElapsed: number; ir: number; loi: number;
  quotas: { label: string; target: number; count: number }[];
  vendors: number; blockers: string[]; budgetUsedShare?: number;
};
const Summary = z.object({
  headline: z.string(),
  bullets: z.array(z.string()).describe('3 to 5 factual status points'),
  risks: z.array(z.object({ level: z.enum(['high', 'medium', 'low']), text: z.string() })),
  nextSteps: z.array(z.string()),
});
export type SummaryOut = z.infer<typeof Summary>;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const projectSummary: AiTask<ProjectFacts, SummaryOut> = {
  name: 'project.summary',
  version: 1,
  description: 'Project record → status summary, risks and next steps',
  schema: Summary,
  system: [
    'You write a short status summary of a market-research fieldwork project for its project manager.',
    'Use only the facts given. Do not invent numbers, dates, vendors or causes. Say when a fact needed for a judgement is missing.',
  ].join('\n'),
  render: (f) => `<project>\n${JSON.stringify(f, null, 2)}\n</project>`,
  rules: (f) => {
    const progress = f.target ? f.completes / f.target : 0;
    const timeShare = f.daysElapsed + f.daysLeft > 0 ? f.daysElapsed / (f.daysElapsed + f.daysLeft) : 1;
    const remaining = Math.max(0, f.target - f.completes);
    const perDay = f.daysLeft > 0 ? Math.ceil(remaining / f.daysLeft) : remaining;
    const risks: SummaryOut['risks'] = [];
    if (f.completes > 0 && progress + 0.1 < timeShare) risks.push({ level: progress + 0.25 < timeShare ? 'high' : 'medium', text: `Behind pace: ${pct(progress)} of completes with ${pct(timeShare)} of the field time used. Needs about ${perDay} completes a day to finish.` });
    if (f.daysLeft < 0 && remaining > 0) risks.push({ level: 'high', text: `Past the deadline with ${remaining} completes outstanding.` });
    const lagging = f.quotas.filter((q) => q.target > 0 && q.count / q.target + 0.2 < progress);
    if (lagging.length) risks.push({ level: 'medium', text: `Quota cells lagging overall progress: ${lagging.map((q) => `${q.label} (${q.count}/${q.target})`).join(', ')}.` });
    if (f.ir < 0.1) risks.push({ level: 'medium', text: `Low incidence (${pct(f.ir)}) makes top-ups slower and costlier.` });
    if (f.budgetUsedShare !== undefined && f.budgetUsedShare > progress + 0.1) risks.push({ level: 'medium', text: `Cost running ahead of delivery: ${pct(f.budgetUsedShare)} of budget used for ${pct(progress)} of completes.` });
    f.blockers.forEach((b) => risks.push({ level: 'high', text: `Blocker: ${b}` }));
    const next: string[] = [];
    if (risks.some((r) => r.text.startsWith('Behind pace'))) next.push('Ask current vendors for a top-up, or request feasibility from another vendor for the lagging markets.');
    if (lagging.length) next.push('Target invitations at the lagging quota cells.');
    if (f.blockers.length) next.push('Resolve the listed blockers with their owners.');
    if (!next.length) next.push(progress >= 1 ? 'Close fieldwork and move to data processing.' : 'Keep the current pace; no action needed.');
    return {
      headline: `${f.code} ${f.name}: ${f.stage}, ${pct(progress)} of ${f.target.toLocaleString('en-US')} completes, ${f.daysLeft >= 0 ? `${f.daysLeft} days left` : `${-f.daysLeft} days past deadline`}.`,
      bullets: [
        `${f.audience} study in ${f.countries.join(', ')} · IR ${pct(f.ir)} · LOI ${f.loi} min.`,
        `${f.completes.toLocaleString('en-US')} completes delivered, ${remaining.toLocaleString('en-US')} to go${f.daysLeft > 0 && remaining ? ` (about ${perDay} a day)` : ''}.`,
        `${f.vendors} sample source${f.vendors === 1 ? '' : 's'} allocated; ${f.quotas.length} quota cell${f.quotas.length === 1 ? '' : 's'} tracked.`,
      ],
      risks,
      nextSteps: next,
    };
  },
};

// ───────────────────────── Open-end codeframe
const Codeframe = z.object({
  codes: z.array(z.object({
    code: z.string().describe('short id such as C1'),
    label: z.string().describe('theme name a client would understand'),
    keywords: z.array(z.string()).describe('single lowercase words that signal this theme in an answer'),
  })),
});
export type CodeframeOut = z.infer<typeof Codeframe>;

export const openEndCodeframe: AiTask<{ question: string; answers: string[]; maxCodes: number }, CodeframeOut> = {
  name: 'openend.codeframe',
  version: 1,
  description: 'Open-ended answers → draft codeframe (themes and keywords) for a coder to review',
  schema: Codeframe,
  maxTokens: 8000,
  system: [
    'You build codeframes for market-research open-ended answers.',
    'Group answers into distinct, mutually exclusive themes. Name each theme in plain words. Do not invent themes that no answer supports.',
    'Keywords must be single lowercase words that appear in the answers; they are used for automatic first-pass coding, which a human coder reviews.',
  ].join('\n'),
  render: ({ question, answers, maxCodes }) => `<question>${question}</question>\nAt most ${maxCodes} codes.\n<answers>\n${answers.map((a) => `- ${a}`).join('\n')}\n</answers>`,
  rules: ({ answers, maxCodes }) => ({ codes: suggestCodeframe(answers, maxCodes) }),
};

export const tasks = [rfqExtract, questionnaireStructure, projectSummary, openEndCodeframe, ...supplyTasks];
