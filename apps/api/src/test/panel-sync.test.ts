/**
 * Project sync and response import against a local stub of the panel's Sampledge routes:
 * condition translation, preview, refusal while quotas lack filters, sync, idempotent import,
 * pseudonymous rows only, and workspace checks.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { startPanelStub } from './panel-stub';
import { buildPanelProject, conditionToFilters } from '../integrations/panel-sync';

let stub: Awaited<ReturnType<typeof startPanelStub>>;
let projectId = '';
before(async () => {
  await setup();
  stub = await startPanelStub();
  process.env.PANEL_T2O_URL = stub.url('t2o');
  process.env.PANEL_T2O_TOKEN = 'tok-t2o';
  const tenant = await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } });
  const any = await h.db.project.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const p = await h.db.project.create({
    data: {
      tenantId: tenant.id, code: 'SE-SYNC-1', name: 'Car owners (test)', clientId: any.clientId, audience: 'B2C', countries: ['US', 'GB'], stage: 'Setup', owner: 'Test',
      start: new Date('2026-11-01'), deadline: new Date('2026-11-20'), target: 401, ir: 0.35, loi: 12, cpiSell: 4, cpiCost: 2.4, budget: 2000,
    },
  });
  projectId = p.id;
  await h.db.quotaCell.createMany({
    data: [
      { tenantId: tenant.id, projectId, key: 'F', label: 'Women', condition: { q: 'gender', op: 'eq', value: 'female' }, target: 200 },
      { tenantId: tenant.id, projectId, key: 'Y', label: 'Under 35', condition: { all: [{ q: 'age', op: 'gte', value: 18 }, { q: 'age', op: 'lt', value: 35 }] }, target: 150 },
      { tenantId: tenant.id, projectId, key: 'CAR', label: 'Own an EV', condition: { q: 'Q7', op: 'eq', value: 'ev' }, target: 50 },
    ],
  });
});
after(async () => { await stub?.close(); delete process.env.PANEL_T2O_URL; delete process.env.PANEL_T2O_TOKEN; await teardown(); });

describe('condition translation', () => {
  it('maps gender, age and region; leaves everything else for a person', () => {
    assert.deepEqual(conditionToFilters({ q: 'gender', op: 'in', values: ['F', 'm'] }), [{ type: 'gender', value: ['female', 'male'] }]);
    assert.deepEqual(conditionToFilters({ all: [{ q: 'age', op: 'gte', value: 18 }, { q: 'age', op: 'lt', value: 35 }] }), [{ type: 'age', value: { gte: 18, lte: 34 } }]);
    assert.deepEqual(conditionToFilters({ q: 'region', op: 'in', values: ['US-CA'] }), [{ type: 'region', value: ['US-CA'] }]);
    assert.equal(conditionToFilters({ q: 'Q7', op: 'eq', value: 'ev' }), null);
    assert.equal(conditionToFilters({ any: [{ q: 'gender', op: 'eq', value: 'f' }] }), null);
    assert.equal(conditionToFilters({ q: 'gender', op: 'eq', value: 'unknown' }), null);
    assert.equal(conditionToFilters(null), null);
  });

  it('splits the target across markets and converts incidence to a percentage', () => {
    const { body } = buildPanelProject({ code: 'P', name: 'n', audience: 'B2C', countries: ['us', 'GB', 'DE'], target: 100, ir: 0.355, loi: 10, cpiCost: 2 }, [{ key: 'F', label: 'Women', condition: { q: 'gender', op: 'eq', value: 'f' }, target: 50 }]);
    assert.deepEqual(body.markets.map((m) => [m.marketID, m.completes, m.ir, m.quotas[0].target]), [['P-US', 34, 35.5, 17], ['P-GB', 33, 35.5, 17], ['P-DE', 33, 35.5, 17]]);
  });
});

describe('project sync', () => {
  it('previews the body and names the quotas that still need filters', async () => {
    const r = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}/preview`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.body.pid, 'SE-SYNC-1');
    assert.deepEqual(r.body.body.markets.map((m: { marketID: string; completes: number }) => [m.marketID, m.completes]), [['SE-SYNC-1-US', 201], ['SE-SYNC-1-GB', 200]]);
    assert.deepEqual(r.body.unmapped, [{ key: 'CAR', label: 'Own an EV' }]);
    assert.equal(stub.requests.length, 0, 'a preview makes no call');
  });

  it('refuses to sync until every quota has filters, then syncs without sending invitations', async () => {
    const refused = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}`, {});
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /Own an EV/);
    const opts = { quotaFilters: { CAR: [{ type: 'car_type', value: ['ev'] }] }, links: { live: 'https://survey.example.com/s?rid={respondentID}' } };
    const r = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}`, opts);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.synced, true);
    const sent = stub.requests.filter((x) => x.method === 'PUT');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, '/api/v1/sampledge/project');
    const body = sent[0].body as { markets: { quotas: { quotaID: string; filters: unknown }[] }[] };
    assert.deepEqual(body.markets[0].quotas.find((q) => q.quotaID === 'CAR-US')?.filters, [{ type: 'car_type', value: ['ev'] }]);
    assert.equal(stub.requests.filter((x) => x.path.startsWith('/api/v1/project/')).length, 0, 'no invite or launch call');
    const log = (await as('panel_manager').get('/panel-backend/calls')).body;
    assert.equal(log[0].action, 'sync');
    assert.equal(log[0].status, 'sent');
  });

  it('is limited to the panel owner and to roles that can change panels', async () => {
    assert.equal((await as('executive').post(`/panel-backend/t2o/sync/${projectId}`, {})).status, 403);
    assert.equal((await as('iso').post(`/panel-backend/t2o/sync/${projectId}/preview`, {})).status, 403);
    assert.equal((await as('panel_manager').post('/panel-backend/t2o/sync/nope/preview', {})).status, 404);
  });
});

describe('response import', () => {
  it('imports pages from the saved cursor, keeps only pseudonymous fields, and never double counts', async () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 2, 10, m)).toISOString();
    const item = (i: number, status: string, extra: Record<string, unknown> = {}) => ({
      responseID: `r${String(i).padStart(3, '0')}`, respondentID: `T2O-${i}`, marketID: 'SE-SYNC-1-US', quotaID: 'F-US', status, updatedAt: t(i),
      start: t(0), end: t(i), loiMinutes: 11.5, deviceType: 'mobile', points: 120,
      profile: { countryCode: 'US', region: 'US-CA', ageBand: '30-34', gender: 'female', category: 'b2c', email: 'leak@example.com', name: 'Leaky' },
      email: 'leak@example.com', ...extra,
    });
    stub.feed.set('t2o:SE-SYNC-1', Array.from({ length: 250 }, (_, i) => item(i + 1, i % 5 === 0 ? 'terminate' : 'complete')));
    const r = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}/import`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.received, 250);
    assert.equal(r.body.pages, 2);
    assert.equal(await h.db.panelResponse.count({ where: { projectId } }), 250);
    const row = await h.db.panelResponse.findFirstOrThrow({ where: { responseID: 'r001' } });
    assert.deepEqual(row.profile, { countryCode: 'US', region: 'US-CA', ageBand: '30-34', gender: 'female', category: 'b2c' });
    assert.ok(!JSON.stringify(row).includes('leak@example.com'));

    // A later status change and a new response arrive; the import picks up only those.
    const feed = stub.feed.get('t2o:SE-SYNC-1')!;
    feed[0] = item(1, 'qualityterminate', { updatedAt: t(300), qualityReasons: ['speeder'] });
    feed.push(item(251, 'complete', { updatedAt: t(301) }));
    const again = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}/import`);
    assert.equal(again.body.received, 2);
    assert.equal(await h.db.panelResponse.count({ where: { projectId } }), 251);
    const changed = await h.db.panelResponse.findFirstOrThrow({ where: { responseID: 'r001' } });
    assert.equal(changed.status, 'qualityterminate');
    assert.deepEqual(changed.qualityReasons, ['speeder']);
    assert.equal((await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}/import`)).body.received, 0);

    const s = await as('panel_manager').get(`/panel-backend/t2o/sync/${projectId}`);
    assert.equal(s.status, 200);
    assert.equal(s.body.imported.complete, 201);
    assert.equal(s.body.imported.terminate, 49, 'r001 moved from terminate to quality terminate');
    assert.equal(s.body.imported.qualityterminate, 1);
    assert.ok(s.body.live, 'live status read from the panel');
    const project = await h.db.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(project.completes, 0, 'project completes are not overwritten');
    const list = (await as('panel_manager').get('/panel-backend/syncs')).body;
    assert.equal(list[0].pid, 'SE-SYNC-1');
    assert.equal(list[0].counts.complete, 201);
  });

  it('records a feed error without losing the position', async () => {
    stub.feed.set('t2o:SE-SYNC-1', [{ responseID: '', status: 'complete', updatedAt: '2026-12-01T00:00:00.000Z' }]);
    const before = await h.db.panelSync.findFirstOrThrow({ where: { projectId } });
    const r = await as('panel_manager').post(`/panel-backend/t2o/sync/${projectId}/import`);
    assert.equal(r.status, 502);
    const after = await h.db.panelSync.findFirstOrThrow({ where: { projectId } });
    assert.equal(after.cursor, before.cursor);
    assert.match(after.importError ?? '', /no responseID/);
  });

  it('reach and questions pass through to the panel', async () => {
    const r = await as('panel_manager').post('/panel-backend/t2o/reach', { country: 'us', filters: [{ type: 'gender', value: ['female'] }], activeWithinDays: 90 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.received, { country: 'US', filters: [{ type: 'gender', value: ['female'] }], activeWithinDays: 90 });
    assert.equal((await as('panel_manager').post('/panel-backend/t2o/reach', { country: 'USA' })).status, 400);
    const q = await as('panel_manager').get('/panel-backend/t2o/questions');
    assert.equal(q.body.data.questions[0].name, 'car_ownership');
  });
});
