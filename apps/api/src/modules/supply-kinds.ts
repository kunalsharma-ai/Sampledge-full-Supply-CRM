/**
 * The SUPPLY360 record kinds (see supply-records.ts for how records work). Importing this file
 * registers them. Kinds that need effects beyond their own record (suspending a panellist,
 * queueing a message) define them here, inside the action's transaction.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { queueMessage, resolveTarget } from './comms';
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
