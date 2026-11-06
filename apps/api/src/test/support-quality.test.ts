/**
 * Support tickets and quality cases (SUPPLY360 records of the panels module): replies reach the
 * member through the Comms Hub, goodwill points are a ledger adjustment, and deciding a quality
 * case suspends or reinstates the member, each change audited.
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

describe('support tickets', () => {
  it('opens a ticket for a member of this workspace only', async () => {
    const bad = await as('panel_manager').post('/supply/records/ticket', { data: { subject: 'Points missing', category: 'Rewards', panelistId: 'nope' } });
    assert.equal(bad.status, 400);
    assert.equal((await as('bizdev').get('/supply/records/ticket')).status, 403, 'roles without panels access');
  });

  it('logs the member, replies by e-mail, notes, grants goodwill and solves, all audited', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId, status: 'active' } });
    const t = await as('panel_manager').post('/supply/records/ticket', { data: { subject: 'Survey closed before I finished', category: 'Survey issue', priority: 'high', panelistId: p.id } });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.match(t.body.ref, /^TCK-/);
    assert.equal(t.body.status, 'new');
    let r = await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/member`, { version: t.body.version, text: 'It said the survey was full on the last page.' });
    assert.equal(r.body.status, 'open');
    assert.equal(r.body.data.messages[0].author, p.handle);
    assert.equal((await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/reply`, { version: r.body.version, text: '  ' })).status, 400);
    r = await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/reply`, { version: r.body.version, text: 'Sorry about that, we are checking.' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'waiting');
    const m = await h.db.message.findFirstOrThrow({ where: { tenantId, relatedId: t.body.id } });
    assert.equal(m.toRef, `panelist:${p.id}`);
    assert.equal(m.recipients, 1);
    assert.equal(m.status, 'queued');
    assert.match(m.subject, new RegExp(`\\[${t.body.ref}\\]`));
    r = await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/note`, { version: r.body.version, text: 'Quota was full at the time.' });
    assert.equal(r.body.status, 'waiting', 'a note keeps the status');
    const before = (await h.db.panelist.findUniqueOrThrow({ where: { id: p.id } })).points;
    assert.equal((await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/goodwill`, { version: r.body.version, points: 5000 })).status, 400, 'at most 500 points');
    r = await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/goodwill`, { version: r.body.version, points: 50 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: p.id } })).points, before + 50);
    const e = await h.db.incentiveEntry.findFirstOrThrow({ where: { tenantId, panelistId: p.id, kind: 'adjust', note: `Goodwill, support ticket ${t.body.ref}` } });
    assert.equal(e.points, 50);
    r = await as('panel_manager').post(`/supply/records/ticket/${t.body.id}/reply_solve`, { version: r.body.version, text: 'Added 50 points for your time.' });
    assert.equal(r.body.status, 'solved');
    assert.deepEqual(r.body.data.messages.map((x: { from: string }) => x.from), ['member', 'agent', 'note', 'note', 'agent']);
    const audit = (await h.db.auditLog.findMany({ where: { tenantId, OR: [{ entityId: t.body.id }, { entityId: e.id }] } })).map((a) => a.action);
    for (const a of ['ticket.created', 'ticket.member', 'ticket.reply', 'ticket.note', 'ticket.goodwill', 'incentive.adjust', 'ticket.reply_solve']) assert.ok(audit.includes(a), a);
    assert.equal((await as('executive').post(`/supply/records/ticket/${t.body.id}/reopen`, { version: r.body.version })).status, 403, 'read access cannot act');
  });
});

describe('quality cases', () => {
  it('summarises outcomes and backtests thresholds from recorded data', async () => {
    const r = await as('panel_manager').get('/supply/quality/summary');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.backtest.length, 11);
    assert.equal(r.body.bands.reduce((a: number, b: number) => a + b, 0), r.body.members);
    const counts = r.body.backtest.map((b: { flagged: number }) => b.flagged);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'stricter thresholds flag fewer members');
    assert.equal((await as('vendor').get('/supply/quality/summary')).status, 403);
  });

  it('opens cases by scan without duplicates, then suspends and reinstates the member', async () => {
    const s1 = await as('panel_manager').post('/supply/quality/scan', { threshold: 0.35 });
    assert.equal(s1.status, 200, JSON.stringify(s1.body));
    assert.ok(s1.body.opened > 0, 'the seed has members with low quality scores');
    const s2 = await as('panel_manager').post('/supply/quality/scan', { threshold: 0.35 });
    assert.equal(s2.body.opened, 0, 'members with an open case are skipped');
    assert.equal((await as('executive').post('/supply/quality/scan', { threshold: 0.35 })).status, 403);
    const list = await as('panel_manager').get('/supply/records/quality_case?status=open');
    const c = list.body[0];
    const p0 = await h.db.panelist.findUniqueOrThrow({ where: { id: c.data.panelistId } });
    assert.equal((await as('panel_manager').post(`/supply/records/quality_case/${c.id}/suspend`, { version: c.version })).status, 400, 'a reason is required');
    const s = await as('panel_manager').post(`/supply/records/quality_case/${c.id}/suspend`, { version: c.version, reason: 'Repeated speeding and duplicate device' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: p0.id } })).status, 'suspended');
    assert.equal(s.body.data.priorStatus, p0.status);
    const back = await as('panel_manager').post(`/supply/records/quality_case/${c.id}/reinstate`, { version: s.body.version, reason: 'Appeal accepted' });
    assert.equal(back.body.status, 'cleared');
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: p0.id } })).status, p0.status);
    const audit = (await h.db.auditLog.findMany({ where: { tenantId, entity: 'Panelist', entityId: p0.id } })).map((a) => a.action);
    assert.deepEqual(audit.filter((a) => a.startsWith('panelist.')), ['panelist.suspended', 'panelist.reinstated']);
  });
});
