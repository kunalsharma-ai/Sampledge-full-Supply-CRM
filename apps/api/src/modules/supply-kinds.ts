/**
 * The SUPPLY360 record kinds (see supply-records.ts for how records work). Importing this file
 * registers them. Kinds that need effects beyond their own record (suspending a panellist,
 * queueing a message) define them here, inside the action's transaction.
 */
import { z } from 'zod';
import { registerKind } from './supply-records';

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
