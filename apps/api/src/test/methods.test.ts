/**
 * Advanced methods on fielded data: Van Westendorp, Gabor-Granger and TURF computed from a survey's
 * completed, non-rejected interviews using the questions the analyst maps.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gaborGranger, turf, vanWestendorp } from '@sampledge/core';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const SID = 'sv-methods-test';
const yesNo = [{ code: 'y', label: 'Yes' }, { code: 'n', label: 'No' }];
const def = {
  id: SID, name: 'Pricing test', version: 1, rules: [], quotas: [],
  questions: [
    { id: 'P1', type: 'numeric', text: 'Too cheap' }, { id: 'P2', type: 'numeric', text: 'Cheap' },
    { id: 'P3', type: 'numeric', text: 'Expensive' }, { id: 'P4', type: 'numeric', text: 'Too expensive' },
    { id: 'G10', type: 'single', text: 'Buy at $10?', options: yesNo }, { id: 'G20', type: 'single', text: 'Buy at $20?', options: yesNo },
    { id: 'T1', type: 'multi', text: 'Flavours', options: [{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }, { code: 'c', label: 'C' }, { code: 'x', label: 'None', exclusive: true }] },
  ],
};
const people = [
  { P1: 5, P2: 10, P3: 20, P4: 30, G10: 'y', G20: 'y', T1: ['a'] },
  { P1: 6, P2: 12, P3: 22, P4: 28, G10: 'y', G20: 'n', T1: ['b'] },
  { P1: 4, P2: 9, P3: 18, P4: 25, G10: 'y', G20: 'n', T1: ['a', 'c'] },
  { P1: 8, P2: 14, P3: 24, P4: 35, G10: 'n', G20: 'n', T1: ['x'] },
  { P1: 30, P2: 10, P3: 20, P4: 25, G10: 'y', G20: 'y', T1: ['c'] }, // out of order: VW excludes it
];

describe('methods on survey data', () => {
  before(async () => {
    const tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
    const p = await h.db.project.findFirstOrThrow({ where: { tenantId } });
    await h.db.survey.create({ data: { id: SID, tenantId, projectId: p.id, name: 'Pricing test', status: 'Published', programmer: 'test', hasDefinition: true, questionCount: def.questions.length, languages: ['en'] } });
    await h.db.surveyVersion.create({ data: { surveyId: SID, version: 1, definition: def, label: 'v1', createdBy: 'test' } });
    await h.db.response.createMany({ data: people.map((a, i) => ({ tenantId, surveyId: SID, version: 1, source: 'test', respondent: `m${i}`, answers: a, path: [], outcome: 'complete', completedAt: new Date() })) });
    // Not counted: a rejected complete and a screenout.
    await h.db.response.createMany({ data: [
      { tenantId, surveyId: SID, version: 1, source: 'test', respondent: 'rej', answers: { ...people[0], T1: ['b'] }, path: [], outcome: 'complete', rejectedAt: new Date() },
      { tenantId, surveyId: SID, version: 1, source: 'test', respondent: 'so', answers: { G10: 'y' }, path: [], outcome: 'screenout' },
    ] });
  });

  it('lists the questions each method can use', async () => {
    const r = await as('data_processing').get(`/surveys/${SID}/methods`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.base, 5);
    assert.deepEqual(r.body.numeric.map((q: { id: string }) => q.id), ['P1', 'P2', 'P3', 'P4']);
    assert.deepEqual(r.body.multi.map((q: { id: string }) => q.id), ['T1']);
  });

  it('Van Westendorp matches the engine on the recorded answers', async () => {
    const r = await as('data_processing').post(`/surveys/${SID}/methods`, { method: 'vw', tooCheap: 'P1', cheap: 'P2', expensive: 'P3', tooExpensive: 'P4' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const expect = vanWestendorp(people.map((p) => ({ tooCheap: p.P1, cheap: p.P2, expensive: p.P3, tooExpensive: p.P4 })), 120);
    assert.equal(r.body.result.n, 4);
    assert.equal(r.body.result.excluded, 1);
    assert.deepEqual(r.body.result.points, expect.points);
  });

  it('Gabor-Granger maps price points to yes answers', async () => {
    const r = await as('data_processing').post(`/surveys/${SID}/methods`, { method: 'gg', prices: [{ price: 10, questionId: 'G10', yes: ['y'] }, { price: 20, questionId: 'G20', yes: ['y'] }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.result.curve.map((c: { demand: number }) => c.demand), [0.8, 0.4]);
    const expect = gaborGranger([10, 20], people.map((p) => ({ 10: p.G10 === 'y', 20: p.G20 === 'y' })));
    assert.equal(r.body.result.revenueMaximisingPrice, expect.revenueMaximisingPrice);
  });

  it('TURF uses the multi-choice options as items (exclusive "none" left out)', async () => {
    const r = await as('data_processing').post(`/surveys/${SID}/methods`, { method: 'turf', questionId: 'T1', k: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const expect = turf(['A', 'B', 'C'], people.map((p) => ['a', 'b', 'c'].map((c) => p.T1.includes(c))), 2);
    assert.equal(r.body.result.reach, expect.reach);
    assert.equal(r.body.result.ladder.length, 2);
    assert.equal((await as('data_processing').post(`/surveys/${SID}/methods`, { method: 'turf', questionId: 'T1', k: 4 })).status, 400);
  });

  it('works on the seeded CX survey, and validates the mapping', async () => {
    const r = await as('executive').post('/surveys/sv-012/methods', { method: 'turf', questionId: 'Q3', k: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.base > 100);
    assert.equal((await as('executive').post('/surveys/sv-012/methods', { method: 'vw', tooCheap: 'Q4', cheap: 'Q4', expensive: 'Q4', tooExpensive: 'Q1' })).status, 400, 'Q1 is not numeric');
    assert.equal((await as('executive').post(`/surveys/${SID}/methods`, { method: 'gg', prices: [{ price: 10, questionId: 'G10', yes: ['y'] }, { price: 10, questionId: 'G20', yes: ['y'] }] })).status, 400);
    assert.equal((await as('executive').post(`/surveys/${SID}/methods`, { method: 'nope' })).status, 400);
    assert.equal((await as('vendor').get(`/surveys/${SID}/methods`)).status, 403);
    assert.equal((await as('iso').get(`/surveys/${SID}/methods`)).status, 404);
  });

  it('the survey list reports completion and logic complexity from records', async () => {
    const tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
    await h.db.response.create({ data: { tenantId, surveyId: SID, version: 1, source: 'test', respondent: 'ip', answers: {}, path: [] } });
    const row = ((await as('survey_programmer').get('/surveys')).body as { id: string; completionRate: number | null; complexity: number | null }[]).find((x) => x.id === SID)!;
    assert.equal(row.completionRate, 0.833, '5 completes of 6 qualified starts; screenout and rejected left out');
    assert.equal(row.complexity, 0, 'no display logic, rules or piping');
    const cx = ((await as('survey_programmer').get('/surveys')).body as { id: string; complexity: number | null; hasDefinition: boolean }[]);
    assert.ok(cx.filter((x) => !x.hasDefinition).every((x) => x.complexity === null));
    assert.ok((cx.find((x) => x.id === 'sv-cloud')?.complexity ?? 0) > 0);
  });

  it('logs programming time with an audit entry', async () => {
    const before = (await h.db.survey.findUniqueOrThrow({ where: { id: SID } })).hoursSpent;
    const r = await as('survey_programmer').post(`/surveys/${SID}/time`, { hours: 1.5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.hoursSpent, before + 1.5);
    assert.equal(await h.db.auditLog.count({ where: { action: 'survey.time_logged', entityId: SID } }), 1);
    assert.equal((await as('survey_programmer').post(`/surveys/${SID}/time`, { hours: 0.1 })).status, 400);
    assert.equal((await as('survey_programmer').post(`/surveys/${SID}/time`, { hours: 30 })).status, 400);
    assert.equal((await as('executive').post(`/surveys/${SID}/time`, { hours: 1 })).status, 403);
  });
});
