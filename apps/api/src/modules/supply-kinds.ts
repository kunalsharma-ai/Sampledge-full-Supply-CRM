/**
 * The SUPPLY360 record kinds (see supply-records.ts for how records work). Importing this file
 * registers them. Kinds that need effects beyond their own record (suspending a panellist,
 * queueing a message) define them here, inside the action's transaction.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { queueMessage, resolveTarget } from './comms';
import { graphProblems, type WorkflowData } from './workflows';
import { registerKind, type RecordAction } from './supply-records';

const email = z.string().trim().toLowerCase().email('Not an e-mail address').max(200);
const panelShort = z.enum(['T2O', 'MFR', 'MHO']);
const brand = z.enum(['turn2opinion', 'myfrequentrewards', 'myhealthopinions']);
const AR = z.string().regex(/^AR-[0-9A-HJKMNP-TV-Z]{26}$/, 'An audience request id (AR-…)');

// ───────────────────────── Weekly rewards programme (panels)
/** ISO week, e.g. 2026-W46. */
export const isoWeek = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, 'A week like 2026-W46');
registerKind('weekly', {
  label: 'Weekly programme week', module: 'panels', prefix: 'WK',
  data: z.object({
    week: isoWeek,
    template: z.string().trim().min(2).max(60),
    topics: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
    brands: z.array(brand).min(1).max(3).default(['turn2opinion', 'myfrequentrewards', 'myhealthopinions']),
    /** set when SampAudience runs the week's survey; its invitations and completes are then counted */
    audienceRequestId: AR.optional(),
    note: z.string().trim().max(300).optional(),
  }).strict(),
  title: (d) => `${d.week} · ${d.template}`,
  statuses: ['planned', 'scheduled', 'sent', 'cancelled'], initial: 'planned', editableIn: ['planned', 'scheduled'],
  unique: (d) => String(d.week),
  actions: {
    schedule: { from: ['planned'], to: 'scheduled' },
    unschedule: { from: ['scheduled'], to: 'planned' },
    mark_sent: { from: ['scheduled'], to: 'sent', body: z.object({ audienceRequestId: AR }).strict(), effect: async (_tx, _ctx, _r, b) => ({ audienceRequestId: b.audienceRequestId }) },
    cancel: { from: ['planned', 'scheduled'], to: 'cancelled' },
  },
});

// ───────────────────────── Saved reports (analytics)
export const reportMetrics = ['completes', 'starts', 'cr', 'invites', 'signups', 'points', 'cpc'] as const;
export const reportDims = ['panel', 'country', 'week', 'source'] as const;
registerKind('report', {
  label: 'Saved report', module: 'analytics', prefix: 'RPT',
  data: z.object({
    name: z.string().trim().min(2).max(80),
    metric: z.enum(reportMetrics),
    rows: z.enum(reportDims),
    cols: z.enum(reportDims).nullable(),
    chart: z.enum(['bar', 'line', 'table']),
    panels: z.array(panelShort).max(3).default([]),
    schedule: z.enum(['off', 'daily', 'weekly', 'monthly']).default('off'),
    recipients: z.array(email).max(20).default([]),
  }).strict()
    .refine((d) => d.rows !== d.cols, { message: 'Rows and columns must be different', path: ['cols'] })
    .refine((d) => d.schedule === 'off' || d.recipients.length > 0, { message: 'Add at least one recipient for a scheduled report', path: ['recipients'] }),
  title: (d) => String(d.name),
  statuses: ['active', 'archived'], initial: 'active', editableIn: ['active'],
  actions: {
    archive: { from: ['active'], to: 'archived' },
    restore: { from: ['archived'], to: 'active' },
  },
});

// ───────────────────────── Communications: e-mail campaigns and newsletters
const brandName: Record<string, string> = { turn2opinion: 'Turn2Opinion', myfrequentrewards: 'MyFrequentRewards', myhealthopinions: 'MyHealthOpinions' };
const isoFuture = z.string().datetime({ offset: true, message: 'A date and time' }).refine((v) => new Date(v).getTime() > Date.now() - 60_000, 'Pick a time in the future');
/** Subject rules the screen also shows: required, short enough for phones, no spam-trigger words. */
export const subjectProblem = (v: string) => (!v.trim() ? 'A subject is required' : v.length > 70 ? 'Over 70 characters gets cut off on most phones' : /free|\$\$\$|!!!/i.test(v) ? 'Words like this trip spam filters' : null);
/** Fields the server writes when it sends or fails; kept through later edits of a failed record. */
const sentFields = {
  sendAt: z.string().datetime({ offset: true }).optional(),
  messageId: z.string().max(40).optional(), recipients: z.number().int().optional(), needsApproval: z.boolean().optional(),
  sentAt: z.string().max(40).optional(), error: z.string().max(400).optional(),
};
const block = z.object({ id: z.string().max(40), kind: z.enum(['heading', 'text', 'button', 'image', 'survey', 'divider']), text: z.string().max(2000) }).strict();
/**
 * The text body a campaign is sent with. Merge fields: {{panel_name}} is the brand, and
 * {{first_name}} becomes "there", because SUPPLY360 holds pseudonymous handles, not names.
 */
export const renderBlocks = (blocks: z.infer<typeof block>[], b: string) => blocks.map((x) => {
  const t = x.text.replaceAll('{{panel_name}}', brandName[b] ?? b).replaceAll('{{first_name}}', 'there');
  return x.kind === 'heading' ? `## ${t}` : x.kind === 'button' ? `[${t}]` : x.kind === 'divider' ? '---' : x.kind === 'image' ? '' : t;
}).filter(Boolean).join('\n\n');

type Send = { brand: string; segment: string; subject: string; body: string };
async function sendToPanel(tx: Parameters<NonNullable<RecordAction['effect']>>[0], ctx: Parameters<NonNullable<RecordAction['effect']>>[1], recId: string, s: Send) {
  const target = `panel:${s.brand}:${s.segment}`;
  const r = await resolveTarget(tx, ctx, 'panel', target);
  if (!r.recipients) throw new BadRequestException('Nobody in this audience can receive it (after consent filtering)');
  const q = await queueMessage(tx, ctx, { channel: 'email', audience: 'panel', target, subject: s.subject, body: s.body }, r, { relatedType: 'SupplyRecord', relatedId: recId });
  return { messageId: q.message.id, recipients: q.recipients, needsApproval: q.needsApproval, sentAt: new Date().toISOString(), error: undefined };
}

const campaignSend: RecordAction['effect'] = async (tx, ctx, rec) => {
  const d = rec.data as { brand: string; segment: string; subjectA: string; subjectB?: string; blocks: z.infer<typeof block>[] };
  const problems = [subjectProblem(d.subjectA), d.subjectB ? 'A/B subject tests are not in the live sender yet; clear subject B to send' : null,
    !d.blocks.some((b) => b.kind === 'button') ? 'Add a button so members can act' : null,
    !d.blocks.some((b) => /email settings|unsubscribe/i.test(b.text)) ? 'Add an unsubscribe or email-settings line' : null].filter(Boolean);
  if (problems.length) throw new BadRequestException(problems.join('; '));
  return sendToPanel(tx, ctx, rec.id, { brand: d.brand, segment: d.segment, subject: d.subjectA, body: renderBlocks(d.blocks, d.brand) });
};
registerKind('campaign', {
  label: 'E-mail campaign', module: 'communications', prefix: 'EM',
  data: z.object({
    name: z.string().trim().min(2).max(80),
    brand,
    /** panel members by status; consent is always filtered at send */
    segment: z.enum(['active', 'dormant', 'all']).default('active'),
    subjectA: z.string().trim().max(120).default(''),
    subjectB: z.string().trim().max(120).optional(),
    split: z.number().int().min(5).max(50).default(20),
    blocks: z.array(block).max(40).default([]),
    /** sendAt: when set and the campaign is scheduled, the scheduler sends it then */
    ...sentFields,
  }).strict(),
  title: (d) => String(d.name),
  statuses: ['draft', 'scheduled', 'sent', 'failed', 'cancelled'], initial: 'draft', editableIn: ['draft', 'failed'],
  actions: {
    schedule: { from: ['draft', 'failed'], to: 'scheduled', body: z.object({ sendAt: isoFuture }).strict(), effect: async (_tx, _ctx, rec, b) => {
      const d = rec.data as { subjectA: string; subjectB?: string };
      const p = subjectProblem(d.subjectA) ?? (d.subjectB ? 'A/B subject tests are not in the live sender yet; clear subject B to schedule' : null);
      if (p) throw new BadRequestException(p);
      return { sendAt: b.sendAt, error: undefined };
    } },
    unschedule: { from: ['scheduled'], to: 'draft' },
    send: { from: ['draft', 'scheduled', 'failed'], to: 'sent', effect: campaignSend },
    cancel: { from: ['draft', 'scheduled', 'failed'], to: 'cancelled' },
  },
  due: { status: 'scheduled', action: 'send', at: (d) => d.sendAt },
});

registerKind('newsletter', {
  label: 'Newsletter issue', module: 'communications', prefix: 'NL',
  data: z.object({
    title: z.string().trim().min(2).max(120),
    brand,
    stories: z.array(z.string().trim().min(2).max(160)).max(8).default([]),
    intro: z.string().trim().max(2000).optional(),
    ...sentFields,
  }).strict(),
  title: (d) => String(d.title),
  statuses: ['draft', 'review', 'scheduled', 'sent', 'failed', 'cancelled'], initial: 'draft', editableIn: ['draft', 'review', 'failed'],
  actions: {
    submit: { from: ['draft'], to: 'review', effect: async (_tx, _ctx, rec) => { if (!(rec.data as { stories: string[] }).stories.length) throw new BadRequestException('Add at least one story before review'); } },
    return: { from: ['review'], to: 'draft' },
    schedule: { from: ['review', 'failed'], to: 'scheduled', body: z.object({ sendAt: isoFuture }).strict(), effect: async (_tx, _ctx, _r, b) => ({ sendAt: b.sendAt, error: undefined }) },
    unschedule: { from: ['scheduled'], to: 'review' },
    send: { from: ['scheduled', 'review', 'failed'], to: 'sent', effect: async (tx, ctx, rec) => {
      const d = rec.data as { title: string; brand: string; stories: string[]; intro?: string };
      if (!d.stories.length) throw new BadRequestException('Add at least one story');
      const body = [d.intro ?? `This month at ${brandName[d.brand]}`, ...d.stories.map((s) => `• ${s}`), 'Change what we send you in your email settings.'].join('\n\n');
      return sendToPanel(tx, ctx, rec.id, { brand: d.brand, segment: 'all', subject: d.title, body });
    } },
    cancel: { from: ['draft', 'review', 'scheduled', 'failed'], to: 'cancelled' },
  },
  due: { status: 'scheduled', action: 'send', at: (d) => d.sendAt },
});

// ───────────────────────── Support tickets (panels)
type Tx = Parameters<NonNullable<RecordAction['effect']>>[0];
type EffectCtx = Parameters<NonNullable<RecordAction['effect']>>[1];
const panelistIn = async (tx: Tx, ctx: EffectCtx, id: unknown) => {
  const p = await tx.panelist.findFirst({ where: { id: String(id), tenantId: ctx.tenantId } });
  if (!p) throw new BadRequestException('No such panel member in this workspace');
  return p;
};
const msg = z.object({ from: z.enum(['member', 'agent', 'note']), author: z.string().max(120), text: z.string().max(5000), at: z.string().max(40) }).strict();
type Msg = z.infer<typeof msg>;
const text = z.object({ text: z.string().trim().min(1, 'Write something first').max(5000) }).strict();
const author = (ctx: EffectCtx) => ctx.name.replace(/ \(Demo\)$/, '');
const append = (rec: { data: unknown }, m: Omit<Msg, 'at'>) => ({ messages: [...((rec.data as { messages?: Msg[] }).messages ?? []), { ...m, at: new Date().toISOString() }] });
/** Hours to the first answer, by priority; the screen counts the SLA from when the ticket was opened. */
export const slaHours = { urgent: 4, high: 12, normal: 24, low: 72 } as const;

const reply = (solve: boolean): RecordAction => ({
  from: ['new', 'open', 'waiting'], to: solve ? 'solved' : 'waiting', body: text,
  effect: async (tx, ctx, rec, b, log) => {
    const d = rec.data as { subject: string; panelistId: string };
    const target = `panelist:${d.panelistId}`;
    const r = await resolveTarget(tx, ctx, 'panel', target);
    if (!r.recipients) throw new BadRequestException('This member asked to be deleted; record a note instead of replying');
    const q = await queueMessage(tx, ctx, { channel: 'email', audience: 'panel', target, subject: `Re: ${d.subject} [${rec.ref}]`, body: String(b.text) }, r, { relatedType: 'SupplyRecord', relatedId: rec.id });
    await log('message.create', 'Message', q.message.id, undefined, { to: target, recipients: 1, status: q.message.status, ticket: rec.ref });
    return append(rec, { from: 'agent', author: `${author(ctx)} (Support)`, text: String(b.text) });
  },
});
registerKind('ticket', {
  label: 'Support ticket', module: 'panels', prefix: 'TCK',
  data: z.object({
    subject: z.string().trim().min(3).max(160),
    category: z.enum(['Rewards', 'Survey issue', 'Account', 'Privacy', 'Technical']),
    priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
    channel: z.enum(['Email', 'In app', 'Chat', 'Phone']).default('Email'),
    /** pseudonymous member id; replies go to them through the Comms Hub */
    panelistId: z.string().min(1).max(40),
    messages: z.array(msg).max(200).default([]),
  }).strict(),
  title: (d) => String(d.subject),
  check: async (tx, ctx, d) => { await panelistIn(tx, ctx, d.panelistId); },
  statuses: ['new', 'open', 'waiting', 'solved'], initial: 'new', editableIn: ['new', 'open', 'waiting'],
  actions: {
    reply: reply(false),
    reply_solve: reply(true),
    note: { from: ['new', 'open', 'waiting', 'solved'], to: '=', body: text, effect: async (_tx, ctx, rec, b) => append(rec, { from: 'note', author: author(ctx), text: String(b.text) }) },
    /** what the member wrote, logged by the team (e-mail, phone or chat) */
    member: { from: ['new', 'open', 'waiting', 'solved'], to: 'open', body: text, effect: async (tx, ctx, rec, b) => append(rec, { from: 'member', author: (await panelistIn(tx, ctx, (rec.data as { panelistId: string }).panelistId)).handle, text: String(b.text) }) },
    open: { from: ['new', 'waiting'], to: 'open' },
    wait: { from: ['new', 'open'], to: 'waiting' },
    solve: { from: ['new', 'open', 'waiting'], to: 'solved' },
    reopen: { from: ['solved'], to: 'open' },
    /** a signed points adjustment on the member's ledger with the ticket as the reason; reversible only by another adjustment */
    goodwill: {
      from: ['new', 'open', 'waiting'], to: '=', body: z.object({ points: z.number().int().min(1).max(500) }).strict(),
      effect: async (tx, ctx, rec, b, log) => {
        const p = await panelistIn(tx, ctx, (rec.data as { panelistId: string }).panelistId);
        const points = Number(b.points);
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { pointValue: true } });
        const e = await tx.incentiveEntry.create({ data: { tenantId: ctx.tenantId, panelistId: p.id, kind: 'adjust', points, valueBase: Math.round(points * t.pointValue * 100) / 100, note: `Goodwill, support ticket ${rec.ref}`, createdBy: ctx.name } });
        await tx.panelist.update({ where: { id: p.id }, data: { points: { increment: points } } });
        await log('incentive.adjust', 'IncentiveEntry', e.id, { points: p.points }, { panelist: p.handle, points: p.points + points, delta: points, ticket: rec.ref });
        return append(rec, { from: 'note', author: author(ctx), text: `Granted ${points} goodwill points (ledger adjustment).` });
      },
    },
  },
});

// ───────────────────────── Quality cases (panels)
registerKind('quality_case', {
  label: 'Quality case', module: 'panels', prefix: 'QC',
  data: z.object({
    panelistId: z.string().min(1).max(40),
    /** what opened the case, e.g. "Quality score below 35" */
    rule: z.string().trim().min(3).max(120),
    /** risk at opening: 1 - the member's quality score */
    score: z.number().min(0).max(1),
    signals: z.array(z.string().trim().max(60)).max(10).default([]),
    note: z.string().trim().max(1000).optional(),
    /** set when suspended, so lifting the suspension restores it */
    priorStatus: z.enum(['active', 'dormant']).optional(),
    decidedReason: z.string().max(500).optional(),
  }).strict(),
  title: (d) => String(d.rule),
  check: async (tx, ctx, d) => { await panelistIn(tx, ctx, d.panelistId); },
  statuses: ['open', 'watching', 'suspended', 'cleared'], initial: 'open', editableIn: ['open', 'watching'],
  actions: {
    watch: { from: ['open'], to: 'watching' },
    suspend: {
      from: ['open', 'watching'], to: 'suspended', body: z.object({ reason: z.string().trim().min(3, 'Say why').max(500) }).strict(),
      effect: async (tx, ctx, rec, b, log) => {
        const p = await panelistIn(tx, ctx, (rec.data as { panelistId: string }).panelistId);
        if (p.status !== 'active' && p.status !== 'dormant') throw new BadRequestException(`${p.handle} is ${p.status.replace('_', ' ')}, so cannot be suspended here`);
        await tx.panelist.update({ where: { id: p.id }, data: { status: 'suspended' } });
        await log('panelist.suspended', 'Panelist', p.id, { status: p.status }, { status: 'suspended', reason: b.reason, case: rec.ref });
        return { priorStatus: p.status as 'active' | 'dormant', decidedReason: String(b.reason) };
      },
    },
    clear: { from: ['open', 'watching'], to: 'cleared', body: z.object({ reason: z.string().trim().min(3, 'Say why').max(500) }).strict(), effect: async (_tx, _ctx, _r, b) => ({ decidedReason: String(b.reason) }) },
    reinstate: {
      from: ['suspended'], to: 'cleared', body: z.object({ reason: z.string().trim().min(3, 'Say why').max(500) }).strict(),
      effect: async (tx, ctx, rec, b, log) => {
        const d = rec.data as { panelistId: string; priorStatus?: 'active' | 'dormant' };
        const p = await panelistIn(tx, ctx, d.panelistId);
        if (p.status === 'suspended') {
          await tx.panelist.update({ where: { id: p.id }, data: { status: d.priorStatus ?? 'active' } });
          await log('panelist.reinstated', 'Panelist', p.id, { status: 'suspended' }, { status: d.priorStatus ?? 'active', reason: b.reason, case: rec.ref });
        }
        return { decidedReason: String(b.reason) };
      },
    },
    reopen: { from: ['cleared'], to: 'open' },
  },
});

// ───────────────────────── Engagement workflows (automation); the runner is modules/workflows.ts
const wfNode = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(['trigger', 'condition', 'delay', 'action']),
  type: z.string().min(1).max(40),
  config: z.record(z.string().max(40), z.union([z.string().max(500), z.number()])).default({}),
  x: z.number(), y: z.number(),
}).strict();
const wfEdge = z.object({ id: z.string().min(1).max(80), from: z.string().max(40), to: z.string().max(40), branch: z.enum(['yes', 'no']).optional() }).strict();
registerKind('workflow', {
  label: 'Workflow', module: 'automation', prefix: 'WF',
  data: z.object({
    name: z.string().trim().min(3).max(120),
    panel: z.enum(['all', 't2o', 'mfr', 'mho']).default('all'),
    nodes: z.array(wfNode).max(60).default([]),
    edges: z.array(wfEdge).max(120).default([]),
    /** members are enrolled only for trigger events after this time */
    activatedAt: z.string().datetime().optional(),
  }).strict(),
  title: (d) => String(d.name),
  statuses: ['draft', 'active', 'paused'], initial: 'draft', editableIn: ['draft', 'paused'],
  actions: {
    /** starts enrolling members; refused while the graph has a problem */
    activate: {
      from: ['draft', 'paused'], to: 'active',
      effect: async (_tx, _ctx, rec) => {
        const p = graphProblems(rec.data as unknown as WorkflowData);
        if (p.length) throw new BadRequestException(p.join('. '));
        return { activatedAt: new Date().toISOString() };
      },
    },
    /** runs stop at their next step until the workflow is active again */
    pause: { from: ['active'], to: 'paused' },
  },
});
