/**
 * Phase 2 assistant: a deterministic intent router over the store's records.
 * There is NO language model behind it yet. It never invents numbers: every figure is computed
 * from records passed in, and each answer lists the record ids it used. When it cannot answer
 * from data, it says so. Phase 5 replaces `route()` with the provider-independent AI gateway
 * using the same "tools" (the functions below) via tool calling.
 */
import { clients, lifecycle, monthlyRevenue, months, vendors, DEMO_NOW, type Opportunity, type Project } from './demo/data';
import { can, type Role } from './roles';
import { fmtMoney, fmtPct } from './utils';

export type AssistantAnswer = {
  title: string;
  text: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  sources: string[];
  link?: { href: string; label: string };
  unavailable?: boolean;
};

type Ctx = { role: Role; projects: Project[]; opportunities: Opportunity[] };

const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
const days = (d: string) => Math.round((new Date(d).getTime() - DEMO_NOW.getTime()) / 86400000);
const closed = (p: Project) => ['Invoice', 'Project Closure', 'Client Sign-off'].includes(p.stage);

export const suggestions = [
  'Show projects likely to miss their deadlines.',
  'Which vendors have the best quality scores?',
  "Summarize today's revenue.",
  'Identify projects with low incidence rates.',
  'Show surveys with high dropout rates.',
  'Prepare a weekly operations summary.',
];

export function deadlineRisk(projects: Project[]) {
  return projects
    .filter((p) => !closed(p))
    .map((p) => {
      const total = Math.max(1, days(p.deadline) - days(p.start));
      const elapsed = Math.min(1, Math.max(0, -days(p.start) / total));
      // delivery progress: furthest of lifecycle position and fieldwork completion
      const progress = Math.max(lifecycle.indexOf(p.stage) / (lifecycle.length - 1), p.completes / p.target);
      const gap = elapsed - progress;
      return { p, left: days(p.deadline), elapsed, progress, gap };
    })
    .filter((x) => x.left < 0 || (x.left <= 10 && x.gap > 0.25) || x.p.blockers.length > 0 && x.left <= 14)
    .sort((a, b) => a.left - b.left);
}

export function route(q: string, ctx: Ctx): AssistantAnswer {
  const t = q.toLowerCase();
  const margins = can(ctx.role, 'view:margins');

  if (/deadline|late|miss|overdue|delay/.test(t)) {
    const r = deadlineRisk(ctx.projects);
    return {
      title: 'Projects at deadline risk',
      text: r.length
        ? `${r.length} open projects are at risk. Rule: overdue, or ≤10 days left with progress trailing elapsed time by >25 pts, or blocked with ≤14 days left.`
        : 'No open projects meet the deadline-risk rule right now.',
      table: { columns: ['Project', 'Owner', 'Days left', 'Progress', 'Elapsed', 'Blocker'], rows: r.map((x) => [x.p.name, x.p.owner, x.left, fmtPct(x.progress, 0), fmtPct(x.elapsed, 0), x.p.blockers[0] ?? '—']) },
      sources: r.map((x) => x.p.id),
      link: { href: '/projects', label: 'Open in Projects' },
    };
  }
  if (/vendor|supplier/.test(t) && /quality|best|top|rank/.test(t)) {
    const v = [...vendors].sort((a, b) => b.quality - a.quality).slice(0, 6);
    return {
      title: 'Vendors ranked by quality score',
      text: `Quality score = share of delivered completes passing respondent-quality checks (trailing 90 days, demo). Top: ${v[0].name} at ${fmtPct(v[0].quality)}.`,
      table: { columns: ['Vendor', 'Quality', 'Reliability', 'Response rate', 'Markets'], rows: v.map((x) => [x.name, fmtPct(x.quality), fmtPct(x.reliability), fmtPct(x.responseRate), x.coverage.length]) },
      sources: v.map((x) => x.id),
      link: { href: '/marketplace', label: 'Open Sample Exchange' },
    };
  }
  if (/revenue|sales|income/.test(t)) {
    const cur = monthlyRevenue[11], prev = monthlyRevenue[10];
    const won = ctx.opportunities.filter((o) => o.stage === 'Won');
    const today = /today/.test(t);
    return {
      title: today ? "Today's revenue" : 'Revenue summary',
      text: `${today ? 'Daily revenue is not recorded in the demo ledger, so I cannot report a figure for today. ' : ''}Month-to-date (${months[11]}) recognised revenue is ${fmtMoney(cur)}, ${cur >= prev ? 'up' : 'down'} ${fmtPct(Math.abs(cur / prev - 1))} vs ${months[10]}. ${won.length} opportunities are marked Won, worth ${fmtMoney(won.reduce((s, o) => s + o.value, 0))}${margins ? ` at an average margin of ${fmtPct(won.reduce((s, o) => s + o.margin, 0) / Math.max(1, won.length))}` : ''}.`,
      table: { columns: ['Won opportunity', 'Client', 'Value', ...(margins ? ['Margin'] : [])], rows: won.map((o) => [o.title, clientName(o.clientId), fmtMoney(o.value), ...(margins ? [fmtPct(o.margin)] : [])]) },
      sources: ['ledger:monthly-revenue', ...won.map((o) => o.id)],
      link: { href: '/crm', label: 'Open Bidding CRM' },
    };
  }
  if (/incidence|\bir\b/.test(t)) {
    const r = ctx.projects.filter((p) => p.ir < 0.15 && !closed(p)).sort((a, b) => a.ir - b.ir);
    return {
      title: 'Projects with low incidence',
      text: `${r.length} open projects have incidence below 15%. Healthcare and senior B2B audiences account for ${r.filter((p) => p.type !== 'B2C').length} of them.`,
      table: { columns: ['Project', 'Type', 'IR', 'Completes', 'Target'], rows: r.map((p) => [p.name, p.type, fmtPct(p.ir), p.completes, p.target]) },
      sources: r.map((p) => p.id),
      link: { href: '/projects', label: 'Open in Projects' },
    };
  }
  if (/dropout|drop-off|abandon/.test(t)) {
    const r = ctx.projects.filter((p) => p.dropout > 0.22 && p.completes > 0).sort((a, b) => b.dropout - a.dropout);
    return {
      title: 'Surveys with high dropout',
      text: `${r.length} fielding surveys have dropout above 22%. Average LOI on these is ${Math.round(r.reduce((s, p) => s + p.loi, 0) / Math.max(1, r.length))} min vs ${Math.round(ctx.projects.reduce((s, p) => s + p.loi, 0) / ctx.projects.length)} min overall.`,
      table: { columns: ['Survey / project', 'Dropout', 'LOI (min)', 'Owner'], rows: r.map((p) => [p.name, fmtPct(p.dropout), p.loi, p.owner]) },
      sources: r.map((p) => p.id),
      link: { href: '/survey-studio', label: 'Open Survey Studio' },
    };
  }
  if (/weekly|summary|report|operations/.test(t)) {
    const open = ctx.projects.filter((p) => !closed(p));
    const field = ctx.projects.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
    const risk = deadlineRisk(ctx.projects);
    const pipe = ctx.opportunities.filter((o) => !['Won', 'Lost'].includes(o.stage));
    return {
      title: 'Weekly operations summary (draft)',
      text: [
        `• ${open.length} open projects; ${field.length} in field with ${field.reduce((s, p) => s + p.completes, 0).toLocaleString()} of ${field.reduce((s, p) => s + p.target, 0).toLocaleString()} completes.`,
        `• ${risk.length} projects at deadline risk; top: ${risk[0]?.p.name ?? 'none'}.`,
        `• ${pipe.length} open opportunities, weighted pipeline ${fmtMoney(pipe.reduce((s, o) => s + o.value * o.probability, 0))}.`,
        `• ${ctx.projects.reduce((s, p) => s + p.blockers.length, 0)} active blockers logged.`,
        'Draft generated from records only; edit before sending.',
      ].join('\n'),
      sources: [...open.map((p) => p.id), ...pipe.map((o) => o.id)].slice(0, 30),
      link: { href: '/projects', label: 'Open Projects' },
    };
  }
  return {
    title: 'I can’t answer that from the available data yet',
    text: 'This demo assistant answers from platform records only and has no language model connected. Try one of the suggested questions, or rephrase around projects, vendors, revenue, incidence, dropout or a weekly summary.',
    sources: [],
    unavailable: true,
  };
}
