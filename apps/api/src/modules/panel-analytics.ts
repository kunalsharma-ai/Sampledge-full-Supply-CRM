/**
 * Panel analytics and the reward policy, from the workspace's own panel records.
 *
 * Analytics are counted from Panelist rows (status, demographics, quality, profile completion,
 * sign-up and last-activity dates, point balances), consents, and survey participation recorded
 * as respondent records (source panel:<brand>) or imported panel responses. Nothing is simulated;
 * a brand with no members shows zeros. Retention uses each member's last activity date, which is
 * all the system records about activity.
 *
 * The reward policy (reward categories, redemption threshold, weekly invitation cap) is versioned:
 * every save is a new version, audited, and the newest version is the one in force. The incentive
 * ledger enforces the redemption threshold.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Put, Query } from '@nestjs/common';
import { panels } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const day = 86400_000;
const BRANDS = ['turn2opinion', 'myfrequentrewards', 'myhealthopinions'] as const;
const IMPORT_PANEL: Record<string, (typeof BRANDS)[number]> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };
const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

const Query_ = z.object({ brand: z.enum(BRANDS).optional() });

export const RewardPolicyBody = z.object({
  categories: z.array(z.object({
    id: z.string().trim().regex(/^[a-z0-9-]{2,30}$/, 'Category id: 2-30 lower-case letters, digits or dashes'),
    name: z.string().trim().min(2).max(60),
    maxLoi: z.number().int().min(1).max(120),
    points: z.number().int().min(1).max(100_000),
    minQuality: z.number().min(0).max(1),
  }).strict()).min(1).max(10),
  redemptionThreshold: z.number().int().min(0).max(1_000_000),
  weeklyInviteCap: z.number().int().min(1).max(50),
  note: z.string().trim().max(300).optional(),
}).strict().refine((b) => new Set(b.categories.map((c) => c.id)).size === b.categories.length, { message: 'Category ids must be unique', path: ['categories'] });
export type RewardPolicy = z.infer<typeof RewardPolicyBody>;

const monthStart = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The policy in force for a workspace (newest version), or null if none has been saved. */
export async function currentRewardPolicy(db: Prisma.TransactionClient | PrismaService, tenantId: string) {
  return db.panelRewardPolicy.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } });
}

@Injectable()
export class PanelAnalyticsService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  async analytics(ctx: Ctx, brand?: (typeof BRANDS)[number], now = new Date()) {
    const t = ctx.tenantId;
    const where: Prisma.PanelistWhereInput = { tenantId: t, ...(brand ? { brand } : {}) };
    const months = Array.from({ length: 6 }, (_, i) => monthStart(now, 5 - i));
    const since30 = new Date(now.getTime() - 30 * day), since90 = new Date(now.getTime() - 90 * day);
    const tenant = await this.db.tenant.findUniqueOrThrow({ where: { id: t }, select: { pointValue: true, baseCurrency: true } });

    const [byBrand, members, demo, quality, healthConsents, panelStarts, imported] = await Promise.all([
      this.db.panelist.groupBy({ by: ['brand', 'status'], where: { tenantId: t }, _count: true, _avg: { qualityScore: true, profileCompletion: true }, _sum: { points: true } }),
      this.db.panelist.findMany({ where, select: { brand: true, status: true, joinedAt: true, lastActiveAt: true, profileCompletion: true, surveysCompleted: true, points: true } }),
      this.db.panelist.groupBy({ by: ['ageBand', 'gender'], where, _count: true }),
      this.db.$queryRaw<{ b: number; n: bigint }[]>(Prisma.sql`
        SELECT LEAST(9, floor("qualityScore" * 10))::int AS b, count(*) AS n FROM "Panelist"
        WHERE "tenantId" = ${t} ${brand ? Prisma.sql`AND "brand" = ${brand}` : Prisma.empty} GROUP BY 1`),
      this.db.panelist.groupBy({ by: ['segment'], where: { tenantId: t, brand: 'myhealthopinions' }, _count: true }),
      this.db.response.findMany({ where: { tenantId: t, source: brand ? `panel:${brand}` : { startsWith: 'panel:' }, startedAt: { gte: months[0] } }, select: { startedAt: true } }),
      this.db.panelResponse.findMany({ where: { tenantId: t, ...(brand ? { panel: Object.keys(IMPORT_PANEL).find((k) => IMPORT_PANEL[k] === brand) } : {}), startedAt: { gte: months[0] } }, select: { startedAt: true } }),
    ]);
    const healthConsent = await this.db.consent.count({ where: { purpose: 'health_data', granted: true, panelist: { tenantId: t, brand: 'myhealthopinions' } } });

    const cards = panels.map((p) => {
      const g = byBrand.filter((x) => x.brand === p.id);
      const n = g.reduce((s, x) => s + x._count, 0);
      const avgOf = (k: 'qualityScore' | 'profileCompletion') => (n ? g.reduce((s, x) => s + (x._avg[k] ?? 0) * x._count, 0) / n : 0);
      return {
        id: p.id, name: p.name, domain: p.domain, focus: p.focus, color: p.color,
        registered: n,
        active: g.find((x) => x.status === 'active')?._count ?? 0,
        avgQuality: r3(avgOf('qualityScore')),
        profileCompletion: r3(avgOf('profileCompletion')),
        rewardLiability: Math.round(g.reduce((s, x) => s + (x._sum.points ?? 0), 0) * tenant.pointValue * 100) / 100,
      };
    });

    const reg = members.length;
    const inMonth = (d: Date | null | undefined, i: number) => !!d && d >= months[i] && (i === 5 || d < months[i + 1]);
    const cohorts = months.map((m, c) => {
      const cohort = members.filter((x) => inMonth(x.joinedAt, c));
      return { month: monthKey(m), size: cohort.length, retained: months.slice(c).map((ms) => (cohort.length ? r3(cohort.filter((x) => x.lastActiveAt && x.lastActiveAt >= ms).length / cohort.length) : null)) };
    });
    const participation = [...panelStarts.map((r) => r.startedAt), ...imported.map((r) => r.startedAt).filter((d): d is Date => !!d)];

    return {
      asOf: now.toISOString(),
      currency: tenant.baseCurrency,
      pointValue: tenant.pointValue,
      cards,
      kpis: {
        registered: reg,
        active: members.filter((m) => m.status === 'active').length,
        active90: members.filter((m) => m.lastActiveAt && m.lastActiveAt >= since90).length,
        newLast30: members.filter((m) => m.joinedAt >= since30).length,
        profileCompletion: reg ? r3(members.reduce((s, m) => s + m.profileCompletion, 0) / reg) : 0,
        inactive90Share: reg ? r3(members.filter((m) => !m.lastActiveAt || m.lastActiveAt < since90).length / reg) : 0,
        rewardLiability: Math.round(members.reduce((s, m) => s + m.points, 0) * tenant.pointValue * 100) / 100,
      },
      profileFunnel: [
        { stage: 'Registered', n: reg },
        { stage: 'Profile 50%+', n: members.filter((m) => m.profileCompletion >= 0.5).length },
        { stage: 'Profile 80%+', n: members.filter((m) => m.profileCompletion >= 0.8).length },
        { stage: 'Completed a survey', n: members.filter((m) => m.surveysCompleted > 0).length },
        { stage: 'Active in 90 days', n: members.filter((m) => m.lastActiveAt && m.lastActiveAt >= since90).length },
      ],
      pyramid: AGE_BANDS.map((a) => ({
        ageBand: a,
        female: demo.find((d) => d.ageBand === a && d.gender === 'female')?._count ?? 0,
        male: demo.find((d) => d.ageBand === a && d.gender === 'male')?._count ?? 0,
        other: demo.filter((d) => d.ageBand === a && !['female', 'male'].includes(d.gender)).reduce((s, d) => s + d._count, 0),
      })),
      quality: Array.from({ length: 10 }, (_, i) => Number(quality.find((q) => q.b === i)?.n ?? 0)),
      monthly: months.map((m, i) => ({
        month: monthKey(m),
        registrations: members.filter((x) => inMonth(x.joinedAt, i)).length,
        activeMembers: members.filter((x) => inMonth(x.lastActiveAt, i)).length,
        surveyStarts: participation.filter((d) => inMonth(d, i)).length,
      })),
      cohorts,
      engagement: {
        lowProfile: members.filter((m) => m.status === 'active' && m.profileCompletion < 0.6).length,
        inactive60: members.filter((m) => m.status === 'active' && (!m.lastActiveAt || m.lastActiveAt < new Date(now.getTime() - 60 * day))).length,
        dormant: members.filter((m) => m.status === 'dormant').length,
        suspended: members.filter((m) => m.status === 'suspended').length,
        deletionRequested: members.filter((m) => m.status === 'deletion_requested').length,
      },
      health: { segments: Object.fromEntries(healthConsents.map((s) => [s.segment, s._count])), healthDataConsents: healthConsent },
    };
  }

  async policy(ctx: Ctx) {
    const [current, history] = await Promise.all([
      currentRewardPolicy(this.db, ctx.tenantId),
      this.db.panelRewardPolicy.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { version: 'desc' }, take: 20, select: { version: true, createdBy: true, createdAt: true, note: true } }),
    ]);
    return { current, history };
  }

  async savePolicy(ctx: Ctx, b: RewardPolicy) {
    return this.db.$transaction(async (tx) => {
      const prev = await currentRewardPolicy(tx, ctx.tenantId);
      const row = await tx.panelRewardPolicy.create({
        data: { tenantId: ctx.tenantId, version: (prev?.version ?? 0) + 1, categories: b.categories as Prisma.InputJsonValue, redemptionThreshold: b.redemptionThreshold, weeklyInviteCap: b.weeklyInviteCap, note: b.note ?? null, createdBy: ctx.name, createdById: ctx.userId },
      });
      await this.audit.log(ctx, 'panel.reward_policy', 'PanelRewardPolicy', row.id,
        prev ? { version: prev.version, categories: prev.categories, redemptionThreshold: prev.redemptionThreshold, weeklyInviteCap: prev.weeklyInviteCap } : undefined,
        { version: row.version, categories: b.categories, redemptionThreshold: b.redemptionThreshold, weeklyInviteCap: b.weeklyInviteCap }, tx);
      return row;
    });
  }
}

@ForModule('panels')
@Controller('panels')
export class PanelAnalyticsController {
  constructor(private s: PanelAnalyticsService) {}
  @Get('analytics') analytics(@Caller() ctx: Ctx, @Query() q: unknown) { return this.s.analytics(ctx, parse(Query_, q).brand); }
  @Get('reward-policy') policy(@Caller() ctx: Ctx) { return this.s.policy(ctx); }
  @Put('reward-policy') @Write()
  save(@Caller() ctx: Ctx, @Body() b: unknown) {
    const x = parse(RewardPolicyBody, b);
    if (x.categories.some((c, i) => x.categories.some((d, j) => j !== i && d.maxLoi === c.maxLoi))) throw new BadRequestException('Two categories cannot share the same maximum LOI');
    return this.s.savePolicy(ctx, x);
  }
}
