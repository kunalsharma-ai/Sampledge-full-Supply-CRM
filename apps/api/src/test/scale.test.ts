/**
 * Scale-out and AI evaluation: a second API instance on the same database, the shared rate-limit
 * store, and the AI evaluation set (scores on the rules, and graders that catch bad answers).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { as, h, login, setup, teardown } from './harness';
import { SharedThrottlerStorage } from '../common/rate-limit-store';
import { LiveHub, type LiveEvent } from '../common/live';
import { codeframeCases, rfqCases, summaryCases } from '../ai/evals/cases';
import { runEvals, toMarkdown } from '../ai/evals/run';
import { projectSummary } from '../ai/tasks';

let b: INestApplication;
let bUrl = '';
before(async () => {
  await setup();
  const { createApp } = await import('../bootstrap');
  b = await createApp();
  await b.listen(0);
  bUrl = (await b.getUrl()).replace('[::1]', 'localhost');
});
after(async () => { await b?.close(); await teardown(); });

const on = (base: string) => (method: string, p: string, token: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/v1${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then(async (r) => ({ status: r.status, headers: r.headers, body: (await r.json().catch(() => null)) as any }));

describe('two API instances on one database', () => {
  it('accepts a session from the other instance and ends it everywhere on sign-out', async () => {
    const token = await login('bizdev@demo.sampledge.test');
    assert.equal((await on(bUrl)('GET', '/auth/me', token)).status, 200);
    assert.equal((await on(bUrl)('POST', '/auth/logout', token)).status, 200);
    assert.equal((await on(h.url)('GET', '/auth/me', token)).status, 401);
  });

  it('replays an Idempotency-Key on the other instance without writing twice', async () => {
    const clientId = (await as('bizdev').get('/clients?take=1')).body[0].id;
    const body = { title: 'Idempotency across instances (TEST)', clientId, audience: 'B2B', countries: ['DE'], sampleSize: 150, incidence: 0.2, loi: 10, owner: 'Test' };
    const headers = { 'idempotency-key': 'scale-test-key-1' };
    const a = await on(h.url)('POST', '/opportunities', h.tokens.bizdev, body, headers);
    const r = await on(bUrl)('POST', '/opportunities', h.tokens.bizdev, body, headers);
    assert.equal(a.status, 201);
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('idempotent-replayed'), 'true');
    assert.equal(r.body.id, a.body.id);
    assert.equal(await h.db.opportunity.count({ where: { title: body.title } }), 1);
  });

  it('delivers live updates from a write on one instance to listeners on the other', async () => {
    const seen: LiveEvent[] = [];
    const off = await b.get(LiveHub).subscribe((e) => seen.push(e));
    const opp = await h.db.opportunity.findFirst({ where: { title: 'Idempotency across instances (TEST)' } });
    const r = await as('bizdev').post(`/opportunities/${opp!.id}/feasibility`, {});
    assert.equal(r.status, 201);
    await h.drain();
    for (let i = 0; i < 50 && !seen.some((e) => e.type === 'feasibility.requested'); i++) await new Promise((res) => setTimeout(res, 100));
    off();
    assert.ok(seen.some((e) => e.type === 'feasibility.requested'), JSON.stringify(seen));
  });
});

describe('shared rate-limit store', () => {
  it('counts hits from every instance in one window and blocks past the limit', async () => {
    const s = h.app.get(SharedThrottlerStorage);
    const s2 = b.get(SharedThrottlerStorage);
    const key = `test-${Date.now()}`;
    const hit = (st: SharedThrottlerStorage) => st.increment(key, 60_000, 3, 60_000, 'default');
    assert.deepEqual([(await hit(s)).totalHits, (await hit(s2)).totalHits, (await hit(s)).totalHits], [1, 2, 3]);
    const fourth = await hit(s2);
    assert.equal(fourth.isBlocked, true);
    assert.ok(fourth.timeToBlockExpire > 50 && fourth.timeToBlockExpire <= 60);
    assert.equal((await hit(s)).isBlocked, true, 'blocked on the other instance too');
    // Once the block and the window have passed, counting starts again.
    await h.db.rateLimitBucket.update({ where: { key: `default:${key}` }, data: { resetAt: new Date(Date.now() - 1000), blockedUntil: new Date(Date.now() - 1000) } });
    const fresh = await hit(s);
    assert.equal(fresh.isBlocked, false);
    assert.equal(fresh.totalHits, 1);
  });
});

describe('AI evaluation set', () => {
  it('scores the rule-based implementations with no critical failures', async () => {
    const r = await runEvals('rules');
    assert.equal(r.tasks.length, 4);
    assert.equal(r.totals.criticalFailed, 0, toMarkdown(r));
    // Baseline on 2026-10-31: 16 of 17 cases. A lower score is a regression in the rules.
    assert.ok(r.totals.passed >= 16, toMarkdown(r));
    assert.match(toMarkdown(r), /\| rfq\.extract v1 \|/);
  });

  it('graders catch guessed numbers, followed injections and invented facts', () => {
    const injection = rfqCases.find((c) => c.id === 'rfq-06')!;
    const bad = injection.grade({ audience: 'Healthcare', countries: ['AU', 'US', 'GB', 'DE', 'FR', 'JP'], sampleSize: 99999, incidence: 0.25, loi: 12, title: null, missing: [] }, injection.input);
    assert.ok(bad.some((c) => c.critical && !c.pass && /injected/.test(c.name)));

    const sparse = rfqCases.find((c) => c.id === 'rfq-04')!;
    const guessed = sparse.grade({ audience: 'B2C', countries: ['BR', 'MX'], sampleSize: 500, incidence: 0.5, loi: 15, title: null, missing: [] }, sparse.input);
    assert.equal(guessed.filter((c) => c.critical && !c.pass).length, 3);

    const behind = summaryCases.find((c) => c.id === 'ps-02')!;
    const good = projectSummary.rules(behind.input);
    assert.ok(behind.grade(good, behind.input).every((c) => c.pass));
    const invented = { ...good, bullets: [...good.bullets, 'The vendor promised 450 extra completes by Friday.'] };
    assert.ok(behind.grade(invented, behind.input).some((c) => c.critical && !c.pass && /450/.test(c.detail ?? '')));

    const cf = codeframeCases[0];
    const offText = cf.grade({ codes: [{ code: 'C1', label: 'Value', keywords: ['value for money'] }] }, cf.input);
    assert.ok(offText.some((c) => c.critical && !c.pass));
  });

  it('is available to admins and the model run is refused without a model', async () => {
    const r = await as('platform_admin').get('/ai/evals');
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, 'rules');
    assert.equal((await as('project_manager').get('/ai/evals')).status, 403);
    const run = await as('platform_admin').post('/ai/evals/run');
    assert.equal(run.status, 400);
    assert.match(run.body.message, /No model is connected/);
  });
});
