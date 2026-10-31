import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecodes, codeText, rake, suggestCodeframe, validateRecode, type Recode } from '../src/dp.ts';
import { surveyResults } from '../src/results.ts';
import { cxResponses, cxSurvey } from '../src/survey/demo-cx.ts';

const rows = cxResponses(600, 7).map((r, i) => ({ id: `r${i}`, answers: r.answers }));

describe('rim weighting', () => {
  const targets = { S1: { f: 0.51, m: 0.47, o: 0.02 }, S2: { a1: 0.3, a2: 0.35, a3: 0.35 } };
  const res = rake(rows, targets);
  it('converges to the targets on every variable', () => {
    assert.ok(res.converged, `max deviation ${res.maxDeviation}`);
    for (const [v, t] of Object.entries(targets)) for (const [c, share] of Object.entries(t)) assert.ok(Math.abs(res.achieved[v][c].weighted - share) < 0.002, `${v}=${c}`);
  });
  it('reports efficiency and keeps weights within the cap', () => {
    assert.ok(res.efficiency > 0.5 && res.efficiency < 1);
    assert.ok(res.maxWeight <= 5 && res.minWeight >= 0.2);
    assert.equal(Object.keys(res.weights).length, rows.length);
  });
  it('rejects targets that do not add up or cannot be reached', () => {
    assert.throws(() => rake(rows, { S1: { f: 0.5, m: 0.4 } }), /add up/);
    assert.throws(() => rake(rows.filter((r) => r.answers.S2 !== 'a3'), targets), /No respondents/);
  });
  it('moves weighted results toward the population', () => {
    const plain = surveyResults(cxSurvey.questions, rows);
    const weighted = surveyResults(cxSurvey.questions, rows.map((r) => ({ ...r, weight: res.weights[r.id] })));
    const share = (x: typeof plain, code: string) => (x.questions.find((q) => q.id === 'S2') as { rows: { code: string; pct: number }[] }).rows.find((r) => r.code === code)!.pct;
    assert.ok(share(plain, 'a3') < 0.25);
    assert.ok(Math.abs(share(weighted, 'a3') - 0.35) < 0.005);
    assert.ok(weighted.weighted && weighted.effectiveBase < weighted.base);
  });
});

describe('open-end coding', () => {
  const texts = rows.map((r) => String(r.answers.Q6));
  const frame = suggestCodeframe(texts, 8);
  it('suggests codes from frequent themes', () => {
    assert.ok(frame.length >= 5);
    assert.ok(frame.some((c) => c.keywords.some((k) => /coverage|price|service/.test(k))));
  });
  it('codes text by keyword and falls back to other', () => {
    const f = [{ code: 'PRICE', label: 'Price', keywords: ['price', 'expensive', 'fees'] }, { code: 'NET', label: 'Network', keywords: ['coverage', 'signal'] }];
    assert.deepEqual(codeText('Too expensive and the signal drops', f), ['PRICE', 'NET']);
    assert.deepEqual(codeText('Hidden fees', f), ['PRICE']);
    assert.deepEqual(codeText('The staff were lovely', f), ['other']);
    assert.deepEqual(codeText('', f), []);
  });
  it('tabulates coded answers', () => {
    const f = [{ code: 'PRICE', label: 'Price', keywords: ['price', 'expensive'] }];
    const coded = rows.map((r) => ({ ...r, codes: { Q6: codeText(String(r.answers.Q6), f) } }));
    const q6 = surveyResults(cxSurvey.questions, coded, undefined, { Q6: [...f, { code: 'other', label: 'Other' }] }).questions.find((q) => q.id === 'Q6') as { coded: { code: string; pct: number }[] };
    assert.ok(q6.coded.find((c) => c.code === 'PRICE')!.pct > 0.1);
  });
});

describe('recodes', () => {
  const top2: Recode = { id: 'R_Q2T2B', label: 'Satisfaction top-2 box', source: 'Q2', kind: 'group', groups: [{ code: 't2b', label: 'Satisfied (top 2)', from: ['5', '4'] }, { code: 'rest', label: 'Not satisfied', from: ['3', '2', '1'] }] };
  const spend: Recode = { id: 'R_SPEND', label: 'Monthly spend band', source: 'Q4', kind: 'bands', groups: [{ code: 'lo', label: 'Under $40', min: 0, max: 39.99 }, { code: 'mid', label: '$40-$59', min: 40, max: 59.99 }, { code: 'hi', label: '$60+', min: 60, max: 10000 }] };
  it('validates against the questionnaire', () => {
    validateRecode(cxSurvey.questions, top2);
    validateRecode(cxSurvey.questions, spend, [top2]);
    assert.throws(() => validateRecode(cxSurvey.questions, { ...top2, id: 'Q2' }), /start with R|already a question/);
    assert.throws(() => validateRecode(cxSurvey.questions, top2, [top2]), /already exists/);
    assert.throws(() => validateRecode(cxSurvey.questions, { ...top2, groups: [{ code: 'a', label: 'A', from: ['5'] }, { code: 'b', label: 'B', from: ['5'] }] }), /more than one group/);
    assert.throws(() => validateRecode(cxSurvey.questions, { ...top2, groups: [{ code: 'a', label: 'A', from: ['9'] }] }), /not an answer code/);
    assert.throws(() => validateRecode(cxSurvey.questions, { ...spend, groups: [{ code: 'a', label: 'A', min: 0, max: 50 }, { code: 'b', label: 'B', min: 50, max: 90 }] }), /overlap/);
    assert.throws(() => validateRecode(cxSurvey.questions, { ...spend, source: 'Q3' }), /bands need/);
  });
  it('adds derived single-choice questions that tabulate like any other', () => {
    const { questions, rows: rr } = applyRecodes(cxSurvey.questions, rows, [top2, spend]);
    assert.deepEqual(questions.map((q) => q.id).filter((id) => id.startsWith('R')), ['R_Q2T2B', 'R_SPEND']);
    assert.equal(questions.findIndex((q) => q.id === 'R_Q2T2B'), questions.findIndex((q) => q.id === 'Q2') + 1);
    const res = surveyResults(questions, rr);
    const t2b = res.questions.find((q) => q.id === 'R_Q2T2B')!;
    const expected = rows.filter((r) => ['5', '4'].includes(r.answers.Q2 as string)).length / rows.filter((r) => r.answers.Q2).length;
    assert.ok(t2b.type === 'single' && Math.abs(t2b.rows.find((x) => x.code === 't2b')!.pct - expected) < 0.001);
    const banner = surveyResults(questions, rr, 'R_SPEND');
    assert.equal(banner.banner?.cols.length, 3);
  });
});
