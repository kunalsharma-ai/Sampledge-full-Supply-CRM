/**
 * SampAudience requests read through for the SUPPLY360 screens: signed as SUPPLY360, merged with
 * what SUPPLY360 recorded, refused for roles without panel or marketplace access, and reported as
 * not connected when SampAudience is not configured.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyRequest } from '@sampledge/contracts';
import { as, h, setup, teardown } from './harness';

const SECRET = 'proxy-test-secret';
const AR = 'AR-01JC9Y3V8Q6K2N4R7T0W5X1Z9P';
let server: Server;
let tenantId = '';
const seen: { path: string; ok: boolean }[] = [];

const view = (id: string, platform: string) => ({
  audienceRequestId: id, status: 'live', title: 'Proxy test study', source: { platform, projectId: 'PRJ-1', surveyId: 'SV-1' },
  organization: { id: 'org-1', name: 'Client Co' }, spec: { countries: ['US'], loiMinutes: 12, expectedIncidence: 0.3, reward: { points: 150 }, fieldwork: { start: '2026-11-01', end: '2026-11-20' }, targeting: { criteria: [], naturalLanguage: 'adults' } },
  requiredCompletes: 100, completes: 40, remaining: 60, approval: { approvedBy: 'u1', approvedAt: '2026-11-02T00:00:00Z', note: null },
  launch: { mode: 'soft', softLaunchTarget: 10, autoBatches: true }, feasibility: null, allocation: [{ country: 'US', panel: 't2o', target: 100 }],
  quotas: [], batches: [], outcomes: { complete: 40, terminate: 12 }, routing: { decisions: 3, routed: 1 }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
});

before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  server = createServer((req, res) => {
    const v = verifyRequest({ headers: req.headers, method: req.method!, path: req.url!, body: '', secretsFor: (id) => (id === 'supply360' ? [SECRET] : []) });
    seen.push({ path: req.url!, ok: v.ok });
    if (!v.ok) { res.writeHead(401).end('bad signature'); return; }
    res.setHeader('content-type', 'application/json');
    if (req.url!.startsWith('/api/v1/audience-requests?') || req.url === '/api/v1/audience-requests') { res.end(JSON.stringify({ data: [{ id: AR }] })); return; }
    if (req.url === `/api/v1/audience-requests/${AR}`) { res.end(JSON.stringify(view(AR, 'PROJEXA'))); return; }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, r));
});
after(async () => { delete process.env.SAMPLEON_URL; delete process.env.SAMPLEON_SECRET; server.close(); await teardown(); });

describe('SampAudience requests read through', () => {
  it('says not connected (and lists nothing) when SampAudience is not configured', async () => {
    delete process.env.SAMPLEON_URL;
    const r = await as('panel_manager').get('/sampaudience/requests');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { connected: false, consoleUrl: null, requests: [] });
    assert.equal((await as('panel_manager').get('/sampaudience/status')).body.connected, false);
  });

  it('lists requests with their full view, signed as SUPPLY360, plus what SUPPLY360 recorded', async () => {
    process.env.SAMPLEON_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.SAMPLEON_SECRET = SECRET;
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId } });
    await h.db.surveyCard.create({ data: { id: 'px_card_1', tenantId, audienceRequestId: AR, surveyId: 'SV-1', panelistId: p.id, panel: 't2o', title: 'x', cardUrl: 'https://x.example/c', loiMinutes: 12, rewardPoints: 150, expiresAt: new Date(Date.now() + 86400_000) } });
    const e = await h.db.incentiveEntry.create({ data: { tenantId, panelistId: p.id, kind: 'earn', points: 150, valueBase: 1.5, createdBy: 'test' } });
    await h.db.participation.create({ data: { tenantId, sessionId: 'px_ses_1', audienceRequestId: AR, surveyId: 'SV-1', panelistId: p.id, status: 'complete', rewardEntryId: e.id } });
    const r = await as('executive').get('/sampaudience/requests?platform=PROJEXA');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.connected, true);
    assert.match(r.body.consoleUrl, /\/console$/);
    assert.equal(r.body.requests.length, 1);
    assert.equal(r.body.requests[0].audienceRequestId, AR);
    assert.deepEqual(r.body.requests[0].recorded, { cards: 1, completes: 1, points: 150 });
    assert.ok(seen.length >= 2 && seen.every((s) => s.ok), 'every call was signed correctly');
    assert.ok(seen.some((s) => s.path === '/api/v1/audience-requests?platform=PROJEXA'), 'the filter is passed on');
    const one = await as('panel_manager').get(`/sampaudience/requests/${AR}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.routing.routed, 1);
    assert.equal((await as('panel_manager').get('/sampaudience/requests/AR-01JC9Y3V8Q6K2N4R7T0W5X1Z9Q')).status, 404);
    assert.equal((await as('panel_manager').get('/sampaudience/requests/nope')).status, 404);
  });

  it('refuses roles with no panel or marketplace access, and reports SampAudience failures as 502', async () => {
    assert.equal((await as('survey_programmer').get('/sampaudience/requests')).status, 403);
    assert.equal((await as('vendor').get('/sampaudience/requests')).status, 403);
    process.env.SAMPLEON_SECRET = 'wrong-secret';
    const r = await as('panel_manager').get('/sampaudience/requests');
    assert.equal(r.status, 502);
    assert.match(JSON.stringify(r.body), /HTTP 401/);
    process.env.SAMPLEON_SECRET = SECRET;
  });
});
