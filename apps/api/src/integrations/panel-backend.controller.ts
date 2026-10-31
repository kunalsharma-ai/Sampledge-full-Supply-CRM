/**
 * Panel backend routes. Reads (status, CPI, options, feasibility counts, project status) call the
 * backend directly; actions that change the panel create an approval and nothing else. Only the
 * workspace that owns the panels (PANEL_BACKEND_TENANT) may use the connection.
 */
import { BadGatewayException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { paged, pageArgs } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { PanelBackend, PanelBackendError, panelActions, panelConfig, panelIds, panelTenant, type PanelAction, type PanelId } from './panel-backend';
import { PanelSyncService } from './panel-sync.service';

const Panel = z.enum(panelIds as [PanelId, ...PanelId[]]);
const Cpi = z.object({ category: z.string().min(1).max(100), subcategory: z.string().max(100).optional(), ir: z.number().gt(0).max(100), loi: z.number().int().min(1).max(120), country: z.string().min(2).max(60) });
const Action = z.object({ action: z.enum(Object.keys(panelActions) as [PanelAction, ...PanelAction[]]), body: z.record(z.string(), z.unknown()).optional(), note: z.string().max(500).optional() });
const Filter = z.object({ type: z.string().min(1).max(60), value: z.unknown() });
const Reach = z.object({ country: z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code'), filters: z.array(Filter).max(30).optional(), activeWithinDays: z.number().int().min(1).max(3650).optional() });
const SyncOpts = z.object({
  quotaFilters: z.record(z.string(), z.array(Filter).max(10)).optional(),
  marketFilters: z.record(z.string(), z.array(Filter).max(20)).optional(),
  completes: z.record(z.string(), z.number().int().min(0).max(1_000_000)).optional(),
  links: z.object({ test: z.string().url().optional(), live: z.string().url().optional() }).optional(),
  softLaunch: z.number().int().min(1).max(10_000).optional(),
});
const remoteId = (id: string) => { if (!/^[\w.-]{1,100}$/.test(id)) throw new NotFoundException('Unknown project id'); return id; };

/** Upstream failures never surface as 401/403: those would read as this user's own session failing. */
function upstream(e: unknown): never {
  if (e instanceof PanelBackendError) {
    if (e.status === 503) throw new ServiceUnavailableException(e.message);
    throw new BadGatewayException(e.message);
  }
  throw e;
}

@Injectable()
export class PanelBackendService {
  constructor(private db: PrismaService, private audit: AuditService, private backend: PanelBackend) {}

  async owner(ctx: Ctx) {
    const t = await this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } });
    if (t?.slug !== panelTenant()) throw new ForbiddenException('The panel connection belongs to another workspace');
  }

  status() {
    return panelIds.map((p) => {
      const c = panelConfig(p);
      return { panel: p, name: c.name, host: c.url ? new URL(c.url).host : null, connected: c.connected, verified: false, note: c.connected ? 'Configured; not yet verified against the backend in this build' : 'Not connected: no URL or app token configured' };
    });
  }

  async read<T>(ctx: Ctx, fn: () => Promise<T>) {
    await this.owner(ctx);
    try { return await fn(); } catch (e) { upstream(e); }
  }

  async requestAction(ctx: Ctx, panel: PanelId, projectId: string, x: z.infer<typeof Action>) {
    await this.owner(ctx);
    const a = panelActions[x.action];
    const cfg = panelConfig(panel);
    return this.db.$transaction(async (tx) => {
      const ap = await requestApproval(tx, {
        tenantId: ctx.tenantId, kind: a.kind, requestedBy: ctx.userId,
        title: `${a.label} on ${cfg.name}: project ${projectId}${cfg.connected ? '' : ' (panel not connected: will not be sent)'}`,
        payload: { panelAction: x.action, panel, remoteProjectId: projectId, body: JSON.stringify(x.body ?? {}), note: x.note ?? '' },
      });
      await this.audit.log(ctx, 'panel.action_requested', 'Approval', ap.id, undefined, { panel, action: x.action, projectId }, tx);
      return { approval: { id: ap.id, kind: ap.kind, status: ap.status, title: ap.title }, connected: cfg.connected };
    });
  }
}

@ForModule('panels')
@Controller('panel-backend')
export class PanelBackendController {
  constructor(private s: PanelBackendService, private backend: PanelBackend, private db: PrismaService, private sync: PanelSyncService) {}

  /** Which panels are configured. Makes no network call. */
  @Get()
  async status(@Caller() ctx: Ctx) {
    const t = await this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } });
    return { owner: t?.slug === panelTenant(), verifiedAgainstBackend: false, panels: this.s.status() };
  }

  @Get('calls')
  async calls(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const { want, ...page } = pageArgs(q, 200, 50);
    return paged(await this.db.panelCall.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page }), want, res);
  }

  /** Verifies a panel's URL and token with a read of the app user's own profile. */
  @Post(':panel/check') @HttpCode(200)
  async check(@Caller() ctx: Ctx, @Param('panel') p: string) {
    const panel = parse(Panel, p);
    const r = await this.s.read(ctx, () => this.backend.whoami(panel));
    return { panel, ok: true, message: r?.message ?? null, fields: r?.data && typeof r.data === 'object' ? Object.keys(r.data as object).slice(0, 30) : [] };
  }

  @Post(':panel/cpi') @HttpCode(200)
  cpi(@Caller() ctx: Ctx, @Param('panel') p: string, @Body() b: unknown) {
    const panel = parse(Panel, p);
    const q = parse(Cpi, b);
    return this.s.read(ctx, () => this.backend.cpi(panel, q));
  }

  @Get(':panel/cpi/categories')
  cpiCategories(@Caller() ctx: Ctx, @Param('panel') p: string, @Query('category') category?: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.cpiCategories(panel, category?.slice(0, 100)));
  }

  @Get(':panel/options/:country/:field')
  options(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('country') country: string, @Param('field') field: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.feasibilityOptions(panel, country.slice(0, 60), field.slice(0, 60)));
  }

  /** Panelist count for a filter in the backend's own format (passed through unchanged). */
  @Post(':panel/feasibility') @HttpCode(200)
  feasibility(@Caller() ctx: Ctx, @Param('panel') p: string, @Body() b: unknown) {
    const panel = parse(Panel, p);
    const x = parse(z.object({ filter: z.record(z.string(), z.unknown()) }), b);
    return this.s.read(ctx, () => this.backend.feasibility(panel, x.filter));
  }

  @Get(':panel/projects/:id')
  project(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('id') id: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.project(panel, remoteId(id)));
  }

  @Get(':panel/projects/:id/qualified')
  qualified(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('id') id: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.qualified(panel, remoteId(id)));
  }

  // ───── The panel's Sampledge routes (agreed with the panel team; see docs/integrations/TURN2OPINION.md)
  /** Reachable panelists for a country and filters, with breakdowns. */
  @Post(':panel/reach') @HttpCode(200)
  reach(@Caller() ctx: Ctx, @Param('panel') p: string, @Body() b: unknown) {
    const panel = parse(Panel, p);
    const q = parse(Reach, b);
    return this.s.read(ctx, () => this.backend.reach(panel, { ...q, country: q.country.toUpperCase() }));
  }

  @Get(':panel/questions')
  questions(@Caller() ctx: Ctx, @Param('panel') p: string, @Query('category') category?: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.questions(panel, category?.slice(0, 60)));
  }

  @Get(':panel/respondents/:rid')
  respondent(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('rid') rid: string) {
    const panel = parse(Panel, p);
    return this.s.read(ctx, () => this.backend.respondentProfile(panel, remoteId(rid)));
  }

  /** Projects that can be synced (enough to pick one; full details stay in Projects). */
  @Get('projects')
  async projects(@Caller() ctx: Ctx) {
    await this.s.owner(ctx);
    const rows = await this.db.project.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true, name: true, countries: true, audience: true, target: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows;
  }

  @Get('syncs')
  syncs(@Caller() ctx: Ctx) { return this.sync.list(ctx); }

  /** What would be sent for a project, and which quotas still need panel filters. No network call. */
  @Post(':panel/sync/:projectId/preview') @HttpCode(200)
  preview(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('projectId') id: string, @Body() b: unknown) {
    return this.sync.preview(ctx, parse(Panel, p), id, parse(SyncOpts, b ?? {}));
  }

  /** Creates or updates the project on the panel. Sends no invitations: those still need an approval. */
  @Post(':panel/sync/:projectId') @Write() @HttpCode(200)
  push(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('projectId') id: string, @Body() b: unknown) {
    return this.sync.push(ctx, parse(Panel, p), id, parse(SyncOpts, b ?? {}));
  }

  /** Counts imported so far, plus the panel's own live status when it can be reached. */
  @Get(':panel/sync/:projectId')
  syncStatus(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('projectId') id: string) {
    return this.sync.status(ctx, parse(Panel, p), id);
  }

  @Post(':panel/sync/:projectId/import') @Write() @HttpCode(200)
  import(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('projectId') id: string) {
    return this.sync.importFor(ctx, parse(Panel, p), id);
  }

  /** Asks for approval to invite, soft-launch or cancel on the panel. Sends nothing by itself. */
  @Post(':panel/projects/:id/actions') @Write() @HttpCode(202)
  action(@Caller() ctx: Ctx, @Param('panel') p: string, @Param('id') id: string, @Body() b: unknown) {
    return this.s.requestAction(ctx, parse(Panel, p), remoteId(id), parse(Action, b));
  }
}

