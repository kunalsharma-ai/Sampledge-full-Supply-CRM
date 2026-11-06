/**
 * Read-only API keys for systems outside SUPPLY360 (a BI warehouse, a partner dashboard).
 *
 * A key is `sk_live_` plus 32 random bytes. Only its SHA-256 hash is stored, and the secret is shown
 * once, when it is made. A call with `Authorization: Bearer sk_live_…` acts as the person who made
 * the key, as they are now (it stops working if they leave), limited to:
 * - GET requests (keys are read-only);
 * - routes that belong to one of the key's modules, at most read access, and never more than the
 *   maker has today.
 * Keys expire (at most a year) and can be revoked at once; both are audited.
 */
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import type { Access, ModuleId, Role } from '@sampledge/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, moduleLevel, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';
import { activeOverrides, effectiveAccess, modules } from './access';

export const KEY_PREFIX = 'sk_live_';
/** Modules a key may be scoped to: everything but admin and the design system. */
export const keyScopes = modules.filter((m) => m !== 'admin' && m !== 'design-system');
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** The caller for a key, or null when the key is unknown, revoked, expired or its maker left. */
export async function resolveApiKey(db: PrismaService, secret: string): Promise<Ctx | null> {
  if (!secret.startsWith(KEY_PREFIX) || secret.length > 100) return null;
  const k = await db.apiKey.findUnique({ where: { hash: hash(secret) } });
  if (!k || k.revokedAt || k.expiresAt <= new Date()) return null;
  const m = await db.membership.findFirst({ where: { tenantId: k.tenantId, userId: k.createdById }, include: { user: { select: { name: true, email: true } } } });
  if (!m || m.role === 'vendor' || m.role === 'client') return null;
  const role = m.role as Role;
  const own = effectiveAccess(await activeOverrides(db, k.tenantId), role, m.userId);
  const scoped: Partial<Record<ModuleId, Access>> = {};
  for (const mod of modules) {
    const lvl = moduleLevel({ role, access: own }, mod);
    scoped[mod] = k.scopes.includes(mod) && (lvl === 'full' || lvl === 'read') ? 'read' : 'none';
  }
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await db.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { userId: m.userId, sessionId: `apikey:${k.id}`, tenantId: k.tenantId, role, name: `${m.user.name} (API key ${k.name})`, email: m.user.email, vendorId: null, clientId: null, access: scoped, apiKeyId: k.id };
}

const FIELDS = { id: true, name: true, prefix: true, scopes: true, createdBy: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true } as const;

@ForModule('integrations')
@Controller('integrations/keys')
export class ApiKeysController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  @Get()
  async list(@Caller() ctx: Ctx) {
    return { scopes: keyScopes, keys: await this.db.apiKey.findMany({ where: { tenantId: ctx.tenantId }, select: FIELDS, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  /** Makes a key; the response is the only time the secret is returned. */
  @Post() @Write() @HttpCode(201)
  async create(@Caller() ctx: Ctx, @Body() body: unknown) {
    if (ctx.apiKeyId) throw new BadRequestException('An API key cannot make keys');
    const b = parse(z.object({
      name: z.string().trim().min(3, 'At least 3 characters').max(80),
      scopes: z.array(z.enum(keyScopes as [ModuleId, ...ModuleId[]])).min(1, 'Choose at least one module').max(keyScopes.length),
      days: z.number().int().min(1).max(366, 'At most one year'),
    }).strict(), body);
    const unreadable = b.scopes.filter((m) => !['full', 'read'].includes(moduleLevel(ctx, m)));
    if (unreadable.length) throw new BadRequestException(`You cannot read ${unreadable.join(', ')}, so a key of yours cannot either`);
    const secret = KEY_PREFIX + randomBytes(32).toString('base64url');
    return this.db.$transaction(async (tx) => {
      const k = await tx.apiKey.create({ data: { tenantId: ctx.tenantId, name: b.name, prefix: secret.slice(0, 12), hash: hash(secret), scopes: [...new Set(b.scopes)], createdBy: ctx.name, createdById: ctx.userId, expiresAt: new Date(Date.now() + b.days * 86400_000) }, select: FIELDS });
      await this.audit.log(ctx, 'api_key.created', 'ApiKey', k.id, undefined, { name: k.name, prefix: k.prefix, scopes: k.scopes, expiresAt: k.expiresAt }, tx);
      return { ...k, secret };
    });
  }

  @Post(':id/revoke') @Write() @HttpCode(200)
  async revoke(@Caller() ctx: Ctx, @Param('id') id: string) {
    const k = await this.db.apiKey.findFirst({ where: { id, tenantId: ctx.tenantId, revokedAt: null } });
    if (!k) throw new NotFoundException('Key not found or already revoked');
    return this.db.$transaction(async (tx) => {
      const u = await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: FIELDS });
      await this.audit.log(ctx, 'api_key.revoked', 'ApiKey', id, { revokedAt: null }, { name: k.name, prefix: k.prefix }, tx);
      return u;
    });
  }
}
