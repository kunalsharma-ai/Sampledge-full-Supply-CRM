import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pageInMemory, paged, pageArgs } from '../common/paging';
import { can, evaluate, lifecycleToOps, type LifecycleStage } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { approvalKinds, fallbackDeciders, type ApprovalKind } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { emit } from '../common/events';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { panelActions, panelConfig, PANELS, type PanelAction, type PanelId } from '../integrations/panel-backend';
import { parse } from '../common/zod';

@Injectable()
export class ApprovalsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** An approved panel action becomes one PanelCall, which the worker sends at most once. */
  private async applyPanelAction(tx: Prisma.TransactionClient, tenantId: string, p: Record<string, string | number>, ok: boolean, meta: { approvalId: string; requestedBy: string }) {
    const a = panelActions[String(p.panelAction) as PanelAction];
    const panel = String(p.panel) as PanelId;
    if (!a || !(panel in PANELS)) return ok ? 'Unknown panel action; nothing sent' : 'Rejected';
    if (!ok) return `${a.label} on ${PANELS[panel]} rejected; nothing sent`;
    let body: unknown = undefined;
    try { body = p.body ? JSON.parse(String(p.body)) : undefined; } catch { /* stored by us; keep undefined */ }
    const call = await tx.panelCall.create({
      data: { tenantId, panel, action: String(p.panelAction), method: a.method, path: a.path(String(p.remoteProjectId)), body: a.method === 'DELETE' ? undefined : ((body ?? {}) as Prisma.InputJsonValue), approvalId: meta.approvalId, requestedBy: meta.requestedBy },
    });
    await emit(tx, tenantId, 'panel.call.approved', { callId: call.id });
    return panelConfig(panel).connected
      ? `${a.label} approved; sending to ${PANELS[panel]} once (see the panel call log)`
      : `${a.label} approved, but ${PANELS[panel]} is not connected: recorded, nothing sent`;
  }

  canDecide(ctx: Ctx, kind: string) {
    const perm = approvalKinds[kind as ApprovalKind];
    if (perm === undefined) return false;
    return perm ? can(ctx.role, perm) : fallbackDeciders.includes(ctx.role);
  }

  /** Approvals the caller requested or may decide. Client users only see publish requests on their projects. */
  async list(ctx: Ctx, status?: string) {
    const rows = await this.db.approval.findMany({ where: { tenantId: ctx.tenantId, ...(status ? { status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
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
      const effect = await this.apply(tx, ctx.tenantId, a.kind, payload, ok, { approvalId: a.id, requestedBy: a.requestedBy });
      const u = await tx.approval.update({ where: { id }, data: { status: decision, decidedBy: ctx.name, decidedAt: new Date(), payload: { ...payload, note: note ?? null, effect } as Prisma.InputJsonValue } });
      await this.audit.log(ctx, `approval.${decision}`, 'Approval', id, { status: 'pending' }, { status: decision, kind: a.kind, effect, note }, tx);
      await emit(tx, ctx.tenantId, 'approval.decided', { approvalId: id, kind: a.kind, decision, requestedBy: a.requestedBy });
      return { approval: u, effect };
    });
  }

  private async apply(tx: Prisma.TransactionClient, tenantId: string, kind: string, p: Record<string, string | number>, ok: boolean, meta: { approvalId: string; requestedBy: string }): Promise<string> {
    if (p.panelAction) return this.applyPanelAction(tx, tenantId, p, ok, meta);
    switch (kind) {
      case 'Publishing surveys': {
        if (!ok || !p.surveyId) return ok ? 'No survey linked' : 'Survey stays unpublished';
        await tx.survey.update({ where: { id: String(p.surveyId) }, data: { status: 'Published' } });
        await tx.surveyVersion.updateMany({ where: { surveyId: String(p.surveyId), version: Number(p.version) }, data: { publishedAt: new Date() } });
        await emit(tx, tenantId, 'survey.published', { surveyId: String(p.surveyId), version: Number(p.version) });
        return `Survey published (v${p.version}); respondent links are live`;
      }
      case 'Purchasing sample': {
        if (!p.allocationId) return ok ? 'Recorded (no allocation linked; demo request)' : 'Rejected';
        await tx.allocation.update({ where: { id: String(p.allocationId) }, data: { status: ok ? 'approved' : 'closed' } });
        if (ok) await emit(tx, tenantId, 'allocation.approved', { allocationId: String(p.allocationId) });
        return ok ? 'Allocation approved; a purchase order and payable are being raised. Delivery to the supplier uses the development adapter (nothing leaves the system).' : 'Allocation closed';
      }
      case 'Sending binding quotations': {
        if (!p.quoteId) return ok ? 'Recorded (no quote linked; demo request)' : 'Rejected';
        await tx.quote.update({ where: { id: String(p.quoteId) }, data: { status: ok ? 'sent' : 'rejected' } });
        if (ok) await tx.opportunity.updateMany({ where: { id: String(p.opportunityId), stage: { in: ['New RFQ', 'Qualifying', 'Feasibility'] } }, data: { stage: 'Quote Sent', probability: 0.5 } });
        if (ok) await emit(tx, tenantId, 'quote.sent', { quoteId: String(p.quoteId) });
        return ok ? 'Quote approved and queued to the client in the Comms Hub (development adapter: recorded, not emailed).' : 'Quote rejected';
      }
      case 'Issuing payments': {
        if (!p.payableId) return ok ? 'Recorded (no payable linked; demo request)' : 'Rejected';
        const pay = await tx.payable.update({ where: { id: String(p.payableId) }, data: ok ? { status: 'paid', paidAt: new Date() } : { status: 'open' } });
        if (!ok) return 'Payment rejected; payable is open again';
        await tx.vendor.update({ where: { id: pay.vendorId }, data: { pendingPayment: { decrement: pay.amount } } });
        await emit(tx, tenantId, 'payable.paid', { payableId: pay.id });
        return 'Payable marked paid. No money moves: payment rails are not connected.';
      }
      case 'High-volume communications': {
        if (!p.messageId) return ok ? 'Recorded (no message linked; demo request)' : 'Rejected';
        await tx.message.update({ where: { id: String(p.messageId) }, data: { status: ok ? 'queued' : 'cancelled' } });
        if (ok) await emit(tx, tenantId, 'message.queued', { messageId: String(p.messageId) });
        return ok ? 'Message queued for the development adapter (recorded, not sent)' : 'Message cancelled';
      }
      case 'Rejecting respondents': {
        if (!p.responseId) return ok ? 'Recorded' : 'Rejected';
        if (!ok) return 'Rejection declined; the interview stays in the results';
        const r = await tx.response.findUniqueOrThrow({ where: { id: String(p.responseId) }, include: { survey: { select: { projectId: true } } } });
        if (r.rejectedAt) return 'Already rejected';
        await tx.response.update({ where: { id: r.id }, data: { rejectedAt: new Date() } });
        // Give the quota places back so fieldwork can replace the interview.
        const def = await tx.surveyVersion.findFirst({ where: { surveyId: r.surveyId, version: r.version } });
        const quotas = ((def?.definition as { quotas?: { id: string; when: unknown }[] } | undefined)?.quotas ?? []);
        let freed = 0;
        for (const q of quotas) {
          if (!evaluate(q.when as never, r.answers as never)) continue;
          freed += await tx.$executeRaw`UPDATE "QuotaCell" SET "count" = GREATEST("count" - 1, 0) WHERE "surveyId" = ${r.surveyId} AND "key" = ${q.id}`;
        }
        if (r.survey.projectId) await tx.project.update({ where: { id: r.survey.projectId }, data: { completes: { decrement: 1 } } });
        return `Interview rejected and removed from results; ${freed} quota place${freed === 1 ? '' : 's'} released`;
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
  /** Visibility is decided per approval in memory, so this list pages after filtering. */
  @Get() async list(@Caller() ctx: Ctx, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) { return pageInMemory(await this.s.list(ctx, typeof q.status === 'string' ? q.status : undefined), q, res); }

  @Post(':id/decision') @HttpCode(200)
  decide(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(1000).optional() }), b);
    return this.s.decide(ctx, id, x.decision, x.note);
  }
}

@Controller()
export class OpsController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** Notifications for the caller's role, newest first, with `read` for this person. */
  @Get('notifications')
  async notifications(@Caller() ctx: Ctx) {
    const rows = await this.db.notification.findMany({
      where: { tenantId: ctx.tenantId, OR: [{ roles: { isEmpty: true } }, { roles: { has: ctx.role } }] },
      orderBy: { createdAt: 'desc' }, take: 50, include: { reads: { where: { userId: ctx.userId }, select: { readAt: true } } },
    });
    return rows.map(({ reads, ...n }) => ({ ...n, read: reads.length > 0, readAt: reads[0]?.readAt ?? null }));
  }

  @Post('notifications/read-all') @HttpCode(200)
  async readAll(@Caller() ctx: Ctx) {
    const unread = await this.db.notification.findMany({ where: { tenantId: ctx.tenantId, OR: [{ roles: { isEmpty: true } }, { roles: { has: ctx.role } }], reads: { none: { userId: ctx.userId } } }, select: { id: true } });
    const r = await this.db.notificationRead.createMany({ data: unread.map((n) => ({ tenantId: ctx.tenantId, notificationId: n.id, userId: ctx.userId })), skipDuplicates: true });
    return { updated: r.count };
  }

  @Post('notifications/:id/read') @HttpCode(200)
  async readOne(@Caller() ctx: Ctx, @Param('id') id: string) {
    const n = await this.db.notification.findFirst({ where: { id, tenantId: ctx.tenantId, OR: [{ roles: { isEmpty: true } }, { roles: { has: ctx.role } }] }, select: { id: true } });
    if (!n) throw new NotFoundException('Notification not found');
    await this.db.notificationRead.upsert({ where: { notificationId_userId: { notificationId: id, userId: ctx.userId } }, create: { tenantId: ctx.tenantId, notificationId: id, userId: ctx.userId }, update: {} });
    return { id, read: true };
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
  async auditLog(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const x = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional() }).passthrough(), q);
    const { want, ...page } = pageArgs(q, 500, 100);
    return paged(await this.db.auditLog.findMany({ where: { tenantId: ctx.tenantId, ...(x.entity ? { entity: x.entity } : {}), ...(x.entityId ? { entityId: x.entityId } : {}) }, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...page }), want, res);
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
