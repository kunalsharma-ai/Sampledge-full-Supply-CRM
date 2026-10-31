import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { rankVendors, type Vendor as CoreVendor } from '@sampledge/core';
import type { Vendor } from '@prisma/client';
import { z } from 'zod';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { redactAllocation, redactVendor } from '../common/redact';
import { parse } from '../common/zod';

export const toCoreVendor = (v: Vendor & { _count?: { allocations: number } }): CoreVendor => ({
  id: v.id, name: v.name, hq: v.hq, coverage: v.coverage, audiences: v.audiences, cpiB2C: v.cpiB2C, cpiB2B: v.cpiB2B, cpiHC: v.cpiHC,
  quality: v.quality, reliability: v.reliability, responseRate: v.responseRate, speed: v.speed, activeAllocations: v._count?.allocations ?? 0,
  delivered: v.delivered, pendingPayment: v.pendingPayment, bidWinRate: v.bidWinRate, verified: v.verified,
});

const RankQuery = z.object({ audience: z.enum(['B2B', 'B2C', 'Healthcare']), country: z.string().length(2), n: z.coerce.number().int().positive(), ir: z.coerce.number().gt(0).max(1), loi: z.coerce.number().int().positive() });

@Injectable()
export class VendorsService {
  constructor(private db: PrismaService) {}

  /** Vendor users see only their own vendor record. */
  private where(ctx: Ctx) {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { id: ctx.vendorId ?? '__none__' } : {}) };
  }

  async list(ctx: Ctx) {
    const rows = await this.db.vendor.findMany({ where: this.where(ctx), include: { _count: { select: { allocations: { where: { status: { in: ['approved', 'live'] } } } } } }, orderBy: { name: 'asc' } });
    return rows.map((v) => redactVendor(ctx, { ...toCoreVendor(v), demo: true }));
  }

  async get(ctx: Ctx, id: string) {
    const v = await this.db.vendor.findFirst({ where: { AND: [this.where(ctx), { id }] }, include: { allocations: { include: { project: { select: { code: true, name: true } } } } } });
    if (!v) throw new NotFoundException('Vendor not found');
    const { allocations, ...rest } = v;
    return { ...redactVendor(ctx, toCoreVendor(rest)), allocations: allocations.map((a) => redactAllocation(ctx, a)) };
  }

  async allocations(ctx: Ctx) {
    const rows = await this.db.allocation.findMany({
      where: { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { vendorId: ctx.vendorId ?? '__none__' } : {}) },
      include: { project: { select: { code: true, name: true, countries: true, audience: true, deadline: true } }, vendor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
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
  @Get('vendors') list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
  @Get('vendors/:id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }
  @Get('allocations') allocations(@Caller() ctx: Ctx) { return this.s.allocations(ctx); }
}

@ForModule('crm')
@Controller()
export class RankingController {
  constructor(private s: VendorsService) {}
  @Get('vendor-ranking') rank(@Caller() ctx: Ctx, @Query() q: unknown) { return this.s.rank(ctx, parse(RankQuery, q)); }
}
