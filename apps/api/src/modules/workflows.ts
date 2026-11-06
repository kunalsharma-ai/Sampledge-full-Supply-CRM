/**
 * Engagement workflows that actually run.
 *
 * A workflow is a `workflow` record (see supply-kinds.ts): a graph of one trigger, conditions with a
 * yes and a no path, delays and actions, built on the automation screen. While it is active the
 * worker, once a minute (WorkflowEngine.runDue):
 * 1. enrols members who meet the trigger after the workflow was activated (never members already
 *    past it), at most ENROL_PER_TICK per workflow and once per member (unique per workflow);
 * 2. moves each due run forward through the graph until it reaches a delay or the end.
 *
 * What the blocks do here:
 * - Triggers: sign-up (joined after activation), inactive N days (crossed the line after
 *   activation), profile below N% (joined after activation and still below), points balance reached
 *   (an earn after activation took the balance to N or more).
 * - Conditions: segment (healthcare professionals, B2B, Gen Z, high quality score) and country.
 *   "Opened last message" needs open tracking from the delivery provider, so a workflow using it
 *   cannot be activated.
 * - Delays: wait N hours; wait for the send window (from N:00 in the member's country time).
 * - Actions: e-mail from a built-in template, only to members who have not withdrawn e-mail consent;
 *   an in-app message (kept in the delivery log, as there is no in-app inbox yet); bonus points, a
 *   signed ledger adjustment of at most 500; a tag, stored as a profile attribute `tag:<name>`.
 *
 * Every message goes through the Comms Hub (one member each, linked to the workflow), and each
 * workflow sends at most AUTOMATION_DAILY_CAP messages in 24 hours; runs past the cap wait an hour.
 * Points and messages are audited as "Automation: <workflow name>". Pausing stops runs at their next
 * step; editing needs the workflow paused, and a run whose next step was removed ends as failed.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post } from '@nestjs/common';
import { Prisma, type Panelist, type SupplyRecord } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';
import { parse } from '../common/zod';
import { queueMessage } from './comms';

type Tx = Prisma.TransactionClient;
const hour = 3600_000, day = 24 * hour;
export const ENROL_PER_TICK = 500;
const dailyCap = () => Number(process.env.AUTOMATION_DAILY_CAP ?? 500);

export type WfNode = { id: string; kind: 'trigger' | 'condition' | 'delay' | 'action'; type: string; config: Record<string, string | number>; x: number; y: number };
export type WfEdge = { id: string; from: string; to: string; branch?: 'yes' | 'no' };
export type WorkflowData = { name: string; panel: 'all' | 't2o' | 'mfr' | 'mho'; nodes: WfNode[]; edges: WfEdge[]; activatedAt?: string };

export const supportedBlocks: Record<WfNode['kind'], string[]> = {
  trigger: ['signup', 'inactive', 'profile_gap', 'points'],
  condition: ['segment', 'country'],
  delay: ['wait', 'window'],
  action: ['email', 'push', 'bonus', 'tag'],
};
const unsupported: Record<string, string> = { opened: '“Opened last message” needs open tracking from the delivery provider, which is not connected' };
export const templates: Record<string, { subject: string; body: string }> = {
  Welcome: { subject: 'Welcome to {{panel}}', body: 'Welcome to {{panel}}. Finish your profile so we can match you to surveys that fit, and start earning points.' },
  'Finish your profile': { subject: 'A few questions left on your {{panel}} profile', body: 'Your profile is {{profile}}% complete. A complete profile gets you more survey matches and more points.' },
  'We miss you': { subject: 'New surveys are waiting at {{panel}}', body: 'It has been a while. New surveys match your profile, and your {{points}} points are still here.' },
  'Points reminder': { subject: 'You have {{points}} points at {{panel}}', body: 'You have {{points}} points. Redeem them for gift cards, PayPal or a donation from your rewards page.' },
  'Survey invite': { subject: 'A new survey for you at {{panel}}', body: 'A new survey matches your profile. Open your dashboard to take part and earn points.' },
};
const brandOf: Record<string, string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };
const brandName: Record<string, string> = { turn2opinion: 'Turn2Opinion', myfrequentrewards: 'MyFrequentRewards', myhealthopinions: 'MyHealthOpinions' };
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
/** Rough standard-time offsets for the send window; countries not listed use UTC. */
const utcOffset: Record<string, number> = { US: -5, CA: -5, MX: -6, BR: -3, GB: 0, IE: 0, PT: 0, DE: 1, FR: 1, ES: 1, IT: 1, NL: 1, BE: 1, SE: 1, PL: 1, ZA: 2, IN: 5.5, SG: 8, CN: 8, JP: 9, AU: 10 };
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** What stops a workflow from being activated; empty when it can run. */
export function graphProblems(d: Pick<WorkflowData, 'nodes' | 'edges'>): string[] {
  const out: string[] = [];
  const triggers = d.nodes.filter((n) => n.kind === 'trigger');
  if (triggers.length !== 1) out.push('A workflow needs exactly one trigger');
  const ids = new Set(d.nodes.map((n) => n.id));
  if (d.edges.some((e) => !ids.has(e.from) || !ids.has(e.to))) out.push('A connection points at a block that no longer exists');
  const targets = new Set(d.edges.map((e) => e.to));
  for (const n of d.nodes) {
    if (unsupported[n.type]) out.push(unsupported[n.type]);
    else if (!supportedBlocks[n.kind]?.includes(n.type)) out.push(`“${n.type}” is not a block the runner knows`);
    if (n.kind !== 'trigger' && !targets.has(n.id)) out.push(`A ${n.kind} block is not connected`);
    if (n.kind === 'condition') {
      const hs = d.edges.filter((e) => e.from === n.id).map((e) => e.branch);
      if (!hs.includes('yes') || !hs.includes('no')) out.push('Every condition needs both a yes and a no path');
    }
    if (n.type === 'bonus' && !(num(n.config.points) >= 1 && num(n.config.points) <= 500)) out.push('Bonus points must be between 1 and 500');
    if (n.type === 'wait' && !(num(n.config.hours) >= 1 && num(n.config.hours) <= 24 * 90)) out.push('A wait is between 1 hour and 90 days');
    if (n.type === 'window' && !(num(n.config.from, -1) >= 0 && num(n.config.from, -1) <= 23)) out.push('The send window starts between 0 and 23');
    if (n.type === 'email' && !templates[String(n.config.template)]) out.push('Pick an e-mail template');
    if (n.type === 'push' && !String(n.config.text ?? '').trim()) out.push('Write the in-app message');
    if (n.type === 'tag' && !/^[\w -]{2,40}$/.test(String(n.config.tag ?? ''))) out.push('A tag is 2 to 40 letters, digits, spaces or dashes');
    if (n.type === 'inactive' && !(num(n.config.days) >= 1)) out.push('Inactive for at least 1 day');
    if (n.type === 'profile_gap' && !(num(n.config.pct) > 0 && num(n.config.pct) <= 100)) out.push('Profile threshold between 1 and 100%');
    if (n.type === 'points' && !(num(n.config.points) >= 1)) out.push('Points balance of at least 1');
  }
  // Loops would run forever between delays.
  const seen = new Set<string>(), stack = new Set<string>();
  const loop = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id); stack.add(id);
    const r = d.edges.filter((e) => e.from === id).some((e) => loop(e.to));
    stack.delete(id);
    return r;
  };
  if (triggers[0] && loop(triggers[0].id)) out.push('The workflow loops back on itself');
  if (!d.nodes.some((n) => n.kind === 'action')) out.push('Add at least one action');
  return [...new Set(out)];
}

/** Does the member take the yes path? */
export function conditionHolds(n: WfNode, p: Pick<Panelist, 'segment' | 'ageBand' | 'qualityScore' | 'country'>) {
  if (n.type === 'country') return n.config.country === 'Any EU' ? EU.includes(p.country) : p.country === n.config.country;
  const s = String(n.config.segment);
  if (s === 'Healthcare professionals') return p.segment === 'hcp';
  if (s === 'B2B decision makers') return p.segment === 'professional';
  if (s === 'Gen Z') return p.ageBand === '18-24';
  if (s === 'High quality score') return p.qualityScore >= 0.85;
  return false;
}

/** When a delay ends, from `now`. */
export function delayUntil(n: WfNode, country: string, now: Date) {
  if (n.type === 'wait') return new Date(now.getTime() + num(n.config.hours, 24) * hour);
  const from = num(n.config.from, 9), off = utcOffset[country] ?? 0;
  const local = new Date(now.getTime() + off * hour);
  const t = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), from) - off * hour);
  return t.getTime() >= now.getTime() ? t : new Date(t.getTime() + day);
}

const fill = (t: string, p: Pick<Panelist, 'brand' | 'points' | 'profileCompletion'>) => t.replaceAll('{{panel}}', brandName[p.brand] ?? p.brand).replaceAll('{{points}}', p.points.toLocaleString('en-US')).replaceAll('{{profile}}', String(Math.round(p.profileCompletion * 100)));
type Step = { node: string; at: string; note?: string };

@Injectable()
export class WorkflowEngine {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private actor(w: SupplyRecord): Ctx {
    return { userId: `workflow:${w.id}`, sessionId: 'workflow', tenantId: w.tenantId, role: 'platform_admin', name: `Automation: ${(w.data as WorkflowData).name}`, email: '', vendorId: null, clientId: null };
  }

  /** Members the trigger enrols now, not yet enrolled. */
  async candidates(tx: Tx, w: SupplyRecord, now: Date) {
    const d = w.data as WorkflowData;
    const t = d.nodes.find((n) => n.kind === 'trigger')!;
    const since = new Date(d.activatedAt ?? now.toISOString());
    const base: Prisma.PanelistWhereInput = { tenantId: w.tenantId, status: { in: ['active', 'dormant'] }, ...(d.panel !== 'all' ? { brand: brandOf[d.panel] } : {}) };
    const panelFilter = t.type === 'signup' && t.config.panel && t.config.panel !== 'Any' ? { brand: Object.keys(brandName).find((k) => brandName[k] === t.config.panel) } : {};
    let where: Prisma.PanelistWhereInput;
    if (t.type === 'signup') where = { ...base, ...panelFilter, joinedAt: { gte: since } };
    else if (t.type === 'inactive') {
      const days = num(t.config.days, 30) * day;
      where = { ...base, lastActiveAt: { lt: new Date(now.getTime() - days), gte: new Date(since.getTime() - days) } };
    } else if (t.type === 'profile_gap') where = { ...base, joinedAt: { gte: since }, profileCompletion: { lt: num(t.config.pct, 60) / 100 } };
    else {
      const earned = await tx.incentiveEntry.findMany({ where: { tenantId: w.tenantId, kind: 'earn', status: 'posted', createdAt: { gte: since } }, select: { panelistId: true }, distinct: ['panelistId'], take: 5000 });
      where = { ...base, id: { in: earned.map((e) => e.panelistId) }, points: { gte: num(t.config.points, 1000) } };
    }
    const taken = new Set((await tx.workflowRun.findMany({ where: { workflowId: w.id }, select: { panelistId: true } })).map((r) => r.panelistId));
    return (await tx.panelist.findMany({ where, select: { id: true }, take: ENROL_PER_TICK + taken.size, orderBy: { joinedAt: 'asc' } })).filter((p) => !taken.has(p.id)).slice(0, ENROL_PER_TICK);
  }

  async enrol(w: SupplyRecord, now = new Date()) {
    const d = w.data as WorkflowData;
    const t = d.nodes.find((n) => n.kind === 'trigger');
    if (!t) return 0;
    return this.db.$transaction(async (tx) => {
      const ps = await this.candidates(tx, w, now);
      if (!ps.length) return 0;
      const r = await tx.workflowRun.createMany({ data: ps.map((p) => ({ tenantId: w.tenantId, workflowId: w.id, panelistId: p.id, nodeId: t.id, status: 'running', wakeAt: now, path: [] })), skipDuplicates: true });
      return r.count;
    });
  }

  /** Moves one run forward until a delay, the end, or a failure. */
  async advance(w: SupplyRecord, runId: string, now = new Date()) {
    const d = w.data as WorkflowData;
    const ctx = this.actor(w);
    return this.db.$transaction(async (tx) => {
      const run = await tx.workflowRun.findUnique({ where: { id: runId } });
      if (!run || (run.status !== 'running' && run.status !== 'waiting') || (run.wakeAt && run.wakeAt > now)) return;
      const p = await tx.panelist.findFirst({ where: { id: run.panelistId, tenantId: w.tenantId } });
      const path = (run.path as Step[]) ?? [];
      const at = now.toISOString();
      const end = (status: string, note: string | null) => tx.workflowRun.update({ where: { id: run.id }, data: { status, note, nodeId: null, wakeAt: null, path: path as Prisma.InputJsonValue, steps: path.length } });
      if (!p || p.status === 'suspended' || p.status === 'deletion_requested') return void (await end('stopped', p ? `Member is ${p.status.replace('_', ' ')}` : 'Member no longer exists'));
      let nodeId: string | null = run.nodeId;
      for (let i = 0; i < 25 && nodeId; i++) {
        const n = d.nodes.find((x) => x.id === nodeId);
        if (!n) return void (await end('failed', 'Its next step was removed from the workflow'));
        const out = d.edges.filter((e) => e.from === n.id);
        let next: string | null = out[0]?.to ?? null;
        let note: string | undefined;
        if (n.kind === 'condition') {
          const yes = conditionHolds(n, p);
          next = out.find((e) => e.branch === (yes ? 'yes' : 'no'))?.to ?? null;
          note = yes ? 'yes' : 'no';
        } else if (n.kind === 'delay') {
          const wake = delayUntil(n, p.country, now);
          path.push({ node: n.id, at, note: `until ${wake.toISOString()}` });
          if (!next) return void (await end('completed', null));
          await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'waiting', nodeId: next, wakeAt: wake, path: path as Prisma.InputJsonValue, steps: path.length, note: null } });
          return;
        } else if (n.kind === 'action') {
          if (n.type === 'email' || n.type === 'push') {
            const sent = await tx.message.count({ where: { tenantId: w.tenantId, relatedType: 'Workflow', relatedId: w.id, createdAt: { gte: new Date(now.getTime() - day) } } });
            if (sent >= dailyCap()) {
              await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'waiting', nodeId: n.id, wakeAt: new Date(now.getTime() + hour), path: path as Prisma.InputJsonValue, note: `Daily cap of ${dailyCap()} messages reached; trying again in an hour` } });
              return;
            }
            const consentOff = n.type === 'email' && (await tx.consent.findFirst({ where: { panelistId: p.id, purpose: 'marketing_email', granted: false } }));
            if (consentOff) note = 'skipped: no e-mail consent';
            else {
              const tpl = n.type === 'email' ? templates[String(n.config.template)] : { subject: 'Message from your panel', body: String(n.config.text) };
              const q = await queueMessage(tx, ctx, { channel: n.type === 'email' ? 'email' : 'in_app', audience: 'panel', target: `panelist:${p.id}`, subject: fill(tpl.subject, p), body: fill(tpl.body, p) }, { recipients: 1, label: `${p.handle} (workflow)` }, { relatedType: 'Workflow', relatedId: w.id });
              await this.audit.log(ctx, 'message.create', 'Message', q.message.id, undefined, { to: `panelist:${p.id}`, recipients: 1, workflow: w.ref }, tx);
              note = n.type === 'email' ? `e-mail “${n.config.template}” queued` : 'in-app message logged';
            }
          } else if (n.type === 'bonus') {
            const points = Math.min(500, Math.max(1, Math.round(num(n.config.points, 50))));
            const t = await tx.tenant.findUniqueOrThrow({ where: { id: w.tenantId }, select: { pointValue: true } });
            const e = await tx.incentiveEntry.create({ data: { tenantId: w.tenantId, panelistId: p.id, kind: 'adjust', points, valueBase: Math.round(points * t.pointValue * 100) / 100, note: `Automation bonus, workflow ${w.ref}`, createdBy: ctx.name } });
            await tx.panelist.update({ where: { id: p.id }, data: { points: { increment: points } } });
            await this.audit.log(ctx, 'incentive.adjust', 'IncentiveEntry', e.id, { points: p.points }, { panelist: p.handle, points: p.points + points, delta: points, workflow: w.ref }, tx);
            note = `+${points} points`;
          } else if (n.type === 'tag') {
            const tag = String(n.config.tag).trim().toLowerCase();
            await tx.panelistAttribute.upsert({ where: { panelistId_key: { panelistId: p.id, key: `tag:${tag}` } }, create: { tenantId: w.tenantId, panelistId: p.id, key: `tag:${tag}`, valueBool: true, source: 'automation' }, update: { valueBool: true, source: 'automation' } });
            note = `tagged “${tag}”`;
          }
        }
        path.push({ node: n.id, at, ...(note ? { note } : {}) });
        nodeId = next;
      }
      if (nodeId) await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'running', nodeId, wakeAt: now, path: path as Prisma.InputJsonValue, steps: path.length } });
      else await end('completed', null);
    });
  }

  /** One pass over every active workflow: enrol, then advance due runs. Returns the steps taken. */
  async runDue(now = new Date()) {
    const active = await this.db.supplyRecord.findMany({ where: { kind: 'workflow', status: 'active' }, take: 200 });
    let moved = 0;
    for (const w of active) {
      await asTenant(w.tenantId, async () => {
        await this.enrol(w, now);
        const due = await this.db.workflowRun.findMany({ where: { workflowId: w.id, status: { in: ['running', 'waiting'] }, wakeAt: { lte: now } }, select: { id: true }, take: 500, orderBy: { wakeAt: 'asc' } });
        for (const r of due) {
          try { await this.advance(w, r.id, now); moved++; } catch (e) {
            await this.db.workflowRun.update({ where: { id: r.id }, data: { status: 'failed', note: e instanceof Error ? e.message.slice(0, 300) : 'failed' } });
          }
        }
      });
    }
    return moved;
  }

  /** A dry run for one member: the path it would take today, with nothing sent or changed. */
  async test(ctx: Ctx, w: SupplyRecord, panelistId?: string) {
    const d = w.data as WorkflowData;
    const p = panelistId
      ? await this.db.panelist.findFirst({ where: { id: panelistId, tenantId: ctx.tenantId } })
      : await this.db.panelist.findFirst({ where: { tenantId: ctx.tenantId, status: 'active', ...(d.panel !== 'all' ? { brand: brandOf[d.panel] } : {}) }, orderBy: { lastActiveAt: 'desc' } });
    if (!p) throw new NotFoundException('No member to test with');
    const consentOff = !!(await this.db.consent.findFirst({ where: { panelistId: p.id, purpose: 'marketing_email', granted: false } }));
    const path: { node: string; note: string }[] = [];
    let id: string | null = d.nodes.find((n) => n.kind === 'trigger')?.id ?? null;
    for (let i = 0; i < 25 && id; i++) {
      const n = d.nodes.find((x) => x.id === id);
      if (!n) break;
      const out = d.edges.filter((e) => e.from === n.id);
      let next: string | null = out[0]?.to ?? null, note = '';
      if (n.kind === 'condition') { const yes = conditionHolds(n, p); next = out.find((e) => e.branch === (yes ? 'yes' : 'no'))?.to ?? null; note = yes ? 'yes' : 'no'; }
      else if (n.kind === 'delay') note = n.type === 'wait' ? `waits ${num(n.config.hours)} h` : `waits for ${num(n.config.from)}:00 in ${p.country}`;
      else if (n.kind === 'action') note = n.type === 'email' ? (consentOff ? 'would skip: no e-mail consent' : `would e-mail “${n.config.template}”`) : n.type === 'bonus' ? `would add ${num(n.config.points)} points` : n.type === 'tag' ? `would tag “${n.config.tag}”` : 'would log an in-app message';
      else note = 'trigger';
      path.push({ node: n.id, note });
      id = next;
    }
    return { member: { id: p.id, handle: p.handle, brand: p.brand, country: p.country, segment: p.segment }, path };
  }
}

@ForModule('automation')
@Controller('supply/workflows')
export class WorkflowsController {
  constructor(private db: PrismaService, private engine: WorkflowEngine) {}

  private async wf(ctx: Ctx, id: string) {
    const w = await this.db.supplyRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: 'workflow', id } });
    if (!w) throw new NotFoundException('Workflow not found');
    return w;
  }

  /** Recent runs (newest first) with each member's handle, and counts for the last 7 days. */
  @Get(':id/runs')
  async runs(@Caller() ctx: Ctx, @Param('id') id: string) {
    const w = await this.wf(ctx, id);
    const since = new Date(Date.now() - 7 * day);
    const [rows, groups] = await Promise.all([
      this.db.workflowRun.findMany({ where: { tenantId: ctx.tenantId, workflowId: w.id }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.db.workflowRun.groupBy({ by: ['status'], where: { tenantId: ctx.tenantId, workflowId: w.id, startedAt: { gte: since } }, _count: true }),
    ]);
    const who = new Map((await this.db.panelist.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.panelistId) } }, select: { id: true, handle: true } })).map((p) => [p.id, p.handle]));
    const by = Object.fromEntries(groups.map((g) => [g.status, g._count]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    return {
      stats: { runs7d: total, completed7d: by.completed ?? 0, waiting: by.waiting ?? 0, failed: by.failed ?? 0 },
      runs: rows.map((r) => ({ id: r.id, member: who.get(r.panelistId) ?? '—', status: r.status, nodeId: r.nodeId, wakeAt: r.wakeAt, path: r.path, note: r.note, startedAt: r.startedAt, updatedAt: r.updatedAt })),
    };
  }

  /** Dry run for one member (a recent active member when none is given). Sends nothing. */
  @Post(':id/test')
  @HttpCode(200)
  async test(@Caller() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { panelistId } = parse(z.object({ panelistId: z.string().max(40).optional() }).strict(), body ?? {});
    const w = await this.wf(ctx, id);
    if (!(w.data as WorkflowData).nodes.some((n) => n.kind === 'trigger')) throw new BadRequestException('Add a trigger first');
    return this.engine.test(ctx, w, panelistId);
  }
}
