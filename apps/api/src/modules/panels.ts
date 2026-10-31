import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { panels } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const Brand = z.enum(['turn2opinion', 'myfrequentrewards', 'myhealthopinions']);
const ListQuery = z.object({
  brand: Brand.optional(), status: z.enum(['active', 'dormant', 'suspended', 'deletion_requested']).optional(), country: z.string().length(2).optional(),
  segment: z.string().optional(), skip: z.coerce.number().int().min(0).default(0), take: z.coerce.number().int().min(1).max(200).default(50),
});
const Purposes = ['research_participation', 'health_data', 'marketing_email'] as const;

/**
 * Panelists are pseudonymous (handle only; no names, emails or health records). The three brands
 * are Sampledge-owned; no brand API is assumed, so the integration status is reported as is.
 */
@Injectable()
export class PanelsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  async summary(ctx: Ctx) {
    const groups = await this.db.panelist.groupBy({ by: ['brand', 'status'], where: { tenantId: ctx.tenantId }, _count: true, _avg: { qualityScore: true, profileCompletion: true } });
    return panels.map((b) => {
      const g = groups.filter((x) => x.brand === b.id);
      const n = g.reduce((s, x) => s + x._count, 0);
      const by = (st: string) => g.find((x) => x.status === st)?._count ?? 0;
      const w = (k: 'qualityScore' | 'profileCompletion') => (n ? g.reduce((s, x) => s + (x._avg[k] ?? 0) * x._count, 0) / n : 0);
      return {
        id: b.id, name: b.name, domain: b.domain, focus: b.focus, integration: b.integration,
        records: n, active: by('active'), dormant: by('dormant'), suspended: by('suspended'), deletionRequested: by('deletion_requested'),
        avgQuality: +w('qualityScore').toFixed(3), profileCompletion: +w('profileCompletion').toFixed(3),
        note: 'Counts are synthetic seed records in this database, not the live brand panel.',
      };
    });
  }

  async list(ctx: Ctx, q: z.infer<typeof ListQuery>) {
    const where = { tenantId: ctx.tenantId, ...(q.brand ? { brand: q.brand } : {}), ...(q.status ? { status: q.status } : {}), ...(q.country ? { country: q.country } : {}), ...(q.segment ? { segment: q.segment } : {}) };
    const [total, rows] = await Promise.all([this.db.panelist.count({ where }), this.db.panelist.findMany({ where, skip: q.skip, take: q.take, orderBy: { handle: 'asc' } })]);
    return { total, rows };
  }

  async get(ctx: Ctx, id: string) {
    const p = await this.db.panelist.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { consents: { orderBy: { at: 'desc' } } } });
    if (!p) throw new NotFoundException('Panelist not found');
    return p;
  }

  /** Consent is append-only: the latest row per purpose is the current state. */
  async recordConsent(ctx: Ctx, id: string, purpose: (typeof Purposes)[number], granted: boolean) {
    const p = await this.get(ctx, id);
    if (purpose === 'health_data' && p.brand !== 'myhealthopinions') throw new BadRequestException('Health-data consent applies to MyHealthOpinions members only');
    const c = await this.db.consent.create({ data: { panelistId: id, purpose, granted } });
    await this.audit.log(ctx, granted ? 'consent.grant' : 'consent.withdraw', 'Panelist', id, undefined, { purpose, granted });
    return c;
  }

  /** Flags a deletion request. The deletion itself is a 'Deleting records' approval. */
  async requestDeletion(ctx: Ctx, id: string) {
    const p = await this.get(ctx, id);
    return this.db.$transaction(async (tx) => {
      await tx.panelist.update({ where: { id }, data: { status: 'deletion_requested' } });
      const ap = await tx.approval.create({ data: { tenantId: ctx.tenantId, kind: 'Deleting records', title: `Delete panelist ${p.handle} (${p.brand}) on member request`, requestedBy: ctx.userId, payload: { panelistId: id } } });
      await this.audit.log(ctx, 'panelist.deletion_requested', 'Panelist', id, { status: p.status }, { status: 'deletion_requested', approvalId: ap.id }, tx);
      return { approval: ap };
    });
  }
}

@ForModule('panels')
@Controller('panels')
export class PanelsController {
  constructor(private s: PanelsService) {}
  @Get('summary') summary(@Caller() ctx: Ctx) { return this.s.summary(ctx); }
  @Get('panelists') list(@Caller() ctx: Ctx, @Query() q: unknown) { return this.s.list(ctx, parse(ListQuery, q)); }
  @Get('panelists/:id') get(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.get(ctx, id); }

  @Post('panelists/:id/consents') @Write()
  consent(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ purpose: z.enum(Purposes), granted: z.boolean() }), b);
    return this.s.recordConsent(ctx, id, x.purpose, x.granted);
  }

  @Post('panelists/:id/deletion-request') @Write()
  deletion(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.requestDeletion(ctx, id); }
}
