import type { Response } from 'express';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { countries, estimateCapacity, estimateCpi, rankVendors, runQA, type Audience, type SurveyDef } from '@sampledge/core';
import { Prisma, type SelfServeStudy } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { emit } from '../common/events';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { DIY_MARGIN } from './diy';
import { nextProjectCode } from './projects';
import { SurveyDefSchema, SurveysService } from './surveys';
import { toCoreVendor } from './vendors';

const codes = countries.map((c) => c.code) as [string, ...string[]];
const cname = (c: string) => countries.find((x) => x.code === c)?.name ?? c;

const SpecFields = {
  title: z.string().trim().min(3).max(140),
  objective: z.string().trim().min(10).max(2000),
  audience: z.enum(['B2C', 'B2B', 'Healthcare']),
  countries: z.array(z.enum(codes)).min(1).max(10).refine((a) => new Set(a).size === a.length, 'Each market once'),
  sampleSize: z.number().int().min(50).max(20_000),
  incidence: z.number().min(0.01).max(1),
  loi: z.number().int().min(3).max(60),
  fieldDays: z.number().int().min(3).max(60),
};
export const StudyCreate = z.object({ ...SpecFields, fieldDays: SpecFields.fieldDays.default(14) });
export const StudyUpdate = z.object(SpecFields).partial();

/** The market screener the platform maintains on every self-service questionnaire. */
export const MARKET_Q = 'COUNTRY';
const OTHER = 'OTHER';
/** Questions a respondent answers per minute, used to check the questionnaire fits the paid length. */
const QUESTIONS_PER_MINUTE = 4;

/** Splits n completes across k markets exactly, the remainder going to the first markets. */
export function splitCompletes(n: number, k: number) {
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
}

type Spec = Pick<SelfServeStudy, 'audience' | 'countries' | 'sampleSize' | 'incidence' | 'loi' | 'fieldDays'>;

/**
 * Keeps the market screener, its screen-out rule and one hard quota per market in line with the
 * study's markets and completes. Everything else in the questionnaire is the client's.
 */
export function withMarkets(def: SurveyDef, s: Spec): SurveyDef {
  const split = splitCompletes(s.sampleSize, s.countries.length);
  const screener = {
    id: MARKET_Q, type: 'single' as const, text: 'In which country do you live?', required: true,
    options: [...s.countries.map((c) => ({ code: c, label: cname(c) })), { code: OTHER, label: 'Another country' }],
  };
  const existing = def.questions.find((q) => q.id === MARKET_Q);
  const questions = [{ ...screener, text: existing?.text?.trim() ? existing.text : screener.text }, ...def.questions.filter((q) => q.id !== MARKET_Q)];
  const rules = [
    { id: 'R_MARKET', after: MARKET_Q, when: { q: MARKET_Q, op: 'eq' as const, value: OTHER }, action: { terminate: 'screenout' as const } },
    ...def.rules.filter((r) => r.id !== 'R_MARKET'),
  ];
  const quotas = s.countries.map((c, i) => ({ id: `M_${c}`, label: `${cname(c)} completes`, when: { q: MARKET_Q, op: 'eq' as const, value: c }, target: split[i], count: 0 }));
  return { ...def, questions, rules, quotas };
}

/** A starting questionnaire: the market screener and one question the client replaces. */
function starter(id: string, s: Spec & { title: string }): SurveyDef {
  return withMarkets({
    id, name: s.title, version: 1, rules: [], quotas: [],
    questions: [{ id: 'Q1', type: 'single', text: 'Which of these brands have you heard of?', required: true, options: [{ code: '1', label: 'Brand A' }, { code: '2', label: 'Brand B' }, { code: '99', label: 'None of these', exclusive: true }] }],
  }, s);
}

/** Answerable questions, i.e. everything but information screens. */
const answerable = (def: SurveyDef) => def.questions.filter((q) => q.type !== 'info').length;

/**
 * Client self-service launch. A client user builds a study and its questionnaire, sees a firm price
 * per complete, and submits it. Submitting plans supplier allocations from the rate cards and asks
 * for one 'Launching client studies' approval: nothing is published and no sample is bought until
 * someone on the research team with purchase approval accepts it. Approval publishes exactly the
 * submitted version, approves the allocations (purchase orders follow through the worker) and moves
 * the project into fieldwork. Clients never see supplier names, costs or margins.
 */
@Injectable()
export class SelfServeService {
  constructor(private db: PrismaService, private audit: AuditService, private surveys: SurveysService) {}

  private async find(ctx: Ctx, id: string) {
    const s = await this.db.selfServeStudy.findFirst({ where: { id, tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { clientId: ctx.clientId ?? '__none__' } : {}) } });
    if (!s) throw new NotFoundException('Study not found');
    return s;
  }

  /** Only the client who owns the study changes it, and only before launch or after a rejection. */
  private async editable(ctx: Ctx, id: string) {
    if (ctx.role !== 'client' || !ctx.clientId) throw new ForbiddenException('Self-service studies are edited by their client');
    const s = await this.find(ctx, id);
    if (s.status !== 'draft' && s.status !== 'rejected') throw new BadRequestException(`This study is ${s.status}; it can no longer be edited`);
    return s;
  }

  /**
   * Supplier plan from the rate cards: per market, the best-ranked suppliers in order until their
   * estimated capacity covers the market (any shortfall stays with the first). The client price is
   * the blended cost marked up by the DIY margin.
   */
  async plan(ctx: Ctx, s: Spec) {
    const vendors = (await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map(toCoreVendor);
    const split = splitCompletes(s.sampleSize, s.countries.length);
    const markets = s.countries.map((country, i) => {
      const n = split[i];
      const q = { audience: s.audience as Audience, country, n, ir: s.incidence, loi: s.loi, deadlineDays: s.fieldDays };
      const ranked = rankVendors(q, vendors).slice(0, 3);
      const lines: { vendorId: string; completes: number; cpi: number }[] = [];
      let left = n;
      for (const r of ranked) {
        if (left <= 0) break;
        const take = Math.min(left, estimateCapacity(r.vendor, q));
        if (take > 0) { lines.push({ vendorId: r.vendor.id, completes: take, cpi: estimateCpi(r.vendor, q) }); left -= take; }
      }
      if (left > 0 && ranked.length) {
        const first = lines.find((l) => l.vendorId === ranked[0].vendor.id);
        if (first) first.completes += left; else lines.unshift({ vendorId: ranked[0].vendor.id, completes: left, cpi: estimateCpi(ranked[0].vendor, q) });
      }
      return { country, n, covered: ranked.length > 0, capacityOk: left <= 0, lines };
    });
    const lines = markets.flatMap((m) => m.lines);
    const cost = lines.reduce((a, l) => a + l.completes * l.cpi, 0);
    const n = lines.reduce((a, l) => a + l.completes, 0);
    const costCpi = n ? Math.round((cost / n) * 100) / 100 : 0;
    const priceCpi = n ? Math.round((costCpi / (1 - DIY_MARGIN)) * 100) / 100 : 0;
    return { markets, costCpi, cost: Math.round(cost), priceCpi, priceTotal: Math.round(priceCpi * s.sampleSize), covered: markets.every((m) => m.covered) };
  }

  /** What the client sees: no supplier names, costs or allocations. */
  private async view(ctx: Ctx, s: SelfServeStudy) {
    const [survey, cells, project, approval] = await Promise.all([
      this.db.survey.findUnique({ where: { id: s.surveyId }, select: { status: true, currentVersion: true, questionCount: true } }),
      this.db.quotaCell.findMany({ where: { surveyId: s.surveyId }, orderBy: { key: 'asc' } }),
      this.db.project.findUnique({ where: { id: s.projectId }, select: { code: true, stage: true, completes: true, target: true, deadline: true } }),
      s.approvalId ? this.db.approval.findUnique({ where: { id: s.approvalId }, select: { status: true, decidedBy: true, decidedAt: true } }) : null,
    ]);
    const { costCpi, createdById: _c, ...rest } = s;
    const internal = ctx.role !== 'client';
    return {
      ...rest, ...(internal ? { costCpi } : {}),
      survey: survey && { status: survey.status, version: survey.currentVersion, questions: survey.questionCount },
      project: project && { code: project.code, stage: project.stage, completes: project.completes, target: project.target, deadline: project.deadline },
      markets: cells.filter((c) => c.key.startsWith('M_')).map((c) => ({ country: c.key.slice(2), label: c.label, target: c.target, count: c.count })),
      approval,
      links: s.status === 'live' ? { respondent: `/r/${s.surveyId}` } : null,
    };
  }

  async list(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.selfServeStudy.findMany({ where: { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { clientId: ctx.clientId ?? '__none__' } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page });
    return Promise.all(rows.map((s) => this.view(ctx, s)));
  }

  async get(ctx: Ctx, id: string) {
    const s = await this.find(ctx, id);
    const sv = await this.db.survey.findUniqueOrThrow({ where: { id: s.surveyId } });
    const definition = await this.surveys.definition(s.surveyId, sv.currentVersion);
    return { ...(await this.view(ctx, s)), definition };
  }

  async create(ctx: Ctx, b: z.infer<typeof StudyCreate>) {
    if (ctx.role !== 'client' || !ctx.clientId) throw new ForbiddenException('Self-service studies are created by client users');
    const pl = await this.plan(ctx, b);
    if (!pl.covered) throw new BadRequestException(`No supplier covers ${b.audience} in ${pl.markets.filter((m) => !m.covered).map((m) => cname(m.country)).join(', ')}`);
    const now = new Date();
    return this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          tenantId: ctx.tenantId, code: await nextProjectCode(tx, ctx.tenantId), name: b.title, clientId: ctx.clientId!, audience: b.audience, countries: b.countries,
          stage: 'Survey Programming', owner: 'Self-service', start: now, deadline: new Date(now.getTime() + b.fieldDays * 86_400_000), target: b.sampleSize,
          ir: b.incidence, loi: b.loi, cpiSell: pl.priceCpi, cpiCost: pl.costCpi, budget: pl.cost, blockers: [],
        },
      });
      const survey = await tx.survey.create({ data: { tenantId: ctx.tenantId, projectId: project.id, name: b.title, status: 'Draft', programmer: ctx.name, languages: ['en'], loi: b.loi, hasDefinition: true } });
      const def = starter(survey.id, b);
      await tx.survey.update({ where: { id: survey.id }, data: { questionCount: def.questions.length } });
      await tx.surveyVersion.create({ data: { surveyId: survey.id, version: 1, definition: def as unknown as Prisma.InputJsonValue, label: 'Created by client', createdBy: ctx.name } });
      for (const q of def.quotas) await tx.quotaCell.create({ data: { tenantId: ctx.tenantId, projectId: project.id, surveyId: survey.id, key: q.id, label: q.label, condition: q.when as Prisma.InputJsonValue, target: q.target } });
      const s = await tx.selfServeStudy.create({
        data: { tenantId: ctx.tenantId, clientId: ctx.clientId!, projectId: project.id, surveyId: survey.id, title: b.title, objective: b.objective, audience: b.audience, countries: b.countries, sampleSize: b.sampleSize, incidence: b.incidence, loi: b.loi, fieldDays: b.fieldDays, status: 'draft', createdBy: ctx.name, createdById: ctx.userId },
      });
      await this.audit.log(ctx, 'selfserve.create', 'SelfServeStudy', s.id, undefined, { title: b.title, projectId: project.id, surveyId: survey.id, countries: b.countries, sampleSize: b.sampleSize }, tx);
      return s;
    }).then((s) => this.get(ctx, s.id));
  }

  /** Changes the study set-up; the market screener and quotas follow in a new questionnaire version. */
  async update(ctx: Ctx, id: string, b: z.infer<typeof StudyUpdate>) {
    const s = await this.editable(ctx, id);
    const next = { ...s, ...b };
    const pl = await this.plan(ctx, next);
    if (!pl.covered) throw new BadRequestException(`No supplier covers ${next.audience} in ${pl.markets.filter((m) => !m.covered).map((m) => cname(m.country)).join(', ')}`);
    await this.db.$transaction(async (tx) => {
      await tx.selfServeStudy.update({ where: { id }, data: b });
      await tx.project.update({ where: { id: s.projectId }, data: { name: next.title, audience: next.audience, countries: next.countries, target: next.sampleSize, ir: next.incidence, loi: next.loi, cpiSell: pl.priceCpi, cpiCost: pl.costCpi, budget: pl.cost } });
      await tx.survey.update({ where: { id: s.surveyId }, data: { name: next.title, loi: next.loi } });
      await this.audit.log(ctx, 'selfserve.update', 'SelfServeStudy', id, Object.fromEntries(Object.keys(b).map((k) => [k, (s as unknown as Record<string, unknown>)[k]])), b, tx);
    });
    if (b.countries || b.sampleSize !== undefined || b.title) {
      const sv = await this.db.survey.findUniqueOrThrow({ where: { id: s.surveyId } });
      await this.saveDefinition(ctx, s.id, await this.surveys.definition(s.surveyId, sv.currentVersion), 'Study set-up changed', sv.currentVersion);
    }
    return this.get(ctx, id);
  }

  /** Saves the client's questionnaire as a new version, with the market screener and quotas re-applied. */
  async saveDefinition(ctx: Ctx, id: string, def: SurveyDef, label: string, baseVersion?: number) {
    const s = await this.editable(ctx, id);
    const fitted = withMarkets({ ...def, name: s.title }, s);
    await this.surveys.saveVersion(ctx, s.surveyId, fitted, label, baseVersion);
    // Quota cells for markets that were removed must not keep counting.
    await this.db.quotaCell.deleteMany({ where: { surveyId: s.surveyId, key: { notIn: fitted.quotas.map((q) => q.id) } } });
    return this.get(ctx, id);
  }

  async qa(ctx: Ctx, id: string) {
    const s = await this.find(ctx, id);
    const sv = await this.db.survey.findUniqueOrThrow({ where: { id: s.surveyId } });
    const def = await this.surveys.definition(s.surveyId, sv.currentVersion);
    const r = runQA(def, 300);
    const minutes = Math.ceil(answerable(def) / QUESTIONS_PER_MINUTE);
    const lengthOk = minutes <= Math.ceil(s.loi * 1.25);
    const critical = r.issues.filter((i) => i.severity === 'critical').length;
    return { version: sv.currentVersion, issues: r.issues, outcomes: r.sim.outcomes, estimatedMinutes: minutes, loi: s.loi, lengthOk, launchable: critical === 0 && lengthOk };
  }

  /** The firm price the client would accept by submitting now. */
  async price(ctx: Ctx, id: string) {
    const s = await this.find(ctx, id);
    const pl = await this.plan(ctx, s);
    return { priceCpi: pl.priceCpi, priceTotal: pl.priceTotal, sampleSize: s.sampleSize, markets: pl.markets.map((m) => ({ country: m.country, n: m.n, capacityOk: m.capacityOk })), currency: 'USD' };
  }

  /**
   * Submits the current questionnaire version at the price the client saw. The allocations are
   * drafted as 'proposed' and the launch waits for a 'Launching client studies' approval.
   */
  async submit(ctx: Ctx, id: string, b: { acceptedTotal: number }) {
    const s = await this.editable(ctx, id);
    const check = await this.qa(ctx, id);
    if (check.issues.some((i) => i.severity === 'critical')) throw new BadRequestException({ message: 'The questionnaire has critical QA issues; fix them before submitting', issues: check.issues.filter((i) => i.severity === 'critical') });
    if (!check.lengthOk) throw new BadRequestException(`About ${check.estimatedMinutes} minutes of questions for a ${s.loi}-minute interview; shorten the questionnaire or raise the interview length`);
    const pl = await this.plan(ctx, s);
    if (!pl.covered) throw new BadRequestException('A market is no longer covered by any supplier');
    if (pl.priceTotal !== b.acceptedTotal) throw new ConflictException({ message: `The price is now $${pl.priceTotal.toLocaleString('en-US')} (you accepted $${b.acceptedTotal.toLocaleString('en-US')}); review it and submit again`, priceTotal: pl.priceTotal, priceCpi: pl.priceCpi });
    const project = await this.db.project.findUniqueOrThrow({ where: { id: s.projectId } });
    const tight = pl.markets.filter((m) => !m.capacityOk).map((m) => m.country);
    return this.db.$transaction(async (tx) => {
      // Re-check inside the transaction so two submits cannot both pass.
      const fresh = await tx.selfServeStudy.updateMany({ where: { id, status: { in: ['draft', 'rejected'] } }, data: { status: 'submitted' } });
      if (!fresh.count) throw new ConflictException('This study was already submitted');
      const allocationIds: string[] = [];
      for (const l of pl.markets.flatMap((m) => m.lines)) {
        const a = await tx.allocation.create({ data: { tenantId: ctx.tenantId, projectId: s.projectId, vendorId: l.vendorId, completes: l.completes, cpi: l.cpi, status: 'proposed' } });
        allocationIds.push(a.id);
      }
      const ap = await requestApproval(tx, {
        tenantId: ctx.tenantId, kind: 'Launching client studies', projectId: s.projectId, amount: pl.cost, requestedBy: ctx.userId,
        title: `Launch ${project.code} ${s.title}: n=${s.sampleSize} ${s.audience} in ${s.countries.join(', ')}, client price $${pl.priceTotal.toLocaleString('en-US')}${tight.length ? ` (capacity tight in ${tight.join(', ')})` : ''}`,
        payload: { studyId: id, surveyId: s.surveyId, version: check.version, allocationIds, priceTotal: pl.priceTotal },
      });
      await tx.allocation.updateMany({ where: { id: { in: allocationIds } }, data: { approvalId: ap.id } });
      await tx.project.update({ where: { id: s.projectId }, data: { stage: 'Client Approval', cpiSell: pl.priceCpi, cpiCost: pl.costCpi, budget: pl.cost } });
      await tx.survey.update({ where: { id: s.surveyId }, data: { status: 'In QA' } });
      const u = await tx.selfServeStudy.update({ where: { id }, data: { priceCpi: pl.priceCpi, priceTotal: pl.priceTotal, costCpi: pl.costCpi, version: check.version, approvalId: ap.id, submittedAt: new Date(), decisionNote: null } });
      await emit(tx, ctx.tenantId, 'selfserve.submitted', { studyId: id, approvalId: ap.id });
      await this.audit.log(ctx, 'selfserve.submit', 'SelfServeStudy', id, { status: s.status }, { status: 'submitted', version: check.version, priceTotal: pl.priceTotal, approvalId: ap.id }, tx);
      return u;
    }).then(() => this.get(ctx, id));
  }

  /** Withdraws a submission that is still waiting; its allocations close and the client can edit again. */
  async withdraw(ctx: Ctx, id: string) {
    if (ctx.role !== 'client') throw new ForbiddenException('Only the client withdraws its submission');
    const s = await this.find(ctx, id);
    if (s.status !== 'submitted' || !s.approvalId) throw new BadRequestException('Nothing is waiting to launch');
    await this.db.$transaction(async (tx) => {
      const a = await tx.approval.updateMany({ where: { id: s.approvalId!, status: 'pending' }, data: { status: 'withdrawn', decidedBy: ctx.name, decidedAt: new Date() } });
      if (!a.count) throw new ConflictException('The launch was already decided');
      await tx.allocation.updateMany({ where: { approvalId: s.approvalId!, status: 'proposed' }, data: { status: 'closed' } });
      await tx.selfServeStudy.update({ where: { id }, data: { status: 'draft' } });
      await tx.project.update({ where: { id: s.projectId }, data: { stage: 'Survey Programming' } });
      await tx.survey.update({ where: { id: s.surveyId }, data: { status: 'Draft' } });
      await this.audit.log(ctx, 'selfserve.withdraw', 'SelfServeStudy', id, { status: 'submitted' }, { status: 'draft' }, tx);
    });
    return this.get(ctx, id);
  }

  /** Ends fieldwork: the survey closes to new respondents and remaining allocations close. */
  async close(ctx: Ctx, id: string) {
    const s = await this.find(ctx, id);
    if (ctx.role !== 'client' && ctx.role !== 'platform_admin') throw new ForbiddenException('Only the client or a platform admin closes fieldwork');
    if (s.status !== 'live') throw new BadRequestException('Only a live study can be closed');
    await this.db.$transaction(async (tx) => {
      await tx.survey.update({ where: { id: s.surveyId }, data: { status: 'Closed' } });
      await tx.allocation.updateMany({ where: { projectId: s.projectId, status: { in: ['approved', 'live'] } }, data: { status: 'closed' } });
      await tx.selfServeStudy.update({ where: { id }, data: { status: 'closed', closedAt: new Date() } });
      await tx.project.update({ where: { id: s.projectId }, data: { stage: 'Data Processing' } });
      await emit(tx, ctx.tenantId, 'project.stage_changed', { projectId: s.projectId, from: 'Fieldwork Monitoring', to: 'Data Processing' });
      await this.audit.log(ctx, 'selfserve.close', 'SelfServeStudy', id, { status: 'live' }, { status: 'closed' }, tx);
    });
    return this.get(ctx, id);
  }
}

/**
 * Effect of a 'Launching client studies' decision, inside the decision's transaction. Approval
 * launches exactly the submitted version; if the study changed since, nothing launches.
 */
export async function applyLaunchDecision(tx: Prisma.TransactionClient, tenantId: string, p: Record<string, unknown>, ok: boolean, meta: { approvalId: string }): Promise<string> {
  const s = await tx.selfServeStudy.findFirst({ where: { id: String(p.studyId), tenantId } });
  if (!s || s.status !== 'submitted' || s.approvalId !== meta.approvalId) return 'The study is no longer waiting for this launch; nothing changed';
  const allocationIds = (Array.isArray(p.allocationIds) ? p.allocationIds : []).map(String);
  if (!ok) {
    await tx.allocation.updateMany({ where: { id: { in: allocationIds }, status: 'proposed' }, data: { status: 'closed' } });
    await tx.selfServeStudy.update({ where: { id: s.id }, data: { status: 'rejected' } });
    await tx.project.update({ where: { id: s.projectId }, data: { stage: 'Survey Programming' } });
    await tx.survey.update({ where: { id: s.surveyId }, data: { status: 'Draft' } });
    await emit(tx, tenantId, 'selfserve.decided', { studyId: s.id, approvalId: meta.approvalId, decision: 'rejected' });
    return 'Launch declined; nothing was published or bought. The client can revise and submit again';
  }
  const sv = await tx.survey.findUniqueOrThrow({ where: { id: s.surveyId } });
  if (sv.currentVersion !== s.version) return `The questionnaire moved on to v${sv.currentVersion} after v${s.version} was submitted; nothing launched`;
  const now = new Date();
  await tx.survey.update({ where: { id: s.surveyId }, data: { status: 'Published' } });
  await tx.surveyVersion.updateMany({ where: { surveyId: s.surveyId, version: s.version! }, data: { publishedAt: now } });
  await tx.allocation.updateMany({ where: { id: { in: allocationIds }, status: 'proposed' }, data: { status: 'approved' } });
  for (const a of allocationIds) await emit(tx, tenantId, 'allocation.approved', { allocationId: a });
  const pr = await tx.project.update({ where: { id: s.projectId }, data: { stage: 'Full Launch', start: now, deadline: new Date(now.getTime() + s.fieldDays * 86_400_000) } });
  await tx.selfServeStudy.update({ where: { id: s.id }, data: { status: 'live', launchedAt: now } });
  // The commercial record: a won self-service opportunity at the accepted price.
  await tx.opportunity.create({
    data: {
      tenantId, clientId: s.clientId, title: s.title, stage: 'Won', owner: 'Self-service', audience: s.audience, countries: s.countries, sampleSize: s.sampleSize, incidence: s.incidence, loi: s.loi,
      value: s.priceTotal ?? 0, margin: DIY_MARGIN, probability: 1, channel: 'self_service', projectId: pr.id, sourceText: `Self-service launch by ${s.createdBy}. Objective: ${s.objective}`,
    },
  });
  await emit(tx, tenantId, 'survey.published', { surveyId: s.surveyId, version: s.version });
  await emit(tx, tenantId, 'project.stage_changed', { projectId: s.projectId, from: 'Client Approval', to: 'Full Launch' });
  await emit(tx, tenantId, 'selfserve.decided', { studyId: s.id, approvalId: meta.approvalId, decision: 'approved' });
  return `Launched: survey v${s.version} published and ${allocationIds.length} supplier allocation${allocationIds.length === 1 ? '' : 's'} approved (purchase orders follow)`;
}

@ForModule('diy')
@Controller('diy/studies')
export class SelfServeController {
  constructor(private s: SelfServeService) {}

  @Get() async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 100, 500); return paged(await this.s.list(ctx, pg), pg.want, res); }
  @Get(':id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }
  @Get(':id/price') price(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.price(ctx, id); }
  @Post(':id/qa') @HttpCode(200) qa(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.qa(ctx, id); }

  @Post() @Write() create(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.create(ctx, parse(StudyCreate, b)); }
  @Patch(':id') @Write() update(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.update(ctx, id, parse(StudyUpdate, b)); }

  @Put(':id/questionnaire') @Write()
  questionnaire(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ definition: SurveyDefSchema, label: z.string().min(1).max(140).default('Edited by client'), baseVersion: z.number().int().optional() }), b);
    return this.s.saveDefinition(ctx, id, x.definition as unknown as SurveyDef, x.label, x.baseVersion);
  }

  @Post(':id/submit') @Write() @HttpCode(200)
  submit(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.submit(ctx, id, parse(z.object({ acceptedTotal: z.number().int().nonnegative() }), b)); }
  @Post(':id/withdraw') @Write() @HttpCode(200) withdraw(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.withdraw(ctx, id); }
  @Post(':id/close') @Write() @HttpCode(200) close(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.close(ctx, id); }
}
