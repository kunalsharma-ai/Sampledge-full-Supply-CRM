/**
 * SUPPLY360 operations endpoints: delivery log and retry, points ledger, workspace settings.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';

let tenantId: string;
let isoTenant: string;
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  isoTenant = (await h.db.membership.findFirstOrThrow({ where: { user: { email: 'admin@isolation.sampledge.test' } } })).tenantId;
});
after(teardown);

describe('integrations: delivery log', () => {
  let failedId: string;
  before(async () => {
    await h.drain();
    const mk = (data: object) => h.db.outboxEvent.create({ data: { tenantId, type: 'test.event', payload: { secret: 'not returned' }, ...data } });
    failedId = (await mk({ attempts: 5, lastError: 'receiver returned 503', createdAt: new Date(Date.now() + 60_000) })).id;
    await mk({ attempts: 2, lastError: 'timeout', lockedUntil: new Date(Date.now() + 3600_000), createdAt: new Date(Date.now() + 50_000) });
    await h.db.outboxEvent.create({ data: { tenantId: isoTenant, type: 'other.tenant', payload: {}, attempts: 5, lastError: 'x' } });
  });

  it('lists deliveries newest first with a status, without payloads, for this workspace only', async () => {
    const r = await as('platform_admin').get('/integrations/deliveries?take=10');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body[0].id, failedId);
    assert.equal(r.body[0].status, 'failed');
    assert.equal(r.body[1].status, 'retrying');
    assert.ok(r.body.every((d: Record<string, unknown>) => !('payload' in d)));
    assert.ok(!r.body.some((d: { type: string }) => d.type === 'other.tenant'));
    const f = await as('platform_admin').get('/integrations/deliveries?status=failed');
    assert.deepEqual(f.body.map((d: { id: string }) => d.id), [failedId]);
    const s = await as('executive').get('/integrations/deliveries/summary');
    assert.equal(s.status, 200);
    assert.equal(s.body.failed, 1);
    assert.equal(s.body.retrying, 1);
    assert.equal((await as('project_manager').get('/integrations/deliveries')).status, 403);
  });

  it('retries only failed deliveries, admins only, and audits it', async () => {
    assert.equal((await as('executive').post(`/integrations/deliveries/${failedId}/retry`)).status, 403, 'read access cannot retry');
    const retrying = (await as('platform_admin').get('/integrations/deliveries?status=retrying')).body[0].id;
    assert.equal((await as('platform_admin').post(`/integrations/deliveries/${retrying}/retry`)).status, 400);
    const r = await as('platform_admin').post(`/integrations/deliveries/${failedId}/retry`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await h.db.outboxEvent.findUniqueOrThrow({ where: { id: failedId } })).attempts, 0);
    const audit = await as('platform_admin').get('/audit?entity=OutboxEvent&action=delivery.retry');
    assert.equal(audit.body[0].entityId, failedId);
    assert.equal((await as('platform_admin').post('/integrations/deliveries/nope/retry')).status, 404);
  });
});

describe('panels: points ledger', () => {
  it('lists incentive entries with handle and brand, filtered, for panel roles', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId } });
    await h.db.incentiveEntry.create({ data: { tenantId, panelistId: p.id, kind: 'adjust', points: 42, valueBase: 0.42, note: 'ledger test', createdBy: 'test' } });
    const r = await as('panel_manager').get('/panels/ledger?kind=adjust');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.find((e: { note: string }) => e.note === 'ledger test');
    assert.ok(row);
    assert.deepEqual(row.panelist, { id: p.id, handle: p.handle, brand: p.brand });
    assert.ok(r.body.every((e: { kind: string }) => e.kind === 'adjust'));
    assert.equal((await as('panel_manager').get(`/panels/ledger?panelistId=${p.id}`)).body[0].panelist.id, p.id);
    assert.equal((await as('bizdev').get('/panels/ledger')).status, 403);
  });
});

describe('admin: workspace settings', () => {
  it('returns every setting, with managed ones read through from where they live', async () => {
    const r = await as('executive').get('/admin/settings');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.values['send.windowStart'], 8);
    assert.equal(r.body.values['privacy.healthOnlyMatch'], true);
    const t = await h.db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(r.body.values['tenant.name'], t.name);
    assert.equal(r.body.values['rewards.pointValue'], Math.round(1 / t.pointValue));
    assert.equal(r.body.managed['rewards.pointValue'].label, 'Finance');
    assert.equal((await as('panel_manager').get('/admin/settings')).status, 403);
  });

  it('saves valid changes atomically and audits each one', async () => {
    const r = await as('platform_admin').patch('/admin/settings', { changes: { 'send.activeWithin': 45, 'quality.autoSuspend': true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, 2);
    assert.equal(r.body.values['send.activeWithin'], 45);
    const g = await as('platform_admin').get('/admin/settings');
    assert.equal(g.body.values['quality.autoSuspend'], true);
    const h0 = g.body.history.find((x: { setting: string }) => x.setting === 'send.activeWithin');
    assert.equal(h0.from, 30);
    assert.equal(h0.to, 45);
    assert.equal((await as('platform_admin').patch('/admin/settings', { changes: { 'send.activeWithin': 45 } })).body.changed, 0, 'unchanged values are not re-audited');
  });

  it('refuses invalid, managed and consent-breaking changes, applying none of the batch', async () => {
    const bad = async (changes: object, expect: RegExp) => {
      const r = await as('platform_admin').patch('/admin/settings', { changes });
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.match(JSON.stringify(r.body), expect);
    };
    await bad({ 'send.weeklyCap': 9 }, /Managed in Panel reward policy/);
    await bad({ 'rewards.pointValue': 200 }, /Managed in Finance/);
    await bad({ 'privacy.healthOnlyMatch': false }, /consent terms/);
    await bad({ 'send.windowStart': 12, 'send.windowEnd': 17 }, /at least 6 hours/);
    await bad({ 'rewards.expiry': 99 }, /At most 36/);
    await bad({ 'locale.default': 'xx' }, /One of/);
    await bad({ 'no.such': 1 }, /Unknown setting/);
    await bad({ 'rewards.expiry': 24, 'limits.apiRate': 1 }, /At least 60/);
    assert.equal((await as('platform_admin').get('/admin/settings')).body.values['rewards.expiry'], 18, 'a batch with one bad value changes nothing');
    assert.equal((await as('executive').patch('/admin/settings', { changes: { 'rewards.expiry': 24 } })).status, 403, 'read access cannot save');
  });

  it('renames the workspace through the tenant record', async () => {
    const before = (await h.db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name;
    assert.equal((await as('platform_admin').patch('/admin/settings', { changes: { 'tenant.name': 'Renamed (Demo)' } })).status, 200);
    assert.equal((await h.db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name, 'Renamed (Demo)');
    await as('platform_admin').patch('/admin/settings', { changes: { 'tenant.name': before } });
  });
});
