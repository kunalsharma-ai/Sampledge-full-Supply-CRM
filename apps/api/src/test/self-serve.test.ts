/**
 * Client self-service launch: a client builds a study and questionnaire, accepts a firm price and
 * submits; nothing is published or bought until the research team approves the launch. Approval
 * publishes the submitted version, approves the supplier allocations (POs follow) and records a won
 * opportunity; respondents then flow into per-market quotas. Clients never see suppliers or costs.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, setup, teardown } from './harness';
import { splitCompletes, withMarkets } from '../modules/self-serve';

before(setup);
after(teardown);

const spec = { title: 'Oat milk concept test', objective: 'Which of two concepts should we take to market next spring?', audience: 'B2C', countries: ['US', 'GB'], sampleSize: 101, incidence: 0.5, loi: 5, fieldDays: 10 };

/** The client's questionnaire: the market screener is added by the platform. */
const questionnaire = (id: string) => ({
  id, name: spec.title, version: 1, rules: [], quotas: [{ id: 'Q_SNEAKY', label: 'Extra', when: { q: 'Q1', op: 'answered' }, target: 9999, count: 0 }],
  questions: [
    { id: 'Q1', type: 'single', text: 'Which concept do you prefer?', required: true, options: [{ code: 'A', label: 'Concept A' }, { code: 'B', label: 'Concept B' }] },
    { id: 'Q2', type: 'rating', text: 'How likely are you to buy it?', min: 1, max: 5, required: true },
  ],
});

/** Plays one live interview to the end. */
async function interview(surveyId: string, country: string, allocation?: string) {
  const s = await call('POST', `/r/${surveyId}/start`, { respondent: `t-${Math.random()}`, ...(allocation ? { allocation } : {}) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  let r = s.body;
  const ans: Record<string, unknown> = { COUNTRY: country, Q1: 'A', Q2: 4 };
  while (!r.outcome && r.question) {
    const q = r.question.id as string;
    const next = await call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: q, value: ans[q] });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    r = next.body;
  }
  return r.outcome as string;
}

describe('client self-service launch', () => {
  let id = '';
  let surveyId = '';
  let projectId = '';

  it('splits completes exactly and keeps the market screener and quotas in line', () => {
    assert.deepEqual(splitCompletes(101, 2), [51, 50]);
    const def = withMarkets({ id: 'x', name: 'x', version: 1, rules: [], quotas: [], questions: [{ id: 'Q1', type: 'text', text: 'Hi' }] }, { audience: 'B2C', countries: ['US', 'DE'], sampleSize: 10, incidence: 0.5, loi: 5, fieldDays: 7 });
    assert.equal(def.questions[0].id, 'COUNTRY');
    assert.deepEqual(def.questions[0].options!.map((o) => o.code), ['US', 'DE', 'OTHER']);
    assert.deepEqual(def.quotas.map((q) => [q.id, q.target]), [['M_US', 5], ['M_DE', 5]]);
    assert.equal(def.rules[0].id, 'R_MARKET');
  });

  it('only client users create studies, and get a project, survey and market quotas', async () => {
    assert.equal((await as('project_manager').post('/diy/studies', spec)).status, 403);
    const r = await as('client').post('/diy/studies', spec);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.id; surveyId = r.body.surveyId; projectId = r.body.projectId;
    assert.equal(r.body.status, 'draft');
    assert.equal(r.body.project.stage, 'Survey Programming');
    assert.deepEqual(r.body.markets.map((m: { country: string; target: number }) => [m.country, m.target]), [['GB', 50], ['US', 51]]);
    assert.equal(r.body.definition.questions[0].id, 'COUNTRY');
    assert.ok(!('costCpi' in r.body), 'clients never see cost');
    const p = await h.db.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(p.clientId, 'cl-01');
  });

  it('saves the client questionnaire as a new version, discarding client-made quotas', async () => {
    const r = await as('client').put(`/diy/studies/${id}/questionnaire`, { definition: questionnaire(surveyId), label: 'Concepts', baseVersion: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.survey.version, 2);
    assert.deepEqual(r.body.definition.questions.map((q: { id: string }) => q.id), ['COUNTRY', 'Q1', 'Q2']);
    assert.deepEqual(r.body.definition.quotas.map((q: { id: string }) => q.id), ['M_US', 'M_GB']);
    const stale = await as('client').put(`/diy/studies/${id}/questionnaire`, { definition: questionnaire(surveyId), baseVersion: 1 });
    assert.equal(stale.status, 400, 'a stale base version is refused');
  });

  it('refuses a launch while the questionnaire is too long for the paid interview length', async () => {
    const long = questionnaire(surveyId);
    for (let i = 3; i <= 40; i++) long.questions.push({ id: `Q${i}`, type: 'rating', text: `Item ${i}`, min: 1, max: 5, required: true });
    await as('client').put(`/diy/studies/${id}/questionnaire`, { definition: long });
    const qa = await as('client').post(`/diy/studies/${id}/qa`);
    assert.equal(qa.body.lengthOk, false);
    const price = (await as('client').get(`/diy/studies/${id}/price`)).body;
    const r = await as('client').post(`/diy/studies/${id}/submit`, { acceptedTotal: price.priceTotal });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /minutes/);
    await as('client').put(`/diy/studies/${id}/questionnaire`, { definition: questionnaire(surveyId) });
  });

  it('refuses a price the client did not see', async () => {
    const price = (await as('client').get(`/diy/studies/${id}/price`)).body;
    assert.ok(price.priceTotal > 0 && price.priceCpi > 0);
    assert.ok(!('lines' in price.markets[0]), 'no supplier lines in the client price');
    const r = await as('client').post(`/diy/studies/${id}/submit`, { acceptedTotal: price.priceTotal + 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.priceTotal, price.priceTotal);
  });

  let approvalId = '';
  it('submits for a launch approval: nothing is published or bought yet', async () => {
    const price = (await as('client').get(`/diy/studies/${id}/price`)).body;
    const r = await as('client').post(`/diy/studies/${id}/submit`, { acceptedTotal: price.priceTotal });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'submitted');
    assert.equal(r.body.priceTotal, price.priceTotal);
    approvalId = r.body.approvalId;
    const a = await h.db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    assert.equal(a.kind, 'Launching client studies');
    assert.equal(a.status, 'pending');
    const allocs = await h.db.allocation.findMany({ where: { projectId } });
    assert.ok(allocs.length >= 2 && allocs.every((x) => x.status === 'proposed' && x.approvalId === approvalId));
    assert.equal(allocs.reduce((s, x) => s + x.completes, 0), spec.sampleSize);
    assert.equal((await h.db.survey.findUniqueOrThrow({ where: { id: surveyId } })).status, 'In QA');
    // Not live: anonymous respondents are turned away.
    assert.equal((await call("POST", `/r/${surveyId}/start`, {})).status, 403);
    // Locked while waiting.
    assert.equal((await as('client').put(`/diy/studies/${id}/questionnaire`, { definition: questionnaire(surveyId) })).status, 400);
  });

  it('shows the client its request without the cost, suppliers or allocations', async () => {
    const list = (await as('client').get('/approvals?status=pending')).body as { id: string; amount: number | null; payload: Record<string, unknown>; canDecide: boolean }[];
    const mine = list.find((x) => x.id === approvalId)!;
    assert.ok(mine, 'the client sees its own launch request');
    assert.equal(mine.amount, null);
    assert.equal(mine.canDecide, false);
    assert.ok(!('allocationIds' in mine.payload));
    const proj = (await as('client').get(`/projects/${projectId}`)).body;
    assert.deepEqual(proj.allocations, []);
    assert.ok(!('cpiCost' in proj));
    await h.drain();
    const n = await h.db.notification.findFirst({ where: { title: { startsWith: 'Self-service launch from' } }, orderBy: { createdAt: 'desc' } });
    assert.ok(n?.roles.includes('project_manager'));
  });

  it('can be withdrawn by the client and resubmitted', async () => {
    const w = await as('client').post(`/diy/studies/${id}/withdraw`);
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.status, 'draft');
    assert.equal((await h.db.approval.findUniqueOrThrow({ where: { id: approvalId } })).status, 'withdrawn');
    assert.ok((await h.db.allocation.findMany({ where: { approvalId } })).every((a) => a.status === 'closed'));
    const price = (await as('client').get(`/diy/studies/${id}/price`)).body;
    const r = await as('client').post(`/diy/studies/${id}/submit`, { acceptedTotal: price.priceTotal });
    assert.equal(r.status, 200);
    approvalId = r.body.approvalId;
  });

  it('a rejection returns the study to the client with the reason, and nothing is bought', async () => {
    assert.equal((await as('client').post(`/approvals/${approvalId}/decision`, { decision: 'approved' })).status, 403, 'clients cannot launch their own study');
    assert.equal((await as('survey_programmer').post(`/approvals/${approvalId}/decision`, { decision: 'approved' })).status, 403, 'needs purchase approval');
    const d = await as('project_manager').post(`/approvals/${approvalId}/decision`, { decision: 'rejected', note: 'Concept B needs an image before launch' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    await h.drain();
    const s = (await as('client').get(`/diy/studies/${id}`)).body;
    assert.equal(s.status, 'rejected');
    assert.equal(s.decisionNote, 'Concept B needs an image before launch');
    assert.equal(await h.db.purchaseOrder.count({ where: { projectId } }), 0);
    const m = await h.db.message.findFirst({ where: { relatedType: 'SelfServeDecision', relatedId: approvalId } });
    assert.equal(m?.toRef, 'client:cl-01');
    assert.match(m!.body, /image before launch/);
  });

  it('approval launches the submitted version: survey live, allocations approved, POs raised, opportunity won', async () => {
    const price = (await as('client').get(`/diy/studies/${id}/price`)).body;
    const sub = await as('client').post(`/diy/studies/${id}/submit`, { acceptedTotal: price.priceTotal });
    assert.equal(sub.status, 200);
    approvalId = sub.body.approvalId;
    const d = await as('project_manager').post(`/approvals/${approvalId}/decision`, { decision: 'approved' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.match(d.body.effect, /Launched/);
    await h.drain();
    const s = (await as('client').get(`/diy/studies/${id}`)).body;
    assert.equal(s.status, 'live');
    assert.equal(s.survey.status, 'Published');
    assert.equal(s.project.stage, 'Full Launch');
    assert.equal(s.links.respondent, `/r/${surveyId}`);
    const allocs = await h.db.allocation.findMany({ where: { approvalId } });
    assert.ok(allocs.every((a) => a.status === 'approved'));
    assert.equal(await h.db.purchaseOrder.count({ where: { projectId } }), allocs.length);
    const o = await h.db.opportunity.findUniqueOrThrow({ where: { projectId } });
    assert.equal(o.stage, 'Won');
    assert.equal(o.channel, 'self_service');
    assert.equal(o.value, price.priceTotal);
  });

  it('counts live interviews into market quotas, screens out other countries, and is closed by the client', async () => {
    const alloc = (await h.db.allocation.findFirstOrThrow({ where: { approvalId, status: 'approved' } })).id;
    assert.equal(await interview(surveyId, 'US', alloc), 'complete');
    assert.equal(await interview(surveyId, 'GB'), 'complete');
    assert.equal(await interview(surveyId, 'OTHER'), 'screenout');
    const s = (await as('client').get(`/diy/studies/${id}`)).body;
    assert.deepEqual(Object.fromEntries(s.markets.map((m: { country: string; count: number }) => [m.country, m.count])), { GB: 1, US: 1 });
    assert.equal(s.project.completes, 2);
    const c = await as('client').post(`/diy/studies/${id}/close`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.status, 'closed');
    assert.equal(c.body.survey.status, 'Closed');
    assert.equal((await call("POST", `/r/${surveyId}/start`, {})).status, 403, 'closed to new respondents');
  });

  it('keeps other clients and tenants out', async () => {
    assert.equal((await as('iso').get(`/diy/studies/${id}`)).status, 404);
    const other = await h.db.selfServeStudy.update({ where: { id }, data: { clientId: 'cl-02' } });
    assert.equal((await as('client').get(`/diy/studies/${other.id}`)).status, 404);
    await h.db.selfServeStudy.update({ where: { id }, data: { clientId: 'cl-01' } });
    const internal = (await as('project_manager').get('/diy/studies')).body as { id: string; costCpi?: number }[];
    assert.ok(internal.find((x) => x.id === id)?.costCpi, 'the team sees cost');
  });
});
