/**
 * SUPPLY360 eligibility & delivery API for SAMPLEON (docs/integrations/SAMPLEON.md): signatures,
 * eligible vs reachable counts, missing profile data, health consent, fatigue and exclusions,
 * survey cards, the panel card feed, participation and rewards from SAMPLEON events, and the
 * signed reward confirmation sent back to SAMPLEON.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeEvent, signRequest, verifyRequest, type EventEnvelope } from '@sampledge/contracts';
import { as, h, setup, teardown } from './harness';

const SECRET = 'sampleon-test-secret';
const PANEL_SECRET = 'mho-cards-secret';
process.env.SAMPLEON_SECRET = SECRET;
process.env.PANEL_CARDS_SECRET_MHO = PANEL_SECRET;
process.env.PANEL_CARDS_SECRET_T2O = 't2o-cards-secret';

let tenantId = '';
const received: EventEnvelope[] = [];
let sampleon: Server;
const AR = 'AR-01JC9Y3V8Q6K2N4R7T0W5X1Z3A';

async function signed(method: string, path: string, body?: unknown, client = 'sampleon', secret = SECRET) {
  const full = `/api/v1/s2s/supply${path}`;
  const text = body === undefined ? '' : JSON.stringify(body);
  const r = await fetch(h.url + full, { method, body: text || undefined, headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...signRequest({ clientId: client, secret, method, path: full, body: text }) } });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

const cardio5 = [{ attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] }, { attribute: 'b2b.years_experience', op: 'gte', value: 5 }];

before(async () => {
  await setup();
  sampleon = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const v = verifyRequest({ headers: req.headers, method: req.method!, path: req.url!, body: b, secretsFor: (id) => (id === 'supply360' ? [SECRET] : []) });
      if (!v.ok) { res.writeHead(401).end(); return; }
      received.push(JSON.parse(b)); res.writeHead(200).end('{}');
    });
  });
  await new Promise<void>((r) => sampleon.listen(0, '127.0.0.1', () => r()));
  process.env.SAMPLEON_URL = `http://127.0.0.1:${(sampleon.address() as AddressInfo).port}`;

  tenantId = (await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  const now = new Date();
  const mk = async (id: string, brand: string, segment: string, status: string, attrs: Record<string, string | number | boolean>, consents: [string, boolean][]) => {
    await h.db.panelist.create({ data: { id, tenantId, brand, handle: id.toUpperCase(), country: 'IS', ageBand: '35-44', gender: 'female', segment, status, qualityScore: 0.9, profileCompletion: 0.8, lastActiveAt: now } });
    for (const [k, v] of Object.entries(attrs)) await h.db.panelistAttribute.create({ data: { tenantId, panelistId: id, key: k, ...(typeof v === 'number' ? { valueNum: v } : typeof v === 'boolean' ? { valueBool: v } : { valueText: v }) } });
    for (const [i, [purpose, granted]] of consents.entries()) await h.db.consent.create({ data: { panelistId: id, purpose, granted, at: new Date(now.getTime() - (consents.length - i) * 1000) } });
  };
  const research: [string, boolean][] = [['research_participation', true]];
  await mk('is-1', 'myhealthopinions', 'hcp', 'active', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 10 }, research);
  await mk('is-2', 'myhealthopinions', 'hcp', 'active', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 3 }, research);
  await mk('is-3', 'myhealthopinions', 'hcp', 'active', { 'hcp.specialty': 'cardiology' }, research);
  await mk('is-4', 'myhealthopinions', 'hcp', 'active', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 12 }, [['research_participation', true], ['research_participation', false]]);
  await mk('is-5', 'turn2opinion', 'consumer', 'active', {}, research);
  await mk('is-6', 'myhealthopinions', 'hcp', 'dormant', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 8 }, research);
  await mk('is-7', 'myhealthopinions', 'patient', 'active', { 'health.diabetes': true }, research);
  await mk('is-8', 'myhealthopinions', 'patient', 'active', { 'health.diabetes': true }, [['research_participation', true], ['health_data', true]]);
});
after(async () => { sampleon?.close(); await teardown(); });

describe('SUPPLY360 eligibility & delivery API for SAMPLEON', () => {
  it('refuses unsigned, wrongly signed and panel-signed eligibility calls', async () => {
    assert.equal((await fetch(`${h.url}/api/v1/s2s/supply/attributes`)).status, 401);
    assert.equal((await signed('GET', '/attributes', undefined, 'sampleon', 'wrong')).status, 401);
    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS' }, 'mho', PANEL_SECRET)).status, 401);
    const cat = await signed('GET', '/attributes');
    assert.equal(cat.status, 200);
    assert.ok(cat.body.attributes.some((a: { key: string; sensitivity: string }) => a.key === 'health.diabetes' && a.sensitivity === 'health'));
  });

  it('counts eligible and reachable respondents and reports missing profile data', async () => {
    const r = await signed('POST', '/eligibility/count', { country: 'IS', criteria: cardio5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.eligible, 3);    // is-1, is-4 (consent withdrawn) and is-6 (dormant)
    assert.equal(r.body.reachable, 1);   // only is-1
    assert.deepEqual(r.body.missingProfile, { 'b2b.years_experience': 1 }); // is-3
    assert.deepEqual(r.body.byPanel, { mho: { eligible: 3, reachable: 1 } });
    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS', criteria: [{ attribute: 'made.up', op: 'exists' }] })).status, 400);
  });

  it('health attributes only count for panelists with health-data consent', async () => {
    const r = await signed('POST', '/eligibility/count', { country: 'IS', criteria: [{ attribute: 'health.diabetes', op: 'eq', value: true }] });
    assert.equal(r.body.eligible, 1);
    assert.equal(r.body.reachable, 1);
    const sel = await signed('POST', '/eligibility/select', { country: 'IS', criteria: [{ attribute: 'health.diabetes', op: 'eq', value: true }], limit: 10 });
    assert.deepEqual(sel.body.respondents.map((x: { respondentRef: string }) => x.respondentRef), ['is-8']);
  });

  it('checks one respondent, including quota membership and consent', async () => {
    const ok = await signed('POST', '/eligibility/check', { respondentRef: 'is-1', criteria: cardio5, quotas: [{ id: 'women', conditions: [{ attribute: 'demo.gender', op: 'eq', value: 'female' }] }, { id: 'men', conditions: [{ attribute: 'demo.gender', op: 'eq', value: 'male' }] }] });
    assert.deepEqual(ok.body, { eligible: true, reasons: [], quotaIds: ['women'], country: 'IS', consented: true });
    const withdrawn = await signed('POST', '/eligibility/check', { respondentRef: 'is-4', criteria: cardio5 });
    assert.equal(withdrawn.body.eligible, false);
    assert.equal(withdrawn.body.consented, false);
  });

  it('delivers survey cards with consent only, then excludes and caps invited respondents', async () => {
    const items = ['is-1', 'is-4'].map((ref, i) => ({ invitationId: `inv_t${i}`, respondentRef: ref, panel: 'mho', cardUrl: `https://sampleon.example/go/tok${i}`, title: 'Cardiology study', loiMinutes: 15, rewardPoints: 500, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), channels: ['card', 'email'] }));
    const d = await signed('POST', '/deliveries', { audienceRequestId: AR, surveyId: 'zsv_cardio', items });
    assert.deepEqual(d.body.results, [{ invitationId: 'inv_t0', status: 'delivered' }, { invitationId: 'inv_t1', status: 'suppressed', reason: 'no research consent' }]);
    assert.equal((await signed('POST', '/deliveries', { audienceRequestId: AR, surveyId: 'zsv_cardio', items: items.slice(0, 1) })).body.results[0].status, 'delivered', 'replay is harmless');
    assert.equal(await h.db.surveyCard.count({ where: { audienceRequestId: AR } }), 1);
    const msg = await h.db.message.findFirstOrThrow({ where: { relatedId: AR } });
    assert.equal(msg.recipients, 1);
    assert.equal(msg.audience, 'panel');

    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS', criteria: cardio5, exclude: { audienceRequestIds: [AR] } })).body.reachable, 0);
    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS', criteria: cardio5, exclude: { surveyIds: ['zsv_cardio'] } })).body.reachable, 0);
    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS', criteria: cardio5, fatigue: { maxInvites: 1, windowDays: 7 } })).body.reachable, 0);
    assert.equal((await signed('POST', '/eligibility/count', { country: 'IS', criteria: cardio5, fatigue: { maxInvites: 2, windowDays: 7 } })).body.reachable, 1);
  });

  it('serves the card feed to the panel website that owns it', async () => {
    const mine = await signed('GET', '/panel/mho/cards?respondentRef=is-1', undefined, 'mho', PANEL_SECRET);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.cards.map((c: { id: string; url: string }) => [c.id, c.url]), [['inv_t0', 'https://sampleon.example/go/tok0']]);
    assert.equal((await signed('GET', '/panel/mho/cards?respondentRef=is-1', undefined, 't2o', 't2o-cards-secret')).status, 403);
  });

  it('records participation and rewards from SAMPLEON events once, and confirms the reward back to SAMPLEON', async () => {
    const subject = { sourcePlatform: 'PROJEXA' as const, sourceProjectId: 'PRJ-1045', surveyId: 'zsv_cardio' };
    const started = makeEvent({ type: 'survey.started', source: 'SAMPLEON', correlationId: AR, subject, payload: { sessionId: 'ses_1', country: 'IS', respondentRef: 'is-1', panel: 'mho' } });
    assert.equal((await signed('POST', '/events', started)).body.status, 'processed');
    assert.equal((await signed('POST', '/events', started)).body.status, 'duplicate');
    const before = await h.db.panelist.findUniqueOrThrow({ where: { id: 'is-1' } });
    const done = makeEvent({ type: 'survey.completed', source: 'SAMPLEON', correlationId: AR, subject, payload: { sessionId: 'ses_1', country: 'IS', respondentRef: 'is-1', panel: 'mho', loiMinutes: 14, rewardPoints: 500, verified: true, progress: { required: 10, completes: 1, remaining: 9 } } });
    assert.equal((await signed('POST', '/events', done)).body.status, 'processed');
    const afterDone = await h.db.panelist.findUniqueOrThrow({ where: { id: 'is-1' } });
    assert.equal(afterDone.points, before.points + 500);
    assert.equal(afterDone.surveysCompleted, before.surveysCompleted + 1);
    const part = await h.db.participation.findUniqueOrThrow({ where: { sessionId: 'ses_1' } });
    assert.equal(part.status, 'complete');
    assert.ok(part.rewardEntryId);
    assert.equal((await h.db.surveyCard.findUniqueOrThrow({ where: { id: 'inv_t0' } })).status, 'completed');

    await h.drain();
    const conf = received.find((e) => e.type === 'reward.eligibility_confirmed')!;
    assert.ok(conf, 'SAMPLEON received the signed reward confirmation');
    assert.equal(conf.source, 'SUPPLY360');
    assert.equal(conf.correlationId, AR);
    assert.deepEqual(conf.payload, { sessionId: 'ses_1', respondentRef: 'is-1', points: 500, ledgerEntryId: part.rewardEntryId });

    // The host later rejects the complete: the reward is reversed and account quality drops.
    const qf = makeEvent({ type: 'quality.failed', source: 'SAMPLEON', correlationId: AR, subject, payload: { sessionId: 'ses_1', country: 'IS', respondentRef: 'is-1', panel: 'mho', reason: 'speeding' } });
    assert.equal((await signed('POST', '/events', qf)).body.status, 'processed');
    const afterQf = await h.db.panelist.findUniqueOrThrow({ where: { id: 'is-1' } });
    assert.equal(afterQf.points, before.points);
    assert.ok(afterQf.qualityScore < afterDone.qualityScore);
    assert.equal(await h.db.incentiveEntry.count({ where: { panelistId: 'is-1', kind: 'adjust', points: -500 } }), 1);
  });

  it('withdraws open cards when SAMPLEON closes the request, and keeps other workspaces out', async () => {
    const items = [{ invitationId: 'inv_t9', respondentRef: 'is-8', panel: 'mho', cardUrl: 'https://sampleon.example/go/tok9', title: 'Diabetes study', loiMinutes: 10, rewardPoints: 300, expiresAt: new Date(Date.now() + 86400_000).toISOString(), channels: ['card'] }];
    await signed('POST', '/deliveries', { audienceRequestId: 'AR-01JC9Y3V8Q6K2N4R7T0W5X1Z3B', surveyId: 'zsv_dia', items });
    const closed = makeEvent({ type: 'project.closed', source: 'SAMPLEON', correlationId: 'AR-01JC9Y3V8Q6K2N4R7T0W5X1Z3B', payload: { reason: 'target reached' } });
    assert.equal((await signed('POST', '/events', closed)).body.status, 'processed');
    assert.equal((await h.db.surveyCard.findUniqueOrThrow({ where: { id: 'inv_t9' } })).status, 'withdrawn');
    assert.equal((await signed('GET', '/panel/mho/cards?respondentRef=is-8', undefined, 'mho', PANEL_SECRET)).body.cards.length, 0);
    assert.equal((await signed('POST', '/events', { ...closed, eventId: crypto.randomUUID(), source: 'PROJEXA' })).status, 403);

    const mine = await as('panel_manager').get('/panels/sampleon/overview');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.cards.withdrawn >= 1);
    const other = await as('iso').get('/panels/sampleon/overview');
    assert.deepEqual(other.body.cards, {});
  });
});
