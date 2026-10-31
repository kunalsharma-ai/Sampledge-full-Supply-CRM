import { BadRequestException, Body, Controller, Get, Header, Injectable, NotFoundException, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { runQA, type SurveyDef } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
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
  languages: z.record(z.record(z.string())).optional(),
}).superRefine((d, ctx) => {
  const seen = new Set<string>();
  for (const q of d.questions) {
    if (seen.has(q.id)) ctx.addIssue({ code: 'custom', message: `Duplicate question id ${q.id}`, path: ['questions'] });
    seen.add(q.id);
  }
});

@Injectable()
export class SurveysService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private where(ctx: Ctx): Prisma.SurveyWhereInput {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { project: { clientId: ctx.clientId ?? '__none__' } } : {}) };
  }

  list(ctx: Ctx) {
    return this.db.survey.findMany({ where: this.where(ctx), include: { project: { select: { id: true, code: true, name: true } } }, orderBy: { name: 'asc' } });
  }

  async get(ctx: Ctx, id: string) {
    const s = await this.db.survey.findFirst({ where: { AND: [this.where(ctx), { id }] }, include: { project: { select: { id: true, code: true, name: true, clientId: true } } } });
    if (!s) throw new NotFoundException('Survey not found');
    const definition = s.hasDefinition ? await this.definition(s.id, s.currentVersion) : null;
    return { ...s, definition };
  }

  /** Loads a version's definition with live quota counts from QuotaCell rows. */
  async definition(surveyId: string, version: number): Promise<SurveyDef> {
    const v = await this.db.surveyVersion.findUnique({ where: { surveyId_version: { surveyId, version } } });
    if (!v) throw new NotFoundException(`Version ${version} not found`);
    const def = v.definition as unknown as SurveyDef;
    const cells = await this.db.quotaCell.findMany({ where: { surveyId } });
    const byKey = new Map(cells.map((c) => [c.key, c]));
    return { ...def, version, quotas: def.quotas.map((q) => ({ ...q, target: byKey.get(q.id)?.target ?? q.target, count: byKey.get(q.id)?.count ?? 0 })) };
  }

  async versions(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    return this.db.surveyVersion.findMany({ where: { surveyId: id }, select: { version: true, label: true, createdBy: true, createdAt: true, publishedAt: true }, orderBy: { version: 'desc' } });
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
    const head = ['response_id', 'version', 'source', 'outcome', 'started_at', 'completed_at', ...qids];
    const body = rows.map((r) => {
      const a = r.answers as Record<string, unknown>;
      return [r.id, r.version, r.source, r.outcome ?? 'in_progress', r.startedAt.toISOString(), r.completedAt?.toISOString() ?? '', ...qids.map((q) => a[q])].map(esc).join(',');
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

@ForModule('survey-studio')
@Controller('surveys')
export class SurveysController {
  constructor(private s: SurveysService) {}

  @Get() list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
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

  @Post(':id/qa')
  qa(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.qa(ctx, id, parse(z.object({ simulations: z.number().int().min(50).max(5000).default(600) }), b ?? {}).simulations);
  }

  @Post(':id/publish') @Write() @RequirePerm('edit:surveys')
  publish(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.requestPublish(ctx, id); }
}
