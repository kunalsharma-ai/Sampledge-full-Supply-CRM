import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { access, can, type ModuleId, type Permission } from '@sampledge/core';
import type { Request } from 'express';
import { config } from '../common/config';
import { MODULE, PERMS, PUBLIC, WRITE, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { tenantScope } from '../common/tenant-scope';

/**
 * Global guard, in order:
 * 1. session: signed JWT (httpOnly cookie, or Bearer for API clients) whose Session row is live;
 * 2. module access: the role's row in core moduleAccess must not be 'none' (writes need 'full', or 'scoped' where allowed);
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
    if (mod) {
      const a = access(ctx.role, mod);
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
    return { userId: s.userId, sessionId: s.id, tenantId: s.tenantId, role: m.role, name: s.user.name, email: s.user.email, vendorId: m.vendorId, clientId: m.clientId };
  }
}
