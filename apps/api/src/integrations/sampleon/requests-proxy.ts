/**
 * SampAudience audience requests, read through for the SUPPLY360 screens.
 *
 * SampAudience (SAMPLEON) owns audience requests: feasibility, allocation, launch, batches and
 * routing all happen there, and decisions are made by a SampAudience approver. SUPPLY360 reads
 * them with its own signed service identity (contract §5.0), the same one it uses to send events,
 * so the allocation, survey, launch, batch and routing screens can show the real pipeline.
 *
 * - `GET /sampaudience/status`: whether SampAudience is configured, and where its console is.
 * - `GET /sampaudience/requests`: every request SUPPLY360 can see (newest first), each with its
 *   full view (feasibility, allocation, quota cells, batches, outcomes, routing counts) and what
 *   SUPPLY360 itself recorded for it (survey cards issued, completes, reward points).
 * - `GET /sampaudience/requests/:id`: one request, the same shape.
 *
 * When SAMPLEON_URL and SAMPLEON_SECRET are not set the list answers `connected: false` and the
 * screens keep their labelled demo data. A SampAudience error is a 502 with its message.
 */
import { BadGatewayException, Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { signRequest } from '@sampledge/contracts';
import { access } from '@sampledge/core';
import { z } from 'zod';
import { Caller, type Ctx } from '../../common/context';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/zod';
import { sampleonConfig } from './s2s';

export type SampRequestView = {
  audienceRequestId: string; status: string; title: string | null;
  source: { platform: string; projectId: string; surveyId: string };
  organization: { id: string; name: string };
  spec: Record<string, unknown>;
  requiredCompletes: number; completes: number; remaining: number;
  approval: { approvedBy: string | null; approvedAt: string | null; note: string | null };
  launch: { mode: string | null; softLaunchTarget: number | null; autoBatches: boolean | null };
  feasibility: Record<string, unknown> | null;
  allocation: { country: string; panel: string; target: number }[];
  quotas: { id: string; label: string; country: string | null; target: number; completes: number; hard: boolean; full: boolean }[];
  batches: { id: string; mode: string; size: number; scheduled_at: string; auto: boolean; status: string; selected: number | null; delivered: number | null; suppressed: number | null; error: string | null; sent_at: string | null }[];
  outcomes: Record<string, number>;
  routing: { decisions: number; routed: number };
  createdAt: string; updatedAt: string;
};

/** Signed GET to SampAudience as SUPPLY360. */
export async function sampleonGet<T>(path: string): Promise<T> {
  const c = sampleonConfig();
  if (!c.url || !c.secret) throw new BadGatewayException('SampAudience is not connected (SAMPLEON_URL and SAMPLEON_SECRET)');
  const u = new URL(`${c.url}${path}`);
  let res: Response;
  try {
    res = await fetch(u, { headers: signRequest({ clientId: c.clientIdAtSampleon, secret: c.secret, method: 'GET', path: u.pathname + u.search, body: '' }), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new BadGatewayException(`SampAudience did not answer: ${e instanceof Error ? e.message : 'network error'}`);
  }
  const text = await res.text();
  if (res.status === 404) throw new NotFoundException('SampAudience has no such audience request');
  if (!res.ok) throw new BadGatewayException(`SampAudience answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const consoleUrl = () => process.env.SAMPLEON_CONSOLE_URL?.replace(/\/+$/, '') || (sampleonConfig().url ? `${sampleonConfig().url}/console` : null);

@Controller('sampaudience')
export class SampAudienceRequestsController {
  constructor(private db: PrismaService) {}

  /** Panel and marketplace roles read this; vendors and clients never do. */
  private allow(ctx: Ctx) {
    const ok = (['panels', 'marketplace'] as const).some((m) => ['full', 'read'].includes(access(ctx.role, m)));
    if (!ok) throw new ForbiddenException('Your role has no access to SampAudience requests');
  }

  private async local(ctx: Ctx, ids: string[]) {
    if (!ids.length) return new Map<string, { cards: number; completes: number; points: number }>();
    const [cards, parts] = await Promise.all([
      this.db.surveyCard.groupBy({ by: ['audienceRequestId'], where: { tenantId: ctx.tenantId, audienceRequestId: { in: ids } }, _count: true }),
      this.db.participation.findMany({ where: { tenantId: ctx.tenantId, audienceRequestId: { in: ids }, status: 'complete' }, select: { audienceRequestId: true, rewardEntryId: true } }),
    ]);
    const entryIds = parts.map((p) => p.rewardEntryId).filter((x): x is string => !!x);
    const pts = new Map((entryIds.length ? await this.db.incentiveEntry.findMany({ where: { tenantId: ctx.tenantId, id: { in: entryIds } }, select: { id: true, points: true } }) : []).map((e) => [e.id, e.points]));
    return new Map(ids.map((id) => {
      const done = parts.filter((p) => p.audienceRequestId === id);
      return [id, { cards: cards.find((c) => c.audienceRequestId === id)?._count ?? 0, completes: done.length, points: done.reduce((s, p) => s + (p.rewardEntryId ? pts.get(p.rewardEntryId) ?? 0 : 0), 0) }];
    }));
  }

  @Get('status')
  status(@Caller() ctx: Ctx) {
    this.allow(ctx);
    const c = sampleonConfig();
    return { connected: !!(c.url && c.secret), consoleUrl: consoleUrl() };
  }

  @Get('requests')
  async list(@Caller() ctx: Ctx, @Query() q: unknown) {
    this.allow(ctx);
    const x = parse(z.object({ platform: z.enum(['PROJEXA', 'ZAPX']).optional(), status: z.string().max(30).optional() }).passthrough(), q);
    const c = sampleonConfig();
    if (!c.url || !c.secret) return { connected: false, consoleUrl: null, requests: [] };
    const qs = new URLSearchParams();
    if (x.platform) qs.set('platform', x.platform);
    if (x.status) qs.set('status', x.status);
    const { data } = await sampleonGet<{ data: { id: string }[] }>(`/api/v1/audience-requests${qs.size ? `?${qs}` : ''}`);
    const views: SampRequestView[] = [];
    const ids = data.slice(0, 60).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 8) views.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => sampleonGet<SampRequestView>(`/api/v1/audience-requests/${encodeURIComponent(id)}`)))));
    const local = await this.local(ctx, ids);
    return { connected: true, consoleUrl: consoleUrl(), requests: views.map((v) => ({ ...v, recorded: local.get(v.audienceRequestId) })) };
  }

  @Get('requests/:id')
  async one(@Caller() ctx: Ctx, @Param('id') id: string) {
    this.allow(ctx);
    if (!/^AR-[0-9A-Z]{26}$/.test(id)) throw new NotFoundException('Not an audience request id');
    const v = await sampleonGet<SampRequestView>(`/api/v1/audience-requests/${id}`);
    return { ...v, recorded: (await this.local(ctx, [id])).get(id), consoleUrl: consoleUrl() };
  }
}
