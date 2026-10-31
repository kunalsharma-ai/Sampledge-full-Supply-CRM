import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Query } from '@nestjs/common';
import { countries, estimateCpi, estimateCapacity, rankVendors, type Audience } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { toCoreVendor } from './vendors';

const codes = countries.map((c) => c.code) as [string, ...string[]];
const Spec = z.object({
  audience: z.enum(['B2C', 'B2B', 'Healthcare']),
  countries: z.array(z.enum(codes)).min(1).max(10),
  sampleSize: z.number().int().min(50).max(20_000),
  incidence: z.number().min(0.01).max(1),
  loi: z.number().int().min(3).max(60),
});
/** Margin applied to rate-card cost for the indicative client price, and the ± band shown. */
const DIY_MARGIN = 0.4;
const BAND = 0.15;

/**
 * DIY research: a client configures a study, sees an indicative price range per market, and submits
 * it. The submission becomes an opportunity in the Bidding CRM (channel 'diy') for Business
 * Development to qualify and quote. The range is a rate-card estimate, never a quote or a supplier
 * confirmation, and vendor names and costs are never shown to the client.
 */
@Injectable()
export class DiyService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  async estimate(ctx: Ctx, s: z.infer<typeof Spec>) {
    const vendors = (await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map(toCoreVendor);
    const per = Math.ceil(s.sampleSize / s.countries.length);
    const markets = s.countries.map((country) => {
      const q = { audience: s.audience as Audience, country, n: per, ir: s.incidence, loi: s.loi };
      const ranked = rankVendors(q, vendors).slice(0, 3);
      if (!ranked.length) return { country, n: per, covered: false as const };
      const cost = ranked.reduce((a, r) => a + estimateCpi(r.vendor, q), 0) / ranked.length;
      const capacity = ranked.reduce((a, r) => a + estimateCapacity(r.vendor, q), 0);
      const cpi = cost / (1 - DIY_MARGIN);
      return { country, n: per, covered: true as const, cpiLow: +(cpi * (1 - BAND)).toFixed(2), cpiHigh: +(cpi * (1 + BAND)).toFixed(2), capacityOk: capacity >= per };
    });
    const covered = markets.filter((m) => m.covered) as Extract<(typeof markets)[number], { covered: true }>[];
    return {
      markets,
      totalLow: Math.round(covered.reduce((a, m) => a + m.cpiLow * m.n, 0)),
      totalHigh: Math.round(covered.reduce((a, m) => a + m.cpiHigh * m.n, 0)),
      basis: 'rate_card_estimate',
      disclaimer: 'Indicative range from rate cards. Not a quote and not a supplier confirmation: the team confirms feasibility with suppliers before quoting.',
    };
  }

  async submit(ctx: Ctx, b: z.infer<typeof Spec> & { title: string; objective: string }) {
    if (ctx.role !== 'client' || !ctx.clientId) throw new ForbiddenException('DIY requests are submitted by client users');
    const est = await this.estimate(ctx, b);
    if (est.markets.every((m) => !m.covered)) throw new BadRequestException('No supplier covers this audience in the selected markets');
    return this.db.$transaction(async (tx) => {
      const o = await tx.opportunity.create({
        data: {
          tenantId: ctx.tenantId, clientId: ctx.clientId!, title: b.title, stage: 'New RFQ', owner: 'Unassigned (DIY)', audience: b.audience, countries: b.countries,
          sampleSize: b.sampleSize, incidence: b.incidence, loi: b.loi, value: Math.round((est.totalLow + est.totalHigh) / 2), margin: DIY_MARGIN, probability: 0.15,
          channel: 'diy', sourceText: `DIY request by ${ctx.name}. Objective: ${b.objective}`,
        },
      });
      await emit(tx, ctx.tenantId, 'diy.requested', { opportunityId: o.id });
      await this.audit.log(ctx, 'diy.submit', 'Opportunity', o.id, undefined, { title: b.title, countries: b.countries, sampleSize: b.sampleSize }, tx);
      return { id: o.id, stage: o.stage };
    });
  }

  /** The client's own DIY requests with a client-facing status. No margins or internal owners. */
  async mine(ctx: Ctx) {
    const rows = await this.db.opportunity.findMany({ where: { tenantId: ctx.tenantId, channel: 'diy', ...(ctx.role === 'client' ? { clientId: ctx.clientId ?? '__none__' } : {}) }, orderBy: { createdAt: 'desc' }, include: { quotes: { where: { status: 'sent' }, orderBy: { version: 'desc' }, take: 1 } } });
    const status: Record<string, string> = { 'New RFQ': 'Received', Qualifying: 'Being reviewed', Feasibility: 'Checking supplier feasibility', 'Quote Sent': 'Quote sent', Negotiation: 'In discussion', Won: 'Commissioned', Lost: 'Closed' };
    return rows.map((o) => ({ id: o.id, title: o.title, audience: o.audience, countries: o.countries, sampleSize: o.sampleSize, incidence: o.incidence, loi: o.loi, status: status[o.stage] ?? o.stage, createdAt: o.createdAt, quote: o.quotes[0] ? { total: o.quotes[0].total, cpi: o.quotes[0].cpiSell } : null, projectId: o.projectId }));
  }
}

@ForModule('diy')
@Controller('diy')
export class DiyController {
  constructor(private s: DiyService) {}

  @Get('estimate')
  estimate(@Caller() ctx: Ctx, @Query() q: Record<string, string>) {
    return this.s.estimate(ctx, parse(Spec, { audience: q.audience, countries: (q.countries ?? '').split(',').filter(Boolean), sampleSize: Number(q.sampleSize), incidence: Number(q.incidence), loi: Number(q.loi) }));
  }

  @Get('requests') mine(@Caller() ctx: Ctx) { return this.s.mine(ctx); }

  @Post('requests') @Write()
  submit(@Caller() ctx: Ctx, @Body() b: unknown) {
    return this.s.submit(ctx, parse(Spec.extend({ title: z.string().min(3).max(140), objective: z.string().min(10).max(2000) }), b));
  }
}
