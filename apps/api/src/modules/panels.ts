import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { panels } from '@sampledge/core';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
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

  /**
   * CSV member import (header row required): handle,country,age_band,gender,segment[,status][,consent_research].
   * The system stores pseudonymous handles only, so any field that looks like an email address or a
   * phone number rejects the row. Existing handles in the brand are skipped. dryRun validates only.
   */
  async importCsv(ctx: Ctx, brand: string, csv: string, dryRun: boolean) {
    const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('Expected a header row and at least one member row');
    if (lines.length > 5001) throw new BadRequestException('At most 5,000 rows per import');
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const need = ['handle', 'country', 'age_band', 'gender', 'segment'];
    const missing = need.filter((h) => !header.includes(h));
    if (missing.length) throw new BadRequestException(`Missing column(s): ${missing.join(', ')}`);
    const col = (row: string[], k: string) => (header.includes(k) ? (row[header.indexOf(k)] ?? '').trim() : '');
    const segs: Record<string, string[]> = { turn2opinion: ['consumer'], myfrequentrewards: ['consumer', 'professional'], myhealthopinions: ['hcp', 'patient', 'caregiver'] };
    const pii = /@|\+?\d[\d\s().-]{7,}\d/;
    const existing = new Set((await this.db.panelist.findMany({ where: { tenantId: ctx.tenantId, brand }, select: { handle: true } })).map((p) => p.handle));
    const errors: { row: number; message: string }[] = [];
    const rows: { handle: string; country: string; ageBand: string; gender: string; segment: string; status: string; consent: boolean }[] = [];
    let skipped = 0;
    lines.slice(1).forEach((line, i) => {
      const r = line.split(',');
      const n = i + 2;
      if (r.some((v) => pii.test(v))) return void errors.push({ row: n, message: 'Looks like an email address or phone number. Only pseudonymous handles are stored.' });
      const m = { handle: col(r, 'handle'), country: col(r, 'country').toUpperCase(), ageBand: col(r, 'age_band'), gender: col(r, 'gender').toLowerCase(), segment: col(r, 'segment').toLowerCase(), status: col(r, 'status').toLowerCase() || 'active', consent: !['no', 'false', '0'].includes(col(r, 'consent_research').toLowerCase()) };
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(m.handle)) return void errors.push({ row: n, message: 'Handle must be 3–40 letters, digits, - or _' });
      if (!/^[A-Z]{2}$/.test(m.country)) return void errors.push({ row: n, message: 'Country must be a 2-letter code' });
      if (!['18-24', '25-34', '35-44', '45-54', '55-64', '65+'].includes(m.ageBand)) return void errors.push({ row: n, message: 'Unknown age band' });
      if (!['female', 'male', 'nonbinary', 'undisclosed'].includes(m.gender)) return void errors.push({ row: n, message: 'Unknown gender value' });
      if (!segs[brand].includes(m.segment)) return void errors.push({ row: n, message: `Segment must be one of ${segs[brand].join(', ')} for this brand` });
      if (!['active', 'dormant', 'suspended'].includes(m.status)) return void errors.push({ row: n, message: 'Unknown status' });
      if (existing.has(m.handle) || rows.some((x) => x.handle === m.handle)) { skipped++; return; }
      rows.push(m);
    });
    if (!dryRun && rows.length) {
      await this.db.$transaction(async (tx) => {
        for (const m of rows) {
          const p = await tx.panelist.create({ data: { tenantId: ctx.tenantId, brand, handle: m.handle, country: m.country, ageBand: m.ageBand, gender: m.gender, segment: m.segment, status: m.status, qualityScore: 0.8, profileCompletion: 0.3 } });
          await tx.consent.create({ data: { panelistId: p.id, purpose: 'research_participation', granted: m.consent } });
        }
        await this.audit.log(ctx, 'panelist.import', 'Panelist', brand, undefined, { imported: rows.length, skipped, errors: errors.length }, tx);
      });
    }
    return { dryRun, accepted: rows.length, skipped, errors: errors.slice(0, 100), errorCount: errors.length };
  }

  /** Flags a deletion request. The deletion itself is a 'Deleting records' approval. */
  async requestDeletion(ctx: Ctx, id: string) {
    const p = await this.get(ctx, id);
    return this.db.$transaction(async (tx) => {
      await tx.panelist.update({ where: { id }, data: { status: 'deletion_requested' } });
      const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Deleting records', title: `Delete panelist ${p.handle} (${p.brand}) on member request`, requestedBy: ctx.userId, payload: { panelistId: id } });
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

  @Post('import') @Write()
  import(@Caller() ctx: Ctx, @Body() b: unknown) {
    const x = parse(z.object({ brand: Brand, csv: z.string().max(2_000_000), dryRun: z.boolean().default(true) }), b);
    return this.s.importCsv(ctx, x.brand, x.csv, x.dryRun);
  }

  @Post('panelists/:id/deletion-request') @Write()
  deletion(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.requestDeletion(ctx, id); }
}
