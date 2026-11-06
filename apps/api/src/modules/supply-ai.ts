/**
 * SUPPLY360 AI: the copilot, survey drafting and support reply drafts, all through the AI gateway
 * (a connected Claude model when AI_PROVIDER=anthropic and a key are set, the rules otherwise).
 *
 * The copilot asks the gateway only which question it is (intent, country, panel, segment); every
 * number in the answer is then counted from the database here, so a model never invents a figure.
 * Anything it proposes is a draft or a link for a person to act on.
 */
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { countries } from '@sampledge/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { AiGateway, type AiResult } from '../ai/gateway';
import { copilotIntent, finishDraft, supportReply, surveyDraft, type IntentOut } from '../ai/supply-tasks';

const day = 86400_000;
const FIELD = ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'];
const brandOf = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' } as const;
const panelOf: Record<string, 't2o' | 'mfr' | 'mho'> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
const panelName = { t2o: 'Turn2Opinion', mfr: 'MyFrequentRewards', mho: 'MyHealthOpinions' } as const;
const segLabel = { hcp: 'healthcare professionals', professional: 'B2B professionals', gen_z: 'Gen Z members (18–24)' } as const;
const countryName = (c: string) => countries.find((x) => x.code === c)?.name ?? c;

export type CopilotCard =
  | { kind: 'count'; title: string; value: number; unit: string; breakdown: { panel: string; value: number }[]; note: string; href: string }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][]; note: string; href: string }
  | { kind: 'bars'; title: string; bars: { label: string; value: number }[]; unit: string; note: string; href: string }
  | { kind: 'text'; title: string; body: string[]; sources: string[]; href?: string };
export type CopilotAction = { id: string; title: string; detail: string; impact: string; risk: 'low' | 'medium' | 'high'; href: string; create?: { kind: 'campaign'; data: Record<string, unknown> } };
export type CopilotAnswer = { text: string; cards: CopilotCard[]; actions: CopilotAction[]; context: { kind: 'country' | 'panel' | 'segment'; value: string; label: string }[]; intent: IntentOut; ai: Pick<AiResult<unknown>, 'provider' | 'model' | 'status' | 'note'> };

@Controller('supply/ai')
export class SupplyAiController {
  constructor(private db: PrismaService, private ai: AiGateway) {}

  /** A question in plain language → an answer counted from recorded data, with proposals to review. */
  @ForModule('command-center') @Post('copilot') @HttpCode(200)
  async copilot(@Caller() ctx: Ctx, @Body() body: unknown): Promise<CopilotAnswer> {
    const b = parse(z.object({ question: z.string().trim().min(2).max(500), context: z.object({ country: z.string().max(2).optional(), panel: z.string().max(3).optional(), segment: z.string().max(20).optional() }).strict().default({}) }).strict(), body);
    const r = await this.ai.run(ctx, copilotIntent, { question: b.question, context: b.context });
    const i = r.data;
    if (i.country && !countries.some((c) => c.code === i.country)) i.country = null;
    const out = await this.answer(ctx, i);
    const context = [
      ...(i.country ? [{ kind: 'country' as const, value: i.country, label: countryName(i.country) }] : []),
      ...(i.panel ? [{ kind: 'panel' as const, value: i.panel, label: panelName[i.panel] }] : []),
      ...(i.segment ? [{ kind: 'segment' as const, value: i.segment, label: segLabel[i.segment] }] : []),
    ];
    return { ...out, context: i.intent === 'unknown' ? [] : context, intent: i, ai: { provider: r.provider, model: r.model, status: r.status, note: r.note } };
  }

  private async answer(ctx: Ctx, i: IntentOut): Promise<Pick<CopilotAnswer, 'text' | 'cards' | 'actions'>> {
    const t = ctx.tenantId, now = Date.now();
    const brand = i.panel ? { brand: brandOf[i.panel] } : {};
    if (i.intent === 'reachable') {
      const where: Prisma.PanelistWhereInput = {
        tenantId: t, status: 'active', lastActiveAt: { gte: new Date(now - 30 * day) }, ...brand,
        ...(i.country ? { country: i.country } : {}),
        ...(i.segment === 'hcp' ? { segment: 'hcp' } : i.segment === 'professional' ? { segment: 'professional' } : i.segment === 'gen_z' ? { ageBand: '18-24' } : {}),
        NOT: { consents: { some: { purpose: 'research_participation', granted: false } } },
      };
      const g = await this.db.panelist.groupBy({ by: ['brand'], where, _count: true });
      const breakdown = (['t2o', 'mfr', 'mho'] as const).filter((p) => !i.panel || p === i.panel).map((p) => ({ panel: p, value: g.find((x) => x.brand === brandOf[p])?._count ?? 0 }));
      const value = breakdown.reduce((a, x) => a + x.value, 0);
      const who = i.segment ? segLabel[i.segment] : 'members';
      const where_ = i.country ? countryName(i.country) : 'all markets';
      return {
        text: `${value.toLocaleString('en-US')} ${who} are reachable in ${where_}${i.panel ? ` on ${panelName[i.panel]}` : ''}: active in the last 30 days without a withdrawn research consent.`,
        cards: [{ kind: 'count', title: `Reachable ${who}, ${where_}`, value, unit: who, breakdown, note: i.segment === 'hcp' ? 'Specialty is not recorded in SUPPLY360, so this counts every healthcare professional.' : 'Active in the last 30 days, research consent not withdrawn.', href: '/supply/panellists' }],
        actions: value ? [{ id: `seg-${now}`, title: 'Open these members in the Panellist Explorer', detail: 'Filter, export counts or start a feasibility check from there.', impact: `${value.toLocaleString('en-US')} members`, risk: 'low', href: '/supply/panellists' }] : [],
      };
    }
    if (i.intent === 'quota_pace') {
      const ps = await this.db.project.findMany({ where: { tenantId: t, stage: { in: FIELD } }, include: { quotas: { where: { closedAt: null } } } });
      const rows = ps.flatMap((p) => {
        const span = Math.max(1, p.deadline.getTime() - p.start.getTime());
        const elapsed = Math.min(1, Math.max(0.05, (now - p.start.getTime()) / span));
        return p.quotas.filter((c) => c.target > 0 && c.count < c.target).map((c) => ({ p, c, pace: c.count / c.target / elapsed }));
      }).filter((x) => x.pace < 0.8).sort((a, b) => a.pace - b.pace);
      return {
        text: rows.length ? `${rows.length} open quota cell${rows.length === 1 ? ' is' : 's are'} behind pace in projects in field. The furthest behind are first.` : 'No open quota cell in a project in field is behind pace.',
        cards: rows.length ? [{ kind: 'table', title: 'Quota cells behind pace', columns: ['Project', 'Cell', 'Achieved', 'Target', 'State'], rows: rows.slice(0, 10).map((x) => [x.p.code, x.c.label, x.c.count, x.c.target, x.pace < 0.5 ? 'At risk' : 'Behind']), note: 'Pace is the share of the target achieved divided by the share of field time passed; behind is under 0.8, at risk under 0.5.', href: '/supply/quotas' }] : [],
        actions: rows.slice(0, 2).map((x, k) => ({ id: `boost-${k}-${now}`, title: `Plan a batch for ${x.p.code} · ${x.c.label}`, detail: 'Opens batch scheduling; nothing is sent until a batch is approved there.', impact: `${(x.c.target - x.c.count).toLocaleString('en-US')} completes to go`, risk: 'low' as const, href: '/supply/batches' })),
      };
    }
    if (i.intent === 'completes_by_country') {
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const count = async (since: Date) => {
        const rs = await this.db.panelResponse.findMany({ where: { tenantId: t, status: 'complete', endedAt: { gte: since }, ...(i.panel ? { panel: { in: [i.panel, brandOf[i.panel]] } } : {}) }, select: { profile: true }, take: 50_000 });
        const m = new Map<string, number>();
        for (const r of rs) { const c = String((r.profile as { countryCode?: string } | null)?.countryCode ?? '—'); m.set(c, (m.get(c) ?? 0) + 1); }
        return { total: rs.length, bars: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })) };
      };
      let span = 'today', r = await count(today);
      if (!r.total) { span = 'in the last 7 days'; r = await count(new Date(now - 7 * day)); }
      return {
        text: r.total ? `${r.total.toLocaleString('en-US')} completes ${span}${r.bars[0] ? `; ${countryName(r.bars[0].label)} leads` : ''}.` : 'No completes were recorded today or in the last 7 days.',
        cards: r.total ? [{ kind: 'bars', title: `Completes ${span} by country (top 10)`, bars: r.bars, unit: 'completes', note: span === 'today' ? 'Completes recorded since 00:00 UTC from SampAudience responses.' : 'Nothing recorded yet today, so this shows the last 7 days.', href: '/supply/analytics' }] : [],
        actions: [],
      };
    }
    if (i.intent === 'winback') {
      const p = i.panel ?? 'mfr';
      const n = await this.db.panelist.count({ where: { tenantId: t, brand: brandOf[p], status: 'dormant', NOT: { consents: { some: { purpose: 'marketing_email', granted: false } } } } });
      const blocks = [
        { id: 'b1', kind: 'heading', text: 'We saved some surveys for you' },
        { id: 'b2', kind: 'text', text: `It has been a while. New ${panelName[p]} surveys match your profile, and your points are still here.` },
        { id: 'b3', kind: 'button', text: 'See my surveys' },
        { id: 'b4', kind: 'text', text: 'Change what we send you in your email settings.' },
      ];
      return {
        text: `${n.toLocaleString('en-US')} dormant ${panelName[p]} members can still receive marketing e-mail. I drafted a win-back e-mail you can review before anything is sent.`,
        cards: [{ kind: 'text', title: 'Draft: “We saved some surveys for you”', body: ['Subject: New surveys are waiting for you', ...blocks.map((x) => (x.kind === 'button' ? `Button: ${x.text}` : x.text))], sources: ['Members with status dormant', 'Marketing e-mail consent not withdrawn'], href: '/supply/email' }],
        actions: n ? [{ id: `wb-${now}`, title: `Create a draft win-back e-mail for ${n.toLocaleString('en-US')} dormant ${panelName[p]} members`, detail: 'Creates a draft in the e-mail campaigns screen. Nothing is sent until someone sends it there; large sends also need approval.', impact: `${n.toLocaleString('en-US')} recipients`, risk: 'medium', href: '/supply/email', create: { kind: 'campaign', data: { name: `Win-back: dormant ${panelName[p]} members`, brand: brandOf[p], segment: 'dormant', subjectA: 'New surveys are waiting for you', blocks } } }] : [],
      };
    }
    if (i.intent === 'redemptions_held') {
      const held = await this.db.incentiveEntry.findMany({ where: { tenantId: t, kind: 'redeem', status: 'pending_approval' }, select: { panelistId: true, points: true, createdAt: true }, take: 5000 });
      const who = new Map((await this.db.panelist.findMany({ where: { tenantId: t, id: { in: [...new Set(held.map((h) => h.panelistId))] } }, select: { id: true, brand: true } })).map((p) => [p.id, p.brand]));
      const by = new Map<string, { n: number; pts: number }>();
      for (const h of held) { const k = panelName[panelOf[who.get(h.panelistId) ?? ''] ?? 't2o'] ?? '—'; const v = by.get(k) ?? { n: 0, pts: 0 }; v.n++; v.pts += Math.abs(h.points); by.set(k, v); }
      const oldest = held.reduce<Date | null>((a, h) => (!a || h.createdAt < a ? h.createdAt : a), null);
      return {
        text: held.length ? `${held.length} redemption${held.length === 1 ? ' is' : 's are'} held for approval${oldest ? `; the oldest has waited ${Math.max(1, Math.round((now - oldest.getTime()) / day))} day(s)` : ''}.` : 'No redemptions are held right now.',
        cards: held.length ? [{ kind: 'text', title: 'Held redemptions', body: [...[...by.entries()].map(([k, v]) => `${k}: ${v.n} held, ${v.pts.toLocaleString('en-US')} points`), 'Redemptions over the workspace limit wait for a rewards approver; the risk signals behind a hold are kept in SampAudience.'], sources: ['Points ledger: redemptions pending approval', 'Approvals queue'], href: '/supply/redemptions' }] : [],
        actions: held.length ? [{ id: `red-${now}`, title: 'Review held redemptions', detail: 'Approve or reject each one in the redemptions queue.', impact: `${held.length} waiting`, risk: 'low', href: '/supply/redemptions' }] : [],
      };
    }
    if (i.intent === 'liability') {
      const [g, ten] = await Promise.all([
        this.db.panelist.groupBy({ by: ['brand'], where: { tenantId: t, status: { not: 'deletion_requested' }, ...brand }, _sum: { points: true } }),
        this.db.tenant.findUniqueOrThrow({ where: { id: t }, select: { pointValue: true, baseCurrency: true } }),
      ]);
      const bars = (['t2o', 'mfr', 'mho'] as const).filter((p) => !i.panel || p === i.panel).map((p) => ({ label: panelName[p], value: Math.round((g.find((x) => x.brand === brandOf[p])?._sum.points ?? 0) * ten.pointValue) }));
      const total = bars.reduce((a, b) => a + b.value, 0);
      return {
        text: `Outstanding reward liability is ${total.toLocaleString('en-US', { style: 'currency', currency: ten.baseCurrency, maximumFractionDigits: 0 })} across member balances.`,
        cards: [{ kind: 'bars', title: `Liability by panel (${ten.baseCurrency})`, bars, unit: ten.baseCurrency, note: `Member point balances at ${ten.pointValue} ${ten.baseCurrency} per point.`, href: '/supply/rewards' }],
        actions: [],
      };
    }
    return { text: 'I can answer questions about reachable members, quota pace, completes by country, dormant members, held redemptions and reward liability, and propose next steps for you to approve. Try one of these:', cards: [], actions: [] };
  }

  /** A survey brief → first-draft questions with the reason for each and wording checks. Nothing is saved. */
  @ForModule('panels') @Post('survey-draft') @HttpCode(200)
  async surveyDraft(@Caller() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ topic: z.string().trim().min(3).max(120), audience: z.enum(['consumer', 'b2b', 'health']), goal: z.string().trim().max(500).default(''), length: z.number().int().min(2).max(30) }).strict(), body);
    const r = await this.ai.run(ctx, surveyDraft, b);
    return { ...finishDraft(r.data), ai: { provider: r.provider, model: r.model, status: r.status, note: r.note } };
  }

  /** A draft reply for a support ticket, from the ticket and the member's recent ledger. Nothing is sent. */
  @ForModule('panels') @Post('tickets/:id/draft') @HttpCode(200)
  async ticketDraft(@Caller() ctx: Ctx, @Param('id') id: string) {
    const rec = await this.db.supplyRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: 'ticket', id } });
    if (!rec) throw new NotFoundException('Ticket not found');
    const d = rec.data as { subject: string; category: string; panelistId: string; messages?: { from: string; text: string }[] };
    const p = await this.db.panelist.findFirst({ where: { tenantId: ctx.tenantId, id: d.panelistId } });
    if (!p) throw new NotFoundException('Member not found');
    const ledger = await this.db.incentiveEntry.findMany({ where: { tenantId: ctx.tenantId, panelistId: p.id }, orderBy: { createdAt: 'desc' }, take: 6 });
    const r = await this.ai.run(ctx, supportReply, {
      subject: d.subject, category: d.category, panel: panelName[panelOf[p.brand] ?? 't2o'],
      messages: (d.messages ?? []).filter((m) => m.from !== 'note').map((m) => ({ from: m.from, text: m.text.slice(0, 2000) })),
      ledger: ledger.map((e) => ({ kind: e.kind, points: e.points, note: e.note, date: e.createdAt.toISOString().slice(0, 10) })),
      balance: p.points,
    });
    const goodwill = r.data.goodwill && r.data.goodwill > 0 ? Math.min(100, Math.round(r.data.goodwill)) : null;
    return { ticketId: rec.id, ref: rec.ref, ...r.data, goodwill, ai: { provider: r.provider, model: r.model, status: r.status, note: r.note } };
  }

  /** Drafts made and replies sent in the last 7 days, from the AI call log and the audit log. */
  @ForModule('panels') @Get('support/stats')
  async supportStats(@Caller() ctx: Ctx) {
    const since = new Date(Date.now() - 7 * day);
    const [drafts, replies, solved, open] = await Promise.all([
      this.db.aiCall.count({ where: { tenantId: ctx.tenantId, task: 'support.reply', createdAt: { gte: since } } }),
      this.db.auditLog.count({ where: { tenantId: ctx.tenantId, action: { in: ['ticket.reply', 'ticket.reply_solve'] }, at: { gte: since } } }),
      this.db.auditLog.count({ where: { tenantId: ctx.tenantId, action: { in: ['ticket.solve', 'ticket.reply_solve'] }, at: { gte: since } } }),
      this.db.supplyRecord.count({ where: { tenantId: ctx.tenantId, kind: 'ticket', status: { in: ['new', 'open'] } } }),
    ]);
    return { drafts7d: drafts, replies7d: replies, solved7d: solved, awaitingReply: open };
  }
}
