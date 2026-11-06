import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { permissionsFor, moduleAccess, type ModuleId } from '@sampledge/core';
import bcrypt from 'bcryptjs';
import { authenticator as otp } from 'otplib';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import type { Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { enterTenant } from '../common/tenant-scope';

/** Compared against when the email is unknown, so response time does not reveal which emails exist. */
/**
 * TOTP check that also accepts the code from the previous or next 30-second step (RFC 6238 §5.2),
 * so a code typed or sent just as the step rolls over, or with slight clock drift, is not refused.
 */
const authenticator = otp.clone({ window: 1 });

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

  /** A session for a user already authenticated elsewhere (SSO). */
  issueFor(userId: string, tenantId: string, method: 'sso' | 'saml') {
    return this.issue(userId, tenantId, method);
  }

  private async issue(userId: string, tenantId: string, method: 'password' | 'sso' | 'saml' = 'password') {
    // The workspace is known from here on: the session and audit rows are written under its scope.
    enterTenant(tenantId);
    const expiresAt = new Date(Date.now() + config.sessionHours * 3600_000);
    const s = await this.db.session.create({ data: { userId, tenantId, expiresAt } });
    const token = await this.jwt.signAsync({ sid: s.id, typ: 'session' }, { expiresIn: `${config.sessionHours}h` });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    await this.audit.log({ tenantId, userId, name: user.name }, 'auth.login', 'User', userId, undefined, { method });
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
    const modules = Object.fromEntries((Object.keys(moduleAccess) as ModuleId[]).map((m) => [m, ctx.access?.[m] ?? moduleAccess[m][ctx.role]]));
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
  /** Starts (or restarts) enrolment. When two-step sign-in is already on, a current code is required,
   * so a stolen session alone cannot turn it off or move it to another device. */
  async enrollMfa(ctx: Ctx, currentCode?: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (user.mfaEnabled && (!currentCode || !user.mfaSecret || !authenticator.check(currentCode, user.mfaSecret))) {
      throw new ForbiddenException('Two-step sign-in is already on: enter a current code from your authenticator app to set up a new device');
    }
    const secret = authenticator.generateSecret();
    // A replacement stays pending until activated; the current device keeps working until then.
    await this.db.user.update({ where: { id: ctx.userId }, data: user.mfaEnabled ? { mfaPendingSecret: secret } : { mfaSecret: secret } });
    return { secret, otpauthUrl: authenticator.keyuri(ctx.email, 'Sampledge Research OS', secret) };
  }

  async disableMfa(ctx: Ctx, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!user.mfaEnabled || !user.mfaSecret) return { mfaEnabled: false };
    if (!authenticator.check(code, user.mfaSecret)) throw new BadRequestException('Code is incorrect');
    await this.db.user.update({ where: { id: ctx.userId }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null } });
    await this.audit.log(ctx, 'auth.mfa_disabled', 'User', ctx.userId);
    return { mfaEnabled: false };
  }

  async activateMfa(ctx: Ctx, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const secret = user.mfaEnabled ? user.mfaPendingSecret : user.mfaSecret;
    if (!secret) throw new BadRequestException('Start enrolment first');
    if (!authenticator.check(code, secret)) throw new BadRequestException('Code is incorrect');
    await this.db.user.update({ where: { id: ctx.userId }, data: { mfaEnabled: true, mfaSecret: secret, mfaPendingSecret: null } });
    await this.audit.log(ctx, user.mfaEnabled ? 'auth.mfa_device_changed' : 'auth.mfa_enabled', 'User', ctx.userId);
    return { mfaEnabled: true };
  }
}
