/**
 * Admin & Security: people and roles, session revocation and the audit trail.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, login, setup, teardown } from './harness';

let pm2Id: string;
before(async () => {
  await setup();
  pm2Id = (await h.db.user.findUniqueOrThrow({ where: { email: 'project.manager2@demo.sampledge.test' } })).id;
});
after(teardown);

describe('admin: people and roles', () => {
  it('lists this workspace’s members without secrets, admins only', async () => {
    const r = await as('platform_admin').get('/admin/users');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.length >= 11);
    assert.ok(r.body.every((u: Record<string, unknown>) => !('passwordHash' in u) && !('mfaSecret' in u)));
    assert.ok(r.body.some((u: { you: boolean; role: string }) => u.you && u.role === 'platform_admin'));
    assert.ok(!r.body.some((u: { email: string }) => u.email.includes('isolation')), 'other tenants’ members are not listed');
    assert.equal((await as('executive').get('/admin/users')).status, 200, 'executive has read access');
    assert.equal((await as('project_manager').get('/admin/users')).status, 403);
  });

  it('changes a role, records it in the audit trail, and applies on the next request', async () => {
    const r = await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'data_processing' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, true);
    assert.equal((await as('pm2').get('/auth/me')).body.role, 'data_processing');
    const audit = await as('platform_admin').get('/audit?entity=User&action=role.changed');
    assert.equal(audit.status, 200);
    assert.equal(audit.body[0].entityId, pm2Id);
    assert.equal(audit.body[0].before.role, 'project_manager');
    assert.equal(audit.body[0].after.role, 'data_processing');
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'project_manager' })).status, 200);
  });

  it('refuses unsafe role changes', async () => {
    const admin = await as('platform_admin').get('/admin/users');
    const me = admin.body.find((u: { you: boolean }) => u.you).id;
    const vendor = admin.body.find((u: { role: string }) => u.role === 'vendor').id;
    assert.equal((await as('platform_admin').patch(`/admin/users/${me}/role`, { role: 'executive' })).status, 403, 'not your own role');
    assert.equal((await as('platform_admin').patch(`/admin/users/${vendor}/role`, { role: 'executive' })).status, 400, 'vendor accounts keep their role');
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'vendor' })).status, 400, 'cannot assign vendor');
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'superuser' })).status, 400);
    assert.equal((await as('executive').patch(`/admin/users/${pm2Id}/role`, { role: 'executive' })).status, 403, 'read-only role cannot change roles');
    const iso = (await h.db.user.findUniqueOrThrow({ where: { email: 'admin@isolation.sampledge.test' } })).id;
    assert.equal((await as('platform_admin').patch(`/admin/users/${iso}/role`, { role: 'executive' })).status, 404, 'other tenants’ members are not found');
  });

  it('granting admin needs someone else’s approval; demotion applies at once', async () => {
    const me = (await as('platform_admin').get('/admin/users')).body.find((u: { you: boolean }) => u.you).id;
    // Admins cannot change their own role, so a workspace always keeps at least one platform admin.
    const req = await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'platform_admin' });
    assert.equal(req.status, 200, JSON.stringify(req.body));
    assert.equal(req.body.changed, false, 'granting admin waits for an approval');
    assert.equal((await as('pm2').get('/auth/me')).body.role, 'project_manager');
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'platform_admin' })).status, 400, 'one open request at a time');
    assert.equal((await as('platform_admin').post(`/approvals/${req.body.approvalId}/decision`, { decision: 'approved' })).status, 403, 'the requester cannot decide');
    assert.equal((await as('project_manager').post(`/approvals/${req.body.approvalId}/decision`, { decision: 'approved' })).status, 403, 'a project manager cannot decide');
    const ok = await as('executive').post(`/approvals/${req.body.approvalId}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.effect, /platform_admin/);
    assert.equal((await as('pm2').get('/auth/me')).body.role, 'platform_admin');
    assert.equal((await as('pm2').patch(`/admin/users/${me}/role`, { role: 'executive' })).status, 200);
    assert.equal((await as('platform_admin').post(`/admin/users/${pm2Id}/sessions/revoke`)).status, 403, 'the demoted admin loses write access at once');
    assert.equal((await as('pm2').patch(`/admin/users/${pm2Id}/role`, { role: 'executive' })).status, 403, 'pm2 cannot demote itself either');
    const back = await call('PATCH', `/admin/users/${me}/role`, { role: 'platform_admin' }, h.tokens.pm2);
    assert.equal(back.status, 200);
    assert.equal((await as('executive').post(`/approvals/${back.body.approvalId}/decision`, { decision: 'approved' })).status, 200);
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2Id}/role`, { role: 'project_manager' })).status, 200);
    const solo = await as('platform_admin').get('/admin/users');
    assert.equal(solo.body.filter((u: { role: string }) => u.role === 'platform_admin').length, 1);
  });
});

describe('admin: sessions', () => {
  it('signs a person out everywhere', async () => {
    const t1 = await login('project.manager2@demo.sampledge.test');
    const t2 = await login('project.manager2@demo.sampledge.test');
    const r = await as('platform_admin').post(`/admin/users/${pm2Id}/sessions/revoke`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.revoked >= 3);
    for (const t of [t1, t2, h.tokens.pm2]) assert.equal((await call('GET', '/auth/me', undefined, t)).status, 401);
    const audit = await as('platform_admin').get('/audit?action=sessions.revoked');
    assert.equal(audit.body[0].entityId, pm2Id);
    h.tokens.pm2 = await login('project.manager2@demo.sampledge.test');
  });

  it('does not revoke your own session from here', async () => {
    const me = (await as('platform_admin').get('/admin/users')).body.find((u: { you: boolean }) => u.you).id;
    assert.equal((await as('platform_admin').post(`/admin/users/${me}/sessions/revoke`)).status, 403);
  });
});

describe('admin: audit trail', () => {
  it('pages newest first and filters', async () => {
    const p1 = await call('GET', '/audit?take=2', undefined, h.tokens.platform_admin);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.length, 2);
    assert.ok(new Date(p1.body[0].at) >= new Date(p1.body[1].at));
    const f = await as('platform_admin').get('/admin/audit/facets');
    assert.ok(f.body.entities.some((e: { value: string }) => e.value === 'User'));
    const byActor = await as('platform_admin').get('/audit?actor=sam');
    assert.ok(byActor.body.length > 0 && byActor.body.every((a: { actor: string }) => /sam/i.test(a.actor)));
    assert.equal((await as('vendor').get('/audit')).status, 403);
  });
});
