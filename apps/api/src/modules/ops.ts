import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { can, lifecycleToOps, type LifecycleStage } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { approvalKinds, fallbackDeciders, type ApprovalKind } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

@Injectable()
export class ApprovalsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  canDecide(ctx: Ctx, kind: string) {
    const perm = approvalKinds[kind as ApprovalKind];
    if (perm === undefined) return false;
    return perm ? can(ctx.role, perm) : fallbackDeciders.includes(ctx.role);
  }

  /** Approvals the caller requested or may decide. Client users only see publish requests on their projects. */
  async list(ctx: Ctx, status?: string) {
    const rows = await this.db.approval.findMany({ where: { tenantId: ctx.tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' } });
    let visible = rows.filter((a) => a.requestedBy === ctx.userId || this.canDecide(ctx, a.kind));
    if (ctx.role === 'client') {
      const mine = new Set((await this.db.project.findMany({ where: { tenantId: ctx.tenantId, clientId: ctx.clientId ?? '__none__' }, select: { id: true } })).map((p) => p.id));
      visible = visible.filter((a) => a.projectId && mine.has(a.projectId));
    }
    if (ctx.role === 'vendor') visible = [];
    return visible.map((a) => ({ ...a, canDecide: a.status === 'pending' && this.canDecide(ctx, a.kind) && a.requestedBy !== ctx.userId }));
  }

  /**
   * Records a human decision and applies its effect in the same transaction.
   * The requester cannot decide their own request (separation of duties).
   */
  async decide(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note?: string) {
    const a = await this.db.approval.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Approval not found');
    if (a.status !== 'pending') throw new BadRequestException(`Already ${a.status}`);
    if (!this.canDecide(ctx, a.kind)) throw new ForbiddenException(`Your role cannot decide "${a.kind}"`);
    if (a.requestedBy === ctx.userId) throw new ForbiddenException('You requested this; someone else must decide it');
    if (ctx.role === 'client') {
      const p = a.projectId ? await this.db.project.findFirst({ where: { id: a.projectId, tenantId: ctx.tenantId } }) : null;
      if (!p || p.clientId !== ctx.clientId) throw new ForbiddenException('Not your project');
    }
    const payload = (a.payload ?? {}) as Record<string, string | number>;
    const ok = decision === 'approved';
    return this.db.$transaction(async (tx) => {
      const effect = await this.apply(tx, a.kind, payload, ok);
      const u = await tx.approval.update({ where: { id }, data: { status: decision, decidedBy: ctx.name, decidedAt: new Date(), payload: { ...payload, note: note ?? null, effect } as Prisma.InputJsonValue } });
      await this.audit.log(ctx, `approval.${decision}`, 'Approval', id, { status: 'pending' }, { status: decision, kind: a.kind, effect, note }, tx);
      return { approval: u, effect };
    });
  }

  private async apply(tx: Prisma.TransactionClient, kind: string, p: Record<string, string | number>, ok: boolean): Promise<string> {
    switch (kind) {
      case 'Publishing surveys': {
        if (!ok || !p.surveyId) return ok ? 'No survey linked' : 'Survey stays unpublished';
        await tx.survey.update({ where: { id: String(p.surveyId) }, data: { status: 'Published' } });
        await tx.surveyVersion.updateMany({ where: { surveyId: String(p.surveyId), version: Number(p.version) }, data: { publishedAt: new Date() } });
        return `Survey published (v${p.version}); respondent links are live`;
      }
      case 'Purchasing sample': {
        if (!p.allocationId) return ok ? 'Recorded (no allocation linked; demo request)' : 'Rejected';
        await tx.allocation.update({ where: { id: String(p.allocationId) }, data: { status: ok ? 'approved' : 'closed' } });
        return ok ? 'Allocation approved. No PO is transmitted: supplier integrations are not connected.' : 'Allocation closed';
      }
      case 'Sending binding quotations': {
        if (!p.quoteId) return ok ? 'Recorded (no quote linked; demo request)' : 'Rejected';
        await tx.quote.update({ where: { id: String(p.quoteId) }, data: { status: ok ? 'sent' : 'rejected' } });
        if (ok) await tx.opportunity.updateMany({ where: { id: String(p.opportunityId), stage: { in: ['New RFQ', 'Qualifying', 'Feasibility'] } }, data: { stage: 'Quote Sent', probability: 0.5 } });
        return ok ? 'Quote marked sent. No email is sent until the Comms Hub (Phase 4) is connected.' : 'Quote rejected';
      }
      case 'Deleting records': {
        if (!p.panelistId) return ok ? 'Recorded' : 'Rejected';
        if (!ok) {
          await tx.panelist.update({ where: { id: String(p.panelistId) }, data: { status: 'active' } });
          return 'Deletion rejected; member restored to active';
        }
        await tx.consent.deleteMany({ where: { panelistId: String(p.panelistId) } });
        await tx.panelist.delete({ where: { id: String(p.panelistId) } });
        return 'Panelist record and consent history deleted';
      }
      default:
        return ok ? 'Decision recorded; this action has no automated effect yet' : 'Rejected';
    }
  }
}

@Controller('approvals')
export class ApprovalsController {
  constructor(private s: ApprovalsService) {}
  @Get() list(@Caller() ctx: Ctx, @Query('status') status?: string) { return this.s.list(ctx, status); }

  @Post(':id/decision') @HttpCode(200)
  decide(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(1000).optional() }), b);
    return this.s.decide(ctx, id, x.decision, x.note);
  }
}

@Controller()
export class OpsController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  @Get('notifications')
  notifications(@Caller() ctx: Ctx) {
    return this.db.notification.findMany({ where: { tenantId: ctx.tenantId, OR: [{ roles: { isEmpty: true } }, { roles: { has: ctx.role } }] }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Post('notifications/read-all') @HttpCode(200)
  async readAll(@Caller() ctx: Ctx) {
    const r = await this.db.notification.updateMany({ where: { tenantId: ctx.tenantId, read: false, OR: [{ roles: { isEmpty: true } }, { roles: { has: ctx.role } }] }, data: { read: true } });
    return { updated: r.count };
  }

  @ForModule('automation') @Get('agents')
  agents(@Caller() ctx: Ctx) {
    return this.db.agent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: 'asc' } }).then((r) => r.map((a) => ({ ...a, demo: true })));
  }

  @ForModule('automation') @Write() @RequirePerm('edit:automations') @Patch('agents/:id')
  async toggleAgent(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), b);
    const a = await this.db.agent.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Agent not found');
    const u = await this.db.agent.update({ where: { id }, data: { enabled } });
    await this.audit.log(ctx, enabled ? 'agent.enable' : 'agent.disable', 'Agent', id, { enabled: a.enabled }, { enabled });
    return u;
  }

  @ForModule('admin') @Get('audit')
  auditLog(@Caller() ctx: Ctx, @Query() q: unknown) {
    const x = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(100) }), q);
    return this.db.auditLog.findMany({ where: { tenantId: ctx.tenantId, ...(x.entity ? { entity: x.entity } : {}), ...(x.entityId ? { entityId: x.entityId } : {}) }, orderBy: { at: 'desc' }, take: x.take });
  }

  /** KPIs computed from the database (not from the demo series). */
  @ForModule('command-center') @Get('dashboard/summary')
  async summary(@Caller() ctx: Ctx) {
    const t = ctx.tenantId;
    const [projects, opps, pending, vendors] = await Promise.all([
      this.db.project.findMany({ where: { tenantId: t }, select: { stage: true, target: true, completes: true, cpiSell: true, cpiCost: true, deadline: true } }),
      this.db.opportunity.findMany({ where: { tenantId: t }, select: { stage: true, value: true, probability: true } }),
      this.db.approval.count({ where: { tenantId: t, status: 'pending' } }),
      this.db.vendor.count({ where: { tenantId: t } }),
    ]);
    const live = projects.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
    const revenue = projects.reduce((s, p) => s + p.completes * p.cpiSell, 0);
    const cost = projects.reduce((s, p) => s + p.completes * p.cpiCost, 0);
    const byOps: Record<string, number> = {};
    for (const p of projects) { const o = lifecycleToOps[p.stage as LifecycleStage] ?? 'Other'; byOps[o] = (byOps[o] ?? 0) + 1; }
    const open = opps.filter((o) => !['Won', 'Lost'].includes(o.stage));
    const showMargin = can(ctx.role, 'view:margins');
    return {
      projects: projects.length, liveProjects: live.length,
      completes: projects.reduce((s, p) => s + p.completes, 0), target: projects.reduce((s, p) => s + p.target, 0),
      recognisedRevenue: Math.round(revenue), ...(showMargin ? { grossMargin: revenue ? +(1 - cost / revenue).toFixed(3) : 0 } : {}),
      pipelineValue: open.reduce((s, o) => s + o.value, 0), weightedPipeline: Math.round(open.reduce((s, o) => s + o.value * o.probability, 0)),
      pendingApprovals: pending, vendors, byOpsStage: byOps,
      overdue: projects.filter((p) => p.deadline < new Date() && !['Invoice', 'Project Closure'].includes(p.stage)).length,
    };
  }
}
