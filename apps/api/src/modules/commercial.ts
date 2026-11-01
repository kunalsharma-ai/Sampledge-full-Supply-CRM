import type { Response } from 'express';
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { crmStages, estimateCpi, type CrmStage, type Vendor as CoreVendor } from '@sampledge/core';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { emit } from '../common/events';
import { Caller, ForModule, RequirePerm, Write, type Ctx } from '../common/context';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { redactMargins } from '../common/redact';
import { parse } from '../common/zod';
import { nextProjectCode } from './projects';
import { toCoreVendor } from './vendors';

const stageProbability: Record<CrmStage, number> = { 'New RFQ': 0.1, Qualifying: 0.2, Feasibility: 0.35, 'Quote Sent': 0.5, Negotiation: 0.7, Won: 1, Lost: 0 };
const OppCreate = z.object({
  title: z.string().min(3).max(140),
  clientId: z.string(),
  audience: z.enum(['B2B', 'B2C', 'Healthcare']),
  countries: z.array(z.string().length(2)).min(1).max(40),
  sampleSize: z.number().int().positive().max(1_000_000),
  incidence: z.number().gt(0).max(1),
  loi: z.number().int().min(1).max(120),
  /** Defaults to the signed-in user creating the opportunity. */
  owner: z.string().min(2).max(80).optional(),
  sourceText: z.string().max(20_000).optional(),
});
const StageBody = z.object({ stage: z.enum(crmStages as unknown as [CrmStage, ...CrmStage[]]), lossReason: z.string().max(200).optional() });

@Injectable()
export class CommercialService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  clients(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    return this.db.client.findMany({
      where: { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { id: ctx.clientId ?? '__none__' } : {}) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], ...page,
    });
  }

  async opportunities(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.opportunity.findMany({ where: { tenantId: ctx.tenantId }, include: { quotes: { orderBy: { version: 'desc' } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page });
    return rows.map((r) => redactMargins(ctx, r));
  }

  async opportunity(ctx: Ctx, id: string) {
    const o = await this.db.opportunity.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { client: true, quotes: { orderBy: { version: 'desc' } }, project: { select: { id: true, code: true } } } });
    if (!o) throw new NotFoundException('Opportunity not found');
    return redactMargins(ctx, o);
  }

  async createOpportunity(ctx: Ctx, b: z.infer<typeof OppCreate>) {
    const client = await this.db.client.findFirst({ where: { id: b.clientId, tenantId: ctx.tenantId } });
    if (!client) throw new NotFoundException('Client not found');
    return this.db.$transaction(async (tx) => {
      const o = await tx.opportunity.create({ data: { ...b, owner: b.owner ?? ctx.name, tenantId: ctx.tenantId, stage: 'New RFQ', value: 0, margin: 0, probability: stageProbability['New RFQ'] } });
      await this.audit.log(ctx, 'opportunity.create', 'Opportunity', o.id, undefined, o, tx);
      return o;
    });
  }

  /** Moving to Won creates the project in the same transaction; moving to Lost needs a reason. */
  async setStage(ctx: Ctx, id: string, stage: CrmStage, lossReason?: string) {
    const o = await this.db.opportunity.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Opportunity not found');
    if (o.stage === stage) return { opportunity: o, project: null };
    if (o.stage === 'Won') throw new BadRequestException('A won opportunity is already a project; change the project instead');
    if (stage === 'Lost' && !lossReason) throw new BadRequestException('Give a loss reason');
    return this.db.$transaction(async (tx) => {
      let project = null;
      if (stage === 'Won' && !o.projectId) {
        const approved = await tx.quote.findFirst({ where: { opportunityId: id, status: { in: ['approved', 'sent'] } }, orderBy: { version: 'desc' } });
        const cpiSell = approved?.cpiSell ?? (o.value && o.sampleSize ? o.value / o.sampleSize : 0);
        const cpiCost = approved?.cpiCost ?? cpiSell * (1 - o.margin);
        const now = new Date();
        project = await tx.project.create({
          data: {
            tenantId: ctx.tenantId, code: await nextProjectCode(tx, ctx.tenantId), name: o.title, clientId: o.clientId, audience: o.audience,
            countries: o.countries, stage: 'Project Setup', owner: o.owner, start: now, deadline: new Date(now.getTime() + 21 * 86400_000),
            target: o.sampleSize, ir: o.incidence, loi: o.loi, cpiSell: +cpiSell.toFixed(2), cpiCost: +cpiCost.toFixed(2),
            budget: Math.round(o.sampleSize * cpiCost * 1.1), blockers: approved ? [] : ['No approved quote on record; CPI derived from opportunity value'],
          },
        });
        await this.audit.log(ctx, 'project.create_from_won', 'Project', project.id, undefined, { opportunityId: id, code: project.code }, tx);
        await emit(tx, ctx.tenantId, 'opportunity.won', { opportunityId: id, projectId: project.id });
      }
      const u = await tx.opportunity.update({
        where: { id },
        data: { stage, probability: stageProbability[stage], lossReason: stage === 'Lost' ? lossReason : null, lastTouch: new Date(), ...(project ? { projectId: project.id } : {}) },
      });
      await this.audit.log(ctx, 'opportunity.stage', 'Opportunity', id, { stage: o.stage }, { stage, lossReason }, tx);
      return { opportunity: redactMargins(ctx, u), project: project ? redactMargins(ctx, project) : null };
    });
  }

  /**
   * Draft quote. Per market, cost comes from the lowest vendor feasibility response when one exists
   * (supplier-confirmed); otherwise from the cheapest eligible rate card (an estimate). The basis
   * records which: supplier_confirmed, mixed or rate_card_estimate. Sell applies the target margin.
   */
  async draftQuote(ctx: Ctx, id: string, targetMargin: number) {
    const o = await this.db.opportunity.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Opportunity not found');
    const vendors = (await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map(toCoreVendor);
    const responses = await this.db.feasibilityRequest.findMany({ where: { opportunityId: id, status: 'responded' } });
    const perCountry = o.countries.map((c) => {
      const confirmed = responses.filter((r) => r.country === c && r.cpi !== null).map((r) => r.cpi as number);
      if (confirmed.length) return { country: c, vendors: confirmed.length, cpi: Math.min(...confirmed), source: 'supplier_confirmed' as const };
      const el = vendors.filter((v: CoreVendor) => v.coverage.includes(c) && v.audiences.includes(o.audience));
      const cpis = el.map((v) => estimateCpi(v, { audience: o.audience, country: c, n: o.sampleSize, ir: o.incidence, loi: o.loi }));
      return { country: c, vendors: el.length, cpi: cpis.length ? Math.min(...cpis) : null, source: 'rate_card_estimate' as const };
    });
    const missing = perCountry.filter((x) => x.cpi === null).map((x) => x.country);
    if (missing.length === perCountry.length) throw new BadRequestException(`No vendor covers ${o.audience} in ${missing.join(', ')}`);
    const priced = perCountry.filter((x) => x.cpi !== null) as { country: string; vendors: number; cpi: number; source: string }[];
    const sources = new Set(priced.map((x) => x.source));
    const basis = sources.size > 1 ? 'mixed' : [...sources][0];
    const cpiCost = +(priced.reduce((s, x) => s + x.cpi, 0) / priced.length).toFixed(2);
    const cpiSell = +(cpiCost / (1 - targetMargin)).toFixed(2);
    const total = Math.round(cpiSell * o.sampleSize);
    return this.db.$transaction(async (tx) => {
      const last = await tx.quote.findFirst({ where: { opportunityId: id }, orderBy: { version: 'desc' } });
      const q = await tx.quote.create({
        data: { tenantId: ctx.tenantId, opportunityId: id, version: (last?.version ?? 0) + 1, cpiSell, cpiCost, margin: targetMargin, total, basis, status: 'draft', createdBy: ctx.name },
      });
      await tx.opportunity.update({ where: { id }, data: { value: total, margin: targetMargin, lastTouch: new Date() } });
      await this.audit.log(ctx, 'quote.draft', 'Quote', q.id, undefined, q, tx);
      const note = basis === 'supplier_confirmed' ? 'All markets priced from vendor feasibility responses.' : basis === 'mixed' ? 'Some markets use vendor responses; others are rate-card estimates.' : 'Rate-card estimate. Not a supplier confirmation.';
      return { quote: redactMargins(ctx, q), perCountry, uncovered: missing, basis: note };
    });
  }

  /** A quote is binding once sent, so sending requires an approval decision. */
  async submitQuote(ctx: Ctx, quoteId: string) {
    const q = await this.db.quote.findFirst({ where: { id: quoteId, tenantId: ctx.tenantId }, include: { opportunity: { include: { client: true } } } });
    if (!q) throw new NotFoundException('Quote not found');
    if (q.status !== 'draft') throw new BadRequestException(`Quote is ${q.status}`);
    return this.db.$transaction(async (tx) => {
      const u = await tx.quote.update({ where: { id: q.id }, data: { status: 'pending_approval' } });
      const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Sending binding quotations', title: `Send quote v${q.version} to ${q.opportunity.client.name}: ${q.opportunity.title}`, amount: q.total, requestedBy: ctx.userId, payload: { quoteId: q.id, opportunityId: q.opportunityId } });
      await this.audit.log(ctx, 'quote.submit', 'Quote', q.id, { status: q.status }, { status: u.status, approvalId: ap.id }, tx);
      return { quote: redactMargins(ctx, u), approval: ap };
    });
  }
}

@Controller()
export class CommercialController {
  constructor(private s: CommercialService) {}

  @ForModule('projects') @Get('clients')
  async clients(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.clients(ctx, pg), pg.want, res); }

  @ForModule('crm') @Get('opportunities')
  async list(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.opportunities(ctx, pg), pg.want, res); }

  @ForModule('crm') @Get('opportunities/:id')
  get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.opportunity(ctx, id); }

  @ForModule('crm') @Write() @Post('opportunities')
  create(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.createOpportunity(ctx, parse(OppCreate, b)); }

  @ForModule('crm') @Write() @Patch('opportunities/:id/stage')
  stage(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(StageBody, b);
    return this.s.setStage(ctx, id, x.stage, x.lossReason);
  }

  @ForModule('crm') @Write() @RequirePerm('view:margins') @Post('opportunities/:id/quotes')
  quote(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    return this.s.draftQuote(ctx, id, parse(z.object({ targetMargin: z.number().min(0).max(0.9).default(0.4) }), b ?? {}).targetMargin);
  }

  @ForModule('crm') @Write() @Post('quotes/:id/submit')
  submit(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.submitQuote(ctx, id); }
}
