/**
 * Phase 6 tests: Postgres row-level security as a second isolation layer.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';
import { as, call, h, setup, teardown } from './harness';

let db: PrismaService;
let demo: string;
let iso: string;
before(async () => {
  await setup();
  db = h.app.get(PrismaService);
  demo = (await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  iso = (await h.db.tenant.findFirstOrThrow({ where: { slug: { not: 'sampledge-demo' } } })).id;
});
after(teardown);

describe('row-level security', () => {
  it('reports enforced isolation for a signed-in request', async () => {
    const r = await as('platform_admin').get('/admin/security');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rowLevelSecurity.roleBypassesRls, false);
    assert.equal(r.body.rowLevelSecurity.tenantSeenByDatabase, 'matches your tenant');
    assert.equal(r.body.rowLevelSecurity.enforced, true);
    assert.ok(r.body.rowLevelSecurity.tablesWithForcedPolicies >= 24);
    assert.equal((await as('project_manager').get('/admin/security')).status, 403);
  });

  it('hides other tenants’ rows even from a query with no tenant filter', async () => {
    const all = await h.db.project.findMany({ select: { tenantId: true } });
    assert.ok(all.some((p) => p.tenantId === iso), 'the isolation tenant has projects');
    const scoped = await asTenant(demo, () => db.project.findMany({ select: { tenantId: true } }));
    assert.ok(scoped.length > 0);
    assert.ok(scoped.every((p) => p.tenantId === demo));
    const byId = await asTenant(demo, async () => db.project.findFirst({ where: { tenantId: iso } }));
    assert.equal(byId, null);
  });

  it('applies inside interactive transactions and refuses cross-tenant writes', async () => {
    const n = await asTenant(demo, () => db.$transaction(async (tx) => (await tx.vendor.findMany()).filter((v) => v.tenantId !== demo).length));
    assert.equal(n, 0);
    const foreign = await h.db.client.findFirstOrThrow({ where: { tenantId: iso } });
    await assert.rejects(asTenant(demo, () => db.client.update({ where: { id: foreign.id }, data: { name: 'hijacked' } })));
    await assert.rejects(asTenant(demo, () => db.client.create({ data: { tenantId: iso, name: 'planted' } })), /row-level security|violates/);
    assert.equal((await h.db.client.findUniqueOrThrow({ where: { id: foreign.id } })).name, foreign.name);
  });
});

describe('data processing', () => {
  const targets = { S1: { f: 0.51, m: 0.47, o: 0.02 }, S2: { a1: 0.3, a2: 0.35, a3: 0.35 } };
  const share = (res: { questions: { id: string; rows?: { code: string; pct: number }[] }[] }, q: string, code: string) => res.questions.find((x) => x.id === q)!.rows!.find((r) => r.code === code)!.pct;

  it('summarises a fielded survey for processing', async () => {
    const r = await as('data_processing').get('/dp/surveys/sv-012');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.completes, 600);
    assert.equal(r.body.synthetic, 600);
    assert.ok(r.body.weightingVariables.some((v: { id: string }) => v.id === 'S2'));
    assert.equal(r.body.openEnds[0].id, 'Q6');
    assert.equal((await as('vendor').get('/dp/surveys/sv-012')).status, 403);
    assert.ok((await as('data_processing').get('/dp/surveys')).body.some((s: { id: string }) => s.id === 'sv-012'));
  });

  it('applies rim weights that move results to the targets', async () => {
    assert.equal((await as('project_manager').put('/dp/surveys/sv-012/weighting', { targets })).status, 403, 'read-only role');
    assert.equal((await as('data_processing').put('/dp/surveys/sv-012/weighting', { targets: { S1: { f: 0.5, m: 0.3 } } })).status, 400);
    const w = await as('data_processing').put('/dp/surveys/sv-012/weighting', { targets });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.ok(w.body.converged && w.body.efficiency > 0.5 && w.body.efficiency < 1);
    const plain = (await as('data_processing').get('/surveys/sv-012/results')).body;
    const weighted = (await as('data_processing').get('/surveys/sv-012/results?weighted=true&banner=S1')).body;
    assert.ok(share(plain, 'S2', 'a3') < 0.25);
    assert.ok(Math.abs(share(weighted, 'S2', 'a3') - 0.35) < 0.005);
    assert.equal(weighted.weighted, true);
    assert.ok(weighted.effectiveBase < weighted.base);
    assert.ok((await as('platform_admin').get('/audit')).body.some((a: { action: string }) => a.action === 'dp.weighting_applied'));
  });

  it('suggests, saves and applies a codeframe, keeping manual codes', async () => {
    const s = await as('data_processing').post('/dp/surveys/sv-012/codeframes/Q6/suggest', { maxCodes: 8 });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.provider, 'rules');
    assert.ok(s.body.data.codes.length >= 5);
    const frame = [{ code: 'PRICE', label: 'Price and value', keywords: ['price', 'expensive', 'fees', 'value'] }, { code: 'NET', label: 'Network and coverage', keywords: ['coverage', 'signal', 'calls', 'speeds'] }, { code: 'SERV', label: 'Customer service', keywords: ['service', 'staff', 'waiting'] }];
    const saved = await as('data_processing').put('/dp/surveys/sv-012/codeframes/Q6', { codes: frame });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.coded, 600);
    const v = (await as('data_processing').get('/dp/surveys/sv-012/codeframes/Q6/verbatims?code=other&take=5')).body;
    assert.ok(v.length > 0);
    const set = await call('PATCH', `/dp/responses/${v[0].id}/codes`, { questionId: 'Q6', codes: ['SERV'] }, h.tokens.data_processing);
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal((await call('PATCH', `/dp/responses/${v[0].id}/codes`, { questionId: 'Q6', codes: ['NOPE'] }, h.tokens.data_processing)).status, 400);
    await as('data_processing').put('/dp/surveys/sv-012/codeframes/Q6', { codes: frame });
    const after = (await as('data_processing').get('/dp/surveys/sv-012/codeframes/Q6/verbatims?code=SERV&take=500')).body;
    assert.ok(after.some((x: { id: string; manual: boolean }) => x.id === v[0].id && x.manual), 'manual code survives recoding');
    const q6 = (await as('data_processing').get('/surveys/sv-012/results')).body.questions.find((q: { id: string }) => q.id === 'Q6');
    assert.ok(q6.coded.find((c: { code: string }) => c.code === 'PRICE').pct > 0.1);
  });

  it('exports Excel tables', async () => {
    const r = await fetch(`${h.url}/api/v1/dp/surveys/sv-012/tables.xlsx?banner=S2&weighted=true`, { headers: { authorization: `Bearer ${h.tokens.data_processing}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    const notes = wb.getWorksheet('Notes')!.getColumn(2).values.join(' ');
    assert.match(notes, /Rim weighted/);
    assert.match(notes, /SYNTHETIC/);
    const tables = wb.getWorksheet('Tables')!;
    assert.ok(tables.rowCount > 40);
  });

  it('removes weighting', async () => {
    assert.equal((await call('DELETE', '/dp/surveys/sv-012/weighting', undefined, h.tokens.data_processing)).status, 200);
    assert.equal((await as('data_processing').get('/surveys/sv-012/results?weighted=true')).body.weighted, false);
  });
});

describe('idempotency and paging', () => {
  const send = (key: string, body: unknown) => fetch(`${h.url}/api/v1/diy/requests`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${h.tokens.client}`, 'idempotency-key': key }, body: JSON.stringify(body) });
  const spec = { audience: 'B2C', countries: ['US'], sampleSize: 300, incidence: 0.5, loi: 10, title: 'Retry-safe request', objective: 'Check that a retried submission is not duplicated.' };

  it('replays a retried write instead of repeating it', async () => {
    const before = await h.db.opportunity.count({ where: { channel: 'diy' } });
    const a = await send('retry-test-0001', spec);
    const b = await send('retry-test-0001', spec);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get('idempotent-replayed'), 'true');
    assert.equal(((await a.json()) as { id: string }).id, ((await b.json()) as { id: string }).id);
    assert.equal(await h.db.opportunity.count({ where: { channel: 'diy' } }), before + 1);
    assert.equal((await send('retry-test-0001', { ...spec, sampleSize: 400 })).status, 422);
    assert.equal((await send('bad', spec)).status, 422);
  });

  it('releases the key when the request fails', async () => {
    assert.equal((await send('retry-test-0002', { ...spec, countries: [] })).status, 400);
    assert.equal((await send('retry-test-0002', spec)).status, 201);
  });

  it('pages lists with a cursor header', async () => {
    const get = (q: string) => fetch(`${h.url}/api/v1/audit${q}`, { headers: { authorization: `Bearer ${h.tokens.platform_admin}` } });
    const p1 = await get('?take=3');
    const next = p1.headers.get('x-next-cursor');
    const rows1 = (await p1.json()) as { id: string }[];
    assert.equal(rows1.length, 3);
    assert.ok(next);
    const rows2 = (await (await get(`?take=3&cursor=${next}`)).json()) as { id: string }[];
    assert.ok(rows2.length > 0 && rows2.every((r) => !rows1.some((x) => x.id === r.id)));
  });
});

describe('single sign-on (OpenID Connect)', () => {
  // A minimal identity provider: discovery, JWKS, and a token endpoint that checks PKCE.
  let idp: import('node:http').Server;
  let issuer = '';
  let nextIdToken: (nonce: string) => Promise<string>;
  let lastChallenge = '';
  let lastNonce = '';
  let emailForToken = 'project.manager@demo.sampledge.test';

  before(async () => {
    const jose = await import('jose');
    const { createServer } = await import('node:http');
    const { createHash } = await import('node:crypto');
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
    const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    nextIdToken = (nonce) => new jose.SignJWT({ email: emailForToken, email_verified: true, nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('sampledge-test').setSubject('u-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    idp = createServer(async (req, res) => {
      const url = new URL(req.url!, issuer);
      const json = (o: unknown, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url.pathname === '/.well-known/openid-configuration') return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/token') {
        let raw = ''; for await (const c of req) raw += c;
        const p = new URLSearchParams(raw);
        const ok = p.get('code') === 'good-code' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === lastChallenge && p.get('client_id') === 'sampledge-test';
        return ok ? json({ access_token: 'x', token_type: 'Bearer', id_token: await nextIdToken(lastNonce) }) : json({ error: 'invalid_grant' }, 400);
      }
      json({ error: 'not_found' }, 404);
    });
    await new Promise<void>((r) => idp.listen(0, r));
    issuer = `http://localhost:${(idp.address() as import('node:net').AddressInfo).port}`;
    Object.assign(process.env, { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'sampledge-test', OIDC_REDIRECT_URI: `${h.url}/api/v1/auth/sso/callback`, OIDC_TENANT: 'sampledge-demo', OIDC_LABEL: 'Sign in with Test IdP' });
  });
  after(() => { idp.close(); for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI', 'OIDC_TENANT', 'OIDC_LABEL']) delete process.env[k]; });

  const startFlow = async () => {
    const r = await fetch(`${h.url}/api/v1/auth/sso/start?next=/projects`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location')!);
    assert.equal(loc.origin, issuer);
    lastChallenge = loc.searchParams.get('code_challenge')!;
    lastNonce = loc.searchParams.get('nonce')!;
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    return { state: loc.searchParams.get('state')!, cookie };
  };

  it('advertises the provider', async () => {
    const r = await (await fetch(`${h.url}/api/v1/auth/sso/config`)).json() as { enabled: boolean; label: string };
    assert.deepEqual(r, { enabled: true, label: 'Sign in with Test IdP' });
  });

  it('signs in a provisioned user with a verified ID token', async () => {
    const { state, cookie } = await startFlow();
    const cb = await fetch(`${h.url}/api/v1/auth/sso/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/projects');
    const session = cb.headers.getSetCookie().find((c) => c.startsWith('sampledge_session='))!.split(';')[0];
    const me = await (await fetch(`${h.url}/api/v1/auth/me`, { headers: { cookie: session } })).json() as { role: string };
    assert.equal(me.role, 'project_manager');
    assert.ok((await h.db.auditLog.findFirst({ where: { action: 'auth.login', after: { path: ['method'], equals: 'sso' } } })));
  });

  it('refuses a wrong state, a bad code and unknown people', async () => {
    const a = await startFlow();
    const bad = await fetch(`${h.url}/api/v1/auth/sso/callback?code=good-code&state=forged`, { redirect: 'manual', headers: { cookie: a.cookie } });
    assert.match(decodeURIComponent(bad.headers.get('location')!), /state does not match/);
    const b = await startFlow();
    const badCode = await fetch(`${h.url}/api/v1/auth/sso/callback?code=wrong&state=${b.state}`, { redirect: 'manual', headers: { cookie: b.cookie } });
    assert.match(decodeURIComponent(badCode.headers.get('location')!), /refused/);
    emailForToken = 'stranger@example.com';
    const c = await startFlow();
    const stranger = await fetch(`${h.url}/api/v1/auth/sso/callback?code=good-code&state=${c.state}`, { redirect: 'manual', headers: { cookie: c.cookie } });
    assert.match(decodeURIComponent(stranger.headers.get('location')!), /no access to this workspace/);
    assert.equal(stranger.headers.getSetCookie().some((x) => x.startsWith('sampledge_session=') && !x.startsWith('sampledge_session=;')), false);
    const noCookie = await fetch(`${h.url}/api/v1/auth/sso/callback?code=good-code&state=${c.state}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(noCookie.headers.get('location')!), /expired/);
  });
});

describe('observability', () => {
  it('tags every response and error with a request id', async () => {
    const ok = await fetch(`${h.url}/api/v1/health`, { headers: { 'x-request-id': 'trace-12345678' } });
    assert.equal(ok.headers.get('x-request-id'), 'trace-12345678');
    const err = await fetch(`${h.url}/api/v1/projects/does-not-exist`, { headers: { authorization: `Bearer ${h.tokens.executive}` } });
    assert.equal(err.status, 404);
    const body = (await err.json()) as { requestId: string; message: string };
    assert.equal(body.requestId, err.headers.get('x-request-id'));
    assert.ok(body.message);
  });

  it('serves Prometheus metrics only with the token', async () => {
    assert.equal((await fetch(`${h.url}/api/v1/metrics`)).status, 404);
    process.env.METRICS_TOKEN = 'metrics-test-token';
    assert.equal((await fetch(`${h.url}/api/v1/metrics`, { headers: { authorization: 'Bearer wrong' } })).status, 404);
    const r = await fetch(`${h.url}/api/v1/metrics`, { headers: { authorization: 'Bearer metrics-test-token' } });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /http_requests_total\{method="GET",route="\/api\/v1\/health",status="200"\} \d+/);
    assert.match(text, /http_request_duration_seconds_bucket/);
    assert.match(text, /sampledge_outbox_pending \d+/);
    delete process.env.METRICS_TOKEN;
  });
});

describe('live updates', () => {
  it('streams workspace changes and role notifications after commit', async () => {
    const ac = new AbortController();
    const r = await fetch(`${h.url}/api/v1/live`, { headers: { authorization: `Bearer ${h.tokens.bizdev}` }, signal: ac.signal });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = r.body!.getReader();
    let text = '';
    const read = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
    // A DIY request notifies Business Development through the worker.
    assert.equal((await as('client').post('/diy/requests', { audience: 'B2B', countries: ['DE'], sampleSize: 200, incidence: 0.3, loi: 12, title: 'Live channel check', objective: 'Make sure the live channel reaches the team.' })).status, 201);
    await h.drain();
    for (let i = 0; i < 40 && !/event: notification/.test(text); i++) await new Promise((res) => setTimeout(res, 50));
    ac.abort();
    await read;
    assert.match(text, /event: change\ndata: \{"type":"diy.requested"/);
    assert.match(text, /event: notification\ndata: .*DIY request from/);
  });

  it('keeps other tenants and other roles out of the stream', async () => {
    const ac = new AbortController();
    const r = await fetch(`${h.url}/api/v1/live`, { headers: { authorization: `Bearer ${h.tokens.iso}` }, signal: ac.signal });
    const reader = r.body!.getReader();
    let text = '';
    const read = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
    await as('client').post('/diy/requests', { audience: 'B2B', countries: ['DE'], sampleSize: 200, incidence: 0.3, loi: 12, title: 'Second live check', objective: 'Other tenants must not see this.' });
    await h.drain();
    await new Promise((res) => setTimeout(res, 400));
    ac.abort();
    await read;
    assert.doesNotMatch(text, /diy|DIY/);
    assert.equal((await fetch(`${h.url}/api/v1/live`)).status, 401);
  });
});
