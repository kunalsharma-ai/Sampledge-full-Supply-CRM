/**
 * Panel backend adapter against a local stub of the Turn2Opinion backend: connection status,
 * read calls, token-per-panel errors, workspace and role checks, and approval-gated actions that
 * are sent at most once.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { startPanelStub } from './panel-stub';

let stub: Awaited<ReturnType<typeof startPanelStub>>;
before(async () => { await setup(); stub = await startPanelStub(); });
after(async () => { await stub?.close(); await teardown(); });

const connect = (panel: string, token = `tok-${panel}`) => { process.env[`PANEL_${panel.toUpperCase()}_URL`] = stub.url(panel); process.env[`PANEL_${panel.toUpperCase()}_TOKEN`] = token; };
const disconnect = (panel: string) => { delete process.env[`PANEL_${panel.toUpperCase()}_URL`]; delete process.env[`PANEL_${panel.toUpperCase()}_TOKEN`]; };
const sent = (path: string) => stub.requests.filter((r) => r.path === path && r.method !== 'GET');

describe('panel connection', () => {
  it('reports every panel as not connected until configured, and refuses calls', async () => {
    const r = await as('panel_manager').get('/panel-backend');
    assert.equal(r.status, 200);
    assert.equal(r.body.owner, true);
    assert.deepEqual(r.body.panels.map((p: { panel: string; connected: boolean }) => [p.panel, p.connected]), [['t2o', false], ['mfr', false], ['mho', false]]);
    const cpi = await as('panel_manager').post('/panel-backend/t2o/cpi', { category: 'B2C', ir: 30, loi: 10, country: 'US' });
    assert.equal(cpi.status, 503);
    assert.match(cpi.body.message, /not connected/);
    assert.equal(stub.requests.length, 0);
  });

  it('calls the configured panel with its token and returns the backend data as sent', async () => {
    connect('t2o');
    const check = await as('panel_manager').post('/panel-backend/t2o/check');
    assert.equal(check.status, 200);
    assert.deepEqual(check.body.fields, ['name', 'role']);
    const cpi = await as('panel_manager').post('/panel-backend/t2o/cpi', { category: 'B2C', subcategory: 'Gen pop', ir: 30, loi: 10, country: 'US' });
    assert.equal(cpi.status, 200);
    assert.deepEqual(cpi.body.data.input, { category: 'B2C', subcategory: 'Gen pop', ir: 30, loi: 10, country: 'US' });
    const filter = { country: 'US', gender: ['female'], age: { gte: 18, lte: 34 } };
    const f = await as('panel_manager').post('/panel-backend/t2o/feasibility', { filter });
    assert.deepEqual(f.body.data.filterReceived, filter, 'filter passed through unchanged');
    assert.equal((await as('panel_manager').get('/panel-backend/t2o/projects/P-1/qualified')).body.data.qualified, true);
    assert.ok(stub.requests.every((r) => r.auth === 'Bearer tok-t2o'));
  });

  it('explains a token issued for another panel without signing the user out', async () => {
    connect('mfr', 'tok-t2o');
    const r = await as('panel_manager').post('/panel-backend/mfr/check');
    assert.equal(r.status, 502, 'never 401/403, which would read as the user\'s own session');
    assert.match(r.body.message, /different panel host/);
    connect('mfr');
  });

  it('is limited to the owning workspace and to roles with panel access', async () => {
    const iso = await as('iso').post('/panel-backend/t2o/check');
    assert.equal(iso.status, 403);
    assert.match(iso.body.message, /another workspace/);
    assert.equal((await as('bizdev').get('/panel-backend')).status, 403);
    assert.equal((await as('executive').post('/panel-backend/t2o/projects/P-1/actions', { action: 'invites' })).status, 403, 'read-only role cannot request actions');
  });
});

describe('approval-gated panel actions', () => {
  it('sends nothing on request, sends once after approval, and never resends', async () => {
    connect('t2o');
    const body = { markets: ['US'], invites: 500, note: 'test (stub)' };
    const r = await as('panel_manager').post('/panel-backend/t2o/projects/P-100/actions', { action: 'invites', body });
    assert.equal(r.status, 202);
    assert.equal(r.body.approval.kind, 'High-volume communications');
    await h.drain();
    assert.equal(sent('/api/v1/project/P-100').length, 0, 'nothing sent before approval');
    assert.equal((await as('panel_manager').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 403, 'requester cannot approve');
    const d = await as('platform_admin').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.match(d.body.effect, /sending to Turn2Opinion once/);
    await h.drain();
    await h.drain();
    const calls = sent('/api/v1/project/P-100');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, body);
    const log = (await as('panel_manager').get('/panel-backend/calls')).body;
    assert.equal(log[0].status, 'sent');
    assert.equal(log[0].approvalId, r.body.approval.id);
  });

  it('records but does not send when rejected, or when the panel is not connected', async () => {
    const rej = await as('panel_manager').post('/panel-backend/t2o/projects/P-200/actions', { action: 'soft-launch', body: {} });
    await as('platform_admin').post(`/approvals/${rej.body.approval.id}/decision`, { decision: 'rejected' });
    await h.drain();
    assert.equal(sent('/api/v1/project/P-200').length, 0);
    assert.equal(await h.db.panelCall.count({ where: { path: '/api/v1/project/P-200' } }), 0);

    disconnect('mho');
    const nc = await as('panel_manager').post('/panel-backend/mho/projects/P-300/actions', { action: 'cancel' });
    assert.match(nc.body.approval.title, /not connected/);
    const d = await as('platform_admin').post(`/approvals/${nc.body.approval.id}/decision`, { decision: 'approved' });
    assert.match(d.body.effect, /not connected: recorded, nothing sent/);
    await h.drain();
    const call = await h.db.panelCall.findFirstOrThrow({ where: { path: '/api/v1/project/P-300' } });
    assert.equal(call.status, 'not_sent');
    assert.equal(call.method, 'DELETE');
  });

  it('records a backend failure and tells the panel team', async () => {
    connect('t2o');
    const r = await as('panel_manager').post('/panel-backend/t2o/projects/boom/actions', { action: 'invites', body: {} });
    await as('platform_admin').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' });
    await h.drain();
    const call = await h.db.panelCall.findFirstOrThrow({ where: { path: '/api/v1/project/boom' } });
    assert.equal(call.status, 'failed');
    assert.match(call.error ?? '', /Internal error \(stub\)/);
    const n = (await as('panel_manager').get('/notifications')).body;
    const items = Array.isArray(n) ? n : n.items;
    assert.ok(items.some((x: { title: string }) => /invites on Turn2Opinion: failed/.test(x.title)));
  });
});
