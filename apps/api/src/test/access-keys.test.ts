/**
 * Workspace access overrides (role limits and temporary person grants), read-only API keys, and
 * scheduled saved reports delivered to the team through the Comms Hub.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, demoEmail, h, setup, teardown } from './harness';
import { SupplyRecordsService } from '../modules/supply-records';
import { nextReportSend } from '../modules/supply-kinds';

let tenantId = '';
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

describe('access overrides', () => {
  it('limits a role to less access, never more, and lifts it again', async () => {
    assert.equal((await as('bizdev').get('/admin/access')).status, 403);
    assert.equal((await as('platform_admin').post('/admin/access/limits', { role: 'bizdev', module: 'crm', level: 'read', reason: 'x' })).status, 400, 'a reason is needed');
    assert.equal((await as('platform_admin').post('/admin/access/limits', { role: 'platform_admin', module: 'admin', level: 'read', reason: 'Testing lockout' })).status, 400);
    assert.equal((await as('platform_admin').post('/admin/access/limits', { role: 'bizdev', module: 'panels', level: 'read', reason: 'Cannot raise a role' })).status, 400);
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId, status: 'active' } });
    const ticket = { data: { subject: 'Points missing', category: 'Rewards', panelistId: p.id } };
    assert.equal((await as('panel_manager').post('/supply/records/ticket', ticket)).status, 201);
    const l = await as('platform_admin').post('/admin/access/limits', { role: 'panel_manager', module: 'panels', level: 'read', reason: 'Support moves to the vendor this month' });
    assert.equal(l.status, 201, JSON.stringify(l.body));
    assert.equal((await as('panel_manager').get('/supply/records/ticket')).status, 200, 'still reads');
    assert.equal((await as('panel_manager').post('/supply/records/ticket', ticket)).status, 403, 'no longer writes');
    assert.equal((await as('panel_manager').get('/auth/me')).body.modules.panels, 'read');
    const m = await as('platform_admin').get('/admin/access');
    assert.equal(m.body.effective.panel_manager.panels, 'read');
    assert.equal(m.body.defaults.panel_manager.panels, 'full');
    assert.equal((await as('platform_admin').post(`/admin/access/${l.body.id}/revoke`, {})).status, 200);
    assert.equal((await as('panel_manager').post('/supply/records/ticket', ticket)).status, 201);
  });

  it('grants one person read access for a limited time, never write or admin', async () => {
    const u = await h.db.user.findUniqueOrThrow({ where: { email: demoEmail('bizdev') } });
    assert.equal((await as('bizdev').get('/supply/records/ticket')).status, 403);
    assert.equal((await as('platform_admin').post('/admin/access/grants', { userId: u.id, module: 'panels', reason: 'Covering support', days: 31 })).status, 400);
    assert.equal((await as('platform_admin').post('/admin/access/grants', { userId: u.id, module: 'admin', reason: 'Covering support', days: 3 })).status, 400);
    const g = await as('platform_admin').post('/admin/access/grants', { userId: u.id, module: 'panels', reason: 'Covering support this week', days: 7 });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal((await as('bizdev').get('/supply/records/ticket')).status, 200);
    assert.equal((await as('bizdev').post('/supply/records/ticket', { data: {} })).status, 403, 'read only');
    const audit = (await h.db.auditLog.findMany({ where: { tenantId, entity: 'AccessOverride' } })).map((a) => a.action);
    for (const a of ['access.limit', 'access.revoke', 'access.grant']) assert.ok(audit.includes(a), a);
    await as('platform_admin').post(`/admin/access/${g.body.id}/revoke`, {});
    assert.equal((await as('bizdev').get('/supply/records/ticket')).status, 403);
  });
});

describe('API keys', () => {
  it('shows the secret once, reads only its modules, refuses writes and stops when revoked', async () => {
    assert.equal((await as('bizdev').post('/integrations/keys', { name: 'BI export', scopes: ['panels'], days: 30 })).status, 403);
    assert.equal((await as('platform_admin').post('/integrations/keys', { name: 'BI export', scopes: ['admin'], days: 30 })).status, 400);
    const k = await as('platform_admin').post('/integrations/keys', { name: 'BI export', scopes: ['panels', 'analytics'], days: 30 });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    assert.match(k.body.secret, /^sk_live_/);
    const row = await h.db.apiKey.findUniqueOrThrow({ where: { id: k.body.id } });
    assert.notEqual(row.hash, k.body.secret);
    const list = await as('platform_admin').get('/integrations/keys');
    assert.equal(list.body.keys.find((x: { id: string }) => x.id === k.body.id).secret, undefined, 'never listed again');
    assert.equal((await call('GET', '/panels/panelists?q=a', undefined, k.body.secret)).status, 200);
    assert.equal((await call('GET', '/supply/facts', undefined, k.body.secret)).status, 200);
    assert.equal((await call('GET', '/supply/records/campaign', undefined, k.body.secret)).status, 403, 'communications is not in scope');
    assert.equal((await call('POST', '/supply/records/ticket', { data: {} }, k.body.secret)).status, 403, 'read-only');
    assert.equal((await call('GET', '/auth/me', undefined, k.body.secret)).status, 403, 'routes without a module are closed to keys');
    assert.equal((await call('GET', '/panels/panelists', undefined, 'sk_live_nope')).status, 401);
    assert.ok((await h.db.apiKey.findUniqueOrThrow({ where: { id: k.body.id } })).lastUsedAt);
    await as('platform_admin').post(`/integrations/keys/${k.body.id}/revoke`, {});
    assert.equal((await call('GET', '/panels/panelists', undefined, k.body.secret)).status, 401);
  });
});

describe('scheduled reports', () => {
  it('works out the next send time', () => {
    assert.equal(nextReportSend(new Date('2026-11-06T09:00:00Z'), 'daily').toISOString(), '2026-11-07T07:00:00.000Z');
    assert.equal(nextReportSend(new Date('2026-11-06T09:00:00Z'), 'weekly').toISOString(), '2026-11-09T07:00:00.000Z');
    assert.equal(nextReportSend(new Date('2026-11-06T09:00:00Z'), 'monthly').toISOString(), '2026-12-01T07:00:00.000Z');
  });

  it('sends only to team members, on schedule, as a text table', async () => {
    const base = { name: 'Weekly completes', metric: 'completes', rows: 'panel', cols: null, chart: 'table', panels: [], schedule: 'weekly' };
    const out = await as('project_manager').post('/supply/records/report', { data: { ...base, recipients: ['someone@example.com'] } });
    assert.equal(out.status, 400);
    assert.match(out.body.message, /team members only/);
    const r = await as('project_manager').post('/supply/records/report', { data: { ...base, recipients: [demoEmail('executive'), demoEmail('project_manager')], nextSendAt: '2020-01-01T00:00:00Z' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(new Date(r.body.data.nextSendAt) > new Date(), 'the server sets the send time');
    const svc = h.app.get(SupplyRecordsService);
    await svc.runDue(new Date());
    assert.equal(await h.db.message.count({ where: { relatedId: r.body.id } }), 0, 'not due yet');
    await svc.runDue(new Date(Date.now() + 8 * 86400_000));
    const after = await h.db.supplyRecord.findUniqueOrThrow({ where: { id: r.body.id } });
    const d = after.data as { lastSentAt?: string; lastMessageId?: string; nextSendAt?: string };
    assert.ok(d.lastSentAt && d.lastMessageId);
    const m = await h.db.message.findUniqueOrThrow({ where: { id: d.lastMessageId } });
    assert.equal(m.recipients, 2);
    assert.match(m.toRef, /^users:/);
    assert.match(m.subject, /Weekly completes \[RPT-/);
    assert.match(m.body, /Completes by panel/);
    const now = await as('project_manager').post(`/supply/records/report/${r.body.id}/deliver`, { version: after.version });
    assert.equal(now.status, 200, 'send now');
    assert.equal((await as('executive').post(`/supply/records/report/${r.body.id}/deliver`, { version: now.body.version })).status, 200, 'analytics is full for executives');
  });
});
