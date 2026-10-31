import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { permissionsFor, moduleAccess, type ModuleId } from '@sampledge/core';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import type { Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';

/** Compared against when the email is unknown, so response time does not reveal which emails exist. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  /** Step 1. Returns a session token, or an MFA challenge when the user has MFA on. */
  async login(email: string, password: string, tenantSlug?: string) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() }, include: { memberships: { include: { tenant: true } } } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect');
    const m = tenantSlug ? user.memberships.find((x) => x.tenant.slug === tenantSlug) : user.memberships[0];
    if (!m) throw new UnauthorizedException('No access to that workspace');
    if (user.mfaEnabled) {
      const challenge = await this.jwt.signAsync({ uid: user.id, tid: m.tenantId, typ: 'mfa' }, { expiresIn: '5m' });
      return { mfaRequired: true as const, challenge };
    }
    return this.issue(user.id, m.tenantId);
  }

  /** Step 2 (MFA users only). */
  async verifyMfa(challenge: string, code: string) {
    let p: { uid: string; tid: string; typ: string };
    try {
      p = await this.jwt.verifyAsync(challenge);
    } catch {
      throw new UnauthorizedException('Challenge expired; sign in again');
    }
    if (p.typ !== 'mfa') throw new UnauthorizedException();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: p.uid } });
    if (!user.mfaSecret || !authenticator.check(code, user.mfaSecret)) throw new UnauthorizedException('Code is incorrect');
    return this.issue(user.id, p.tid);
  }

  private async issue(userId: string, tenantId: string) {
    const expiresAt = new Date(Date.now() + config.sessionHours * 3600_000);
    const s = await this.db.session.create({ data: { userId, tenantId, expiresAt } });
    const token = await this.jwt.signAsync({ sid: s.id, typ: 'session' }, { expiresIn: `${config.sessionHours}h` });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    await this.audit.log({ tenantId, userId, name: user.name }, 'auth.login', 'User', userId);
    return { mfaRequired: false as const, token, expiresAt };
  }

  async logout(ctx: Ctx) {
    await this.db.session.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date() } });
    await this.audit.log(ctx, 'auth.logout', 'User', ctx.userId);
  }

  async me(ctx: Ctx) {
    const [tenant, user] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
    ]);
    const modules = Object.fromEntries((Object.keys(moduleAccess) as ModuleId[]).map((m) => [m, moduleAccess[m][ctx.role]]));
    return {
      user: { id: user.id, name: user.name, email: user.email, mfaEnabled: user.mfaEnabled },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      role: ctx.role,
      vendorId: ctx.vendorId,
      clientId: ctx.clientId,
      permissions: permissionsFor(ctx.role),
      modules,
    };
  }

  /** Begins TOTP enrolment. MFA turns on only after a valid code is confirmed. */
  async enrollMfa(ctx: Ctx) {
    const secret = authenticator.generateSecret();
    await this.db.user.update({ where: { id: ctx.userId }, data: { mfaSecret: secret, mfaEnabled: false } });
    return { secret, otpauthUrl: authenticator.keyuri(ctx.email, 'Sampledge Research OS', secret) };
  }

  async activateMfa(ctx: Ctx, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!user.mfaSecret) throw new BadRequestException('Start enrolment first');
    if (!authenticator.check(code, user.mfaSecret)) throw new BadRequestException('Code is incorrect');
    await this.db.user.update({ where: { id: ctx.userId }, data: { mfaEnabled: true } });
    await this.audit.log(ctx, 'auth.mfa_enabled', 'User', ctx.userId);
    return { mfaEnabled: true };
  }
}
