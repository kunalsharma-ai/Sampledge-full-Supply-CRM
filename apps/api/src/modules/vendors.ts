import type { Response } from 'express';
import { Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Query, Res } from '@nestjs/common';
import { rankVendors, type Vendor as CoreVendor } from '@sampledge/core';
import type { Vendor } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { redactAllocation, redactVendor } from '../common/redact';
import { parse } from '../common/zod';

export const toCoreVendor = (v: Vendor & { _count?: { allocations: number } }): CoreVendor => ({
  id: v.id, name: v.name, hq: v.hq, coverage: v.coverage, audiences: v.audiences, cpiB2C: v.cpiB2C, cpiB2B: v.cpiB2B, cpiHC: v.cpiHC,
  quality: v.quality, reliability: v.reliability, responseRate: v.responseRate, speed: v.speed, activeAllocations: v._count?.allocations ?? 0,
  delivered: v.delivered, pendingPayment: v.pendingPayment, bidWinRate: v.bidWinRate, verified: v.verified,
});

/** Exit links must be https and may carry {rid}; nothing else from the response is ever substituted. */
const ExitUrl = z.string().trim().max(2000).url().refine((u) => u.startsWith('https://'), 'Use an https:// link').nullable().optional();
const Redirects = z.object({ completeUrl: ExitUrl, screenoutUrl: ExitUrl, overquotaUrl: ExitUrl }).strict();

const RankQuery = z.object({ audience: z.enum(['B2B', 'B2C', 'Healthcare']), country: z.string().length(2), n: z.coerce.number().int().positive(), ir: z.coerce.number().gt(0).max(1), loi: z.coerce.number().int().positive() });

@Injectable()
export class VendorsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** Exit links for one allocation: the vendor it belongs to, or a team member with full Sample Exchange access. */
  async setRedirects(ctx: Ctx, id: string, body: z.infer<typeof Redirects>) {
    const a = await this.db.allocation.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Allocation not found');
    if (ctx.role === 'vendor' && a.vendorId !== ctx.vendorId) throw new ForbiddenException('Not your allocation');
    const pick = (x: { completeUrl: string | null; screenoutUrl: string | null; overquotaUrl: string | null }) => ({ completeUrl: x.completeUrl, screenoutUrl: x.screenoutUrl, overquotaUrl: x.overquotaUrl });
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Partial<ReturnType<typeof pick>>;
    return this.db.$transaction(async (tx) => {
      const u = await tx.allocation.update({ where: { id }, data });
      await this.audit.log(ctx, 'allocation.redirects', 'Allocation', id, pick(a), pick(u), tx);
      return { id: u.id, ...pick(u) };
    });
  }

  /** Vendor users see only their own vendor record. */
  private where(ctx: Ctx) {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { id: ctx.vendorId ?? '__none__' } : {}) };
  }

  async list(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.vendor.findMany({ where: this.where(ctx), include: { _count: { select: { allocations: { where: { status: { in: ['approved', 'live'] } } } } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...page });
    return rows.map((v) => redactVendor(ctx, { ...toCoreVendor(v), demo: true }));
  }

  async get(ctx: Ctx, id: string) {
    const v = await this.db.vendor.findFirst({ where: { AND: [this.where(ctx), { id }] }, include: { allocations: { include: { project: { select: { code: true, name: true } } } } } });
    if (!v) throw new NotFoundException('Vendor not found');
    const { allocations, ...rest } = v;
    return { ...redactVendor(ctx, toCoreVendor(rest)), allocations: allocations.map((a) => redactAllocation(ctx, a)) };
  }

  async allocations(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.allocation.findMany({
      where: { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { vendorId: ctx.vendorId ?? '__none__' } : {}) },
      include: { project: { select: { code: true, name: true, countries: true, audience: true, deadline: true, surveys: { where: { status: 'Published', hasDefinition: true }, select: { id: true, name: true } } } }, vendor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page,
    });
    return rows.map((a) => redactAllocation(ctx, a));
  }

  /** Explainable ranking from rate cards. Hidden from vendor users, who must not see competitors. */
  async rank(ctx: Ctx, q: z.infer<typeof RankQuery>) {
    const vendors = (await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map(toCoreVendor);
    return rankVendors(q, vendors).map((r) => ({ ...r, vendor: redactVendor(ctx, r.vendor), basis: 'rate_card_estimate' }));
  }
}

@ForModule('marketplace')
@Controller()
export class VendorsController {
  constructor(private s: VendorsService) {}
  @Get('vendors') async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.list(ctx, pg), pg.want, res); }
  @Get('vendors/:id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }
  @Get('allocations') async allocations(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.allocations(ctx, pg), pg.want, res); }
  @Patch('allocations/:id/redirects') @Write({ allowScoped: true })
  redirects(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.setRedirects(ctx, id, parse(Redirects, b ?? {})); }
}

@ForModule('crm')
@Controller()
export class RankingController {
  constructor(private s: VendorsService) {}
  @Get('vendor-ranking') rank(@Caller() ctx: Ctx, @Query() q: unknown) { return this.s.rank(ctx, parse(RankQuery, q)); }
}
