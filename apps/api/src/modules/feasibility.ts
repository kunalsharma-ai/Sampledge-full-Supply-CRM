import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Post } from '@nestjs/common';
import { can, rankVendors } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { toCoreVendor } from './vendors';

const day = 86400_000;

/**
 * Supplier feasibility. Business Development asks vendors for CPI and capacity per market; vendors
 * answer in their portal. Answers are the only source of `supplier_confirmed` quote pricing.
 * Vendors see the brief (audience, market, n, IR, LOI) but never the client's identity.
 */
@Injectable()
export class FeasibilityService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  async request(ctx: Ctx, opportunityId: string, vendorIds: string[] | undefined, dueInDays: number) {
    const o = await this.db.opportunity.findFirst({ where: { id: opportunityId, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Opportunity not found');
    if (['Won', 'Lost'].includes(o.stage)) throw new BadRequestException(`Opportunity is ${o.stage}`);
    const vendors = (await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map(toCoreVendor);
    const pairs: { vendorId: string; country: string }[] = [];
    for (const country of o.countries) {
      const q = { audience: o.audience, country, n: o.sampleSize, ir: o.incidence, loi: o.loi };
      const eligible = rankVendors(q, vendors).map((r) => r.vendor.id);
      const chosen = vendorIds ? eligible.filter((id) => vendorIds.includes(id)) : eligible.slice(0, 3);
      for (const vendorId of chosen) pairs.push({ vendorId, country });
    }
    if (!pairs.length) throw new BadRequestException('No selected vendor covers this audience in these markets');
    return this.db.$transaction(async (tx) => {
      const created = [];
      for (const pr of pairs) {
        const exists = await tx.feasibilityRequest.findUnique({ where: { opportunityId_vendorId_country: { opportunityId, ...pr } } });
        if (exists) continue;
        const f = await tx.feasibilityRequest.create({
          data: { tenantId: ctx.tenantId, opportunityId, ...pr, audience: o.audience, sampleSize: o.sampleSize, incidence: o.incidence, loi: o.loi, status: 'sent', dueAt: new Date(Date.now() + dueInDays * day) },
        });
        await emit(tx, ctx.tenantId, 'feasibility.requested', { requestId: f.id });
        created.push(f);
      }
      if (o.stage === 'New RFQ' || o.stage === 'Qualifying') await tx.opportunity.update({ where: { id: opportunityId }, data: { stage: 'Feasibility', probability: 0.35, lastTouch: new Date() } });
      await this.audit.log(ctx, 'feasibility.request', 'Opportunity', opportunityId, undefined, { requests: created.length }, tx);
      return { created: created.length, skipped: pairs.length - created.length };
    });
  }

  /** Internal view for an opportunity. Bids (CPIs) need view:vendor_bids. */
  async forOpportunity(ctx: Ctx, opportunityId: string) {
    const o = await this.db.opportunity.findFirst({ where: { id: opportunityId, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Opportunity not found');
    const rows = await this.db.feasibilityRequest.findMany({ where: { opportunityId }, orderBy: [{ country: 'asc' }, { createdAt: 'asc' }] });
    const names = new Map((await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    const bids = can(ctx.role, 'view:vendor_bids');
    return rows.map((r) => ({ ...r, vendorName: names.get(r.vendorId), ...(bids ? {} : { cpi: undefined }) }));
  }

  /** Vendor portal inbox (vendor: own requests only; internal roles: all). No client identity. */
  async inbox(ctx: Ctx) {
    const rows = await this.db.feasibilityRequest.findMany({
      where: { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { vendorId: ctx.vendorId ?? '__none__' } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ opportunityId, ...r }) => ({ ...r, reference: `RFQ-${opportunityId.slice(-6).toUpperCase()}` }));
  }

  async respond(ctx: Ctx, id: string, b: { cpi?: number; capacity?: number; note?: string; decline?: boolean }) {
    const f = await this.db.feasibilityRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!f) throw new NotFoundException('Request not found');
    if (ctx.role === 'vendor' && f.vendorId !== ctx.vendorId) throw new NotFoundException('Request not found');
    // Nobody answers on a vendor's behalf: a response is a supplier confirmation.
    if (ctx.role !== 'vendor') throw new ForbiddenException('Only the vendor answers its own feasibility request');
    if (f.status !== 'sent') throw new BadRequestException(`Already ${f.status}`);
    if (!b.decline && (b.cpi === undefined || b.capacity === undefined)) throw new BadRequestException('Give a CPI and capacity, or decline');
    return this.db.$transaction(async (tx) => {
      const u = await tx.feasibilityRequest.update({
        where: { id },
        data: b.decline ? { status: 'declined', note: b.note, respondedAt: new Date(), respondedBy: ctx.name } : { status: 'responded', cpi: b.cpi, capacity: b.capacity, note: b.note, respondedAt: new Date(), respondedBy: ctx.name },
      });
      await emit(tx, ctx.tenantId, 'feasibility.responded', { requestId: id });
      await this.audit.log(ctx, b.decline ? 'feasibility.decline' : 'feasibility.respond', 'FeasibilityRequest', id, { status: 'sent' }, { status: u.status, cpi: u.cpi, capacity: u.capacity }, tx);
      return u;
    });
  }
}

@Controller()
export class FeasibilityController {
  constructor(private s: FeasibilityService) {}

  @ForModule('crm') @Write() @Post('opportunities/:id/feasibility')
  request(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ vendorIds: z.array(z.string()).max(30).optional(), dueInDays: z.number().int().min(1).max(30).default(3) }), b ?? {});
    return this.s.request(ctx, id, x.vendorIds, x.dueInDays);
  }

  @ForModule('crm') @Get('opportunities/:id/feasibility')
  list(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.forOpportunity(ctx, id); }

  @ForModule('vendor-portal') @Get('feasibility')
  inbox(@Caller() ctx: Ctx) { return this.s.inbox(ctx); }

  @ForModule('vendor-portal') @Write({ allowScoped: true }) @Post('feasibility/:id/respond') @HttpCode(200)
  respond(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.respond(ctx, id, parse(z.object({ cpi: z.number().positive().max(10_000).optional(), capacity: z.number().int().positive().max(1_000_000).optional(), note: z.string().max(1000).optional(), decline: z.boolean().optional() }), b));
  }
}
