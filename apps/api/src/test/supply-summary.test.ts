/**
 * Summary views counted from recorded tables: audience counts for the segment builder and
 * feasibility, per-country market figures, and the member activity feed.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';

let tenantId = '';
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

const cond = (field: string, values: string[], op = 'in') => ({ kind: 'cond', field, op, values });

describe('audience count', () => {
  it('counts members matching the rules, the same as the database', async () => {
    const root = { kind: 'group', join: 'AND', children: [cond('country', ['US', 'GB']), cond('status', ['active'])] };
    const r = await as('panel_manager').post('/supply/audience/count', { root });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const want = await h.db.panelist.count({ where: { tenantId, country: { in: ['US', 'GB'] }, status: 'active' } });
    assert.equal(r.body.eligible, want);
    assert.ok(r.body.reachable <= r.body.eligible && r.body.invitable <= r.body.reachable);
    assert.ok(r.body.byCountry.every((c: { code: string }) => ['US', 'GB'].includes(c.code)));
    assert.equal(r.body.byCountry.reduce((a: number, c: { eligible: number }) => a + c.eligible, 0), want);
    assert.deepEqual(r.body.unsupported, []);
  });

  it('maps panel names and negation, and reports fields it does not record', async () => {
    const r = await as('panel_manager').post('/supply/audience/count', { root: { kind: 'group', join: 'AND', children: [cond('brand', ['mho']), cond('country', ['US'], 'not_in'), cond('income', ['High'])] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const want = await h.db.panelist.count({ where: { tenantId, brand: 'myhealthopinions', NOT: { country: { in: ['US'] } }, status: { not: 'deletion_requested' } } });
    assert.equal(r.body.eligible, want);
    assert.deepEqual(Object.keys(r.body.byPanel).filter((k) => r.body.byPanel[k]), want ? ['mho'] : []);
    assert.deepEqual(r.body.unsupported, ['Household income']);
  });

  it('is closed to roles without panels and rejects bad trees', async () => {
    assert.equal((await as('bizdev').post('/supply/audience/count', { root: { kind: 'group', join: 'AND', children: [] } })).status, 403);
    assert.equal((await as('panel_manager').post('/supply/audience/count', { root: { kind: 'nope' } })).status, 400);
  });
});

describe('markets', () => {
  it('totals members per country from the panelist table', async () => {
    const r = await as('panel_manager').get('/supply/markets');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const us = r.body.markets.find((m: { code: string }) => m.code === 'US');
    assert.ok(us);
    const want = await h.db.panelist.count({ where: { tenantId, country: 'US', status: { not: 'deletion_requested' } } });
    assert.equal(us.members.t2o + us.members.mfr + us.members.mho, want);
    assert.equal(us.trend.length, 7);
    assert.ok(us.reachable <= us.consented);
  });
});

describe('activity feed', () => {
  it('lists recent member events, newest first', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId, status: 'active' } });
    await as('panel_manager').post('/supply/records/ticket', { data: { subject: 'Feed check', category: 'Rewards', panelistId: p.id } });
    const r = await as('panel_manager').get('/panels/events?hours=24');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const t = r.body.events.find((e: { type: string; text: string }) => e.type === 'support' && /Feed check/.test(e.text));
    assert.ok(t);
    assert.equal(t.panelistId, p.id);
    const at = r.body.events.map((e: { at: string }) => new Date(e.at).getTime());
    assert.deepEqual(at, [...at].sort((a, b) => b - a));
    assert.equal((await as('panel_manager').get('/panels/events?hours=999')).status, 400);
  });
});
