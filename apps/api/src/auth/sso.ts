/**
 * Single sign-on with OpenID Connect (authorization code flow with PKCE).
 *
 * Configured by environment (one identity provider per deployment, mapped to one workspace):
 *   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (optional for public clients),
 *   OIDC_REDIRECT_URI (…/api/v1/auth/sso/callback as the browser sees it), OIDC_TENANT (workspace slug),
 *   OIDC_LABEL (button text, optional).
 *
 * Users are not created on first sign-in: an administrator adds the person to the workspace first,
 * and the provider's verified e-mail must match. The provider is responsible for MFA on SSO sign-ins.
 * State, nonce and the PKCE verifier travel in a short-lived signed, httpOnly cookie.
 */
import { BadRequestException, Controller, Get, Injectable, Logger, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../common/config';
import { Public } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';

const FLOW_COOKIE = 'sampledge_sso';
type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

export function ssoConfig() {
  const e = process.env;
  const enabled = !!(e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_REDIRECT_URI && e.OIDC_TENANT);
  return { enabled, issuer: e.OIDC_ISSUER?.replace(/\/$/, '') ?? '', clientId: e.OIDC_CLIENT_ID ?? '', clientSecret: e.OIDC_CLIENT_SECRET, redirectUri: e.OIDC_REDIRECT_URI ?? '', tenant: e.OIDC_TENANT ?? '', label: e.OIDC_LABEL ?? 'Sign in with SSO' };
}

const b64url = (b: Buffer) => b.toString('base64url');
/** Only same-site paths are accepted as the post-sign-in destination. */
const safeNext = (n?: string) => (n && /^\/(?!\/)[\w\-/?=&%.]*$/.test(n) ? n : '/command-center');

@Injectable()
export class SsoService {
  private log = new Logger('SSO');
  private discovery?: { at: number; d: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> };
  constructor(private jwt: JwtService, private db: PrismaService, private auth: AuthService) {}

  private async provider() {
    const c = ssoConfig();
    if (!c.enabled) throw new BadRequestException('Single sign-on is not configured');
    if (this.discovery && Date.now() - this.discovery.at < 3600_000 && this.discovery.d.issuer === c.issuer) return { c, ...this.discovery };
    const r = await fetch(`${c.issuer}/.well-known/openid-configuration`);
    if (!r.ok) throw new BadRequestException(`Identity provider discovery failed (${r.status})`);
    const d = (await r.json()) as Discovery;
    if (d.issuer.replace(/\/$/, '') !== c.issuer) throw new BadRequestException('Identity provider issuer does not match OIDC_ISSUER');
    this.discovery = { at: Date.now(), d, jwks: createRemoteJWKSet(new URL(d.jwks_uri)) };
    return { c, ...this.discovery };
  }

  async start(next?: string) {
    const { c, d } = await this.provider();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const flow = await this.jwt.signAsync({ typ: 'sso', state, nonce, verifier, next: safeNext(next) }, { expiresIn: '10m' });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return { url: url.toString(), flow };
  }

  async callback(flowToken: string | undefined, code: string, state: string) {
    let flow: { typ: string; state: string; nonce: string; verifier: string; next: string };
    try { flow = await this.jwt.verifyAsync(flowToken ?? ''); } catch { throw new UnauthorizedException('Sign-in session expired; start again'); }
    if (flow.typ !== 'sso' || flow.state !== state) throw new UnauthorizedException('Sign-in state does not match; start again');
    const { c, d, jwks } = await this.provider();
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.redirectUri, client_id: c.clientId, code_verifier: flow.verifier, ...(c.clientSecret ? { client_secret: c.clientSecret } : {}) });
    const tr = await fetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    if (!tr.ok) { this.log.warn(`token endpoint ${tr.status}`); throw new UnauthorizedException('The identity provider refused the sign-in'); }
    const tokens = (await tr.json()) as { id_token?: string };
    if (!tokens.id_token) throw new UnauthorizedException('The identity provider sent no ID token');
    let claims: JWTPayload & { email?: string; email_verified?: boolean; nonce?: string };
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, { issuer: d.issuer, audience: c.clientId, clockTolerance: 60 }));
    } catch (e) {
      this.log.warn(`id_token rejected: ${(e as Error).message}`);
      throw new UnauthorizedException('The ID token could not be verified');
    }
    if (claims.nonce !== flow.nonce) throw new UnauthorizedException('The ID token nonce does not match');
    if (!claims.email || claims.email_verified === false) throw new UnauthorizedException('The identity provider did not confirm an e-mail address');
    const tenant = await this.db.tenant.findUnique({ where: { slug: c.tenant } });
    const user = await this.db.user.findUnique({ where: { email: claims.email.toLowerCase() }, include: { memberships: true } });
    if (!tenant || !user || !user.memberships.some((m) => m.tenantId === tenant.id)) {
      throw new UnauthorizedException(`${claims.email} has no access to this workspace. Ask an administrator to add you.`);
    }
    const session = await this.auth.issueFor(user.id, tenant.id, 'sso');
    return { ...session, next: flow.next };
  }
}

@Controller('auth/sso')
export class SsoController {
  constructor(private sso: SsoService) {}

  @Public() @Get('config')
  cfg() {
    const c = ssoConfig();
    return { enabled: c.enabled, label: c.enabled ? c.label : null };
  }

  @Public() @Get('start')
  async start(@Query('next') next: string | undefined, @Res() res: Response) {
    const { url, flow } = await this.sso.start(next);
    res.cookie(FLOW_COOKIE, flow, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 600_000, path: '/api/v1/auth/sso' });
    res.redirect(302, url);
  }

  @Public() @Get('callback')
  async callback(@Req() req: Request, @Query() q: Record<string, string>, @Res() res: Response) {
    res.clearCookie(FLOW_COOKIE, { path: '/api/v1/auth/sso' });
    if (q.error) return res.redirect(302, `/login?sso_error=${encodeURIComponent(q.error_description ?? q.error)}`);
    try {
      const r = await this.sso.callback(req.cookies?.[FLOW_COOKIE], q.code ?? '', q.state ?? '');
      res.cookie(config.cookieName, r.token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: r.expiresAt, path: '/' });
      return res.redirect(302, r.next);
    } catch (e) {
      return res.redirect(302, `/login?sso_error=${encodeURIComponent((e as Error).message)}`);
    }
  }
}
