/**
 * Client deliverables: files the research team releases to a client from a survey's results.
 *
 * The file is generated once, when the team releases it, and stored with its SHA-256, so the client
 * downloads exactly what was released (and what an approver looked at). Aggregate reports (PDF,
 * PowerPoint, Excel tables) are released directly. Respondent-level data (CSV, SPSS) is a sensitive
 * dataset: it waits for a "Releasing sensitive datasets" approval before the client can see it.
 * Clients see only released files on their own client's projects; every client download is audited.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { DpService } from './dp';
import { SurveysService } from './surveys';

export const deliverableKinds = {
  report_pdf: { label: 'Report (PDF)', ext: 'pdf', type: 'application/pdf', sensitive: false },
  report_pptx: { label: 'Report (PowerPoint)', ext: 'pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sensitive: false },
  tables_xlsx: { label: 'Data tables (Excel)', ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sensitive: false },
  responses_csv: { label: 'Respondent-level data (CSV)', ext: 'csv', type: 'text/csv; charset=utf-8', sensitive: true },
  data_sav: { label: 'Respondent-level data (SPSS)', ext: 'sav', type: 'application/x-spss-sav', sensitive: true },
} as const;
type Kind = keyof typeof deliverableKinds;

const CreateBody = z.object({
  projectId: z.string().max(40),
  surveyId: z.string().max(40),
  kind: z.enum(Object.keys(deliverableKinds) as [Kind, ...Kind[]]),
  title: z.string().trim().min(3).max(120).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();

const LIST_FIELDS = { id: true, projectId: true, surveyId: true, kind: true, title: true, note: true, fileName: true, size: true, sha256: true, status: true, createdBy: true, createdAt: true, releasedAt: true, withdrawnAt: true, downloads: true, approvalId: true, project: { select: { code: true, name: true } } } as const;

@Injectable()
export class DeliverablesService {
  constructor(private db: PrismaService, private audit: AuditService, private surveys: SurveysService, private dp: DpService) {}

  private staffOnly(ctx: Ctx) {
    if (ctx.role === 'client' || ctx.role === 'vendor') throw new ForbiddenException('Only the research team releases deliverables');
  }

  async list(ctx: Ctx, projectId?: string) {
    const where = ctx.role === 'client'
      ? { tenantId: ctx.tenantId, status: 'released', project: { clientId: ctx.clientId ?? '__none__' } }
      : { tenantId: ctx.tenantId };
    return this.db.deliverable.findMany({ where: { ...where, ...(projectId ? { projectId } : {}) }, select: LIST_FIELDS, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 });
  }

  private async render(ctx: Ctx, surveyId: string, kind: Kind): Promise<Buffer> {
    switch (kind) {
      case 'report_pdf': return this.surveys.report(ctx, surveyId, { excludeFlagged: true }, 'pdf');
      case 'report_pptx': return this.surveys.report(ctx, surveyId, { excludeFlagged: true }, 'pptx');
      case 'tables_xlsx': return this.dp.tables(ctx, surveyId, { excludeFlagged: 'true' });
      case 'responses_csv': return Buffer.from(await this.surveys.csv(ctx, surveyId), 'utf8');
      case 'data_sav': return this.dp.spss(ctx, surveyId);
    }
  }

  async create(ctx: Ctx, b: z.infer<typeof CreateBody>) {
    this.staffOnly(ctx);
    const project = await this.db.project.findFirst({ where: { id: b.projectId, tenantId: ctx.tenantId }, select: { id: true, code: true, clientId: true } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.clientId) throw new BadRequestException('This project has no client to release to');
    const survey = await this.db.survey.findFirst({ where: { id: b.surveyId, tenantId: ctx.tenantId }, select: { id: true, name: true, projectId: true } });
    if (!survey || survey.projectId !== project.id) throw new BadRequestException('The survey does not belong to this project');
    const k = deliverableKinds[b.kind];
    const content = await this.render(ctx, survey.id, b.kind);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const fileName = `${project.code}-${survey.id}-${b.kind.replace('_', '-')}.${k.ext}`;
    const title = b.title ?? `${survey.name}: ${k.label}`;
    return this.db.$transaction(async (tx) => {
      const d = await tx.deliverable.create({
        data: {
          tenantId: ctx.tenantId, projectId: project.id, surveyId: survey.id, kind: b.kind, title, note: b.note ?? null, fileName, contentType: k.type,
          size: content.length, sha256, content: new Uint8Array(content), status: k.sensitive ? 'pending_approval' : 'released', createdBy: ctx.name, createdById: ctx.userId,
          releasedAt: k.sensitive ? null : new Date(),
        },
        select: LIST_FIELDS,
      });
      let approvalId: string | null = null;
      if (k.sensitive) {
        const a = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Releasing sensitive datasets', title: `Release ${title} to the client (${project.code})`, projectId: project.id, requestedBy: ctx.userId, payload: { deliverableId: d.id, sha256 } });
        approvalId = a.id;
        await tx.deliverable.update({ where: { id: d.id }, data: { approvalId } });
      } else {
        await emit(tx, ctx.tenantId, 'deliverable.released', { deliverableId: d.id, projectId: project.id });
      }
      await this.audit.log(ctx, k.sensitive ? 'deliverable.release_requested' : 'deliverable.released', 'Deliverable', d.id, undefined, { title, kind: b.kind, sha256, approvalId }, tx);
      return { ...d, approvalId, status: k.sensitive ? 'pending_approval' : 'released' };
    });
  }

  async download(ctx: Ctx, id: string) {
    const d = await this.db.deliverable.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { project: { select: { clientId: true } } } });
    if (!d) throw new NotFoundException('Deliverable not found');
    if (ctx.role === 'vendor') throw new NotFoundException('Deliverable not found');
    if (ctx.role === 'client') {
      if (d.project.clientId !== ctx.clientId || d.status !== 'released') throw new NotFoundException('Deliverable not found');
      await this.db.$transaction(async (tx) => {
        await tx.deliverable.update({ where: { id }, data: { downloads: { increment: 1 } } });
        await this.audit.log(ctx, 'deliverable.download', 'Deliverable', id, undefined, { fileName: d.fileName, sha256: d.sha256 }, tx);
      });
    }
    return d;
  }

  async withdraw(ctx: Ctx, id: string) {
    this.staffOnly(ctx);
    const d = await this.db.deliverable.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!d) throw new NotFoundException('Deliverable not found');
    if (d.status === 'withdrawn') return { id, status: 'withdrawn' };
    return this.db.$transaction(async (tx) => {
      await tx.deliverable.update({ where: { id }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
      if (d.approvalId) await tx.approval.updateMany({ where: { id: d.approvalId, status: 'pending' }, data: { status: 'rejected', decidedBy: ctx.name, decidedAt: new Date() } });
      await this.audit.log(ctx, 'deliverable.withdrawn', 'Deliverable', id, { status: d.status }, { status: 'withdrawn' }, tx);
      return { id, status: 'withdrawn' };
    });
  }
}

@ForModule('client-portal')
@Controller('deliverables')
export class DeliverablesController {
  constructor(private s: DeliverablesService) {}

  @Get() list(@Caller() ctx: Ctx, @Query('projectId') projectId?: string) { return this.s.list(ctx, projectId); }

  @Post() @Write()
  create(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.create(ctx, parse(CreateBody, b)); }

  @Get(':id/download')
  async download(@Caller() ctx: Ctx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const d = await this.s.download(ctx, id);
    res.setHeader('content-type', d.contentType);
    res.setHeader('content-disposition', `attachment; filename="${d.fileName}"`);
    res.setHeader('x-content-sha256', d.sha256);
    return new StreamableFile(Buffer.from(d.content));
  }

  @Post(':id/withdraw') @Write()
  withdraw(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.withdraw(ctx, id); }
}
