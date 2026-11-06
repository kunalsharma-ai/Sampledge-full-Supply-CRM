import { BadRequestException, Body, Controller, Get, Header, HttpCode, Injectable, NotFoundException, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { applyRecodes, gaborGranger, turf, vanWestendorp, type Recode, flowQuestions, responseFlow, responseSegments, responseTrend, runQA, segmentationVariables, surveyResults, type SurveyDef } from '@sampledge/core';
import { buildReport } from './report';
import { buildPdfReport } from './report-pdf';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const Cond: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ q: z.string(), op: z.enum(['eq', 'neq']), value: z.string() }),
    z.object({ q: z.string(), op: z.enum(['in', 'nin']), values: z.array(z.string()) }),
    z.object({ q: z.string(), op: z.enum(['gt', 'gte', 'lt', 'lte']), value: z.number() }),
    z.object({ q: z.string(), op: z.literal('answered') }),
    z.object({ all: z.array(Cond) }),
    z.object({ any: z.array(Cond) }),
    z.object({ not: Cond }),
  ]),
);
const Opt = z.object({ code: z.string().min(1), label: z.string(), exclusive: z.boolean().optional() });
/** Structural schema for SurveyDef. Logic problems (dangling refs, unreachable questions) are QA findings, not 400s. */
export const SurveyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  questions: z.array(z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.enum(['single', 'multi', 'dropdown', 'text', 'numeric', 'rating', 'nps', 'likert', 'matrix', 'ranking', 'slider', 'constant_sum', 'maxdiff', 'info']),
    text: z.string(), options: z.array(Opt).optional(), rows: z.array(Opt).optional(), min: z.number().optional(), max: z.number().optional(),
    required: z.boolean().optional(), randomize: z.boolean().optional(), displayIf: Cond.optional(), block: z.string().optional(),
  })).min(1).max(2000),
  rules: z.array(z.object({ id: z.string(), after: z.string(), when: Cond.nullable(), action: z.union([z.object({ goto: z.string() }), z.object({ terminate: z.enum(['complete', 'screenout', 'overquota']) })]) })),
  quotas: z.array(z.object({ id: z.string(), label: z.string(), when: Cond, target: z.number().int().nonnegative(), count: z.number().int().nonnegative() })),
  languages: z.record(z.string(), z.record(z.string(), z.string())).optional(),
}).superRefine((d, ctx) => {
  const seen = new Set<string>();
  for (const q of d.questions) {
    if (seen.has(q.id)) ctx.addIssue({ code: 'custom', message: `Duplicate question id ${q.id}`, path: ['questions'] });
    seen.add(q.id);
  }
});

export type ResultsOpts = { banner?: string; excludeFlagged?: boolean; weighted?: boolean };
export type DpConfig = { recodes?: Recode[]; weighting?: { targets: Record<string, Record<string, number>>; stats: unknown; appliedAt: string; by: string }; codeframes?: Record<string, { code: string; label: string; keywords: string[] }[]> };
const flag = z.enum(['true', 'false']).optional().transform((v) => v === 'true');
export const resultsQuery = (q: unknown): ResultsOpts => parse(z.object({ banner: z.string().max(40).optional(), excludeFlagged: flag, weighted: flag }), q);
export type ExploreOpts = { excludeFlagged?: boolean; weighted?: boolean; from?: string; to?: string; trendQ?: string; trendCode?: string; interval?: 'day' | 'week'; k?: number };
const qid = z.string().max(40).optional();
export const exploreQuery = (q: unknown): ExploreOpts => parse(z.object({
  excludeFlagged: flag, weighted: flag, from: qid, to: qid, trendQ: qid, trendCode: qid,
  interval: z.enum(['day', 'week']).optional(), k: z.coerce.number().int().min(2).max(6).optional(),
}), q);

/**
 * Share of qualified starts that finished: completes / (all starts − screenouts − over-quotas).
 * Screened-out and over-quota respondents were never eligible to finish, so they are left out.
 * Null until someone has started.
 */
export function completionRate(by: Record<string, number>): number | null {
  const starts = Object.values(by).reduce((a, b) => a + b, 0);
  const eligible = starts - (by.screenout ?? 0) - (by.overquota ?? 0);
  return eligible > 0 ? Math.round(((by.complete ?? 0) / eligible) * 1000) / 1000 : null;
}

/**
 * Routing and display logic per question, from 0 to 1: questions with display logic, routing
 * rules and piped text, divided by the number of questions (one logic element per question = 1).
 */
export function logicComplexity(def: SurveyDef): number {
  const n = def.questions.length;
  if (!n) return 0;
  const logic = def.questions.filter((q) => q.displayIf).length + def.rules.length + def.questions.filter((q) => /\{\{\w+\}\}/.test(q.text)).length;
  return Math.round(Math.min(1, logic / n) * 100) / 100;
}

@Injectable()
export class SurveysService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private where(ctx: Ctx): Prisma.SurveyWhereInput {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { project: { clientId: ctx.clientId ?? '__none__' } } : {}) };
  }

  async list(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.survey.findMany({ where: this.where(ctx), include: { project: { select: { id: true, code: true, name: true } }, _count: { select: { responses: { where: { outcome: 'complete', source: { not: 'preview' }, rejectedAt: null } } } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...page });
    const ids = rows.map((r) => r.id);
    const [outcomes, versions] = await Promise.all([
      ids.length ? this.db.response.groupBy({ by: ['surveyId', 'outcome'], where: { surveyId: { in: ids }, source: { not: 'preview' }, rejectedAt: null }, _count: { _all: true } }) : [],
      this.db.surveyVersion.findMany({ where: { OR: rows.filter((r) => r.hasDefinition).map((r) => ({ surveyId: r.id, version: r.currentVersion })) }, select: { surveyId: true, definition: true } }),
    ]);
    const defs = new Map(versions.map((v) => [v.surveyId, v.definition as unknown as SurveyDef]));
    return rows.map(({ _count, ...s }) => {
      const by = Object.fromEntries(outcomes.filter((o) => o.surveyId === s.id).map((o) => [o.outcome ?? 'in_progress', o._count._all]));
      const def = defs.get(s.id);
      return { ...s, completes: _count.responses, completionRate: completionRate(by), complexity: def ? logicComplexity(def) : null };
    });
  }

  async get(ctx: Ctx, id: string) {
    const s = await this.db.survey.findFirst({ where: { AND: [this.where(ctx), { id }] }, include: { project: { select: { id: true, code: true, name: true, clientId: true } } } });
    if (!s) throw new NotFoundException('Survey not found');
    const definition = s.hasDefinition ? await this.definition(s.id, s.currentVersion) : null;
    return { ...s, definition };
  }

  /** Loads a version's definition with live quota counts from QuotaCell rows. A cell closed early reads as full. */
  async definition(surveyId: string, version: number): Promise<SurveyDef> {
    const v = await this.db.surveyVersion.findUnique({ where: { surveyId_version: { surveyId, version } } });
    if (!v) throw new NotFoundException(`Version ${version} not found`);
    const def = v.definition as unknown as SurveyDef;
    const cells = await this.db.quotaCell.findMany({ where: { surveyId } });
    const byKey = new Map(cells.map((c) => [c.key, c]));
    return { ...def, version, quotas: def.quotas.map((q) => {
      const c = byKey.get(q.id);
      const target = c?.target ?? q.target;
      return { ...q, target, count: c?.closedAt ? Math.max(c.count, target) : c?.count ?? 0 };
    }) };
  }

  async versions(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    return this.db.surveyVersion.findMany({ where: { surveyId: id }, select: { version: true, label: true, createdBy: true, createdAt: true, publishedAt: true }, orderBy: { version: 'desc' } });
  }

  /** Adds programming time to a survey; the Workload chart sums these per programmer. */
  async logTime(ctx: Ctx, id: string, hours: number) {
    const before = await this.get(ctx, id);
    return this.db.$transaction(async (tx) => {
      const s = await tx.survey.update({ where: { id }, data: { hoursSpent: { increment: hours } }, select: { id: true, hoursSpent: true } });
      await this.audit.log(ctx, 'survey.time_logged', 'Survey', id, { hoursSpent: before.hoursSpent }, { hoursSpent: s.hoursSpent, hours }, tx);
      return s;
    });
  }

  async create(ctx: Ctx, b: { name: string; projectId: string; languages: string[] }) {
    const p = await this.db.project.findFirst({ where: { id: b.projectId, tenantId: ctx.tenantId } });
    if (!p) throw new NotFoundException('Project not found');
    return this.db.$transaction(async (tx) => {
      const s = await tx.survey.create({ data: { tenantId: ctx.tenantId, projectId: p.id, name: b.name, status: 'Draft', programmer: ctx.name, languages: b.languages, hasDefinition: true, questionCount: 1 } });
      const def: SurveyDef = { id: s.id, name: b.name, version: 1, questions: [{ id: 'Q1', type: 'single', text: 'First question', options: [{ code: '1', label: 'Option 1' }, { code: '2', label: 'Option 2' }] }], rules: [], quotas: [] };
      await tx.surveyVersion.create({ data: { surveyId: s.id, version: 1, definition: def as unknown as Prisma.InputJsonValue, label: 'Created', createdBy: ctx.name } });
      await this.audit.log(ctx, 'survey.create', 'Survey', s.id, undefined, { name: b.name, projectId: p.id }, tx);
      return s;
    });
  }

  /**
   * Saves a new immutable version. Quota cells are upserted by key, so counts already collected
   * survive edits to labels, conditions and targets. Published versions are never modified.
   */
  async saveVersion(ctx: Ctx, id: string, def: SurveyDef, label: string, baseVersion?: number) {
    const s = await this.db.survey.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw new NotFoundException('Survey not found');
    if (!s.projectId) throw new BadRequestException('Attach the survey to a project before saving logic');
    if (baseVersion !== undefined && baseVersion !== s.currentVersion) {
      throw new BadRequestException(`Survey moved on to v${s.currentVersion} since you loaded v${baseVersion}; reload and reapply your change`);
    }
    const version = s.currentVersion + 1;
    const stored = { ...def, id, version, quotas: def.quotas.map((q) => ({ ...q, count: 0 })) };
    return this.db.$transaction(async (tx) => {
      await tx.surveyVersion.create({ data: { surveyId: id, version, definition: stored as unknown as Prisma.InputJsonValue, label, createdBy: ctx.name } });
      for (const q of def.quotas) {
        await tx.quotaCell.upsert({
          where: { surveyId_key: { surveyId: id, key: q.id } },
          create: { tenantId: ctx.tenantId, projectId: s.projectId!, surveyId: id, key: q.id, label: q.label, condition: q.when as Prisma.InputJsonValue, target: q.target },
          update: { label: q.label, condition: q.when as Prisma.InputJsonValue, target: q.target },
        });
      }
      const u = await tx.survey.update({ where: { id }, data: { currentVersion: version, hasDefinition: true, questionCount: def.questions.length, status: s.status === 'Published' ? 'In QA' : s.status } });
      await this.audit.log(ctx, 'survey.version', 'Survey', id, { version: s.currentVersion }, { version, label }, tx);
      return { survey: u, version };
    });
  }

  async qa(ctx: Ctx, id: string, simulations: number) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    const r = runQA(s.definition, simulations);
    const critical = r.issues.filter((i) => i.severity === 'critical').length;
    await this.db.survey.update({ where: { id }, data: { alerts: r.issues.length, ...(s.status === 'Draft' ? { status: 'In QA' } : {}) } });
    return { version: s.currentVersion, issues: r.issues, sim: r.sim, publishable: critical === 0 };
  }

  /** Publishing is approval-gated and blocked while QA reports critical issues. */
  async requestPublish(ctx: Ctx, id: string) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('Nothing to publish');
    if (s.status === 'Published') throw new BadRequestException('Already published');
    const critical = runQA(s.definition, 300).issues.filter((i) => i.severity === 'critical');
    if (critical.length) throw new BadRequestException({ message: `QA has ${critical.length} critical issue(s); fix them before publishing`, issues: critical });
    const pending = await this.db.approval.findFirst({ where: { tenantId: ctx.tenantId, kind: 'Publishing surveys', status: 'pending', payload: { path: ['surveyId'], equals: id } } });
    if (pending) return { approval: pending, alreadyPending: true };
    const ap = await this.db.$transaction(async (tx) => {
      const a = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Publishing surveys', title: `Publish ${s.name} v${s.currentVersion}`, projectId: s.projectId, requestedBy: ctx.userId, payload: { surveyId: id, version: s.currentVersion } });
      await this.audit.log(ctx, 'survey.publish_requested', 'Survey', id, undefined, { version: s.currentVersion, approvalId: a.id }, tx);
      return a;
    });
    return { approval: ap, alreadyPending: false };
  }

  /**
   * Results from completed, non-rejected responses. Flagged interviews are included unless excluded.
   * `weighted` applies the Data Processing rim weights; coded open ends are tabulated with their codeframe.
   */
  async results(ctx: Ctx, id: string, o: ResultsOpts = {}) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    const rows = await this.db.response.findMany({ where: { surveyId: id, outcome: 'complete', source: { not: 'preview' }, rejectedAt: null }, select: { id: true, answers: true, flags: true, weight: true, codes: true, source: true } });
    const used = o.excludeFlagged ? rows.filter((r) => !r.flags.length) : rows;
    const rejected = await this.db.response.count({ where: { surveyId: id, rejectedAt: { not: null } } });
    const dp = (s.dp ?? {}) as DpConfig;
    const hasWeights = !!dp.weighting;
    const frames = Object.fromEntries(Object.entries(dp.codeframes ?? {}).map(([q, f]) => [q, [...f, { code: 'other', label: 'Other' }]]));
    const rec = applyRecodes(s.definition.questions, used.map((r) => ({ id: r.id, answers: r.answers as Record<string, never>, ...(o.weighted && hasWeights ? { weight: r.weight } : {}), codes: (r.codes ?? undefined) as Record<string, string[]> | undefined })), dp.recodes);
    const res = surveyResults(rec.questions, rec.rows, o.banner, frames);
    return {
      survey: { id: s.id, name: s.name, version: s.currentVersion }, flagged: rows.filter((r) => r.flags.length).length, excludedFlagged: !!o.excludeFlagged, rejected,
      synthetic: rows.filter((r) => r.source.startsWith('synthetic:')).length, weightingAvailable: hasWeights, ...res,
    };
  }

  /**
   * Flow (Sankey), fieldwork trend and segmentation over the same completed responses that
   * results() uses. Each view reports its own error instead of failing the others.
   */
  async explore(ctx: Ctx, id: string, o: ExploreOpts = {}) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    const rows = await this.db.response.findMany({ where: { surveyId: id, outcome: 'complete', source: { not: 'preview' }, rejectedAt: null }, select: { id: true, answers: true, flags: true, weight: true, completedAt: true, source: true } });
    const used = o.excludeFlagged ? rows.filter((r) => !r.flags.length) : rows;
    const weighted = !!o.weighted && !!(s.dp as DpConfig | null)?.weighting;
    const rec = applyRecodes(s.definition.questions, used.map((r) => ({ id: r.id, answers: r.answers as Record<string, never>, completedAt: r.completedAt, ...(weighted ? { weight: r.weight } : {}) })), (s.dp as DpConfig | null)?.recodes);
    const data = rec.rows;
    const qs = rec.questions;
    const flowable = flowQuestions(qs);
    const segVars = segmentationVariables(qs).map((v) => ({ id: v.id, label: v.label }));
    const attempt = <T,>(f: () => T): { ok: true; data: T } | { ok: false; error: string } => { try { return { ok: true, data: f() }; } catch (e) { return { ok: false, error: (e as Error).message }; } };
    // Default flow: first single-choice question into the NPS question (or the last one).
    const from = o.from ?? flowable[0]?.id;
    const to = o.to ?? (qs.find((q) => q.type === 'nps' && q.id !== from)?.id ?? flowable.filter((q) => q.id !== from).slice(-1)[0]?.id);
    return {
      survey: { id: s.id, name: s.name }, base: data.length, weighted, synthetic: rows.filter((r) => r.source.startsWith('synthetic:')).length,
      options: { flow: flowable, segmentation: segVars, trend: qs.filter((q) => ['nps', 'numeric', 'single', 'multi'].includes(q.type)).map((q) => ({ id: q.id, text: q.text, type: q.type, options: q.options?.map((x) => ({ code: x.code, label: x.label })) ?? [] })) },
      flow: from && to ? attempt(() => responseFlow(qs, data, from, to)) : { ok: false as const, error: 'This survey needs two single-choice or NPS questions for a flow' },
      trend: attempt(() => responseTrend(qs, data, { interval: o.interval, questionId: o.trendQ, code: o.trendCode })),
      segments: attempt(() => responseSegments(qs, data, { k: o.k ?? 3 })),
    };
  }

  /** Questions a pricing or portfolio method can use, for the Insight Studio mapping form. */
  async methodOptions(ctx: Ctx, id: string) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    const q = (types: string[]) => s.definition!.questions.filter((x) => types.includes(x.type)).map((x) => ({ id: x.id, text: x.text, options: x.options?.map((o) => ({ code: o.code, label: o.label })) ?? [] }));
    const base = await this.db.response.count({ where: { surveyId: id, outcome: 'complete', source: { not: 'preview' }, rejectedAt: null } });
    return { survey: { id: s.id, name: s.name, version: s.currentVersion }, base, numeric: q(['numeric', 'slider']), single: q(['single', 'dropdown', 'likert']), multi: q(['multi']), weightingAvailable: !!(s.dp as DpConfig | null)?.weighting };
  }

  /**
   * Van Westendorp, Gabor-Granger or TURF computed from the survey's completed, non-rejected
   * interviews, using the questions the analyst maps to the method's inputs.
   */
  async method(ctx: Ctx, id: string, b: z.infer<typeof MethodBody>) {
    const s = await this.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    const qs = new Map(s.definition.questions.map((q) => [q.id, q]));
    const need = (qid: string, types: string[]) => {
      const q = qs.get(qid);
      if (!q) throw new BadRequestException(`Question ${qid} is not in this survey`);
      if (!types.includes(q.type)) throw new BadRequestException(`${qid} is a ${q.type} question; this input needs ${types.join(' or ')}`);
      return q;
    };
    const rows = await this.db.response.findMany({ where: { surveyId: id, outcome: 'complete', source: { not: 'preview' }, rejectedAt: null }, select: { answers: true, flags: true, weight: true } });
    const used = b.excludeFlagged ? rows.filter((r) => !r.flags.length) : rows;
    const ans = used.map((r) => r.answers as Record<string, unknown>);
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    const meta = { survey: { id: s.id, name: s.name }, base: used.length, excludedFlagged: !!b.excludeFlagged };
    try {
      if (b.method === 'vw') {
        for (const k of ['tooCheap', 'cheap', 'expensive', 'tooExpensive'] as const) need(b[k], ['numeric', 'slider']);
        const answers = ans.map((a) => ({ tooCheap: num(a[b.tooCheap]), cheap: num(a[b.cheap]), expensive: num(a[b.expensive]), tooExpensive: num(a[b.tooExpensive]) }))
          .filter((x) => Object.values(x).every(Number.isFinite));
        return { ...meta, method: 'vw' as const, answered: answers.length, result: vanWestendorp(answers, 120) };
      }
      if (b.method === 'gg') {
        if (new Set(b.prices.map((p) => p.price)).size !== b.prices.length) throw new BadRequestException('Each price point can be mapped once');
        for (const p of b.prices) need(p.questionId, ['single', 'dropdown', 'likert']);
        const answers = ans.map((a) => Object.fromEntries(b.prices.filter((p) => a[p.questionId] !== undefined && a[p.questionId] !== null && a[p.questionId] !== '').map((p) => [p.price, p.yes.includes(String(a[p.questionId]))])) as Record<number, boolean>);
        return { ...meta, method: 'gg' as const, answered: answers.filter((a) => Object.keys(a).length).length, result: gaborGranger(b.prices.map((p) => p.price), answers) };
      }
      const q = need(b.questionId, ['multi']);
      const items = (q.options ?? []).filter((o) => !o.exclusive);
      if (b.k > items.length) throw new BadRequestException(`The question has ${items.length} items; pick a portfolio of at most that size`);
      const weighted = !!b.weighted && !!(s.dp as DpConfig | null)?.weighting;
      const reach = ans.map((a) => { const v = a[b.questionId]; const picked = Array.isArray(v) ? v.map(String) : []; return items.map((o) => picked.includes(o.code)); });
      return { ...meta, method: 'turf' as const, weighted, answered: reach.filter((r) => r.some(Boolean)).length, result: turf(items.map((o) => o.label), reach, b.k, weighted ? { weights: used.map((r) => r.weight) } : {}) };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  async report(ctx: Ctx, id: string, o: ResultsOpts = {}, format: 'pptx' | 'pdf' = 'pptx') {
    const r = await this.results(ctx, id, o);
    if (!r.base) throw new BadRequestException('No completed responses to report on yet');
    await this.audit.log(ctx, 'survey.report_exported', 'Survey', id, undefined, { base: r.base, banner: o.banner ?? null, weighted: r.weighted, format });
    return format === 'pdf' ? buildPdfReport(r) : buildReport(r);
  }

  /** Rejecting a respondent is a 'Rejecting respondents' approval; the decider cannot be the requester. */
  async requestReject(ctx: Ctx, id: string, responseId: string, reason: string) {
    const s = await this.get(ctx, id);
    const r = await this.db.response.findFirst({ where: { id: responseId, surveyId: id } });
    if (!r) throw new NotFoundException('Response not found');
    if (r.outcome !== 'complete') throw new BadRequestException('Only completed interviews can be rejected');
    if (r.rejectedAt) throw new BadRequestException('Already rejected');
    const pending = await this.db.approval.findFirst({ where: { tenantId: ctx.tenantId, kind: 'Rejecting respondents', status: 'pending', payload: { path: ['responseId'], equals: responseId } } });
    if (pending) return { approval: pending, alreadyPending: true };
    const ap = await this.db.$transaction(async (tx) => {
      const a = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Rejecting respondents', title: `Reject response ${responseId.slice(-6)} on ${s.name}: ${reason}${r.flags.length ? ` (flags: ${r.flags.join(', ')})` : ''}`, projectId: s.projectId, requestedBy: ctx.userId, payload: { responseId, surveyId: id, reason } });
      await this.audit.log(ctx, 'response.reject_requested', 'Response', responseId, undefined, { reason, approvalId: a.id }, tx);
      return a;
    });
    return { approval: ap, alreadyPending: false };
  }

  /** CSV of all responses: one row per response, one column per question (arrays joined with |). */
  async csv(ctx: Ctx, id: string) {
    const s = await this.get(ctx, id);
    const def = s.definition;
    const qids = def ? def.questions.filter((q) => q.type !== 'info').map((q) => q.id) : [];
    const rows = await this.db.response.findMany({ where: { surveyId: id }, orderBy: { startedAt: 'asc' } });
    const esc = (v: unknown) => {
      const t = v === undefined || v === null ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' ? Object.entries(v as Record<string, string>).map(([k, x]) => `${k}=${x}`).join(';') : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['response_id', 'version', 'source', 'outcome', 'started_at', 'completed_at', 'quality_flags', 'rejected', ...qids];
    const body = rows.map((r) => {
      const a = r.answers as Record<string, unknown>;
      return [r.id, r.version, r.source, r.outcome ?? 'in_progress', r.startedAt.toISOString(), r.completedAt?.toISOString() ?? '', r.flags.join('|'), r.rejectedAt ? 'yes' : '', ...qids.map((q) => a[q])].map(esc).join(',');
    });
    return [head.join(','), ...body].join('\n') + '\n';
  }

  async responses(ctx: Ctx, id: string, outcome?: string, take = 50) {
    await this.get(ctx, id);
    const [rows, byOutcome] = await Promise.all([
      this.db.response.findMany({ where: { surveyId: id, ...(outcome ? { outcome } : {}) }, orderBy: { startedAt: 'desc' }, take }),
      this.db.response.groupBy({ by: ['outcome', 'source'], where: { surveyId: id }, _count: true }),
    ]);
    const cells = await this.db.quotaCell.findMany({ where: { surveyId: id }, orderBy: { key: 'asc' } });
    return { rows, summary: byOutcome.map((g) => ({ outcome: g.outcome ?? 'in_progress', source: g.source, n: g._count })), quotas: cells };
  }
}

const MethodBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('vw'), tooCheap: z.string(), cheap: z.string(), expensive: z.string(), tooExpensive: z.string(), excludeFlagged: z.boolean().optional() }).strict(),
  z.object({ method: z.literal('gg'), prices: z.array(z.object({ price: z.number().positive(), questionId: z.string(), yes: z.array(z.string()).min(1) }).strict()).min(2).max(12), excludeFlagged: z.boolean().optional() }).strict(),
  z.object({ method: z.literal('turf'), questionId: z.string(), k: z.number().int().min(1).max(10), weighted: z.boolean().optional(), excludeFlagged: z.boolean().optional() }).strict(),
]);

@ForModule('survey-studio')
@Controller('surveys')
export class SurveysController {
  constructor(private s: SurveysService) {}

  /** Listed for Insight Studio too (names and status only), so analysts can pick a survey. */
  @ForModule('analytics') @Get() async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.list(ctx, pg), pg.want, res); }
  @Get(':id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }
  @Get(':id/versions') versions(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.versions(ctx, id); }

  @Get(':id/versions/:v')
  async version(@Caller() ctx: Ctx, @Param('id') id: string, @Param('v') v: string) {
    await this.s.get(ctx, id);
    return this.s.definition(id, Number(v));
  }

  @Get(':id/responses.csv') @Header('content-type', 'text/csv; charset=utf-8')
  async exportCsv(@Caller() ctx: Ctx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', `attachment; filename="${id}-responses.csv"`);
    return this.s.csv(ctx, id);
  }

  @ForModule('analytics') @Get(':id/explore')
  explore(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown) {
    return this.s.explore(ctx, id, exploreQuery(q));
  }

  @ForModule('analytics') @Get(':id/methods')
  methodOptions(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.methodOptions(ctx, id); }

  /** Read-only analysis (POST only because the mapping is a body). */
  @ForModule('analytics') @Post(':id/methods') @HttpCode(200)
  method(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.method(ctx, id, parse(MethodBody, b)); }

  @ForModule('analytics') @Get(':id/results')
  results(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown) {
    return this.s.results(ctx, id, resultsQuery(q));
  }

  @ForModule('analytics') @Get(':id/report.pptx') @Header('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  async reportPptx(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const buf = await this.s.report(ctx, id, resultsQuery(q));
    res.setHeader('content-disposition', `attachment; filename="${id}-report.pptx"`);
    return new StreamableFile(buf);
  }

  @ForModule('analytics') @Get(':id/report.pdf') @Header('content-type', 'application/pdf')
  async reportPdf(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const buf = await this.s.report(ctx, id, resultsQuery(q), 'pdf');
    res.setHeader('content-disposition', `attachment; filename="${id}-report.pdf"`);
    return new StreamableFile(buf);
  }

  @Post(':id/responses/:rid/reject') @Write()
  reject(@Caller() ctx: Ctx, @Param('id') id: string, @Param('rid') rid: string, @Body() b: unknown) {
    return this.s.requestReject(ctx, id, rid, parse(z.object({ reason: z.string().min(3).max(300) }), b).reason);
  }

  @Get(':id/responses')
  responses(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown) {
    const x = parse(z.object({ outcome: z.enum(['complete', 'screenout', 'overquota']).optional(), take: z.coerce.number().int().min(1).max(500).default(50) }), q);
    return this.s.responses(ctx, id, x.outcome, x.take);
  }

  @Post() @Write() @RequirePerm('edit:surveys')
  create(@Caller() ctx: Ctx, @Body() b: unknown) {
    return this.s.create(ctx, parse(z.object({ name: z.string().min(3).max(140), projectId: z.string(), languages: z.array(z.string()).default(['en']) }), b));
  }

  @Put(':id/definition') @Write() @RequirePerm('edit:surveys')
  save(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ definition: SurveyDefSchema, label: z.string().min(1).max(200), baseVersion: z.number().int().optional() }), b);
    return this.s.saveVersion(ctx, id, x.definition as SurveyDef, x.label, x.baseVersion);
  }

  @Post(':id/time') @Write() @RequirePerm('edit:surveys') @HttpCode(200)
  logTime(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.logTime(ctx, id, parse(z.object({ hours: z.number().min(0.25).max(24).multipleOf(0.25) }).strict(), b).hours);
  }

  @Post(':id/qa')
  qa(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.qa(ctx, id, parse(z.object({ simulations: z.number().int().min(50).max(5000).default(600) }), b ?? {}).simulations);
  }

  @Post(':id/publish') @Write() @RequirePerm('edit:surveys')
  publish(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.requestPublish(ctx, id); }
}
