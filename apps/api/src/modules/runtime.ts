import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Post, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { live } from '../common/live';
import { access, answer, qualityFlags, displayOptions, evaluate, pipe, start, type Answer, type Answers, type Outcome, type RunState, type SurveyDef } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import type { Request, Response as ExpressResponse } from 'express';
import { config } from '../common/config';
import { z } from 'zod';
import type { Ctx } from '../common/context';
import { Public } from '../common/context';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { SurveysService } from './surveys';
import { enterTenant } from '../common/tenant-scope';

const DEVICE_COOKIE = 'sx_dev';

/** The device cookie is never stored as is: only a keyed hash per survey, so it cannot link surveys. */
export const deviceHash = (surveyId: string, device: string) => createHmac('sha256', config.jwtSecret).update(`device:${surveyId}:${device}`).digest('base64url');

/** Builds a supplier exit link. Only the supplier's own respondent id is substituted, URL-encoded. */
export function exitUrl(a: { completeUrl: string | null; screenoutUrl: string | null; overquotaUrl: string | null } | null, outcome: string | null | undefined, rid: string | null) {
  if (!a || !outcome) return null;
  const url = outcome === 'complete' ? a.completeUrl : outcome === 'screenout' ? a.screenoutUrl : outcome === 'overquota' ? a.overquotaUrl : null;
  return url ? url.split('{rid}').join(encodeURIComponent(rid ?? '')) : null;
}

/** Thrown inside the completion transaction when a hard cell filled up between check and write. */
class QuotaRace extends Error {}

const AnswerValue: z.ZodType<Answer> = z.union([z.string().max(10_000), z.number(), z.array(z.string().max(200)).max(200), z.record(z.string().max(200))]);

/**
 * Respondent runtime. Respondents are anonymous: the response id is the session token.
 * Live sessions need a Published survey; signed-in staff with Survey Studio access can preview
 * any status, and preview completes never touch quota counts.
 */
@Injectable()
export class RuntimeService {
  constructor(private db: PrismaService, private surveys: SurveysService) {}

  private render(def: SurveyDef, st: RunState, seed: string) {
    if (!st.cursor) return null;
    const q = def.questions.find((x) => x.id === st.cursor)!;
    const visible = def.questions.filter((x) => evaluate(x.displayIf, st.answers));
    const pos = visible.findIndex((x) => x.id === q.id);
    return {
      question: { id: q.id, type: q.type, text: pipe(q.text, def, st.answers), options: q.options ? displayOptions(q, seed) : undefined, rows: q.rows, min: q.min, max: q.max, required: q.required !== false },
      progress: visible.length ? Math.round((pos / visible.length) * 100) : 0,
    };
  }

  async start(surveyId: string, body: { source?: string; respondent?: string; preview?: boolean; allocation?: string }, staff: Ctx | undefined, device?: string) {
    const s = await this.db.survey.findUnique({ where: { id: surveyId } });
    if (!s || !s.hasDefinition) throw new NotFoundException('Survey not found');
    enterTenant(s.tenantId);
    let source = body.source ?? 'direct';
    if (body.preview || s.status !== 'Published') {
      if (!staff || staff.tenantId !== s.tenantId || access(staff.role, 'survey-studio') === 'none') throw new ForbiddenException('This survey is not live');
      source = 'preview';
    }
    // Supplier entry: the allocation must belong to this survey's project and be approved or live.
    let allocationId: string | null = null;
    if (body.allocation && source !== 'preview') {
      const a = await this.db.allocation.findFirst({ where: { id: body.allocation, tenantId: s.tenantId } });
      if (!a || !s.projectId || a.projectId !== s.projectId) throw new NotFoundException('This survey link is not valid');
      if (a.status !== 'approved' && a.status !== 'live') throw new ForbiddenException('This survey is not open for this supplier');
      allocationId = a.id;
      source = `vendor:${a.vendorId}`;
    }
    const def = await this.surveys.definition(s.id, s.currentVersion);
    const st = start(def);
    const supplierRid = allocationId ? body.respondent ?? null : null;
    const r = await this.db.response.create({
      data: {
        // The id is the respondent's only credential for reading and answering this session, so it is
        // 144 random bits rather than a cuid (which is mostly timestamp and counter, and guessable).
        id: `rs_${randomBytes(18).toString('base64url')}`,
        tenantId: s.tenantId, surveyId: s.id, version: s.currentVersion, source, respondent: body.respondent ?? 'anon', answers: {}, path: [], cursor: st.cursor,
        allocationId, supplierRid, deviceHash: device && source !== 'preview' ? deviceHash(s.id, device) : null,
      },
    });
    return { responseId: r.id, version: s.currentVersion, preview: source === 'preview', ...this.render(def, st, r.id) };
  }

  async state(responseId: string) {
    const r = await this.db.response.findUnique({ where: { id: responseId } });
    if (!r) throw new NotFoundException('Session not found');
    enterTenant(r.tenantId);
    const def = await this.surveys.definition(r.surveyId, r.version);
    const st: RunState = { cursor: r.cursor, answers: r.answers as Answers, path: r.path, outcome: (r.outcome ?? undefined) as Outcome | undefined };
    return { responseId: r.id, outcome: r.outcome, redirect: await this.redirectFor(r, r.outcome), ...this.render(def, st, r.id) };
  }

  private async redirectFor(r: { allocationId: string | null; supplierRid: string | null }, outcome: string | null | undefined) {
    if (!r.allocationId || !outcome) return null;
    const a = await this.db.allocation.findUnique({ where: { id: r.allocationId }, select: { completeUrl: true, screenoutUrl: true, overquotaUrl: true } });
    return exitUrl(a, outcome, r.supplierRid);
  }

  async answer(responseId: string, qid: string, value: Answer) {
    const r = await this.db.response.findUnique({ where: { id: responseId } });
    if (!r) throw new NotFoundException('Session not found');
    enterTenant(r.tenantId);
    if (r.outcome) throw new BadRequestException(`This session already ended (${r.outcome})`);
    const def = await this.surveys.definition(r.surveyId, r.version);
    const prev: RunState = { cursor: r.cursor, answers: r.answers as Answers, path: r.path };
    const next = answer(def, prev, qid, value);
    if (next.error) throw new UnprocessableEntityException({ message: next.error, questionId: qid });

    let outcome = next.outcome;
    if (outcome === 'complete' && r.source !== 'preview') {
      try {
        const flags = await this.quality(r, def, next.answers);
        await this.db.$transaction(async (tx) => {
          await this.countComplete(tx, r.surveyId, def, next.answers);
          await this.save(tx, r.id, next, 'complete');
          if (flags.length) await tx.response.update({ where: { id: r.id }, data: { flags } });
          await live(tx, { t: r.tenantId, type: 'response.completed', module: 'survey-studio' });
        });
      } catch (e) {
        if (!(e instanceof QuotaRace)) throw e;
        outcome = 'overquota';
        await this.save(this.db, r.id, next, 'overquota');
      }
    } else {
      await this.save(this.db, r.id, next, outcome);
    }
    return { responseId: r.id, outcome: outcome ?? null, ...(outcome ? { redirect: await this.redirectFor(r, outcome) } : this.render(def, next, r.id)) };
  }

  /**
   * Atomic quota counting. Each matching cell increments only while count < target (hard cells),
   * so two respondents racing for the last slot cannot both complete. A zero-row update means the
   * cell filled first: the whole completion rolls back and the respondent is overquota.
   */
  private async countComplete(tx: Prisma.TransactionClient, surveyId: string, def: SurveyDef, answers: Answers) {
    const cells = await tx.quotaCell.findMany({ where: { surveyId } });
    const byKey = new Map(cells.map((c) => [c.key, c]));
    for (const q of def.quotas) {
      if (!evaluate(q.when, answers)) continue;
      const cell = byKey.get(q.id);
      if (!cell) continue;
      const n = await tx.$executeRaw`UPDATE "QuotaCell" SET "count" = "count" + 1 WHERE "id" = ${cell.id} AND ("hard" = false OR "count" < "target")`;
      if (n === 0) throw new QuotaRace();
      if (cell.count + 1 >= cell.target) {
        const now = await tx.quotaCell.findUniqueOrThrow({ where: { id: cell.id } });
        if (now.count === now.target) await emit(tx, cell.tenantId, 'quota.filled', { quotaCellId: cell.id, surveyId, label: cell.label });
      }
    }
    const s = await tx.survey.findUniqueOrThrow({ where: { id: surveyId }, select: { projectId: true } });
    if (s.projectId) await tx.project.update({ where: { id: s.projectId }, data: { completes: { increment: 1 } } });
  }

  /** Quality flags on a completed interview (flagging only; rejection is approval-gated). */
  private async quality(r: { id: string; surveyId: string; respondent: string; startedAt: Date; deviceHash: string | null; allocationId: string | null }, def: SurveyDef, answers: Answers) {
    const s = await this.db.survey.findUniqueOrThrow({ where: { id: r.surveyId }, select: { project: { select: { loi: true } } } });
    const flags: string[] = qualityFlags(def.questions, answers, (Date.now() - r.startedAt.getTime()) / 1000, s.project?.loi ?? 10);
    if (r.respondent !== 'anon' && (await this.db.response.count({ where: { surveyId: r.surveyId, respondent: r.respondent, outcome: 'complete', id: { not: r.id } } }))) flags.push('duplicate');
    // The same browser completing twice: flagged for review, never blocked or rejected automatically.
    if (r.deviceHash && (await this.db.response.count({ where: { surveyId: r.surveyId, deviceHash: r.deviceHash, outcome: 'complete', id: { not: r.id } } }))) flags.push('duplicate_device');
    return flags;
  }

  private save(tx: Prisma.TransactionClient | PrismaService, id: string, st: RunState, outcome: Outcome | undefined) {
    return tx.response.update({
      where: { id },
      data: { answers: st.answers as Prisma.InputJsonValue, path: st.path, cursor: st.cursor, outcome: outcome ?? null, completedAt: outcome ? new Date() : null },
    });
  }
}

@Controller('r')
export class RuntimeController {
  constructor(private s: RuntimeService) {}

  @Public() @Post(':surveyId/start')
  startSession(@Param('surveyId') id: string, @Body() b: unknown, @Req() req: Request & { ctx?: Ctx }, @Res({ passthrough: true }) res: ExpressResponse) {
    const x = parse(z.object({ source: z.string().max(60).regex(/^[a-z0-9:_-]+$/i).optional(), respondent: z.string().max(80).optional(), preview: z.boolean().optional(), allocation: z.string().max(40).optional() }), b ?? {});
    // A random first-party id for duplicate checks; it carries no information about the person.
    let device = typeof req.cookies?.[DEVICE_COOKIE] === 'string' && /^[\w-]{16,64}$/.test(req.cookies[DEVICE_COOKIE]) ? req.cookies[DEVICE_COOKIE] as string : undefined;
    if (!device) {
      device = randomBytes(18).toString('base64url');
      res.cookie(DEVICE_COOKIE, device, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 365 * 86400_000, path: '/api/v1/r' });
    }
    return this.s.start(id, x, req.ctx, device);
  }

  @Public() @Get('session/:id')
  state(@Param('id') id: string) { return this.s.state(id); }

  @Public() @Post('session/:id/answer') @HttpCode(200)
  answer(@Param('id') id: string, @Body() b: unknown) {
    const x = parse(z.object({ questionId: z.string(), value: AnswerValue }), b);
    return this.s.answer(id, x.questionId, x.value);
  }
}
