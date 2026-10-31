/**
 * Project sync and response import with the panels' Sampledge routes.
 *
 * - Sync creates or updates the project on the panel (a draft there: it sends nobody anything).
 *   Invitations and soft launch stay behind a 'High-volume communications' approval.
 * - Import pulls the panel's response feed page by page from the saved cursor and upserts
 *   PanelResponse rows, so running it twice never double counts. Rows are pseudonymous
 *   (respondentID, age band, gender, country, region).
 * - Imported counts are shown beside the project's own; they never overwrite Project.completes,
 *   which also counts other suppliers.
 */
import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import type { Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { PanelBackend, PanelBackendError, panelConfig, PANELS, panelTenant, type PanelId } from './panel-backend';
import { buildPanelProject, type SyncOptions } from './panel-sync';

const MAX_PAGES = Number(process.env.PANEL_IMPORT_MAX_PAGES ?? 20);
const STATUSES = ['invited', 'started', 'complete', 'terminate', 'overquota', 'qualityterminate', 'dropout'];

type FeedItem = {
  responseID?: unknown; respondentID?: unknown; marketID?: unknown; quotaID?: unknown; status?: unknown; qualityReasons?: unknown;
  start?: unknown; end?: unknown; loiMinutes?: unknown; deviceType?: unknown; points?: unknown; profile?: unknown; updatedAt?: unknown;
};
const str = (v: unknown, max = 120) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const date = (v: unknown) => { if (typeof v !== 'string') return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Only the pseudonymous profile fields are kept, whatever else the panel sends. */
const profileOf = (v: unknown) => {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return { countryCode: str(p.countryCode, 2), region: str(p.region, 20), ageBand: str(p.ageBand, 10), gender: str(p.gender, 10), category: str(p.category, 30) };
};

function upstream(e: unknown): never {
  if (e instanceof PanelBackendError) {
    if (e.status === 503) throw new ServiceUnavailableException(e.message);
    throw new BadGatewayException(e.message);
  }
  throw e;
}

@Injectable()
export class PanelSyncService {
  private log = new Logger('PanelSync');
  constructor(private db: PrismaService, private audit: AuditService, private backend: PanelBackend) {}

  /** Same rule as the rest of the panel connection: only the workspace that owns the panels. */
  private async owner(ctx: Ctx) {
    const t = await this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } });
    if (t?.slug !== panelTenant()) throw new ForbiddenException('The panel connection belongs to another workspace');
  }

  private async project(ctx: Ctx, projectId: string) {
    const p = await this.db.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId }, include: { quotas: true } });
    if (!p) throw new NotFoundException('Unknown project');
    return p;
  }

  private build(p: Awaited<ReturnType<PanelSyncService['project']>>, opts: SyncOptions) {
    try {
      return buildPanelProject(
        { code: p.code, name: p.name, audience: p.audience, countries: p.countries, target: p.target, ir: p.ir, loi: p.loi, cpiCost: p.cpiCost },
        p.quotas.map((q) => ({ key: q.key, label: q.label, condition: q.condition, target: q.target })),
        opts,
      );
    } catch (e) { throw new BadRequestException((e as Error).message); }
  }

  async list(ctx: Ctx) {
    await this.owner(ctx);
    const rows = await this.db.panelSync.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const counts = await this.db.panelResponse.groupBy({ by: ['panel', 'projectId', 'status'], where: { tenantId: ctx.tenantId }, _count: { _all: true } });
    return rows.map((r) => ({
      id: r.id, panel: r.panel, panelName: PANELS[r.panel as PanelId] ?? r.panel, projectId: r.projectId, pid: r.pid, syncedAt: r.syncedAt, importedAt: r.importedAt, importError: r.importError,
      counts: Object.fromEntries(counts.filter((c) => c.panel === r.panel && c.projectId === r.projectId).map((c) => [c.status, c._count._all])),
    }));
  }

  async preview(ctx: Ctx, panel: PanelId, projectId: string, opts: SyncOptions) {
    await this.owner(ctx);
    const p = await this.project(ctx, projectId);
    return { panel, connected: panelConfig(panel).connected, ...this.build(p, opts) };
  }

  async push(ctx: Ctx, panel: PanelId, projectId: string, opts: SyncOptions) {
    await this.owner(ctx);
    const p = await this.project(ctx, projectId);
    const { body, unmapped } = this.build(p, opts);
    if (unmapped.length) throw new BadRequestException(`Give panel filters for: ${unmapped.map((u) => u.label).join(', ')}`);
    const call = await this.db.panelCall.create({ data: { tenantId: ctx.tenantId, panel, action: 'sync', method: 'PUT', path: 'project', body: body as unknown as Prisma.InputJsonValue, status: 'sending', requestedBy: ctx.userId } });
    let reply;
    try {
      reply = await this.backend.syncProject(panel, body);
    } catch (e) {
      const err = e instanceof PanelBackendError ? e : null;
      await this.db.panelCall.update({ where: { id: call.id }, data: { status: err?.status === 503 ? 'not_sent' : 'failed', httpStatus: err?.status ?? null, error: (e as Error).message.slice(0, 500), completedAt: new Date() } });
      upstream(e);
    }
    await this.db.panelCall.update({ where: { id: call.id }, data: { status: 'sent', httpStatus: reply.status, response: (reply.data ?? null) as Prisma.InputJsonValue, completedAt: new Date() } });
    const link = await this.db.panelSync.upsert({
      where: { tenantId_panel_projectId: { tenantId: ctx.tenantId, panel, projectId } },
      create: { tenantId: ctx.tenantId, panel, projectId, pid: p.code, body: body as unknown as Prisma.InputJsonValue, syncedAt: new Date(), syncedBy: ctx.userId },
      update: { pid: p.code, body: body as unknown as Prisma.InputJsonValue, syncedAt: new Date(), syncedBy: ctx.userId },
    });
    await this.audit.log(ctx, 'panel.project_synced', 'Project', projectId, undefined, { panel, pid: p.code, markets: body.markets.length });
    return { synced: true, link: { id: link.id, pid: link.pid, syncedAt: link.syncedAt }, panelReply: reply.data, message: reply.message };
  }

  async status(ctx: Ctx, panel: PanelId, projectId: string) {
    await this.owner(ctx);
    const link = await this.db.panelSync.findUnique({ where: { tenantId_panel_projectId: { tenantId: ctx.tenantId, panel, projectId } } });
    if (!link) throw new NotFoundException('This project has not been synced to that panel');
    const rows = await this.db.panelResponse.groupBy({ by: ['marketID', 'status'], where: { tenantId: ctx.tenantId, panel, projectId }, _count: { _all: true } });
    const imported = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).reduce((a, r) => a + r._count._all, 0)]));
    let live: unknown = null;
    let liveError: string | null = null;
    try { live = (await this.backend.projectStatus(panel, link.pid)).data; } catch (e) { liveError = (e as Error).message; }
    return { pid: link.pid, syncedAt: link.syncedAt, importedAt: link.importedAt, importError: link.importError, imported, live, liveError };
  }

  async importFor(ctx: Ctx, panel: PanelId, projectId: string) {
    await this.owner(ctx);
    const link = await this.db.panelSync.findUnique({ where: { tenantId_panel_projectId: { tenantId: ctx.tenantId, panel, projectId } } });
    if (!link) throw new NotFoundException('This project has not been synced to that panel');
    const r = await this.importLink(link.id);
    if (r.error) throw new BadGatewayException(r.error);
    await this.audit.log(ctx, 'panel.responses_imported', 'Project', projectId, undefined, { panel, received: r.received });
    return r;
  }

  /** Imports one link's new responses. Used by the route and by the worker's periodic import. */
  async importLink(linkId: string): Promise<{ received: number; pages: number; more: boolean; error: string | null }> {
    const link = await this.db.panelSync.findUniqueOrThrow({ where: { id: linkId } });
    const panel = link.panel as PanelId;
    let cursor = link.cursor;
    let received = 0, pages = 0, more = false;
    try {
      while (pages < MAX_PAGES) {
        const reply = await this.backend.responses(panel, link.pid, { cursor });
        pages += 1;
        const data = (reply.data ?? {}) as { items?: unknown; nextCursor?: unknown };
        const items = Array.isArray(data.items) ? (data.items as FeedItem[]) : [];
        await this.db.$transaction(items.map((it) => {
          const responseID = str(it.responseID);
          const status = str(it.status, 30);
          if (!responseID || !status) throw new Error('A response from the panel had no responseID or status');
          const row = {
            respondentID: str(it.respondentID), marketID: str(it.marketID), quotaID: str(it.quotaID), status: status.toLowerCase(),
            qualityReasons: Array.isArray(it.qualityReasons) ? it.qualityReasons.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
            startedAt: date(it.start), endedAt: date(it.end), loiMinutes: num(it.loiMinutes), deviceType: str(it.deviceType, 20),
            points: Math.round(num(it.points) ?? 0), profile: (profileOf(it.profile) ?? Prisma.JsonNull) as Prisma.InputJsonValue, panelUpdatedAt: date(it.updatedAt), importedAt: new Date(),
          };
          return this.db.panelResponse.upsert({
            where: { tenantId_panel_responseID: { tenantId: link.tenantId, panel, responseID } },
            create: { tenantId: link.tenantId, panel, projectId: link.projectId, responseID, ...row },
            update: row,
          });
        }));
        received += items.length;
        const next = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
        // Keep the position after the last item so the next import starts there.
        if (next) cursor = next;
        else if (items.length) cursor = cursorAfter(items[items.length - 1]) ?? cursor;
        await this.db.panelSync.update({ where: { id: link.id }, data: { cursor, importedAt: new Date(), importError: null } });
        if (!next) { more = false; break; }
        more = true;
      }
      return { received, pages, more, error: null };
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      await this.db.panelSync.update({ where: { id: link.id }, data: { importError: error } });
      this.log.warn(`import ${link.panel}/${link.pid}: ${error}`);
      return { received, pages, more, error };
    }
  }

  /** For the worker: every linked project whose panel is configured. */
  async importAll() {
    const links = await this.db.panelSync.findMany({ select: { id: true, panel: true } });
    let received = 0;
    for (const l of links) {
      if (!panelConfig(l.panel as PanelId).connected) continue;
      received += (await this.importLink(l.id)).received;
    }
    return { links: links.length, received };
  }
}

/**
 * The panel's cursor format, rebuilt for the last item of a final page so a later import asks only
 * for changes after it (the panel encodes {t, id} as base64url JSON).
 */
function cursorAfter(it: FeedItem): string | null {
  const t = str(it.updatedAt), id = str(it.responseID);
  return t && id ? Buffer.from(JSON.stringify({ t, id })).toString('base64url') : null;
}
