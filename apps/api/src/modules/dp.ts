/**
 * Data Processing: weighting, open-end coding and tabulation on recorded responses.
 *
 * - Weighting: rim weighting (raking) to target shares on single-choice questions. Weights are
 *   stored per response; results and reports use them on request (`weighted=true`).
 * - Coding: a codeframe per open-ended question (suggested by the AI gateway or rules, edited by a
 *   coder), automatic first-pass coding by keyword, and manual overrides that recoding keeps.
 * - Tabulation: an Excel workbook with every question against a banner, weighted or not.
 * Every change is audited. Nothing here deletes or alters answers.
 */
import { BadRequestException, Body, Controller, Delete, Get, Header, Injectable, NotFoundException, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { codeText, rake, type Code } from '@sampledge/core';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { z } from 'zod';
import { AiGateway } from '../ai/gateway';
import { openEndCodeframe } from '../ai/tasks';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { resultsQuery, SurveysService, type DpConfig } from './surveys';

type Codes = Record<string, string[]> & { __manual?: string[] };
const usable = (surveyId: string): Prisma.ResponseWhereInput => ({ surveyId, outcome: 'complete', source: { not: 'preview' }, rejectedAt: null });

@Injectable()
export class DpService {
  constructor(private db: PrismaService, private audit: AuditService, private surveys: SurveysService, private ai: AiGateway) {}

  private async survey(ctx: Ctx, id: string) {
    const s = await this.surveys.get(ctx, id);
    if (!s.definition) throw new BadRequestException('This survey has no programmed definition yet');
    return { ...s, definition: s.definition, dp: (s.dp ?? {}) as DpConfig };
  }

  async list(ctx: Ctx) {
    const rows = await this.surveys.list(ctx);
    return rows.filter((s) => s.hasDefinition).map((s) => ({ id: s.id, name: s.name, status: s.status, completes: s.completes, weighted: !!(s.dp as DpConfig | null)?.weighting, codeframes: Object.keys((s.dp as DpConfig | null)?.codeframes ?? {}).length }));
  }

  async overview(ctx: Ctx, id: string) {
    const s = await this.survey(ctx, id);
    const outcomes = await this.db.response.groupBy({ by: ['outcome'], where: { surveyId: id, source: { not: 'preview' } }, _count: true });
    const rows = await this.db.response.findMany({ where: usable(id), select: { answers: true, flags: true, source: true, codes: true, startedAt: true, completedAt: true } });
    const rejected = await this.db.response.count({ where: { surveyId: id, rejectedAt: { not: null } } });
    const mins = rows.filter((r) => r.completedAt).map((r) => (r.completedAt!.getTime() - r.startedAt.getTime()) / 60000).sort((a, b) => a - b);
    const flagCounts: Record<string, number> = {};
    rows.forEach((r) => r.flags.forEach((f) => { flagCounts[f] = (flagCounts[f] ?? 0) + 1; }));
    const singles = s.definition.questions.filter((q) => q.type === 'single' && q.options?.length).map((q) => ({
      id: q.id, text: q.text,
      options: q.options!.map((o) => ({ code: o.code, label: o.label, share: rows.length ? Math.round((rows.filter((r) => (r.answers as Record<string, unknown>)[q.id] === o.code).length / rows.length) * 10000) / 10000 : 0 })),
    }));
    const texts = s.definition.questions.filter((q) => q.type === 'text').map((q) => {
      const answered = rows.filter((r) => String((r.answers as Record<string, unknown>)[q.id] ?? '').trim());
      const coded = answered.filter((r) => ((r.codes as Codes | null)?.[q.id] ?? []).length);
      return { id: q.id, text: q.text, answered: answered.length, coded: coded.length, manual: rows.filter((r) => (r.codes as Codes | null)?.__manual?.includes(q.id)).length, codeframe: s.dp.codeframes?.[q.id] ?? null };
    });
    return {
      survey: { id: s.id, name: s.name, status: s.status, version: s.currentVersion },
      completes: rows.length, rejected, synthetic: rows.filter((r) => r.source.startsWith('synthetic:')).length,
      outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome ?? 'in_progress', o._count])),
      medianMinutes: mins.length ? Math.round(mins[Math.floor(mins.length / 2)] * 10) / 10 : null,
      flags: flagCounts, weighting: s.dp.weighting ?? null, weightingVariables: singles, openEnds: texts,
    };
  }

  async weight(ctx: Ctx, id: string, targets: Record<string, Record<string, number>>) {
    const s = await this.survey(ctx, id);
    for (const v of Object.keys(targets)) {
      const q = s.definition.questions.find((x) => x.id === v);
      if (!q || q.type !== 'single') throw new BadRequestException(`${v} is not a single-choice question`);
      const bad = Object.keys(targets[v]).filter((c) => !q.options?.some((o) => o.code === c));
      if (bad.length) throw new BadRequestException(`${v} has no option ${bad.join(', ')}`);
    }
    const rows = await this.db.response.findMany({ where: usable(id), select: { id: true, answers: true } });
    if (rows.length < 30) throw new BadRequestException('Weighting needs at least 30 completed interviews');
    let r: ReturnType<typeof rake>;
    try { r = rake(rows.map((x) => ({ id: x.id, answers: x.answers as Record<string, never> })), targets); } catch (e) { throw new BadRequestException((e as Error).message); }
    const ids = Object.keys(r.weights);
    const ws = ids.map((k) => r.weights[k]);
    const { weights: _w, ...stats } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
    const cfg: DpConfig = { ...s.dp, weighting: { targets, stats, appliedAt: new Date().toISOString(), by: ctx.name } };
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Response" AS r SET "weight" = v.w FROM unnest(${ids}::text[], ${ws}::float8[]) AS v(id, w) WHERE r."id" = v.id AND r."surveyId" = ${id}`;
      await tx.survey.update({ where: { id }, data: { dp: cfg as Prisma.InputJsonValue } });
      await this.audit.log(ctx, 'dp.weighting_applied', 'Survey', id, s.dp.weighting ? { targets: s.dp.weighting.targets } : undefined, { targets, efficiency: r.efficiency, effectiveBase: r.effectiveBase, iterations: r.iterations }, tx);
    });
    return stats;
  }

  async unweight(ctx: Ctx, id: string) {
    const s = await this.survey(ctx, id);
    const { weighting, ...rest } = s.dp;
    await this.db.$transaction(async (tx) => {
      await tx.response.updateMany({ where: { surveyId: id }, data: { weight: 1 } });
      await tx.survey.update({ where: { id }, data: { dp: rest as Prisma.InputJsonValue } });
      await this.audit.log(ctx, 'dp.weighting_removed', 'Survey', id, weighting ? { targets: weighting.targets } : undefined, undefined, tx);
    });
    return { removed: !!weighting };
  }

  private async textQuestion(ctx: Ctx, id: string, qid: string) {
    const s = await this.survey(ctx, id);
    const q = s.definition.questions.find((x) => x.id === qid);
    if (!q || q.type !== 'text') throw new BadRequestException(`${qid} is not an open-ended question`);
    return { s, q };
  }

  async suggest(ctx: Ctx, id: string, qid: string, maxCodes: number) {
    const { q } = await this.textQuestion(ctx, id, qid);
    const rows = await this.db.response.findMany({ where: usable(id), select: { answers: true }, take: 2000 });
    const answers = rows.map((r) => String((r.answers as Record<string, unknown>)[qid] ?? '').trim()).filter(Boolean);
    if (answers.length < 10) throw new BadRequestException('At least 10 answers are needed to suggest a codeframe');
    // The model sees a sample of distinct answers; the rules see them all.
    const sample = [...new Set(answers)].slice(0, 300);
    const r = await this.ai.run(ctx, { ...openEndCodeframe, rules: (i) => openEndCodeframe.rules({ ...i, answers }) }, { question: q.text, answers: sample, maxCodes });
    return { ...r, answers: answers.length };
  }

  /** Saves the codeframe and codes every answer by keyword, keeping manual overrides. */
  async saveFrame(ctx: Ctx, id: string, qid: string, frame: Code[]) {
    const { s } = await this.textQuestion(ctx, id, qid);
    const codesSeen = new Set<string>();
    for (const c of frame) { if (codesSeen.has(c.code) || c.code === 'other') throw new BadRequestException(`Duplicate or reserved code ${c.code}`); codesSeen.add(c.code); }
    const rows = await this.db.response.findMany({ where: usable(id), select: { id: true, answers: true, codes: true } });
    const updates = rows.map((r) => {
      const codes = { ...((r.codes as Codes | null) ?? {}) } as Codes;
      if (!codes.__manual?.includes(qid)) codes[qid] = codeText(String((r.answers as Record<string, unknown>)[qid] ?? ''), frame);
      else codes[qid] = (codes[qid] ?? []).filter((c) => c === 'other' || codesSeen.has(c));
      return { id: r.id, codes };
    });
    const cfg: DpConfig = { ...s.dp, codeframes: { ...(s.dp.codeframes ?? {}), [qid]: frame } };
    await this.db.$transaction(async (tx) => {
      const ids = updates.map((u) => u.id);
      const vals = updates.map((u) => JSON.stringify(u.codes));
      await tx.$executeRaw`UPDATE "Response" AS r SET "codes" = v.c::jsonb FROM unnest(${ids}::text[], ${vals}::text[]) AS v(id, c) WHERE r."id" = v.id AND r."surveyId" = ${id}`;
      await tx.survey.update({ where: { id }, data: { dp: cfg as Prisma.InputJsonValue } });
      await this.audit.log(ctx, 'dp.codeframe_saved', 'Survey', id, s.dp.codeframes?.[qid] ? { [qid]: s.dp.codeframes[qid] } : undefined, { [qid]: frame }, tx);
    }, { timeout: 30_000 });
    const tally: Record<string, number> = {};
    updates.forEach((u) => (u.codes[qid] ?? []).forEach((c) => { tally[c] = (tally[c] ?? 0) + 1; }));
    return { coded: updates.filter((u) => (u.codes[qid] ?? []).length).length, tally };
  }

  async verbatims(ctx: Ctx, id: string, qid: string, code: string | undefined, take: number) {
    await this.textQuestion(ctx, id, qid);
    const rows = await this.db.response.findMany({ where: usable(id), select: { id: true, answers: true, codes: true }, orderBy: { completedAt: 'asc' } });
    return rows
      .map((r) => ({ id: r.id, text: String((r.answers as Record<string, unknown>)[qid] ?? ''), codes: ((r.codes as Codes | null)?.[qid] ?? []) as string[], manual: !!(r.codes as Codes | null)?.__manual?.includes(qid) }))
      .filter((r) => r.text.trim() && (!code || (code === 'uncoded' ? !r.codes.length : r.codes.includes(code))))
      .slice(0, take);
  }

  async setCodes(ctx: Ctx, responseId: string, qid: string, codes: string[]) {
    const r = await this.db.response.findFirst({ where: { id: responseId, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundException('Response not found');
    const { s } = await this.textQuestion(ctx, r.surveyId, qid);
    const frame = s.dp.codeframes?.[qid];
    if (!frame) throw new BadRequestException('Save a codeframe for this question first');
    const bad = codes.filter((c) => c !== 'other' && !frame.some((f) => f.code === c));
    if (bad.length) throw new BadRequestException(`Not in the codeframe: ${bad.join(', ')}`);
    const before = (r.codes as Codes | null) ?? {};
    const next: Codes = { ...before, [qid]: [...new Set(codes)], __manual: [...new Set([...(before.__manual ?? []), qid])] };
    await this.db.$transaction(async (tx) => {
      await tx.response.update({ where: { id: r.id }, data: { codes: next as Prisma.InputJsonValue } });
      await this.audit.log(ctx, 'dp.codes_set', 'Response', r.id, { [qid]: before[qid] ?? [] }, { [qid]: next[qid] }, tx);
    });
    return { id: r.id, codes: next[qid], manual: true };
  }

  /** Excel tables: every question against the banner, percentages with significance letters beneath. */
  async tables(ctx: Ctx, id: string, q: unknown) {
    const o = resultsQuery(q);
    const r = await this.surveys.results(ctx, id, o);
    if (!r.base) throw new BadRequestException('No completed responses to tabulate yet');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sampledge';
    const notes = wb.addWorksheet('Notes');
    [
      ['Survey', `${r.survey.name} (v${r.survey.version})`],
      ['Base', `${r.base} completed interviews`],
      ['Weighting', r.weighted ? `Rim weighted · weighted base ${r.weightedBase} · effective base ${r.effectiveBase}` : 'Unweighted'],
      ['Banner', r.banner ? `${r.banner.id}: ${r.banner.text}` : 'Total only'],
      ['Significance', 'Letters beneath a percentage mark a column significantly higher than the lettered column (two-proportion z-test, 95%, effective base ≥ 30).'],
      ['Exclusions', `${r.rejected} rejected interview(s) excluded${r.excludedFlagged ? `; ${r.flagged} quality-flagged interview(s) excluded` : ''}`],
      ...(r.synthetic ? [['Data', `${r.synthetic} of these interviews are SYNTHETIC demo data, not real respondents`]] : []),
      ['Generated', new Date().toISOString()],
    ].forEach((row) => notes.addRow(row));
    notes.getColumn(1).width = 16; notes.getColumn(2).width = 110; notes.getColumn(1).font = { bold: true };

    const ws = wb.addWorksheet('Tables');
    const cols = r.banner?.cols ?? [];
    ws.columns = [{ width: 48 }, { width: 12 }, ...cols.map(() => ({ width: 14 }))];
    const pct = (row: ExcelJS.Row) => { for (let i = 2; i <= cols.length + 2; i++) row.getCell(i).numFmt = '0%'; };
    for (const qr of r.questions) {
      ws.addRow([`${qr.id}. ${qr.text}`]).font = { bold: true };
      ws.addRow(['', 'Total', ...cols.map((c) => `${c.label} (${c.letter})`)]).font = { color: { argb: 'FF5B6478' } };
      const choice = qr.type === 'single' || qr.type === 'multi' ? qr.rows : qr.type === 'text' && qr.coded ? qr.coded : null;
      if (choice) {
        ws.addRow(['Base (interviews)', qr.base, ...(choice[0]?.byBanner?.map((c) => c.base) ?? [])]);
        for (const row of choice) {
          pct(ws.addRow([row.label, row.pct, ...(row.byBanner?.map((c) => c.pct) ?? [])]));
          if (row.byBanner?.some((c) => c.sig.length)) ws.addRow(['', '', ...row.byBanner.map((c) => c.sig.join(''))]).font = { color: { argb: 'FF0EB5D8' }, size: 9 };
        }
      } else if (qr.type === 'numeric') {
        ws.addRow(['Base (interviews)', qr.base, ...(qr.byBanner?.map((c) => c.base) ?? [])]);
        ws.addRow(['Mean', qr.mean, ...(qr.byBanner?.map((c) => c.mean) ?? [])]);
        ws.addRow(['Median', qr.median]);
      } else if (qr.type === 'nps') {
        ws.addRow(['Base (interviews)', qr.base, ...(qr.byBanner?.map((c) => c.base) ?? [])]);
        ws.addRow(['NPS', qr.nps, ...(qr.byBanner?.map((c) => c.nps) ?? [])]);
        pct(ws.addRow(['Promoters (9–10)', qr.promoters]));
        pct(ws.addRow(['Passives (7–8)', qr.passives]));
        pct(ws.addRow(['Detractors (0–6)', qr.detractors]));
      } else if (qr.type === 'matrix') {
        for (const row of qr.rows) pct(ws.addRow([row.label, ...row.dist.map((d) => d.pct)]));
      } else if (qr.type === 'text') {
        ws.addRow(['Not coded yet: see the verbatims in Data Processing']);
      }
      ws.addRow([]);
    }
    await this.audit.log(ctx, 'dp.tables_exported', 'Survey', id, undefined, { banner: o.banner ?? null, weighted: r.weighted });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

const Targets = z.record(z.string().max(40), z.record(z.string().max(40), z.number().min(0).max(1)));
const Frame = z.array(z.object({ code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/), label: z.string().min(1).max(120), keywords: z.array(z.string().min(2).max(40)).max(30) })).min(1).max(40);

@ForModule('data-processing')
@Controller('dp')
export class DpController {
  constructor(private s: DpService) {}

  @Get('surveys') list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
  @Get('surveys/:id') overview(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.overview(ctx, id); }

  @Put('surveys/:id/weighting') @Write()
  weight(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.weight(ctx, id, parse(z.object({ targets: Targets }), b).targets); }

  @Delete('surveys/:id/weighting') @Write()
  unweight(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.unweight(ctx, id); }

  @Post('surveys/:id/codeframes/:qid/suggest') @Write()
  suggest(@Caller() ctx: Ctx, @Param('id') id: string, @Param('qid') qid: string, @Body() b: unknown) {
    return this.s.suggest(ctx, id, qid, parse(z.object({ maxCodes: z.number().int().min(2).max(30).default(10) }), b ?? {}).maxCodes);
  }

  @Put('surveys/:id/codeframes/:qid') @Write()
  saveFrame(@Caller() ctx: Ctx, @Param('id') id: string, @Param('qid') qid: string, @Body() b: unknown) {
    return this.s.saveFrame(ctx, id, qid, parse(z.object({ codes: Frame }), b).codes);
  }

  @Get('surveys/:id/codeframes/:qid/verbatims')
  verbatims(@Caller() ctx: Ctx, @Param('id') id: string, @Param('qid') qid: string, @Query('code') code?: string, @Query('take') take?: string) {
    return this.s.verbatims(ctx, id, qid, code, Math.min(500, Number(take) || 100));
  }

  @Patch('responses/:rid/codes') @Write()
  setCodes(@Caller() ctx: Ctx, @Param('rid') rid: string, @Body() b: unknown) {
    const x = parse(z.object({ questionId: z.string().max(40), codes: z.array(z.string().max(20)).max(40) }), b);
    return this.s.setCodes(ctx, rid, x.questionId, x.codes);
  }

  @Get('surveys/:id/tables.xlsx') @Header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async tables(@Caller() ctx: Ctx, @Param('id') id: string, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const buf = await this.s.tables(ctx, id, q);
    res.setHeader('content-disposition', `attachment; filename="${id}-tables.xlsx"`);
    return new StreamableFile(buf);
  }
}
