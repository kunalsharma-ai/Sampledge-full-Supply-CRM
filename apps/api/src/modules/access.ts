/**
 * Workspace access overrides on top of the role matrix in @sampledge/core (roles.ts).
 *
 * Two kinds, both audited and revocable:
 * - a role limit: a role gets *less* access to a module in this workspace (read or none). It can
 *   never raise a role, and platform admins always keep full admin access, so nobody is locked out;
 * - a person grant: one member gets read access to a module they lack, with a reason, for at most
 *   30 days. Grants never give write access and never cover admin.
 * The guard applies them to every request (moduleLevel in common/context.ts) from a per-tenant cache
 * that is refreshed every 30 seconds and at once on this instance after a change.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { access, moduleAccess, roles, type Access, type ModuleId, type Role } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const rank: Record<Access, number> = { none: 0, scoped: 1, read: 2, full: 3 };
export const modules = Object.keys(moduleAccess) as ModuleId[];
type Row = { role: string | null; userId: string | null; module: string; level: string; expiresAt: Date | null };
const cache = new Map<string, { at: number; rows: Row[] }>();
const TTL = 30_000;

export function invalidateOverrides(tenantId: string) { cache.delete(tenantId); }

/** Active overrides for a workspace (cached). Reads without tenant scope: called by the guard before it is set. */
export async function activeOverrides(db: PrismaService, tenantId: string): Promise<Row[]> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const now = new Date();
  const rows = await db.accessOverride.findMany({ where: { tenantId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { role: true, userId: true, module: true, level: true, expiresAt: true } });
  cache.set(tenantId, { at: Date.now(), rows });
  return rows;
}

/** The modules where this person's level differs from their role's default. */
export function effectiveAccess(rows: Row[], role: Role, userId: string, now = new Date()) {
  const out: Partial<Record<ModuleId, Access>> = {};
  for (const m of modules) {
    let level = access(role, m);
    for (const r of rows) if (r.role === role && !r.userId && r.module === m && rank[r.level as Access] < rank[level]) level = r.level as Access;
    for (const r of rows) if (r.userId === userId && r.module === m && (!r.expiresAt || r.expiresAt > now) && rank[r.level as Access] > rank[level]) level = r.level as Access;
    if (level !== access(role, m)) out[m] = level;
  }
  return out;
}

const RoleLimit = z.object({
  role: z.enum(roles.map((r) => r.id) as [Role, ...Role[]]),
  module: z.enum(modules as [ModuleId, ...ModuleId[]]),
  level: z.enum(['read', 'none']),
  reason: z.string().trim().min(5, 'Say why, in a few words').max(300),
}).strict();
const Grant = z.object({
  userId: z.string().min(1).max(40),
  module: z.enum(modules as [ModuleId, ...ModuleId[]]),
  reason: z.string().trim().min(5, 'Say why, in a few words').max(300),
  days: z.number().int().min(1).max(30, 'A grant lasts at most 30 days'),
}).strict();

@ForModule('admin')
@Controller('admin/access')
export class AccessController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** The role matrix as enforced here: core defaults, this workspace's levels, and the active overrides. */
  @Get()
  async matrix(@Caller() ctx: Ctx) {
    const rows = await this.db.accessOverride.findMany({ where: { tenantId: ctx.tenantId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } });
    const people = new Map((await this.db.user.findMany({ where: { id: { in: rows.flatMap((r) => (r.userId ? [r.userId] : [])) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const counts = await this.db.membership.groupBy({ by: ['role'], where: { tenantId: ctx.tenantId }, _count: true });
    return {
      modules,
      roles: roles.map((r) => ({ id: r.id, label: r.label, people: counts.find((c) => c.role === r.id)?._count ?? 0 })),
      defaults: Object.fromEntries(roles.map((r) => [r.id, Object.fromEntries(modules.map((m) => [m, access(r.id, m)]))])),
      effective: Object.fromEntries(roles.map((r) => [r.id, Object.fromEntries(modules.map((m) => [m, effectiveAccess(rows.filter((x) => !x.userId), r.id, '')[m] ?? access(r.id, m)]))])),
      overrides: rows.map((r) => ({ id: r.id, kind: r.userId ? 'grant' : 'limit', role: r.role, userId: r.userId, person: r.userId ? people.get(r.userId) ?? '—' : null, module: r.module, level: r.level, reason: r.reason, expiresAt: r.expiresAt, createdBy: r.createdBy, createdAt: r.createdAt })),
    };
  }

  /** Gives a role less access to a module in this workspace. */
  @Post('limits') @Write() @HttpCode(201)
  async limit(@Caller() ctx: Ctx, @Body() body: unknown) {
    const b = parse(RoleLimit, body);
    const def = access(b.role, b.module);
    if (b.role === 'platform_admin' && b.module === 'admin') throw new BadRequestException('Platform admins always keep admin access, so nobody is locked out');
    if (rank[b.level] >= rank[def]) throw new BadRequestException(`${b.role.replace('_', ' ')} already has ${def} access to ${b.module}; a limit can only lower it`);
    return this.db.$transaction(async (tx) => {
      await tx.accessOverride.updateMany({ where: { tenantId: ctx.tenantId, role: b.role, userId: null, module: b.module, revokedAt: null }, data: { revokedAt: new Date() } });
      const o = await tx.accessOverride.create({ data: { tenantId: ctx.tenantId, role: b.role, module: b.module, level: b.level, reason: b.reason, createdBy: ctx.name, createdById: ctx.userId } });
      await this.audit.log(ctx, 'access.limit', 'AccessOverride', o.id, { level: def }, { role: b.role, module: b.module, level: b.level, reason: b.reason }, tx);
      invalidateOverrides(ctx.tenantId);
      return o;
    });
  }

  /** Gives one member read access to a module for a few days. */
  @Post('grants') @Write() @HttpCode(201)
  async grant(@Caller() ctx: Ctx, @Body() body: unknown) {
    const b = parse(Grant, body);
    if (b.module === 'admin') throw new BadRequestException('Admin access cannot be granted to a person; change their role instead');
    const m = await this.db.membership.findFirst({ where: { tenantId: ctx.tenantId, userId: b.userId }, include: { user: { select: { name: true } } } });
    if (!m) throw new NotFoundException('Not a member of this workspace');
    if (m.role === 'vendor' || m.role === 'client') throw new BadRequestException('Vendors and clients only see their own records; grants are for the team');
    const rows = await activeOverrides(this.db, ctx.tenantId);
    const now = effectiveAccess(rows, m.role as Role, m.userId)[b.module] ?? access(m.role as Role, b.module);
    if (rank[now] >= rank.read) throw new BadRequestException(`${m.user.name} can already read ${b.module}`);
    const expiresAt = new Date(Date.now() + b.days * 86400_000);
    return this.db.$transaction(async (tx) => {
      const o = await tx.accessOverride.create({ data: { tenantId: ctx.tenantId, userId: m.userId, module: b.module, level: 'read', reason: b.reason, expiresAt, createdBy: ctx.name, createdById: ctx.userId } });
      await this.audit.log(ctx, 'access.grant', 'AccessOverride', o.id, { level: now }, { person: m.user.name, module: b.module, level: 'read', reason: b.reason, expiresAt }, tx);
      invalidateOverrides(ctx.tenantId);
      return o;
    });
  }

  @Post(':id/revoke') @Write() @HttpCode(200)
  async revoke(@Caller() ctx: Ctx, @Param('id') id: string) {
    const o = await this.db.accessOverride.findFirst({ where: { id, tenantId: ctx.tenantId, revokedAt: null } });
    if (!o) throw new NotFoundException('Override not found or already ended');
    return this.db.$transaction(async (tx) => {
      const u = await tx.accessOverride.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.log(ctx, 'access.revoke', 'AccessOverride', id, { module: o.module, level: o.level, role: o.role, userId: o.userId }, { revoked: true }, tx);
      invalidateOverrides(ctx.tenantId);
      return u;
    });
  }
}
