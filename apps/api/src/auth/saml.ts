/**
 * Single sign-on with SAML 2.0 (service-provider initiated: HTTP-Redirect request, HTTP-POST response).
 *
 * Configured by environment (one identity provider per deployment, mapped to one workspace):
 *   SAML_ENTRY_POINT   the identity provider's sign-in URL
 *   SAML_IDP_ISSUER    the identity provider's entity ID (responses from any other issuer are refused)
 *   SAML_IDP_CERT      the identity provider's signing certificate (PEM, or its base64 body)
 *   SAML_SP_ENTITY_ID  Sampledge's entity ID at the provider
 *   SAML_CALLBACK_URL  …/api/v1/auth/saml/acs as the browser sees it
 *   SAML_TENANT        workspace slug
 *   SAML_LABEL         button text (optional)
 *   SAML_EMAIL_ATTRIBUTE  attribute that holds the e-mail (optional; otherwise email, mail, the
 *                      standard mail OID, or an e-mail-format NameID)
 *
 * As with OpenID Connect, nobody is created on first sign-in: the person must already be a member of
 * the workspace with the same e-mail, and MFA is the provider's.
 *
 * Checks: the assertion must be signed by SAML_IDP_CERT, come from SAML_IDP_ISSUER, be addressed to
 * this service, be within its time window, answer a request this deployment started (request IDs live
 * in Postgres so any API instance can finish the flow), and be used once. The provider's POST arrives
 * cross-site, where the browser withholds our cookies, so the ACS hands over to a same-site GET
 * (/finish) that checks the flow cookie set when this browser started: an assertion obtained in
 * someone else's browser cannot sign this one in.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Logger, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../common/config';
import { Public } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';

const FLOW_COOKIE = 'sampledge_saml';
const REQUEST_TTL_MS = 10 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function samlConfig() {
  const e = process.env;
  const enabled = !!(e.SAML_ENTRY_POINT && e.SAML_IDP_ISSUER && e.SAML_IDP_CERT && e.SAML_SP_ENTITY_ID && e.SAML_CALLBACK_URL && e.SAML_TENANT);
  return {
    enabled, entryPoint: e.SAML_ENTRY_POINT ?? '', idpIssuer: e.SAML_IDP_ISSUER ?? '', idpCert: e.SAML_IDP_CERT ?? '',
    spEntityId: e.SAML_SP_ENTITY_ID ?? '', callbackUrl: e.SAML_CALLBACK_URL ?? '', tenant: e.SAML_TENANT ?? '',
    label: e.SAML_LABEL ?? 'Sign in with SAML', emailAttribute: e.SAML_EMAIL_ATTRIBUTE,
  };
}

/** Only same-site paths are accepted as the post-sign-in destination. */
const safeNext = (n?: string) => (n && /^\/(?!\/)[\w\-/?=&%.]*$/.test(n) ? n : '/command-center');

/** Request IDs and seen assertions, shared by every API instance. Keys are namespaced by purpose. */
export class PostgresSamlCache implements CacheProvider {
  constructor(private db: PrismaService, private ttlMs = REQUEST_TTL_MS) {}
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const row = await this.db.samlCache.upsert({ where: { key }, create: { key, value, expiresAt }, update: {} });
    return row.value === value ? { value, createdAt: row.createdAt.getTime() } : null;
  }
  async getAsync(key: string) {
    const row = await this.db.samlCache.findUnique({ where: { key } });
    return row && row.expiresAt > new Date() ? row.value : null;
  }
  async removeAsync(key: string | null) {
    if (!key) return null;
    return this.consumeAsync(key);
  }
  async consumeAsync(key: string) {
    // DELETE … RETURNING is atomic: of two copies of one response, only one gets the row.
    const rows = await this.db.$queryRaw<{ value: string; expiresAt: Date }[]>`DELETE FROM "SamlCache" WHERE "key" = ${key} RETURNING "value", "expiresAt"`;
    return rows[0] && rows[0].expiresAt > new Date() ? rows[0].value : null;
  }
  async saveIfAbsentAsync(key: string, value: string, expiresAtMs: number) {
    const rows = await this.db.$queryRaw<{ key: string }[]>`
      INSERT INTO "SamlCache" ("key", "value", "expiresAt", "createdAt") VALUES (${key}, ${value}, ${new Date(expiresAtMs)}, now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "expiresAt" = EXCLUDED."expiresAt", "createdAt" = now()
        WHERE "SamlCache"."expiresAt" <= now()
      RETURNING "key"`;
    return rows.length === 1;
  }
}

export function emailFrom(p: Profile, attribute?: string): string | null {
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const candidates = attribute ? [pick(p[attribute])] : [p.email, p.mail, p['urn:oid:0.9.2342.19200300.100.1.3'], pick(p['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'])];
  if (!attribute && /emailAddress$/.test(p.nameIDFormat ?? '')) candidates.push(p.nameID);
  const found = candidates.find((c) => typeof c === 'string' && EMAIL_RE.test(c));
  return typeof found === 'string' ? found.toLowerCase() : null;
}

@Injectable()
export class SamlService {
  private log = new Logger('SAML');
  private cache: PostgresSamlCache;
  constructor(private jwt: JwtService, private db: PrismaService, private auth: AuthService) {
    this.cache = new PostgresSamlCache(db);
  }

  private saml(requestId?: string) {
    const c = samlConfig();
    if (!c.enabled) throw new BadRequestException('SAML sign-in is not configured');
    return {
      c,
      saml: new SAML({
        entryPoint: c.entryPoint, issuer: c.spEntityId, callbackUrl: c.callbackUrl, idpCert: c.idpCert, idpIssuer: c.idpIssuer,
        audience: c.spEntityId, wantAssertionsSigned: true, wantAuthnResponseSigned: false,
        validateInResponseTo: ValidateInResponseTo.always, requestIdExpirationPeriodMs: REQUEST_TTL_MS,
        rejectReplayedAssertions: true, cacheProvider: this.cache, acceptedClockSkewMs: 60_000, maxAssertionAgeMs: 0,
        identifierFormat: null, disableRequestedAuthnContext: true,
        ...(requestId ? { generateUniqueId: () => requestId } : {}),
      }),
    };
  }

  /** Returns the provider URL and a flow token that binds the request to this browser. */
  async start(next?: string) {
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const { saml } = this.saml(requestId);
    const relay = await this.jwt.signAsync({ typ: 'saml-relay', next: safeNext(next) }, { expiresIn: '10m' });
    const url = await saml.getAuthorizeUrlAsync(relay, {});
    const flow = await this.jwt.signAsync({ typ: 'saml', requestId }, { expiresIn: '10m' });
    return { url, flow };
  }

  /** Validates the provider's POST. Returns a short hand-over token for /finish; never a session. */
  async acs(samlResponse: string, relayState: string | undefined) {
    if (!samlResponse) throw new UnauthorizedException('No SAML response was received');
    const { c, saml } = this.saml();
    let profile: Profile | null;
    try {
      ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse }));
    } catch (e) {
      this.log.warn(`SAML response rejected: ${(e as Error).message}`);
      throw new UnauthorizedException('The SAML response could not be verified');
    }
    if (!profile) throw new UnauthorizedException('The SAML response could not be verified');
    // node-saml has already matched this to a request we issued and consumed it; read which one from
    // the verified assertion so /finish can tie it to the browser that started it.
    const requestId = this.inResponseTo(profile);
    if (!requestId) throw new UnauthorizedException('The SAML response does not answer a sign-in request');
    let next = '/command-center';
    try {
      const r = await this.jwt.verifyAsync<{ typ: string; next: string }>(relayState ?? '');
      if (r.typ === 'saml-relay') next = r.next;
    } catch { /* the destination is a convenience; a missing or stale RelayState falls back */ }
    const email = emailFrom(profile, c.emailAttribute);
    if (!email) throw new UnauthorizedException('The identity provider did not send an e-mail address');
    const handover = await this.jwt.signAsync({ typ: 'saml-handover', email, requestId, next }, { expiresIn: '2m' });
    return handover;
  }

  private inResponseTo(p: Profile) {
    const xml = p.getAssertionXml?.() ?? '';
    return /<(?:\w+:)?SubjectConfirmationData\b[^>]*\sInResponseTo="([^"]+)"/.exec(xml)?.[1] ?? null;
  }

  /** Same-site step: the flow cookie must belong to the request the assertion answered. */
  async finish(flowToken: string | undefined, handoverToken: string) {
    let flow: { typ: string; requestId: string };
    let handover: { typ: string; email: string; requestId: string | null; next: string };
    try { flow = await this.jwt.verifyAsync(flowToken ?? ''); } catch { throw new UnauthorizedException('Sign-in session expired; start again'); }
    try { handover = await this.jwt.verifyAsync(handoverToken); } catch { throw new UnauthorizedException('Sign-in session expired; start again'); }
    if (flow.typ !== 'saml' || handover.typ !== 'saml-handover' || !handover.requestId || flow.requestId !== handover.requestId) {
      throw new UnauthorizedException('This sign-in was started in another browser; start again');
    }
    // A hand-over token works once.
    if (!(await this.cache.saveIfAbsentAsync(`handover:${handover.requestId}`, '1', Date.now() + REQUEST_TTL_MS))) {
      throw new UnauthorizedException('This sign-in was already used; start again');
    }
    const c = samlConfig();
    const tenant = await this.db.tenant.findUnique({ where: { slug: c.tenant } });
    const user = await this.db.user.findUnique({ where: { email: handover.email }, include: { memberships: true } });
    if (!tenant || !user || !user.memberships.some((m) => m.tenantId === tenant.id)) {
      throw new UnauthorizedException(`${handover.email} has no access to this workspace. Ask an administrator to add you.`);
    }
    const session = await this.auth.issueFor(user.id, tenant.id, 'saml');
    return { ...session, next: handover.next };
  }

  async metadata() {
    const { saml } = this.saml();
    return saml.generateServiceProviderMetadata(null, null);
  }
}

@Controller('auth/saml')
export class SamlController {
  constructor(private s: SamlService) {}

  @Public() @Get('config')
  cfg() {
    const c = samlConfig();
    return { enabled: c.enabled, label: c.enabled ? c.label : null };
  }

  @Public() @Get('metadata')
  async metadata(@Res() res: Response) {
    res.type('application/samlmetadata+xml').send(await this.s.metadata());
  }

  @Public() @Get('start')
  async start(@Query('next') next: string | undefined, @Res() res: Response) {
    const { url, flow } = await this.s.start(next);
    res.cookie(FLOW_COOKIE, flow, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: REQUEST_TTL_MS, path: '/api/v1/auth/saml' });
    res.redirect(302, url);
  }

  @Public() @Post('acs')
  async acs(@Body() body: Record<string, string>, @Res() res: Response) {
    try {
      const t = await this.s.acs(body?.SAMLResponse ?? '', body?.RelayState);
      return res.redirect(303, `/api/v1/auth/saml/finish?t=${encodeURIComponent(t)}`);
    } catch (e) {
      return res.redirect(303, `/login?sso_error=${encodeURIComponent((e as Error).message)}`);
    }
  }

  @Public() @Get('finish')
  async finish(@Req() req: Request, @Query('t') t: string | undefined, @Res() res: Response) {
    res.clearCookie(FLOW_COOKIE, { path: '/api/v1/auth/saml' });
    try {
      const r = await this.s.finish(req.cookies?.[FLOW_COOKIE], t ?? '');
      res.cookie(config.cookieName, r.token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: r.expiresAt, path: '/' });
      return res.redirect(302, r.next);
    } catch (e) {
      return res.redirect(302, `/login?sso_error=${encodeURIComponent((e as Error).message)}`);
    }
  }
}
