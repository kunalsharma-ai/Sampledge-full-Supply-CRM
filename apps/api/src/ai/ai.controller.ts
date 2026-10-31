import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { paged, pageArgs } from '../common/paging';
import { can } from '@sampledge/core';
import { z } from 'zod';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { ProjectsService } from '../modules/projects';
import { extractText } from './documents';
import { AI_MODEL, aiConfig, AiGateway } from './gateway';
import { projectSummary, questionnaireStructure, rfqExtract, tasks, type ProjectFacts } from './tasks';

const day = 86400_000;

@Controller('ai')
export class AiController {
  constructor(private ai: AiGateway, private db: PrismaService, private projects: ProjectsService) {}

  /** Which provider answers, the month's spend against the cap, and the registered tasks. */
  @Get('status')
  async status(@Caller() ctx: Ctx) {
    const cfg = aiConfig();
    const spend = await this.ai.monthSpend(ctx.tenantId);
    return {
      provider: cfg.provider, model: cfg.provider === 'anthropic' ? AI_MODEL : null, connected: cfg.provider !== 'rules', note: cfg.note ?? null,
      monthSpendUsd: Math.round(spend.usd * 100) / 100, monthCalls: spend.calls, capUsd: cfg.capUsd,
      tasks: tasks.map((t) => ({ name: t.name, version: t.version, description: t.description })),
    };
  }

  @ForModule('admin') @Get('usage')
  async usage(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const { want, ...page } = pageArgs(q, 200, 50);
    return paged(await this.db.aiCall.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page }), want, res);
  }

  @ForModule('crm') @Post('rfq-extract') @HttpCode(200)
  rfq(@Caller() ctx: Ctx, @Body() b: unknown) {
    return this.ai.run(ctx, rfqExtract, parse(z.object({ text: z.string().min(10).max(20_000) }), b));
  }

  /** Questionnaire text or an uploaded file (base64) → structured draft questions. Nothing is saved. */
  @ForModule('survey-studio') @Post('questionnaire') @HttpCode(200)
  async questionnaire(@Caller() ctx: Ctx, @Body() b: unknown) {
    const x = parse(z.union([z.object({ text: z.string().min(5).max(200_000) }), z.object({ fileName: z.string().max(200), base64: z.string().max(12_000_000) })]), b);
    const doc = 'text' in x ? { text: x.text, kind: 'text' } : await extractText(x.fileName, x.base64);
    if (doc.text.trim().length < 5) return { source: doc.kind, chars: 0, result: null, message: 'No text found in the file. Scanned PDFs need OCR, which is not available.' };
    const result = await this.ai.run(ctx, questionnaireStructure, { text: doc.text.slice(0, 200_000) });
    return { source: doc.kind, chars: doc.text.length, text: doc.text.slice(0, 20_000), result };
  }

  @ForModule('projects') @Get('projects/:id/summary')
  async summary(@Caller() ctx: Ctx, @Param('id') id: string) {
    const p = await this.projects.get(ctx, id); // scoped and redacted for the caller
    const now = Date.now();
    const facts: ProjectFacts = {
      code: p.code, name: p.name, stage: p.stage, audience: p.audience, countries: p.countries,
      target: p.target, completes: p.completes, ir: p.ir, loi: p.loi,
      daysLeft: Math.ceil((p.deadline.getTime() - now) / day), daysElapsed: Math.max(0, Math.floor((now - p.start.getTime()) / day)),
      quotas: p.quotas.map((q) => ({ label: q.label, target: q.target, count: q.count })),
      vendors: new Set(p.allocations.map((a) => a.vendorId)).size,
      blockers: p.blockers,
      // Cost facts only reach the model (or the rules) when the caller may see margins.
      ...(can(ctx.role, 'view:margins') && 'budget' in p && typeof p.budget === 'number' && p.budget > 0 ? { budgetUsedShare: Math.round(((p as { costIncurred: number }).costIncurred / p.budget) * 100) / 100 } : {}),
    };
    return this.ai.run(ctx, projectSummary, facts);
  }
}
