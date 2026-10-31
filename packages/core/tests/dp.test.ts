import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { codeText, rake, suggestCodeframe } from '../src/dp.ts';
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
