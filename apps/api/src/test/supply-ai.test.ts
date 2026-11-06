/**
 * SUPPLY360 AI through the gateway (rule-based here, as in any workspace without a model): the
 * copilot counts its answers from the database, survey drafts carry reasons and wording checks, and
 * support drafts use the ticket and the member's ledger. Every call is logged as an AiCall.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { routeQuestion } from '../ai/supply-tasks';

let tenantId = '';
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

describe('copilot', () => {
  it('routes questions by keyword and keeps the conversation context', () => {
    assert.deepEqual(routeQuestion({ question: 'How many reachable cardiologists are there in Germany?', context: {} }), { intent: 'reachable', country: 'DE', panel: null, segment: 'hcp' });
    assert.equal(routeQuestion({ question: 'Which quotas are behind pace?', context: {} }).intent, 'quota_pace');
    assert.deepEqual(routeQuestion({ question: 'and on MyHealthOpinions?', context: { country: 'DE' } }), { intent: 'unknown', country: 'DE', panel: 'mho', segment: null });
    assert.equal(routeQuestion({ question: 'Win back dormant MFR members', context: {} }).panel, 'mfr');
  });

  it('answers with counts from the database and logs the call', async () => {
    const r = await as('platform_admin').post('/supply/ai/copilot', { question: 'How many members are reachable in the United States?' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ai.provider, 'rules');
    assert.equal(r.body.intent.country, 'US');
    const want = await h.db.panelist.count({ where: { tenantId, country: 'US', status: 'active', lastActiveAt: { gte: new Date(Date.now() - 30 * 86400_000) }, NOT: { consents: { some: { purpose: 'research_participation', granted: false } } } } });
    assert.equal(r.body.cards[0].value, want);
    assert.ok(r.body.context.some((c: { kind: string }) => c.kind === 'country'));
    assert.ok(await h.db.aiCall.findFirst({ where: { tenantId, task: 'copilot.intent' } }));
  });

  it('proposes a draft win-back campaign, never a send', async () => {
    const r = await as('platform_admin').post('/supply/ai/copilot', { question: 'Win back dormant MyFrequentRewards members' });
    const a = r.body.actions[0];
    assert.equal(a.create.kind, 'campaign');
    assert.equal(a.create.data.segment, 'dormant');
    const c = await as('platform_admin').post('/supply/records/campaign', { data: a.create.data });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.status, 'draft');
  });

  it('answers liability and unknown questions, and keeps roles without the command center out', async () => {
    const l = await as('executive').post('/supply/ai/copilot', { question: 'What is our reward liability?' });
    assert.equal(l.status, 200, 'read access can ask');
    assert.equal(l.body.cards[0].kind, 'bars');
    assert.equal((await as('executive').post('/supply/ai/copilot', { question: 'Tell me a joke' })).body.intent.intent, 'unknown');
    assert.equal((await as('panel_manager').post('/supply/ai/copilot', { question: 'liability' })).status, 403);
    assert.equal((await as('vendor').post('/supply/ai/copilot', { question: 'liability' })).status, 403);
  });
});

describe('survey drafting', () => {
  it('drafts questions with reasons, an attention check and wording checks', async () => {
    const r = await as('panel_manager').post('/supply/ai/survey-draft', { topic: 'electric cars', audience: 'consumer', goal: 'Size the market', length: 6 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.questions[0].id, 'Q1');
    assert.ok(r.body.questions.every((q: { rationale: string; flags: string[] }) => q.rationale && Array.isArray(q.flags)));
    assert.ok(r.body.questions.some((q: { text: string }) => /Somewhat agree/.test(q.text)));
    assert.equal((await as('panel_manager').post('/supply/ai/survey-draft', { topic: 'x', audience: 'consumer', length: 6 })).status, 400);
  });
});

describe('support drafts', () => {
  it('drafts from the ticket and offers goodwill for a survey that closed', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId, status: 'active' } });
    const t = (await as('panel_manager').post('/supply/records/ticket', { data: { subject: 'Survey closed before I finished', category: 'Survey issue', panelistId: p.id } })).body;
    await as('panel_manager').post(`/supply/records/ticket/${t.id}/member`, { version: t.version, text: 'It said the survey was full.' });
    const d = await as('panel_manager').post(`/supply/ai/tickets/${t.id}/draft`, {});
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.goodwill, 50);
    assert.equal(d.body.confidence, 'high');
    assert.match(d.body.reply, /quota/);
    assert.equal((await as('panel_manager').post('/supply/ai/tickets/nope/draft', {})).status, 404);
    const s = await as('panel_manager').get('/supply/ai/support/stats');
    assert.ok(s.body.drafts7d >= 1);
    assert.ok(s.body.awaitingReply >= 1);
  });
});
