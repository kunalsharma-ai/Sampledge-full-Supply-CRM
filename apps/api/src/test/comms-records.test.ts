/**
 * E-mail campaigns and newsletter issues (SUPPLY360 records of the communications module): their
 * send goes through the Comms Hub with consent filtering and the high-volume approval, scheduled
 * ones are sent by the scheduler, and lifecycle journeys are counted from recorded activity.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { SupplyRecordsService } from '../modules/supply-records';
import { renderBlocks } from '../modules/supply-kinds';

before(setup);
after(teardown);

const blocks = [
  { id: 'b1', kind: 'heading', text: 'New surveys for you, {{first_name}}' },
  { id: 'b2', kind: 'text', text: 'Three surveys picked for {{panel_name}} members.' },
  { id: 'b3', kind: 'button', text: 'See my surveys' },
  { id: 'b4', kind: 'text', text: 'Change what we send you in your email settings.' },
];
const soon = () => new Date(Date.now() + 3600_000).toISOString();

describe('e-mail campaigns', () => {
  it('checks the content before sending, then queues one consent-filtered message linked to the campaign', async () => {
    const c = await as('panel_manager').post('/supply/records/campaign', { data: { name: 'Weekly picks', brand: 'myhealthopinions', segment: 'active', subjectA: 'New surveys for you', blocks: blocks.slice(0, 2) } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.match(c.body.ref, /^EM-/);
    const bad = await as('panel_manager').post(`/supply/records/campaign/${c.body.id}/send`, { version: c.body.version });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /button/);
    assert.match(bad.body.message, /unsubscribe/);
    const u = await as('panel_manager').patch(`/supply/records/campaign/${c.body.id}`, { data: { blocks, subjectB: 'Or this one' }, version: c.body.version });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const ab = await as('panel_manager').post(`/supply/records/campaign/${c.body.id}/send`, { version: u.body.version });
    assert.equal(ab.status, 400, 'A/B tests are refused by the live sender');
    assert.match(ab.body.message, /subject B/);
    const v = (await as('panel_manager').patch(`/supply/records/campaign/${c.body.id}`, { data: { subjectB: '' }, version: u.body.version })).body;
    const s = await as('panel_manager').post(`/supply/records/campaign/${c.body.id}/send`, { version: v.version });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.status, 'sent');
    const m = await h.db.message.findUniqueOrThrow({ where: { id: s.body.data.messageId } });
    assert.equal(m.toRef, 'panel:myhealthopinions:active');
    assert.equal(m.relatedId, c.body.id);
    assert.equal(m.recipients, s.body.data.recipients);
    assert.equal(m.status, s.body.data.needsApproval ? 'pending_approval' : 'queued');
    assert.match(m.body, /New surveys for you, there/);
    assert.match(m.body, /MyHealthOpinions members/);
    assert.equal((await as('panel_manager').patch(`/supply/records/campaign/${c.body.id}`, { data: { name: 'x y' }, version: s.body.version })).status, 400, 'a sent campaign is locked');
  });

  it('renders blocks to text without names', () => {
    assert.equal(renderBlocks([{ id: 'a', kind: 'image', text: 'pic' }, { id: 'b', kind: 'button', text: 'Go' }, { id: 'c', kind: 'divider', text: '' }], 'turn2opinion'), '[Go]\n\n---');
  });

  it('schedules for a future time, and the scheduler sends it or marks it failed with the reason', async () => {
    const mk = async (b: unknown[]) => (await as('panel_manager').post('/supply/records/campaign', { data: { name: 'Later', brand: 'turn2opinion', subjectA: 'Your weekly picks', blocks: b } })).body;
    const a = await mk(blocks);
    const past = await as('panel_manager').post(`/supply/records/campaign/${a.id}/schedule`, { version: a.version, sendAt: '2020-01-01T00:00:00Z' });
    assert.equal(past.status, 400);
    const sa = await as('panel_manager').post(`/supply/records/campaign/${a.id}/schedule`, { version: a.version, sendAt: soon() });
    assert.equal(sa.status, 200, JSON.stringify(sa.body));
    assert.equal(sa.body.status, 'scheduled');
    const b = await mk(blocks.slice(0, 1));
    assert.equal((await as('panel_manager').post(`/supply/records/campaign/${b.id}/schedule`, { version: b.version, sendAt: soon() })).status, 200);
    const svc = h.app.get(SupplyRecordsService);
    assert.equal(await svc.runDue(new Date()), 0, 'nothing is due yet');
    assert.equal(await svc.runDue(new Date(Date.now() + 2 * 3600_000)), 1);
    const ra = await h.db.supplyRecord.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(ra.status, 'sent');
    assert.ok((ra.data as { messageId?: string }).messageId);
    const rb = await h.db.supplyRecord.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(rb.status, 'failed');
    assert.match(String((rb.data as { error?: string }).error), /button/);
    const audit = await h.db.auditLog.findMany({ where: { entity: 'SupplyRecord', entityId: { in: [a.id, b.id] } } });
    assert.ok(audit.some((x) => x.action === 'campaign.send'));
    assert.ok(audit.some((x) => x.action === 'campaign.failed'));
    const fixed = await as('panel_manager').patch(`/supply/records/campaign/${b.id}`, { data: { blocks }, version: rb.version });
    assert.equal(fixed.status, 200, 'a failed campaign can be fixed and sent again');
  });
});

describe('newsletter issues', () => {
  it('moves draft → review → scheduled → sent, and sends to the whole consented panel', async () => {
    const n = await as('panel_manager').post('/supply/records/newsletter', { data: { title: 'November at MyFrequentRewards', brand: 'myfrequentrewards' } });
    assert.equal(n.status, 201, JSON.stringify(n.body));
    assert.equal((await as('panel_manager').post(`/supply/records/newsletter/${n.body.id}/submit`, { version: n.body.version })).status, 400, 'needs a story');
    const e = await as('panel_manager').patch(`/supply/records/newsletter/${n.body.id}`, { data: { stories: ['Gift card catalogue refresh', 'Tier upgrades explained'] }, version: n.body.version });
    const r = await as('panel_manager').post(`/supply/records/newsletter/${n.body.id}/submit`, { version: e.body.version });
    assert.equal(r.body.status, 'review');
    const s = await as('panel_manager').post(`/supply/records/newsletter/${n.body.id}/schedule`, { version: r.body.version, sendAt: soon() });
    assert.equal(s.body.status, 'scheduled');
    const sent = await as('panel_manager').post(`/supply/records/newsletter/${n.body.id}/send`, { version: s.body.version });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const m = await h.db.message.findUniqueOrThrow({ where: { id: sent.body.data.messageId } });
    assert.equal(m.toRef, 'panel:myfrequentrewards:all');
    assert.match(m.body, /• Gift card catalogue refresh/);
    assert.match(m.body, /email settings/);
  });

  it('keeps vendors out', async () => {
    assert.equal((await as('vendor').get('/supply/records/newsletter')).status, 403);
  });
});

describe('lifecycle journeys', () => {
  it('counts the recorded stages per panel for a joining cohort', async () => {
    const r = await as('panel_manager').get('/supply/journeys?days=730');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.stages, ['Registered', 'Profiled', 'First survey', 'Active', 'Loyal']);
    assert.deepEqual(r.body.notTracked, ['Visitor', 'Verified']);
    const tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
    const total = await h.db.panelist.count({ where: { tenantId, status: { not: 'deletion_requested' }, joinedAt: { gte: new Date(Date.now() - 730 * 86400_000) } } });
    const sum = (['t2o', 'mfr', 'mho'] as const).reduce((a, p) => a + r.body.counts[p][0], 0);
    assert.equal(sum, total);
    for (const p of ['t2o', 'mfr', 'mho']) {
      const c: number[] = r.body.counts[p];
      assert.ok(c[1] <= c[0] && c[4] <= c[2], `stages narrow for ${p}`);
    }
    assert.equal((await as('vendor').get('/supply/journeys')).status, 403);
  });
});
