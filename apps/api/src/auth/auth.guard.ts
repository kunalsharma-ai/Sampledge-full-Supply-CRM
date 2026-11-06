import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, type ModuleId, type Permission, type Role } from '@sampledge/core';
import type { Request } from 'express';
import { config } from '../common/config';
import { MODULE, moduleLevel, PERMS, PUBLIC, WRITE, type Ctx } from '../common/context';
import { activeOverrides, effectiveAccess } from '../modules/access';
import { KEY_PREFIX, resolveApiKey } from '../modules/api-keys';
import { PrismaService } from '../common/prisma.service';
import { tenantScope } from '../common/tenant-scope';

/**
 * Global guard, in order:
 * 1. caller: signed JWT (httpOnly cookie, or Bearer) whose Session row is live, or a read-only API key
 *    (Bearer sk_live_…, see modules/api-keys.ts), which may only GET routes of its modules;
 * 2. module access: the role's row in core moduleAccess, after this workspace's overrides
 *    (modules/access.ts), must not be 'none' (writes need 'full', or 'scoped' where allowed);
 * 3. permissions: every @RequirePerm key.
 * Ownership checks for scoped roles (vendor, client) happen in the services, against Membership.vendorId/clientId.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private db: PrismaService) {}

  async canActivate(ec: ExecutionContext) {
    const targets = [ec.getHandler(), ec.getClass()];
    const req = ec.switchToHttp().getRequest<Request & { ctx?: Ctx }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, targets);
    const ctx = await this.resolve(req);
    if (ctx) req.ctx = ctx;
    if (isPublic) return true;
    if (!ctx) throw new UnauthorizedException('Sign in required');
    // From here on the database enforces the caller's tenant as well (row-level security).
    const scope = tenantScope.getStore();
    if (scope) scope.tenantId = ctx.tenantId;

    const mod = this.reflector.getAllAndOverride<ModuleId | undefined>(MODULE, targets);
    if (ctx.apiKeyId) {
      if (req.method !== 'GET') throw new ForbiddenException('API keys are read-only');
      if (!mod) throw new ForbiddenException('This route is not available to API keys');
    }
    if (mod) {
      const a = moduleLevel(ctx, mod);
      if (a === 'none') throw new ForbiddenException(`Your role has no access to ${mod}`);
      const write = this.reflector.getAllAndOverride<{ allowScoped?: boolean } | undefined>(WRITE, targets);
      if (write && a === 'read') throw new ForbiddenException(`Your role has read-only access to ${mod}`);
      if (write && a === 'scoped' && !write.allowScoped) throw new ForbiddenException(`Your role cannot change ${mod} records`);
    }
    const perms = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMS, targets) ?? [];
    const missing = perms.filter((p) => !can(ctx.role, p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }

  private async resolve(req: Request): Promise<Ctx | null> {
    const header = req.headers.authorization;
    const token = (req.cookies?.[config.cookieName] as string | undefined) ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) return null;
    if (token.startsWith(KEY_PREFIX)) return header?.startsWith('Bearer ') ? resolveApiKey(this.db, token) : null;
    let payload: { sid: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    if (payload.typ !== 'session') return null;
    const s = await this.db.session.findUnique({ where: { id: payload.sid }, include: { user: { include: { memberships: true } } } });
    if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
    const m = s.user.memberships.find((x) => x.tenantId === s.tenantId);
    if (!m) return null;
    const overrides = effectiveAccess(await activeOverrides(this.db, s.tenantId), m.role as Role, s.userId);
    return { userId: s.userId, sessionId: s.id, tenantId: s.tenantId, role: m.role, name: s.user.name, email: s.user.email, vendorId: m.vendorId, clientId: m.clientId, ...(Object.keys(overrides).length ? { access: overrides } : {}) };
  }
}
