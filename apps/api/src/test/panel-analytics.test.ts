/**
 * Panel analytics are counted from panel member records (per brand and overall), and the reward
 * policy is saved as audited versions whose redemption threshold the incentive ledger enforces.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const day = 86400_000;
let tenantId = '';

describe('panel analytics', () => {
  before(async () => {
    tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  });

  it('counts members, demographics and quality from the records', async () => {
    const r = await as('panel_manager').get('/panels/analytics');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const total = await h.db.panelist.count({ where: { tenantId } });
    assert.equal(r.body.kpis.registered, total);
    assert.equal(r.body.kpis.active, await h.db.panelist.count({ where: { tenantId, status: 'active' } }));
    assert.equal(r.body.cards.length, 3);
    assert.equal(r.body.cards.reduce((s: number, c: { registered: number }) => s + c.registered, 0), total);
    assert.equal(r.body.quality.reduce((a: number, b: number) => a + b, 0), total, 'every member in one quality bucket');
    const female = await h.db.panelist.count({ where: { tenantId, gender: 'female', ageBand: '25-34' } });
    assert.equal(r.body.pyramid.find((x: { ageBand: string }) => x.ageBand === '25-34').female, female);
    assert.equal(r.body.profileFunnel[0].n, total);
    const pts = await h.db.panelist.aggregate({ where: { tenantId }, _sum: { points: true } });
    const t = await h.db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(r.body.kpis.rewardLiability, Math.round((pts._sum.points ?? 0) * t.pointValue * 100) / 100);
    assert.equal(r.body.monthly.length, 6);
    assert.equal(r.body.cohorts.length, 6);
  });

  it('filters by brand and reflects new members and panel survey starts', async () => {
    const before = (await as('panel_manager').get('/panels/analytics?brand=myhealthopinions')).body;
    assert.equal(before.kpis.registered, await h.db.panelist.count({ where: { tenantId, brand: 'myhealthopinions' } }));
    const now = new Date();
    await h.db.panelist.create({ data: { tenantId, brand: 'myhealthopinions', handle: 'pa-new-1', country: 'US', ageBand: '35-44', gender: 'female', segment: 'hcp', status: 'active', qualityScore: 0.95, profileCompletion: 0.9, joinedAt: now, lastActiveAt: now } });
    const sv = await h.db.survey.findFirstOrThrow({ where: { tenantId } });
    await h.db.response.create({ data: { tenantId, surveyId: sv.id, version: 1, source: 'panel:myhealthopinions', respondent: 'pa-r1', answers: {}, path: [] } });
    const after = (await as('panel_manager').get('/panels/analytics?brand=myhealthopinions')).body;
    assert.equal(after.kpis.registered, before.kpis.registered + 1);
    assert.equal(after.kpis.newLast30, before.kpis.newLast30 + 1);
    assert.equal(after.monthly[5].registrations, before.monthly[5].registrations + 1);
    assert.equal(after.monthly[5].surveyStarts, before.monthly[5].surveyStarts + 1);
    assert.equal(after.health.segments.hcp, (before.health.segments.hcp ?? 0) + 1);
    assert.equal((await as('panel_manager').get('/panels/analytics?brand=nope')).status, 400);
  });

  it('counts engagement signals', async () => {
    const before = (await as('panel_manager').get('/panels/analytics')).body.engagement;
    await h.db.panelist.create({ data: { tenantId, brand: 'turn2opinion', handle: 'pa-quiet-1', country: 'US', ageBand: '25-34', gender: 'male', segment: 'consumer', status: 'active', qualityScore: 0.8, profileCompletion: 0.4, lastActiveAt: new Date(Date.now() - 90 * day) } });
    const after = (await as('panel_manager').get('/panels/analytics')).body.engagement;
    assert.equal(after.lowProfile, before.lowProfile + 1);
    assert.equal(after.inactive60, before.inactive60 + 1);
  });

  it('is limited to roles with panel access and to the workspace', async () => {
    assert.equal((await as('bizdev').get('/panels/analytics')).status, 403);
    assert.equal((await as('vendor').get('/panels/analytics')).status, 403);
    const iso = await as('iso').get('/panels/analytics');
    assert.equal(iso.status, 200);
    assert.equal(iso.body.kpis.registered, 0);
  });
});

describe('reward policy', () => {
  const policy = { categories: [{ id: 'short', name: 'Short reward', maxLoi: 10, points: 50, minQuality: 0.6 }, { id: 'high', name: 'High reward', maxLoi: 30, points: 250, minQuality: 0.8 }], redemptionThreshold: 1000, weeklyInviteCap: 3 };

  it('starts unset, saves audited versions and keeps history', async () => {
    const empty = await as('panel_manager').get('/panels/reward-policy');
    assert.equal(empty.body.current, null);
    const v1 = await as('panel_manager').put('/panels/reward-policy', policy);
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    assert.equal(v1.body.version, 1);
    const v2 = await as('panel_manager').put('/panels/reward-policy', { ...policy, redemptionThreshold: 2500, note: 'Raise threshold' });
    assert.equal(v2.body.version, 2);
    const cur = (await as('executive').get('/panels/reward-policy')).body;
    assert.equal(cur.current.redemptionThreshold, 2500);
    assert.deepEqual(cur.history.map((x: { version: number }) => x.version), [2, 1]);
    const audit = await h.db.auditLog.findMany({ where: { action: 'panel.reward_policy' } });
    assert.equal(audit.length, 2);
  });

  it('validates the policy and needs full panel access', async () => {
    assert.equal((await as('panel_manager').put('/panels/reward-policy', { ...policy, categories: [] })).status, 400);
    assert.equal((await as('panel_manager').put('/panels/reward-policy', { ...policy, categories: [policy.categories[0], { ...policy.categories[1], id: 'short' }] })).status, 400);
    assert.equal((await as('panel_manager').put('/panels/reward-policy', { ...policy, weeklyInviteCap: 0 })).status, 400);
    assert.equal((await as('panel_manager').put('/panels/reward-policy', { ...policy, extra: 1 })).status, 400);
    assert.equal((await as('executive').put('/panels/reward-policy', policy)).status, 403, 'executive has read access to panels');
  });

  it('the incentive ledger refuses redemptions below the threshold', async () => {
    const low = await h.db.panelist.create({ data: { tenantId, brand: 'turn2opinion', handle: 'pa-low-1', country: 'US', ageBand: '25-34', gender: 'male', segment: 'consumer', status: 'active', qualityScore: 0.8, profileCompletion: 0.8, points: 2000 } });
    const refused = await as('finance').post('/finance/incentives', { panelistId: low.id, kind: 'redeem', points: 500 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /at least 2,500 points/);
    await h.db.panelist.update({ where: { id: low.id }, data: { points: 3000 } });
    const ok = await as('finance').post('/finance/incentives', { panelistId: low.id, kind: 'redeem', points: 500 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'pending_approval');
  });
});
