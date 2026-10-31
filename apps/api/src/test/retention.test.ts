/**
 * Workspace settings, data retention policies and the operator's tenant command.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, login, setup, teardown } from './harness';

let t: string;
before(async () => {
  await setup();
  t = (await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

const DAY = 86400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('workspace settings', () => {
  it('shows this workspace and what it holds, and renames it with an audit entry', async () => {
    const w = await as('platform_admin').get('/admin/workspace');
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.slug, 'sampledge-demo');
    assert.ok(w.body.counts.members >= 11 && w.body.counts.projects > 0);
    const iso = await as('iso').get('/admin/workspace');
    assert.notEqual(iso.body.id, w.body.id);
    assert.ok(iso.body.counts.projects < w.body.counts.projects, 'counts are per workspace');
    const r = await as('platform_admin').patch('/admin/workspace', { name: 'Sampledge (Renamed)' });
    assert.equal(r.body.changed, true);
    assert.equal((await as('platform_admin').get('/audit?action=workspace.renamed')).body[0].after.name, 'Sampledge (Renamed)');
    assert.equal((await as('executive').patch('/admin/workspace', { name: 'Nope' })).status, 403);
    assert.equal((await as('project_manager').get('/admin/workspace')).status, 403);
    await as('platform_admin').patch('/admin/workspace', { name: w.body.name });
  });
});

describe('data retention', () => {
  it('keeps everything by default', async () => {
    const r = await as('platform_admin').get('/admin/retention');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.categories.length >= 5);
    assert.ok(r.body.categories.every((c: { days: number | null }) => c.days === null));
    const run = await as('platform_admin').post('/admin/retention/run');
    assert.deepEqual(run.body.counts, {}, 'no policy, nothing removed');
  });

  it('turning a policy on waits for someone else’s approval; lengthening applies at once', async () => {
    assert.equal((await as('platform_admin').put('/admin/retention', { category: 'sessions', days: 3 })).status, 400, 'below the minimum');
    const req = await as('platform_admin').put('/admin/retention', { category: 'notifications', days: 90 });
    assert.equal(req.status, 200, JSON.stringify(req.body));
    assert.equal(req.body.changed, false);
    assert.ok(req.body.approvalId);
    assert.equal((await as('platform_admin').put('/admin/retention', { category: 'notifications', days: 60 })).status, 400, 'one open request per category');
    assert.equal((await as('platform_admin').post(`/approvals/${req.body.approvalId}/decision`, { decision: 'approved' })).status, 403, 'the requester cannot decide');
    const ok = await as('executive').post(`/approvals/${req.body.approvalId}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.effect, /90 days/);
    const now = (await as('platform_admin').get('/admin/retention')).body.categories.find((c: { category: string }) => c.category === 'notifications');
    assert.equal(now.days, 90);
    const longer = await as('platform_admin').put('/admin/retention', { category: 'notifications', days: 120 });
    assert.equal(longer.body.changed, true, 'lengthening needs no approval');
    const off = await as('platform_admin').put('/admin/retention', { category: 'notifications', days: null });
    assert.equal(off.body.changed, true);
    assert.equal((await as('executive').put('/admin/retention', { category: 'sessions', days: 30 })).status, 403);
  });

  it('removes or redacts only what is past its period, in this workspace, and audits the run', async () => {
    const user = await h.db.user.findUniqueOrThrow({ where: { email: 'finance@demo.sampledge.test' } });
    const iso = (await h.db.tenant.findFirstOrThrow({ where: { slug: { not: 'sampledge-demo' } } })).id;
    const oldMsg = await h.db.message.create({ data: { tenantId: t, channel: 'email', audience: 'internal', toRef: 'role:finance', recipients: 1, subject: 'Old', body: 'Secret old body', status: 'delivered_dev', createdBy: 'test', createdAt: ago(100) } });
    const queued = await h.db.message.create({ data: { tenantId: t, channel: 'email', audience: 'internal', toRef: 'role:finance', recipients: 1, subject: 'Waiting', body: 'Still queued', status: 'pending_approval', createdBy: 'test', createdAt: ago(100) } });
    const newMsg = await h.db.message.create({ data: { tenantId: t, channel: 'email', audience: 'internal', toRef: 'role:finance', recipients: 1, subject: 'New', body: 'Fresh', status: 'delivered_dev', createdBy: 'test' } });
    const isoMsg = await h.db.message.create({ data: { tenantId: iso, channel: 'email', audience: 'internal', toRef: 'role:finance', recipients: 1, subject: 'Other workspace', body: 'Theirs', status: 'delivered_dev', createdBy: 'test', createdAt: ago(100) } });
    const oldSession = await h.db.session.create({ data: { tenantId: t, userId: user.id, expiresAt: ago(20), createdAt: ago(21) } });
    const liveSession = await h.db.session.create({ data: { tenantId: t, userId: user.id, expiresAt: new Date(Date.now() + DAY) } });
    const oldAi = await h.db.aiCall.create({ data: { tenantId: t, userId: user.id, task: 'project.summary', provider: 'rules', status: 'ok', createdAt: ago(200) } });

    // Policies set directly here; the approval path is covered above.
    await h.db.tenant.update({ where: { id: t }, data: { retention: { messages: 30, sessions: 7, ai_calls: 62 } } });
    const due = (await as('platform_admin').get('/admin/retention')).body.categories;
    assert.ok(due.find((c: { category: string }) => c.category === 'messages').eligibleNow >= 1);

    const run = await as('platform_admin').post('/admin/retention/run');
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.ok(run.body.counts.messages >= 1 && run.body.counts.sessions >= 1 && run.body.counts.ai_calls >= 1);

    const m = await h.db.message.findUniqueOrThrow({ where: { id: oldMsg.id } });
    assert.equal(m.body, '');
    assert.match(m.subject, /retention/);
    assert.equal(m.recipients, 1, 'the log row is kept');
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: queued.id } })).body, 'Still queued', 'unsent messages are never touched');
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: newMsg.id } })).body, 'Fresh');
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: isoMsg.id } })).body, 'Theirs', 'other workspaces are untouched');
    assert.equal(await h.db.session.count({ where: { id: oldSession.id } }), 0);
    assert.equal(await h.db.session.count({ where: { id: liveSession.id } }), 1);
    assert.equal(await h.db.aiCall.count({ where: { id: oldAi.id } }), 0);
    const audit = (await as('platform_admin').get('/audit?action=retention.applied')).body[0];
    assert.ok(audit.after.messages >= 1);

    const again = await as('platform_admin').post('/admin/retention/run');
    assert.equal(again.body.counts.messages, 0, 'a redacted message is not counted twice');
    await h.db.tenant.update({ where: { id: t }, data: { retention: {}, retentionRunAt: null } });
  });

  it('runs once a day from the worker', async () => {
    await h.db.tenant.update({ where: { id: t }, data: { retention: { notifications: 30 }, retentionRunAt: null } });
    const old = await h.db.notification.create({ data: { tenantId: t, roles: ['finance'], title: 'Old', body: 'x', module: 'finance', createdAt: ago(40) } });
    const { EventsWorker } = await import('../modules/worker');
    await h.app.get(EventsWorker).retention();
    assert.equal(await h.db.notification.count({ where: { id: old.id } }), 0);
    const ran = await h.db.tenant.findUniqueOrThrow({ where: { id: t } });
    assert.ok(ran.retentionRunAt);
    const entry = await h.db.auditLog.findFirstOrThrow({ where: { tenantId: t, action: 'retention.applied' }, orderBy: { at: 'desc' } });
    assert.match(entry.actor, /system/);
    await h.db.tenant.update({ where: { id: t }, data: { retention: {}, retentionRunAt: null } });
  });
});

describe('operator tenant command', () => {
  it('creates a workspace with its first admin, who sees only that workspace', async () => {
    const { createWorkspace, listWorkspaces } = await import('../tenant');
    const r = await createWorkspace(h.db, { name: 'Acme Research', slug: 'acme-research', adminEmail: 'Ops@Acme.example', adminName: 'Ana Ops' });
    assert.ok(r.admin.password && r.admin.password.length >= 12);
    assert.ok((await listWorkspaces(h.db)).some((w) => w.slug === 'acme-research' && w.members === 1));
    const token = await login('ops@acme.example', r.admin.password!);
    const me = (await call('GET', '/admin/workspace', undefined, token)).body;
    assert.equal(me.name, 'Acme Research');
    assert.equal(me.counts.projects, 0, 'a new workspace starts empty');
    await assert.rejects(createWorkspace(h.db, { name: 'Again', slug: 'acme-research', adminEmail: 'x@acme.example', adminName: 'X' }), /already exists/);
    await assert.rejects(createWorkspace(h.db, { name: 'Bad', slug: 'Bad Slug!', adminEmail: 'x@acme.example', adminName: 'X' }), /Slug/);
    const existing = await createWorkspace(h.db, { name: 'Second', slug: 'second-ws', adminEmail: 'finance@demo.sampledge.test', adminName: '' });
    assert.equal(existing.admin.password, null, 'an existing account keeps its password');
  });
});
