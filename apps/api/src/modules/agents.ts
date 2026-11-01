/**
 * Automation agents that actually run.
 *
 * Each agent is a deterministic job over the workspace's records. It runs on its schedule from the
 * worker (claimed with a conditional update, so several workers never run one twice) or on demand,
 * and every run is logged in AgentRun with what it examined and what it produced. Agents never take
 * a consequential action themselves: they notify people, or open an approval (rejecting
 * respondents, high-volume messages) that a person decides, exactly as a team member's request would.
 *
 * Agents start paused. Agents whose job needs something not available here (a language model, or a
 * person's judgement such as a vendor's feasibility answer) are listed but cannot be turned on, and
 * say why.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Logger, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { runQA, type Role, type SurveyDef } from '@sampledge/core';
import { Prisma, type Agent } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';
import { parse } from '../common/zod';
import { CommsService } from './comms';
import { InsightsService, type KpiKey } from './insights';

type Tx = Prisma.TransactionClient;
const day = 86400_000;
const FIELD = ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'];

/** What one run did. */
export type RunResult = { summary: string; examined: number; notifications: number; approvals: number; messages: number };
type RunCtx = { tx: Tx; tenantId: string; agent: Agent; settings: Record<string, number>; now: Date; notify: (roles: Role[], title: string, body: string, module: string, dedupeDays?: number) => Promise<boolean> };

type Def = {
  key: string;
  name: string;
  description: string;
  everyMinutes: number;
  requiresApproval: string[];
  /** null: listed but cannot run here, with the reason */
  run: ((c: RunCtx, svc: AgentsService) => Promise<RunResult>) | null;
  unavailable?: string;
  settings?: z.ZodObject<Record<string, z.ZodType<number>>>;
};

const result = (summary: string, r: Partial<RunResult> = {}): RunResult => ({ summary, examined: 0, notifications: 0, approvals: 0, messages: 0, ...r });
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

export const AGENTS: Def[] = [
  {
    key: 'respondent-quality', name: 'Respondent Quality Agent', everyMinutes: 60, requiresApproval: ['Rejecting respondents'],
    description: 'Finds completed interviews with several quality flags (speeding, straightlining, duplicate device, gibberish) and asks for approval to reject them, one request per survey.',
    settings: z.object({ minFlags: z.number().int().min(1).max(4).default(2) }),
    async run(c) {
      const rows = await c.tx.response.findMany({ where: { tenantId: c.tenantId, outcome: 'complete', rejectedAt: null, NOT: { flags: { isEmpty: true } } }, select: { id: true, surveyId: true, flags: true }, take: 2000 });
      const bad = rows.filter((r) => r.flags.length >= c.settings.minFlags);
      // Interviews already put to a person by this agent (pending or decided) are not asked about again.
      const asked = new Set((await c.tx.approval.findMany({ where: { tenantId: c.tenantId, agentId: c.agent.id, kind: 'Rejecting respondents' }, select: { payload: true } }))
        .flatMap((a) => ((a.payload as { responseIds?: string[] } | null)?.responseIds ?? [])));
      const fresh = bad.filter((r) => !asked.has(r.id));
      const bySurvey = new Map<string, string[]>();
      for (const r of fresh) bySurvey.set(r.surveyId, [...(bySurvey.get(r.surveyId) ?? []), r.id]);
      let approvals = 0;
      for (const [surveyId, ids] of bySurvey) {
        const s = await c.tx.survey.findUnique({ where: { id: surveyId }, select: { name: true, projectId: true } });
        await requestApproval(c.tx, { tenantId: c.tenantId, kind: 'Rejecting respondents', agentId: c.agent.id, requestedBy: `agent:${c.agent.id}`, projectId: s?.projectId ?? null,
          title: `Reject ${plural(ids.length, 'interview')} with ${c.settings.minFlags}+ quality flags (${s?.name ?? surveyId})`, payload: { surveyId, responseIds: ids.slice(0, 500) } });
        approvals++;
      }
      return result(fresh.length ? `Asked to reject ${plural(fresh.length, 'flagged interview')} in ${plural(approvals, 'survey')}` : `No new interviews with ${c.settings.minFlags}+ flags`, { examined: rows.length, approvals });
    },
  },
  {
    key: 'project-health', name: 'Project Management Agent', everyMinutes: 60, requiresApproval: [],
    description: 'Watches projects in field: warns project managers when a quota cell is nearly full or completes fall behind the elapsed field time.',
    settings: z.object({ quotaAlert: z.number().min(0.5).max(0.99).default(0.9), paceGap: z.number().min(0.05).max(0.5).default(0.15) }),
    async run(c) {
      const projects = await c.tx.project.findMany({ where: { tenantId: c.tenantId, stage: { in: FIELD } }, include: { quotas: true } });
      let n = 0;
      for (const p of projects) {
        for (const q of p.quotas) {
          if (q.target <= 0) continue;
          const fill = q.count / q.target;
          if (fill >= c.settings.quotaAlert && fill < 1 && (await c.notify(['project_manager'], `Quota "${q.label}" is ${Math.round(fill * 100)}% full`, `${p.code} ${p.name}: ${q.count} of ${q.target}. Consider closing the cell or rebalancing sample.`, 'projects', 1))) n++;
        }
        const elapsed = Math.min(1, Math.max(0, (c.now.getTime() - p.start.getTime()) / Math.max(1, p.deadline.getTime() - p.start.getTime())));
        const done = p.target ? p.completes / p.target : 1;
        if (elapsed > 0.2 && done < elapsed - c.settings.paceGap && (await c.notify(['project_manager', 'executive'], `${p.code} is behind pace`, `${p.name}: ${Math.round(done * 100)}% of completes with ${Math.round(elapsed * 100)}% of field time gone (${p.completes} of ${p.target}).`, 'projects', 1))) n++;
      }
      return result(n ? `Raised ${plural(n, 'alert')} on ${plural(projects.length, 'project')} in field` : `${plural(projects.length, 'project')} in field, nothing to raise`, { examined: projects.length, notifications: n });
    },
  },
  {
    key: 'supplier-delivery', name: 'Vendor Recommendation Agent', everyMinutes: 240, requiresApproval: ['Purchasing sample'],
    description: 'Compares each live supplier allocation with the field time elapsed and tells project managers which suppliers are behind, so sample can be rebalanced.',
    settings: z.object({ paceGap: z.number().min(0.05).max(0.6).default(0.2) }),
    async run(c) {
      const allocs = await c.tx.allocation.findMany({ where: { tenantId: c.tenantId, status: 'live' }, include: { project: { select: { code: true, name: true, start: true, deadline: true } }, vendor: { select: { name: true } } } });
      let n = 0;
      for (const a of allocs) {
        const delivered = await c.tx.response.count({ where: { allocationId: a.id, outcome: 'complete', rejectedAt: null } });
        const elapsed = Math.min(1, Math.max(0, (c.now.getTime() - a.project.start.getTime()) / Math.max(1, a.project.deadline.getTime() - a.project.start.getTime())));
        const share = a.completes ? delivered / a.completes : 1;
        if (elapsed > 0.25 && share < elapsed - c.settings.paceGap && (await c.notify(['project_manager'], `${a.vendor.name} behind on ${a.project.code}`, `${delivered} of ${a.completes} completes delivered with ${Math.round(elapsed * 100)}% of field time gone. Consider moving sample to another supplier (purchases need approval).`, 'marketplace', 2))) n++;
      }
      return result(n ? `${plural(n, 'supplier')} behind plan` : `${plural(allocs.length, 'live allocation')} on plan`, { examined: allocs.length, notifications: n });
    },
  },
  {
    key: 'panel-engagement', name: 'Panel Engagement Agent', everyMinutes: 7 * 24 * 60, requiresApproval: ['High-volume communications'],
    description: 'Once a week, drafts a re-engagement e-mail to each panel\'s dormant members (consent-filtered) from the Re-engagement template. Large sends wait for approval in the Comms Hub.',
    async run(c, svc) {
      const tpl = await c.tx.messageTemplate.findFirst({ where: { tenantId: c.tenantId, key: 'panel_reengage' } });
      if (!tpl) return result('No "panel_reengage" message template in this workspace; nothing drafted');
      let messages = 0, approvals = 0, examined = 0;
      for (const brand of ['turn2opinion', 'myfrequentrewards', 'myhealthopinions']) {
        const target = `panel:${brand}:dormant`;
        const recent = await c.tx.message.findFirst({ where: { tenantId: c.tenantId, toRef: target, createdBy: c.agent.name, status: { not: 'cancelled' }, createdAt: { gte: new Date(c.now.getTime() - 7 * day) } } });
        if (recent) continue;
        const r = await svc.comms.sendAsAgent(c.tx, c.agent, { channel: 'email', audience: 'panel', target, subject: tpl.subject, body: tpl.body });
        if (!r) continue;
        examined += r.recipients;
        messages++;
        if (r.needsApproval) approvals++;
      }
      return result(messages ? `Drafted ${plural(messages, 're-engagement message')} to ${plural(examined, 'dormant member')}${approvals ? `; ${approvals} wait for approval` : ''}` : 'No dormant members to contact, or this week\'s messages already exist', { examined, messages, approvals });
    },
  },
  {
    key: 'survey-qa', name: 'Survey QA Agent', everyMinutes: 120, requiresApproval: ['Publishing surveys'],
    description: 'Runs the survey QA checks (dangling logic, unreachable questions, quota conflicts, simulated paths) on each new draft version and tells the programmers what it found.',
    async run(c) {
      const surveys = await c.tx.survey.findMany({ where: { tenantId: c.tenantId, status: { in: ['Draft', 'In QA'] }, hasDefinition: true }, select: { id: true, name: true, currentVersion: true } });
      const checked = { ...((c.agent.state as { checked?: Record<string, number> }).checked ?? {}) };
      let n = 0, examined = 0;
      for (const s of surveys) {
        if (checked[s.id] === s.currentVersion) continue;
        const v = await c.tx.surveyVersion.findUnique({ where: { surveyId_version: { surveyId: s.id, version: s.currentVersion } } });
        checked[s.id] = s.currentVersion;
        if (!v) continue;
        examined++;
        const { issues } = runQA(v.definition as unknown as SurveyDef, 200);
        const crit = issues.filter((i) => i.severity === 'critical').length, major = issues.filter((i) => i.severity === 'major').length;
        if (issues.length && (await c.notify(['survey_programmer'], `QA found ${plural(issues.length, 'issue')} in ${s.name} v${s.currentVersion}`, `${crit} critical, ${major} major, ${issues.length - crit - major} minor. Open the QA tab in Survey Studio to review.`, 'survey-studio', 0))) n++;
      }
      await c.tx.agent.update({ where: { id: c.agent.id }, data: { state: { ...(c.agent.state as object), checked } as Prisma.InputJsonValue } });
      return result(examined ? `Checked ${plural(examined, 'new survey version')}; ${n} with issues` : 'No new draft versions to check', { examined, notifications: n });
    },
  },
  {
    key: 'pipeline-followup', name: 'CRM and Bidding Agent', everyMinutes: 360, requiresApproval: ['Sending binding quotations'],
    description: 'Reminds business development about open opportunities nobody has touched for a while and supplier feasibility requests past their due date.',
    settings: z.object({ staleDays: z.number().int().min(2).max(90).default(14) }),
    async run(c) {
      const stale = await c.tx.opportunity.findMany({ where: { tenantId: c.tenantId, stage: { notIn: ['Won', 'Lost'] }, lastTouch: { lt: new Date(c.now.getTime() - c.settings.staleDays * day) } }, select: { id: true, title: true, stage: true, lastTouch: true } });
      const overdue = await c.tx.feasibilityRequest.findMany({ where: { tenantId: c.tenantId, status: 'sent', dueAt: { lt: c.now } }, select: { id: true, country: true, opportunityId: true } });
      let n = 0;
      for (const o of stale) if (await c.notify(['bizdev'], `Follow up: ${o.title}`, `${o.stage}; no activity for ${Math.floor((c.now.getTime() - o.lastTouch.getTime()) / day)} days.`, 'crm', 7)) n++;
      const byOpp = new Map<string, number>();
      for (const f of overdue) byOpp.set(f.opportunityId, (byOpp.get(f.opportunityId) ?? 0) + 1);
      for (const [oppId, k] of byOpp) {
        const o = await c.tx.opportunity.findUnique({ where: { id: oppId }, select: { title: true } });
        if (await c.notify(['bizdev'], `Feasibility overdue: ${o?.title ?? oppId}`, `${plural(k, 'supplier request')} past the due date without an answer.`, 'crm', 2)) n++;
      }
      return result(n ? `Raised ${plural(n, 'reminder')}` : 'Pipeline is up to date', { examined: stale.length + overdue.length, notifications: n });
    },
  },
  {
    key: 'finance-overdue', name: 'Finance Reconciliation Agent', everyMinutes: 360, requiresApproval: ['Issuing payments'],
    description: 'Flags issued invoices past their due date and open supplier payables past theirs, for the finance team to chase or pay (payments need approval).',
    async run(c) {
      const inv = await c.tx.invoice.findMany({ where: { tenantId: c.tenantId, status: 'issued', dueAt: { lt: c.now } }, select: { number: true, amount: true, currency: true, dueAt: true } });
      const pay = await c.tx.payable.findMany({ where: { tenantId: c.tenantId, status: 'open', dueAt: { lt: c.now } }, select: { id: true, amount: true, currency: true, dueAt: true, purchaseOrder: { select: { number: true } } } });
      let n = 0;
      for (const i of inv) if (await c.notify(['finance'], `Invoice ${i.number} is overdue`, `${i.currency} ${i.amount.toLocaleString('en-US')} was due ${i.dueAt!.toISOString().slice(0, 10)}.`, 'finance', 7)) n++;
      for (const p of pay) if (await c.notify(['finance'], `Payable on ${p.purchaseOrder.number} is overdue`, `${p.currency} ${p.amount.toLocaleString('en-US')} was due ${p.dueAt.toISOString().slice(0, 10)}. Paying it needs an Issuing payments approval.`, 'finance', 7)) n++;
      return result(inv.length + pay.length ? `${plural(inv.length, 'overdue invoice')}, ${plural(pay.length, 'overdue payable')}; ${n} new alerts` : 'Nothing overdue', { examined: inv.length + pay.length, notifications: n });
    },
  },
  {
    key: 'executive-digest', name: 'Executive Intelligence Agent', everyMinutes: 7 * 24 * 60, requiresApproval: [],
    description: 'Once a week, sends executives a digest of the business metrics with the change against the value recorded 30 days earlier.',
    async run(c, svc) {
      const k = await svc.insights.kpis(c.tenantId, c.now);
      const h = await svc.insights.history(c.tenantId, c.now);
      const line = (key: KpiKey, label: string, fmt: (n: number) => string) => {
        const p = h[key].prior;
        return `${label} ${fmt(k[key])}${p ? ` (${k[key] >= p ? '+' : ''}${Math.round(((k[key] - p) / Math.abs(p)) * 100)}% vs 30 days ago)` : ''}`;
      };
      const pct = (n: number) => `${Math.round(n * 100)}%`, num = (n: number) => Math.round(n).toLocaleString('en-US');
      const body = [line('active_projects', 'Active projects', num), line('pending_bids', 'pending bids', num), line('monthly_revenue', 'revenue this month', num), line('pending_invoices', 'pending invoices', num), line('delivery', 'field delivery on track', pct), line('incidence', 'incidence', pct)].join('; ');
      const sent = await c.notify(['executive', 'platform_admin'], `Weekly operations digest, ${c.now.toISOString().slice(0, 10)}`, `${body}.`, 'command-center', 0);
      return result('Sent the weekly digest', { examined: 14, notifications: sent ? 1 : 0 });
    },
  },
  { key: 'survey-programming', name: 'Survey Programming Agent', everyMinutes: 60, requiresApproval: ['Publishing surveys'], run: null, description: 'Turns a questionnaire document into a programmed survey draft.', unavailable: 'Runs on request from Survey Studio (questionnaire import). Scheduled runs need a language model: set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY.' },
  { key: 'feasibility', name: 'Research Feasibility Agent', everyMinutes: 60, requiresApproval: ['Purchasing sample'], run: null, description: 'Collects supplier feasibility for open opportunities.', unavailable: 'Feasibility answers come from vendors themselves (Vendor Portal); requests are sent from the CRM. Not automated.' },
  { key: 'data-processing', name: 'Data Processing Agent', everyMinutes: 60, requiresApproval: ['Releasing sensitive datasets'], run: null, description: 'Weighting, coding and recodes.', unavailable: 'Weighting and coding are set up by the data processing team in Data Processing. Not automated.' },
  { key: 'reporting', name: 'Reporting Agent', everyMinutes: 60, requiresApproval: ['Releasing sensitive datasets'], run: null, description: 'Report delivery to clients.', unavailable: 'Recurring reports run as scheduled deliveries (Client Portal → Scheduled delivery), not as an agent.' },
];
const byKey = new Map(AGENTS.map((a) => [a.key, a]));

const PatchBody = z.object({ enabled: z.boolean().optional(), everyMinutes: z.number().int().min(5).max(7 * 24 * 60 * 4).optional(), settings: z.record(z.string(), z.number()).optional() }).strict();

@Injectable()
export class AgentsService {
  private log = new Logger('Agents');
  constructor(private db: PrismaService, private audit: AuditService, readonly comms: CommsService, readonly insights: InsightsService) {}

  /** Makes sure every built-in agent has a row in this workspace (new workspaces start with none). */
  async ensure(tenantId: string) {
    const have = new Set((await this.db.agent.findMany({ where: { tenantId }, select: { key: true } })).map((a) => a.key));
    const missing = AGENTS.filter((a) => !have.has(a.key));
    if (missing.length) await this.db.agent.createMany({ data: missing.map((a) => ({ id: `ag-${tenantId.slice(-6)}-${a.key}`, tenantId, key: a.key, name: a.name, enabled: false, requiresApproval: a.requiresApproval, everyMinutes: a.everyMinutes })), skipDuplicates: true });
  }

  private settingsOf(def: Def, a: Agent) {
    return def.settings ? def.settings.parse(a.settings ?? {}) : {};
  }

  async list(ctx: Ctx, now = new Date()) {
    await this.ensure(ctx.tenantId);
    const rows = await this.db.agent.findMany({ where: { tenantId: ctx.tenantId } });
    const since = new Date(now.getTime() - 30 * day);
    const stats = await this.db.agentRun.groupBy({ by: ['agentId', 'status'], where: { tenantId: ctx.tenantId, startedAt: { gte: since } }, _count: true, _avg: { ms: true }, _sum: { notifications: true, approvals: true, messages: true } });
    const order = new Map(AGENTS.map((a, i) => [a.key, i]));
    return rows.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99)).map((a) => {
      const def = byKey.get(a.key);
      const s = stats.filter((x) => x.agentId === a.id);
      const runs = s.reduce((n, x) => n + x._count, 0), ok = s.find((x) => x.status === 'succeeded')?._count ?? 0;
      return {
        id: a.id, key: a.key, name: a.name, description: def?.description ?? '', enabled: a.enabled, available: !!def?.run, unavailable: def?.unavailable ?? null,
        requiresApprovalFor: a.requiresApproval, everyMinutes: a.everyMinutes, settings: def ? this.settingsOf(def, a) : {}, nextRunAt: a.nextRunAt, lastRunAt: a.lastRunAt,
        runs30d: runs, successRate: runs ? ok / runs : null, avgMs: runs ? Math.round(s.reduce((n, x) => n + (x._avg.ms ?? 0) * x._count, 0) / runs) : null,
        produced30d: { notifications: s.reduce((n, x) => n + (x._sum.notifications ?? 0), 0), approvals: s.reduce((n, x) => n + (x._sum.approvals ?? 0), 0), messages: s.reduce((n, x) => n + (x._sum.messages ?? 0), 0) },
      };
    });
  }

  async runs(ctx: Ctx, agentId?: string) {
    return this.db.agentRun.findMany({ where: { tenantId: ctx.tenantId, ...(agentId ? { agentId } : {}) }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: 50, include: { agent: { select: { name: true } } } });
  }

  /** Runs per day for the last 14 days, by outcome. */
  async daily(ctx: Ctx, now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 13 * day);
    const rows = await this.db.agentRun.findMany({ where: { tenantId: ctx.tenantId, startedAt: { gte: start } }, select: { startedAt: true, status: true } });
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start.getTime() + i * day), e = d.getTime() + day;
      const inDay = rows.filter((r) => r.startedAt.getTime() >= d.getTime() && r.startedAt.getTime() < e);
      return { day: d.toISOString().slice(0, 10), succeeded: inDay.filter((r) => r.status === 'succeeded').length, failed: inDay.filter((r) => r.status === 'failed').length };
    });
  }

  async update(ctx: Ctx, id: string, b: z.infer<typeof PatchBody>) {
    const a = await this.db.agent.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Agent not found');
    const def = byKey.get(a.key);
    if (b.enabled && !def?.run) throw new BadRequestException(def?.unavailable ?? 'This agent cannot run here');
    let settings: Record<string, number> | undefined;
    if (b.settings) {
      if (!def?.settings) throw new BadRequestException('This agent has no settings');
      const r = def.settings.strict().safeParse({ ...(a.settings as object), ...b.settings });
      if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      settings = r.data as Record<string, number>;
    }
    const everyMinutes = b.everyMinutes ?? a.everyMinutes;
    const enabled = b.enabled ?? a.enabled;
    // Turning an agent on (or changing its schedule) runs it at the next worker check.
    const nextRunAt = enabled ? (b.enabled && !a.enabled ? new Date() : b.everyMinutes ? new Date(Date.now() + everyMinutes * 60_000) : a.nextRunAt ?? new Date()) : null;
    return this.db.$transaction(async (tx) => {
      const u = await tx.agent.update({ where: { id }, data: { enabled, everyMinutes, nextRunAt, ...(settings ? { settings } : {}) } });
      await this.audit.log(ctx, b.enabled === undefined ? 'agent.configure' : b.enabled ? 'agent.enable' : 'agent.disable', 'Agent', id,
        { enabled: a.enabled, everyMinutes: a.everyMinutes, settings: a.settings }, { enabled, everyMinutes, settings: settings ?? a.settings }, tx);
      return u;
    });
  }

  /** Runs one agent now, as the caller asked. */
  async runNow(ctx: Ctx, id: string) {
    const a = await this.db.agent.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Agent not found');
    const def = byKey.get(a.key);
    if (!def?.run) throw new BadRequestException(def?.unavailable ?? 'This agent cannot run here');
    const run = await this.execute(a, 'manual', ctx.name);
    await this.audit.log(ctx, 'agent.run', 'Agent', id, undefined, { runId: run.id, status: run.status, summary: run.summary });
    return run;
  }

  /** Worker: runs every enabled agent that is due, once each. Returns how many ran. */
  async runDue(now = new Date()) {
    const due = await this.db.agent.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 50, orderBy: { nextRunAt: 'asc' } });
    let ran = 0;
    for (const a of due) {
      await asTenant(a.tenantId, async () => {
        const claimed = await this.db.agent.updateMany({ where: { id: a.id, enabled: true, nextRunAt: a.nextRunAt }, data: { nextRunAt: new Date(now.getTime() + a.everyMinutes * 60_000) } });
        if (!claimed.count || !byKey.get(a.key)?.run) return;
        ran++;
        await this.execute(a, 'schedule', null, now);
      });
    }
    return ran;
  }

  /** One run in its own transaction; a failure rolls back what it did and is logged as failed. */
  async execute(a: Agent, trigger: 'schedule' | 'manual', by: string | null, now = new Date()) {
    const def = byKey.get(a.key)!;
    const t0 = Date.now();
    let r: RunResult, status = 'succeeded', error: string | null = null;
    try {
      r = await this.db.$transaction(async (tx) => {
        const notify: RunCtx['notify'] = async (roles, title, body, module, dedupeDays = 1) => {
          if (dedupeDays > 0 && (await tx.notification.findFirst({ where: { tenantId: a.tenantId, title, createdAt: { gte: new Date(now.getTime() - dedupeDays * day) } } }))) return false;
          await tx.notification.create({ data: { tenantId: a.tenantId, roles, title, body: `${body} (${a.name})`, module } });
          return true;
        };
        const fresh = await tx.agent.findUniqueOrThrow({ where: { id: a.id } });
        return def.run!({ tx, tenantId: a.tenantId, agent: fresh, settings: this.settingsOf(def, fresh) as Record<string, number>, now, notify }, this);
      }, { timeout: 60_000 });
    } catch (e) {
      status = 'failed';
      error = String((e as Error).message).slice(0, 500);
      r = result('Run failed; nothing it did was kept');
      this.log.warn(`agent ${a.key} in ${a.tenantId} failed: ${error}`);
    }
    const run = await this.db.agentRun.create({ data: { tenantId: a.tenantId, agentId: a.id, trigger, triggeredBy: by, status, ms: Date.now() - t0, error, ...r } });
    await this.db.agent.update({ where: { id: a.id }, data: { lastRunAt: now } });
    return run;
  }
}

@ForModule('automation')
@Controller('agents')
export class AgentsController {
  constructor(private s: AgentsService) {}
  @Get() list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
  @Get('runs') runs(@Caller() ctx: Ctx, @Query('agentId') agentId?: string) { return this.s.runs(ctx, agentId); }
  @Get('daily') daily(@Caller() ctx: Ctx) { return this.s.daily(ctx); }
  @Patch(':id') @Write() @RequirePerm('edit:automations')
  update(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.update(ctx, id, parse(PatchBody, b)); }
  @Post(':id/run') @Write() @RequirePerm('edit:automations')
  run(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.runNow(ctx, id); }
}

