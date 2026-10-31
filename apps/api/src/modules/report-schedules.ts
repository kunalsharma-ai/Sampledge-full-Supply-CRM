/**
 * Scheduled report delivery: a survey's report or tables released to the client every day or week.
 *
 * Each run is an ordinary deliverable release made on behalf of the person who set the schedule,
 * checked against their access at run time (a schedule stops working if they lose it). The client
 * gets the usual Comms Hub e-mail saying a file is ready (sent through SMTP when it is configured,
 * otherwise recorded by the development adapter); the file itself stays in the client portal.
 * Respondent-level data cannot be scheduled: each release of it needs its own approval.
 * Runs are claimed with a conditional update, so several API instances never run one twice.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { access, type Role } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';
import { parse } from '../common/zod';
import { deliverableKinds, DeliverablesService } from './deliverables';

const SCHEDULABLE = ['report_pdf', 'report_pptx', 'tables_xlsx'] as const;

const CreateBody = z.object({
  projectId: z.string().max(40),
  surveyId: z.string().max(40),
  kind: z.enum(SCHEDULABLE, { error: 'Only reports and tables can be scheduled; respondent-level data needs an approval each time' }),
  frequency: z.enum(['daily', 'weekly']),
  weekday: z.number().int().min(0).max(6).optional(), // 0 = Sunday, for weekly
  hourUtc: z.number().int().min(0).max(23),
}).strict().refine((b) => b.frequency === 'daily' || b.weekday !== undefined, { message: 'Pick a weekday for a weekly schedule', path: ['weekday'] });

/** The next run strictly after `from`, at hourUtc (and on weekday for weekly schedules). */
export function nextRun(from: Date, s: { frequency: string; weekday: number | null; hourUtc: number }) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), s.hourUtc));
  while (d <= from || (s.frequency === 'weekly' && d.getUTCDay() !== s.weekday)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const FIELDS = { id: true, projectId: true, surveyId: true, kind: true, frequency: true, weekday: true, hourUtc: true, active: true, createdBy: true, nextRunAt: true, lastRunAt: true, lastResult: true, lastDeliverableId: true, createdAt: true, project: { select: { code: true, name: true } } } as const;

@Injectable()
export class ReportSchedulesService {
  private log = new Logger('ReportSchedules');
  constructor(private db: PrismaService, private audit: AuditService, private deliverables: DeliverablesService) {}

  private staffOnly(ctx: Ctx) {
    if (ctx.role === 'client' || ctx.role === 'vendor') throw new ForbiddenException('Only the research team schedules deliveries');
  }

  list(ctx: Ctx) {
    this.staffOnly(ctx);
    return this.db.reportSchedule.findMany({ where: { tenantId: ctx.tenantId }, select: FIELDS, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
  }

  async create(ctx: Ctx, b: z.infer<typeof CreateBody>) {
    this.staffOnly(ctx);
    const project = await this.db.project.findFirst({ where: { id: b.projectId, tenantId: ctx.tenantId }, select: { id: true, clientId: true } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.clientId) throw new BadRequestException('This project has no client to deliver to');
    const survey = await this.db.survey.findFirst({ where: { id: b.surveyId, tenantId: ctx.tenantId }, select: { projectId: true } });
    if (!survey || survey.projectId !== project.id) throw new BadRequestException('The survey does not belong to this project');
    const weekday = b.frequency === 'weekly' ? b.weekday! : null;
    const nextRunAt = nextRun(new Date(), { frequency: b.frequency, weekday, hourUtc: b.hourUtc });
    return this.db.$transaction(async (tx) => {
      const s = await tx.reportSchedule.create({ data: { tenantId: ctx.tenantId, projectId: project.id, surveyId: b.surveyId, kind: b.kind, frequency: b.frequency, weekday, hourUtc: b.hourUtc, createdBy: ctx.name, createdById: ctx.userId, nextRunAt }, select: FIELDS });
      await this.audit.log(ctx, 'report_schedule.created', 'ReportSchedule', s.id, undefined, { kind: b.kind, frequency: b.frequency, weekday, hourUtc: b.hourUtc }, tx);
      return s;
    });
  }

  async setActive(ctx: Ctx, id: string, active: boolean) {
    this.staffOnly(ctx);
    const s = await this.db.reportSchedule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw new NotFoundException('Schedule not found');
    return this.db.$transaction(async (tx) => {
      const u = await tx.reportSchedule.update({ where: { id }, data: { active, ...(active ? { nextRunAt: nextRun(new Date(), s) } : {}) }, select: FIELDS });
      await this.audit.log(ctx, active ? 'report_schedule.resumed' : 'report_schedule.paused', 'ReportSchedule', id, { active: s.active }, { active }, tx);
      return u;
    });
  }

  /** Runs every due schedule once. Called by the worker; returns how many ran. */
  async runDue(now = new Date()) {
    const due = await this.db.reportSchedule.findMany({ where: { active: true, nextRunAt: { lte: now } }, take: 50, orderBy: { nextRunAt: 'asc' } });
    let ran = 0;
    for (const s of due) {
      await asTenant(s.tenantId, async () => {
        // Claim: only the instance whose update matches the old nextRunAt runs it.
        const claimed = await this.db.reportSchedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt, active: true }, data: { nextRunAt: nextRun(now, s), lastRunAt: now } });
        if (!claimed.count) return;
        ran++;
        let result: string;
        let deliverableId: string | null = null;
        try {
          const ctx = await this.ownerCtx(s.tenantId, s.createdById);
          const stamp = now.toISOString().slice(0, 10);
          const d = await this.deliverables.create(ctx, { projectId: s.projectId, surveyId: s.surveyId, kind: s.kind as (typeof SCHEDULABLE)[number], note: `Scheduled ${s.frequency} delivery, ${stamp}` });
          deliverableId = d.id;
          result = `Released ${deliverableKinds[s.kind as keyof typeof deliverableKinds].label} on ${stamp}`;
        } catch (e) {
          result = `Not delivered: ${(e as Error).message}`.slice(0, 300);
          this.log.warn(`schedule ${s.id}: ${result}`);
        }
        await this.db.reportSchedule.update({ where: { id: s.id }, data: { lastResult: result, ...(deliverableId ? { lastDeliverableId: deliverableId } : {}) } });
      });
    }
    return ran;
  }

  /** The schedule's owner as they are now: a run fails if they no longer have the access to release. */
  private async ownerCtx(tenantId: string, userId: string): Promise<Ctx> {
    const m = await this.db.membership.findFirst({ where: { tenantId, userId }, include: { user: { select: { name: true, email: true } } } });
    if (!m) throw new Error('The person who set this schedule is no longer a member');
    const role = m.role as Role;
    if (role === 'client' || role === 'vendor' || access(role, 'client-portal') !== 'full') throw new Error('The person who set this schedule can no longer release deliverables');
    return { userId, sessionId: 'scheduled', tenantId, role, name: m.user.name, email: m.user.email, vendorId: m.vendorId, clientId: m.clientId };
  }
}

@ForModule('client-portal')
@Controller('report-schedules')
export class ReportSchedulesController {
  constructor(private s: ReportSchedulesService) {}
  @Get() list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
  @Post() @Write() create(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.create(ctx, parse(CreateBody, b)); }
  @Post(':id/pause') @Write() pause(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.setActive(ctx, id, false); }
  @Post(':id/resume') @Write() resume(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.setActive(ctx, id, true); }
}
