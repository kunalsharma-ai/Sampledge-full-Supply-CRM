import type { Response } from 'express';
import { Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { lifecycle, type LifecycleStage } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { emit } from '../common/events';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { redactMargins } from '../common/redact';
import { parse } from '../common/zod';

const Audience = z.enum(['B2B', 'B2C', 'Healthcare']);
export const ProjectCreate = z.object({
  name: z.string().min(3).max(140),
  clientId: z.string(),
  audience: Audience,
  countries: z.array(z.string().length(2)).min(1).max(40),
  owner: z.string().min(2).max(80),
  start: z.coerce.date(),
  deadline: z.coerce.date(),
  target: z.number().int().positive().max(1_000_000),
  ir: z.number().gt(0).max(1),
  loi: z.number().int().min(1).max(120),
  cpiSell: z.number().nonnegative(),
  cpiCost: z.number().nonnegative(),
});
const StageBody = z.object({ stage: z.enum(lifecycle as unknown as [LifecycleStage, ...LifecycleStage[]]) });
const ProjectPatch = z.object({
  owner: z.string().min(2).max(80).optional(),
  deadline: z.coerce.date().optional(),
  blockers: z.array(z.string().max(200)).max(20).optional(),
  target: z.number().int().positive().optional(),
});
const ListQuery = z.object({ stage: z.string().optional(), clientId: z.string().optional(), q: z.string().optional() });

/** Next project code within the tenant: SE-<yy><seq>. */
export async function nextProjectCode(tx: Prisma.TransactionClient, tenantId: string) {
  const rows = await tx.project.findMany({ where: { tenantId }, select: { code: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.replace(/\D/g, '').slice(2)) || 0), 99);
  return `SE-26${max + 1}`;
}

@Injectable()
export class ProjectsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** Tenant filter plus ownership for client users. */
  scope(ctx: Ctx): Prisma.ProjectWhereInput {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { clientId: ctx.clientId ?? '__none__' } : {}) };
  }

  async list(ctx: Ctx, q: z.infer<typeof ListQuery>, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.project.findMany({
      where: { ...this.scope(ctx), ...(q.stage ? { stage: q.stage } : {}), ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
      include: { quotas: { orderBy: { key: 'asc' } }, allocations: true, surveys: { select: { id: true, name: true, status: true } } },
      orderBy: [{ code: 'asc' }, { id: 'asc' }], ...page,
    });
    return rows.map((r) => redactMargins(ctx, r));
  }

  async get(ctx: Ctx, id: string) {
    const p = await this.db.project.findFirst({
      where: { AND: [this.scope(ctx), { id }] },
      include: { client: true, quotas: { orderBy: { key: 'asc' } }, allocations: { include: { vendor: { select: { id: true, name: true } } } }, surveys: true, opportunity: { select: { id: true, title: true } } },
    });
    if (!p) throw new NotFoundException('Project not found');
    return redactMargins(ctx, p);
  }

  async create(ctx: Ctx, body: z.infer<typeof ProjectCreate>) {
    const client = await this.db.client.findFirst({ where: { id: body.clientId, tenantId: ctx.tenantId } });
    if (!client) throw new NotFoundException('Client not found');
    return this.db.$transaction(async (tx) => {
      const code = await nextProjectCode(tx, ctx.tenantId);
      const p = await tx.project.create({
        data: { ...body, tenantId: ctx.tenantId, code, stage: 'Project Setup', budget: Math.round(body.target * body.cpiCost * 1.1), blockers: [] },
      });
      await this.audit.log(ctx, 'project.create', 'Project', p.id, undefined, p, tx);
      return p;
    });
  }

  async setStage(ctx: Ctx, id: string, stage: LifecycleStage) {
    const p = await this.db.project.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!p) throw new NotFoundException('Project not found');
    if (p.stage === stage) return p;
    return this.db.$transaction(async (tx) => {
      const u = await tx.project.update({ where: { id }, data: { stage } });
      await this.audit.log(ctx, 'project.stage', 'Project', id, { stage: p.stage }, { stage }, tx);
      await emit(tx, ctx.tenantId, 'project.stage_changed', { projectId: id, from: p.stage, to: stage });
      return redactMargins(ctx, u);
    });
  }

  async patch(ctx: Ctx, id: string, body: z.infer<typeof ProjectPatch>) {
    const p = await this.db.project.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!p) throw new NotFoundException('Project not found');
    return this.db.$transaction(async (tx) => {
      const u = await tx.project.update({ where: { id }, data: body });
      await this.audit.log(ctx, 'project.update', 'Project', id, Object.fromEntries(Object.keys(body).map((k) => [k, (p as Record<string, unknown>)[k]])), body, tx);
      return redactMargins(ctx, u);
    });
  }

  /** Proposes a vendor allocation. Committing spend (status approved) needs a human approval. */
  async proposeAllocation(ctx: Ctx, projectId: string, body: { vendorId: string; completes: number; cpi: number }) {
    const [p, v] = await Promise.all([
      this.db.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId } }),
      this.db.vendor.findFirst({ where: { id: body.vendorId, tenantId: ctx.tenantId } }),
    ]);
    if (!p) throw new NotFoundException('Project not found');
    if (!v) throw new NotFoundException('Vendor not found');
    if (!v.coverage.some((c) => p.countries.includes(c)) || !v.audiences.includes(p.audience)) {
      throw new ForbiddenException(`${v.name} has no ${p.audience} coverage in ${p.countries.join(', ')}`);
    }
    return this.db.$transaction(async (tx) => {
      const amount = Math.round(body.completes * body.cpi);
      const draft = await tx.allocation.create({ data: { tenantId: ctx.tenantId, projectId, vendorId: v.id, completes: body.completes, cpi: body.cpi, status: 'proposed' } });
      const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Purchasing sample', title: `Issue PO: ${body.completes} completes from ${v.name} (${p.code})`, projectId, amount, requestedBy: ctx.userId, payload: { vendorId: v.id, allocationId: draft.id } });
      const a = await tx.allocation.update({ where: { id: draft.id }, data: { approvalId: ap.id } });
      await this.audit.log(ctx, 'allocation.propose', 'Allocation', a.id, undefined, a, tx);
      return { allocation: a, approval: ap };
    });
  }
}

@ForModule('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private s: ProjectsService) {}

  @Get() async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.list(ctx, parse(ListQuery, q), pg), pg.want, res); }
  @Get(':id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }

  @Post() @Write() @RequirePerm('edit:projects')
  create(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.create(ctx, parse(ProjectCreate, b)); }

  @Patch(':id/stage') @Write() @RequirePerm('edit:projects')
  stage(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.setStage(ctx, id, parse(StageBody, b).stage); }

  @Patch(':id') @Write() @RequirePerm('edit:projects')
  patch(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.patch(ctx, id, parse(ProjectPatch, b)); }

  @Post(':id/allocations') @Write() @RequirePerm('edit:projects')
  allocate(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.proposeAllocation(ctx, id, parse(z.object({ vendorId: z.string(), completes: z.number().int().positive().max(100_000), cpi: z.number().positive().max(10_000) }), b));
  }
}

