/**
 * SUPPLY360 working records (generic store with per-kind rules), analytics facts, the weekly
 * programme read model and closing quota cells early.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { isoWeekOf } from '../modules/supply-views';

let tenantId: string;
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

describe('supply records', () => {
  let id: string;
  let version: number;

  it('lists the kinds a role can read, and refuses roles without module access', async () => {
    const k = await as('panel_manager').get('/supply/records');
    assert.equal(k.status, 200);
    const weekly = k.body.find((x: { id: string }) => x.id === 'weekly');
    assert.equal(weekly.canWrite, true);
    assert.ok(weekly.actions.schedule);
    assert.equal((await as('bizdev').get('/supply/records/weekly')).status, 403, 'bizdev has no panels access');
    assert.equal((await as('vendor').get('/supply/records/report')).status, 403, 'scoped roles never see supply records');
    assert.equal((await as('panel_manager').get('/supply/records/nope')).status, 404);
  });

  it('creates with a reference, validates the shape and keeps one entry per week', async () => {
    const r = await as('panel_manager').post('/supply/records/weekly', { data: { week: '2030-W02', template: 'Quick pulse', topics: ['Travel'] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.ref, /^WK-\d+$/);
    assert.equal(r.body.status, 'planned');
    assert.equal(r.body.title, '2030-W02 · Quick pulse');
    assert.equal(r.body.data.brands.length, 3, 'defaults fill in');
    ({ id, version } = r.body);
    const dup = await as('panel_manager').post('/supply/records/weekly', { data: { week: '2030-W02', template: 'Profile refresh' } });
    assert.equal(dup.status, 409);
    const bad = await as('panel_manager').post('/supply/records/weekly', { data: { week: '2030-46', template: 'x' } });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body), /week/);
    assert.equal((await as('executive').post('/supply/records/weekly', { data: { week: '2030-W03', template: 'Quick pulse' } })).status, 403, 'read access cannot create');
  });

  it('updates with the version last seen and refuses a stale one', async () => {
    const u = await as('panel_manager').patch(`/supply/records/weekly/${id}`, { data: { template: 'Prediction game' }, version });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(u.body.data.template, 'Prediction game');
    assert.equal(u.body.data.topics[0], 'Travel', 'other fields are kept');
    assert.equal(u.body.version, version + 1);
    const stale = await as('panel_manager').patch(`/supply/records/weekly/${id}`, { data: { template: 'Quick pulse' }, version });
    assert.equal(stale.status, 409);
    version = u.body.version;
  });

  it('moves through allowed status changes only, with each one audited', async () => {
    assert.equal((await as('panel_manager').post(`/supply/records/weekly/${id}/mark_sent`, { version, audienceRequestId: 'AR-01JC0000000000000000000000' })).status, 400, 'planned cannot be sent');
    const s = await as('panel_manager').post(`/supply/records/weekly/${id}/schedule`, { version });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.status, 'scheduled');
    const sent = await as('panel_manager').post(`/supply/records/weekly/${id}/mark_sent`, { version: s.body.version, audienceRequestId: 'AR-01JC0000000000000000000000' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.data.audienceRequestId, 'AR-01JC0000000000000000000000');
    assert.equal((await as('panel_manager').patch(`/supply/records/weekly/${id}`, { data: { template: 'x y' }, version: sent.body.version })).status, 400, 'a sent week is locked');
    const audit = await h.db.auditLog.findMany({ where: { entity: 'SupplyRecord', entityId: id }, orderBy: { at: 'asc' } });
    assert.deepEqual(audit.map((a) => a.action), ['weekly.created', 'weekly.updated', 'weekly.schedule', 'weekly.mark_sent']);
  });

  it('checks report rules: recipients for a schedule, different rows and columns', async () => {
    const base = { name: 'Completes by panel', metric: 'completes', rows: 'week', cols: 'panel', chart: 'line' };
    assert.equal((await as('executive').post('/supply/records/report', { data: { ...base, schedule: 'weekly' } })).status, 400);
    assert.equal((await as('executive').post('/supply/records/report', { data: { ...base, cols: 'week' } })).status, 400);
    const ok = await as('executive').post('/supply/records/report', { data: { ...base, schedule: 'weekly', recipients: ['Leads@Example.com'] } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.data.recipients, ['leads@example.com']);
    assert.match(ok.body.ref, /^RPT-/);
  });
});

describe('weekly programme and analytics facts', () => {
  it('counts invitations, completes and reward cost for the week SampAudience ran', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId } });
    const AR = 'AR-01JC0000000000000000000000';
    await h.db.surveyCard.createMany({ data: [1, 2, 3].map((i) => ({ id: `wk_card_${i}`, tenantId, audienceRequestId: AR, surveyId: 'wk', panelistId: p.id, panel: 't2o', title: 'Weekly', cardUrl: 'https://x.example/c', loiMinutes: 3, rewardPoints: 50, expiresAt: new Date(Date.now() + 86400_000) })) });
    const e = await h.db.incentiveEntry.create({ data: { tenantId, panelistId: p.id, kind: 'earn', points: 50, valueBase: 0.5, createdBy: 'test' } });
    await h.db.participation.create({ data: { tenantId, sessionId: 'wk_ses_1', audienceRequestId: AR, surveyId: 'wk', panelistId: p.id, status: 'complete', rewardEntryId: e.id, endedAt: new Date() } });
    const r = await as('panel_manager').get('/supply/weekly-programme');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const w = r.body.find((x: { data: { week: string } }) => x.data.week === '2030-W02');
    assert.equal(w.invites, 3);
    assert.equal(w.completes, 1);
    assert.equal(w.cost, 0.5);
  });

  it('returns fact rows per panel, country and ISO week from recorded activity', async () => {
    const r = await as('executive').get('/supply/facts?weeks=4');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.weeks.length, 4);
    assert.equal(r.body.weeks[3], isoWeekOf(new Date()));
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId } });
    const short = { turn2opinion: 'T2O', myfrequentrewards: 'MFR', myhealthopinions: 'MHO' }[p.brand];
    const row = r.body.facts.find((f: { panel: string; country: string; week: string }) => f.panel === short && f.country === p.country && f.week === isoWeekOf(new Date()));
    assert.ok(row, 'this week has a row for the test panellist');
    assert.ok(row.invites >= 3 && row.completes >= 1 && row.starts >= 1 && row.points >= 50);
    assert.equal((await as('vendor').get('/supply/facts')).status, 403);
  });

  it('works out ISO weeks the way Postgres does', () => {
    assert.equal(isoWeekOf(new Date('2026-01-01T12:00:00Z')), '2026-W01');
    assert.equal(isoWeekOf(new Date('2027-01-01T12:00:00Z')), '2026-W53');
    assert.equal(isoWeekOf(new Date('2026-11-06T12:00:00Z')), '2026-W45');
  });
});

describe('quota cells closed early', () => {
  it('closes and reopens a cell with a reason, audited, for project roles that can write', async () => {
    const c = await h.db.quotaCell.findFirstOrThrow({ where: { tenantId } });
    assert.equal((await as('executive').post(`/supply/quotas/${c.id}/close`, { reason: 'Client asked' })).status, 403);
    assert.equal((await as('project_manager').post(`/supply/quotas/${c.id}/close`, {})).status, 400, 'a reason is required');
    const r = await as('project_manager').post(`/supply/quotas/${c.id}/close`, { reason: 'Client asked to stop this cell' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.closedAt);
    assert.equal((await as('project_manager').post(`/supply/quotas/${c.id}/close`, { reason: 'again please' })).status, 400);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { entity: 'QuotaCell', entityId: c.id, action: 'quota.closed' } });
    assert.equal((audit.after as { reason: string }).reason, 'Client asked to stop this cell');
    const o = await as('project_manager').post(`/supply/quotas/${c.id}/reopen`);
    assert.equal(o.status, 200);
    assert.equal(o.body.closedAt, null);
  });
});
