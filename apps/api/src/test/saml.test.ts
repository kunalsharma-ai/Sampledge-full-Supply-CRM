/**
 * SAML sign-in against a stand-in identity provider: the test plays the provider, building and
 * signing responses with a test-only key (src/test/fixtures/saml-idp.*, not a real provider's).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import { as, h, setup, teardown } from './harness';

const fixture = (f: string) => readFileSync(path.resolve(__dirname, '../../src/test/fixtures', f), 'utf8');
const IDP = { key: fixture('saml-idp.key'), cert: fixture('saml-idp.crt') };
const OTHER = { key: fixture('saml-other-idp.key') };
const IDP_ISSUER = 'https://idp.example.test/saml';
const SP = 'https://sampledge.example.test/saml';
const env = () => ({
  SAML_ENTRY_POINT: 'https://idp.example.test/sso', SAML_IDP_ISSUER: IDP_ISSUER, SAML_IDP_CERT: IDP.cert,
  SAML_SP_ENTITY_ID: SP, SAML_CALLBACK_URL: `${h.url}/api/v1/auth/saml/acs`, SAML_TENANT: 'sampledge-demo', SAML_LABEL: 'Sign in with Test SAML',
});

before(async () => { await setup(); Object.assign(process.env, env()); });
after(async () => { for (const k of Object.keys(env())) delete process.env[k]; await teardown(); });

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
type Opts = { inResponseTo: string; email?: string; issuer?: string; audience?: string; notOnOrAfterMs?: number; key?: string; sign?: boolean; tamper?: (xml: string) => string };

function response(o: Opts) {
  const id = `_a${randomBytes(12).toString('hex')}`;
  const acs = env().SAML_CALLBACK_URL;
  const until = iso(o.notOnOrAfterMs ?? 300_000);
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${o.issuer ?? IDP_ISSUER}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">user-123</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.inResponseTo}" NotOnOrAfter="${until}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${until}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? SP}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="${id}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${o.email ?? 'project.manager@demo.sampledge.test'}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion>`;
  let signed = assertion;
  if (o.sign !== false) {
    const sig = new SignedXml({ privateKey: o.key ?? IDP.key, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
    signed = sig.getSignedXml();
  }
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(12).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${acs}" InResponseTo="${o.inResponseTo}">` +
    `<saml:Issuer>${o.issuer ?? IDP_ISSUER}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`;
  if (o.tamper) xml = o.tamper(xml);
  return Buffer.from(xml).toString('base64');
}

/** One browser: starts a flow, keeps its cookie. */
async function startFlow(next = '/projects') {
  const r = await fetch(`${h.url}/api/v1/auth/saml/start?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, 'https://idp.example.test/sso');
  const req = inflateRawSync(Buffer.from(loc.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
  const requestId = /\sID="([^"]+)"/.exec(req)![1];
  assert.match(req, new RegExp(`AssertionConsumerServiceURL="${env().SAML_CALLBACK_URL.replace(/[.?]/g, '\\$&')}"`));
  return { requestId, relay: loc.searchParams.get('RelayState')!, cookie: r.headers.get('set-cookie')!.split(';')[0] };
}

/** The provider's POST arrives without our cookies (cross-site); /finish runs in the browser with them. */
async function postBack(samlResponse: string, relay: string, cookie?: string) {
  const acs = await fetch(`${h.url}/api/v1/auth/saml/acs`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relay }) });
  assert.equal(acs.status, 303);
  const to = acs.headers.get('location')!;
  if (!to.startsWith('/api/v1/auth/saml/finish')) return { location: decodeURIComponent(to), session: null };
  const fin = await fetch(`${h.url}${to}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const session = fin.headers.getSetCookie().find((c) => c.startsWith('sampledge_session=') && !c.startsWith('sampledge_session=;'))?.split(';')[0] ?? null;
  return { location: decodeURIComponent(fin.headers.get('location')!), session };
}

describe('SAML sign-in', () => {
  it('advertises the provider and publishes service metadata', async () => {
    assert.deepEqual(await (await fetch(`${h.url}/api/v1/auth/saml/config`)).json(), { enabled: true, label: 'Sign in with Test SAML' });
    const md = await (await fetch(`${h.url}/api/v1/auth/saml/metadata`)).text();
    assert.match(md, new RegExp(`entityID="${SP}"`));
    assert.match(md, /AssertionConsumerService[^>]+HTTP-POST/);
  });

  it('signs in a member with a signed assertion and records the method', async () => {
    const f = await startFlow();
    const r = await postBack(response({ inResponseTo: f.requestId }), f.relay, f.cookie);
    assert.equal(r.location, '/projects');
    assert.ok(r.session, 'session cookie set');
    const me = await (await fetch(`${h.url}/api/v1/auth/me`, { headers: { cookie: r.session! } })).json() as { role: string };
    assert.equal(me.role, 'project_manager');
    assert.ok(await h.db.auditLog.findFirst({ where: { action: 'auth.login', after: { path: ['method'], equals: 'saml' } } }));
  });

  it('refuses a replayed response', async () => {
    const f = await startFlow();
    const res = response({ inResponseTo: f.requestId });
    assert.ok((await postBack(res, f.relay, f.cookie)).session);
    const again = await postBack(res, f.relay, f.cookie);
    assert.equal(again.session, null);
    assert.match(again.location, /could not be verified/);
  });

  it('refuses unsigned, tampered, wrongly signed, foreign, misaddressed and expired assertions', async () => {
    const cases: [string, (id: string) => string][] = [
      ['unsigned', (id) => response({ inResponseTo: id, sign: false })],
      ['tampered after signing', (id) => response({ inResponseTo: id, tamper: (x) => x.replace('project.manager@', 'platform.admin@') })],
      ['signed by another key', (id) => response({ inResponseTo: id, key: OTHER.key })],
      ['another issuer', (id) => response({ inResponseTo: id, issuer: 'https://evil.example.test' })],
      ['another audience', (id) => response({ inResponseTo: id, audience: 'https://someone-else.example.test' })],
      ['expired', (id) => response({ inResponseTo: id, notOnOrAfterMs: -5 * 60_000 })],
      ['unsolicited', () => response({ inResponseTo: `_unknown${randomBytes(8).toString('hex')}` })],
    ];
    for (const [name, make] of cases) {
      const f = await startFlow();
      const r = await postBack(make(f.requestId), f.relay, f.cookie);
      assert.equal(r.session, null, name);
      assert.match(r.location, /^\/login\?sso_error=/, name);
    }
  });

  it('will not finish in a browser that did not start the sign-in', async () => {
    const victim = await startFlow();
    const attacker = await startFlow();
    // The attacker's own valid assertion, finished with the victim's cookie, must not sign the victim in.
    const r = await postBack(response({ inResponseTo: attacker.requestId, email: 'platform.admin@demo.sampledge.test' }), attacker.relay, victim.cookie);
    assert.equal(r.session, null);
    assert.match(r.location, /another browser/);
    const none = await postBack(response({ inResponseTo: victim.requestId }), victim.relay);
    assert.match(none.location, /expired/);
  });

  it('does not create accounts for people outside the workspace', async () => {
    const f = await startFlow();
    const r = await postBack(response({ inResponseTo: f.requestId, email: 'stranger@example.com' }), f.relay, f.cookie);
    assert.equal(r.session, null);
    assert.match(r.location, /no access to this workspace/);
    assert.equal(await h.db.user.count({ where: { email: 'stranger@example.com' } }), 0);
  });

  it('shows on the integrations page without exposing the certificate', async () => {
    const r = await as('platform_admin').get('/integrations');
    const row = (r.body as { id: string; state: string }[]).find((x) => x.id === 'sso-saml')!;
    assert.equal(row.state, 'connected');
    assert.ok(!JSON.stringify(r.body).includes('BEGIN CERTIFICATE'));
  });

  it('is off when not configured', async () => {
    const saved = process.env.SAML_IDP_CERT;
    delete process.env.SAML_IDP_CERT;
    assert.deepEqual(await (await fetch(`${h.url}/api/v1/auth/saml/config`)).json(), { enabled: false, label: null });
    assert.equal((await fetch(`${h.url}/api/v1/auth/saml/start`, { redirect: 'manual' })).status, 400);
    process.env.SAML_IDP_CERT = saved;
  });
});
