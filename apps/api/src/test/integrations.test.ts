/**
 * Integrations overview: states come from the server's settings, secrets are never returned, and
 * the panel connection shows only to the workspace that owns it.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, setup, teardown } from './harness';

before(setup);
after(teardown);
type Row = { id: string; state: string; detail: string; settings: { name: string; set: boolean }[] };
const find = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

describe('integrations overview', () => {
  it('reports each integration from the settings without exposing secrets', async () => {
    process.env.PANEL_T2O_URL = 'https://t2o.example.test';
    process.env.PANEL_T2O_TOKEN = 'secret-token-value';
    delete process.env.PANEL_MFR_URL; delete process.env.PANEL_MFR_TOKEN;
    const r = await as('platform_admin').get('/integrations');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = r.body as Row[];
    assert.equal(find(rows, 'panel-t2o').state, 'configured', 'configured but never seen working');
    assert.match(find(rows, 'panel-t2o').detail, /t2o\.example\.test/);
    assert.deepEqual(find(rows, 'panel-t2o').settings, [{ name: 'PANEL_T2O_URL', set: true }, { name: 'PANEL_T2O_TOKEN', set: true }]);
    assert.equal(find(rows, 'panel-mfr').state, 'off');
    assert.equal(find(rows, 'messaging').state, 'development');
    assert.equal(find(rows, 'accounting').state, 'not_built');
    assert.equal(find(rows, 'ai-anthropic').state, 'off');
    assert.ok(!JSON.stringify(r.body).includes('secret-token-value'));
    delete process.env.PANEL_T2O_URL; delete process.env.PANEL_T2O_TOKEN;
  });

  it('hides the panel connection from other workspaces and is limited to roles with access', async () => {
    const iso = await as('iso').get('/integrations');
    assert.equal(iso.status, 200);
    const row = find(iso.body as Row[], 'panel-t2o');
    assert.equal(row.state, 'off');
    assert.match(row.detail, /another workspace/);
    assert.deepEqual(row.settings, []);
    assert.equal((await as('bizdev').get('/integrations')).status, 403);
    assert.equal((await as('panel_manager').get('/integrations')).status, 200);
  });
});
