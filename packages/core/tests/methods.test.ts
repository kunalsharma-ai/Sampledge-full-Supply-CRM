import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conjointDesign, conjointEstimate, conjointSimulate, gaborGranger, maxDiffDesign, maxDiffScores, turf, vanWestendorp, type ConjointChoice } from '../src/methods.ts';
import { extractRfq, parseQuestionnaire } from '../src/extract.ts';

function prng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

test('MaxDiff design balances item frequency and pairs', () => {
  const d = maxDiffDesign({ items: 12, perSet: 4, versions: 3, seed: 3 });
  assert.equal(d.setsPerVersion, 9);
  for (const v of d.versions) {
    const freq = new Array(12).fill(0);
    v.forEach((set) => { assert.equal(new Set(set).size, 4, 'no repeats within a set'); set.forEach((i) => freq[i]++); });
    assert.ok(Math.max(...freq) - Math.min(...freq) <= 1, `within-version frequency ${freq}`);
  }
  assert.ok(d.diagnostics.appearancesMax - d.diagnostics.appearancesMin <= 1);
  assert.ok(d.diagnostics.pairMin >= 1, 'every pair co-occurs at least once across 3 versions');
});

test('MaxDiff counting recovers the true order', () => {
  const items = ['A', 'B', 'C', 'D', 'E', 'F'];
  const truth = [5, 4, 3, 2, 1, 0];
  const d = maxDiffDesign({ items: 6, perSet: 3, sets: 8, versions: 20 });
  const answers = d.versions.flat().map((set) => ({ set, best: set.reduce((a, b) => (truth[b] > truth[a] ? b : a)), worst: set.reduce((a, b) => (truth[b] < truth[a] ? b : a)) }));
  const s = maxDiffScores(items, answers);
  assert.deepEqual(s.map((x) => x.item), items);
  assert.equal(s[0].index, 100);
  assert.equal(s.at(-1)!.index, 0);
});

test('conjoint design is level-balanced and the MNL recovers part-worth order', () => {
  const attributes = [{ name: 'Brand', levels: ['X', 'Y', 'Z'] }, { name: 'Price', levels: ['$10', '$15', '$20'] }, { name: 'Speed', levels: ['Fast', 'Slow'] }];
  const d = conjointDesign({ attributes, tasks: 10, alternatives: 3, versions: 60, seed: 2 });
  assert.ok(d.levelBalance <= 2, `level balance ${d.levelBalance}`);
  const util = [[0.6, 0, -0.6], [1, 0, -1], [0.5, -0.5]];
  const r = prng(9);
  const choices: ConjointChoice[] = d.versions.flat().map((task) => {
    const u = task.alternatives.map((alt) => alt.reduce((s, l, k) => s + util[k][l], 0) - Math.log(-Math.log(r() || 1e-9)));
    return { task, chosen: u.indexOf(Math.max(...u)) };
  });
  const est = conjointEstimate(attributes, choices);
  const price = est.partWorths[1].levels.map((l) => l.utility);
  assert.ok(price[0] > price[1] && price[1] > price[2], `price utilities ${price}`);
  assert.ok(Math.abs(price[0] - 1) < 0.25, `recovered $10 utility ${price[0]}`);
  assert.equal(est.importance.reduce((a, b) => a + b.importance, 0).toFixed(2), '1.00');
  assert.ok(est.importance[1].importance > est.importance[2].importance);
  assert.ok(est.fit.mcFaddenR2 > 0.1);
  const shares = conjointSimulate(est, [{ Brand: 'X', Price: '$10', Speed: 'Fast' }, { Brand: 'Z', Price: '$20', Speed: 'Slow' }]);
  assert.ok(shares[0] > 0.9);
});

test('Van Westendorp finds the price points and drops inconsistent answers', () => {
  const r = prng(4);
  const answers = Array.from({ length: 400 }, () => { const c = 20 + r() * 20; return { tooCheap: c * 0.5, cheap: c * 0.8, expensive: c * 1.3, tooExpensive: c * 1.7 }; });
  answers.push({ tooCheap: 50, cheap: 10, expensive: 5, tooExpensive: 1 });
  const vw = vanWestendorp(answers);
  assert.equal(vw.excluded, 1);
  const { pointOfMarginalCheapness: pmc, optimalPricePoint: opp, indifferencePricePoint: ipp, pointOfMarginalExpensiveness: pme } = vw.points;
  assert.ok(pmc! < opp! && opp! < pme! && pmc! < ipp! && ipp! < pme!, JSON.stringify(vw.points));
  assert.ok(ipp! > 25 && ipp! < 35, `IPP ${ipp}`);
});

test('Gabor-Granger picks the revenue-maximising price', () => {
  const prices = [5, 10, 15, 20];
  const wtp = Array.from({ length: 100 }, (_, i) => 4 + i * 0.2); // uniform 4..24
  const answers = wtp.map((w) => Object.fromEntries(prices.map((p) => [p, w >= p])));
  const g = gaborGranger(prices, answers);
  assert.deepEqual(g.curve.map((c) => c.demand), [0.95, 0.7, 0.45, 0.2]);
  assert.equal(g.revenueMaximisingPrice, 10); // 10 × 0.70 = 7.00 beats 15 × 0.45 = 6.75
  assert.ok(g.elasticity.every((e) => e.elasticity < 0));
});

test('TURF exhaustive search beats the most popular items when they overlap', () => {
  const items = ['A', 'B', 'C', 'D'];
  // A and B are popular but reach the same people; C reaches a different group.
  const reach = [
    ...Array.from({ length: 40 }, () => [true, true, false, false]),
    ...Array.from({ length: 30 }, () => [false, false, true, false]),
    ...Array.from({ length: 10 }, () => [false, false, false, true]),
    ...Array.from({ length: 20 }, () => [false, false, false, false]),
  ];
  const t = turf(items, reach, 2);
  assert.equal(t.method, 'exhaustive');
  assert.deepEqual([...t.portfolio].sort(), ['A', 'C']);
  assert.equal(t.reach, 0.7);
  assert.equal(t.ladder[0].item, 'A');
  const g = turf(items, reach, 2, { maxCombos: 1 });
  assert.equal(g.method, 'greedy');
  assert.equal(g.reach, 0.7);
});

test('RFQ and questionnaire extraction', () => {
  const r = extractRfq('Need 1,200 completes of IT decision makers in Germany and US, 15% IR, 12 minutes', [{ code: 'DE', name: 'Germany' }, { code: 'US', name: 'United States' }, { code: 'FR', name: 'France' }]);
  assert.equal(r.n, 1200);
  assert.equal(r.ir, 0.15);
  assert.equal(r.loi, 12);
  assert.deepEqual(r.countries, ['DE', 'US']);
  assert.equal(r.audience, 'B2B');
  assert.deepEqual(extractRfq('500 IT decision makers in Italy', [{ code: 'IT', name: 'Italy' }, { code: 'IN', name: 'India' }]).countries, ['IT']);
  const q = parseQuestionnaire('Q1. Which do you use? Select all that apply. [RANDOMIZE]\n1. A\n2. B\n3. None of these\nQ2. How old are you?');
  assert.equal(q[0].type, 'multi');
  assert.equal(q[0].randomize, true);
  assert.equal(q[0].options[2].exclusive, true);
  assert.equal(q[1].type, 'numeric');
});

import { qualityFlags, surveyResults } from '../src/results.ts';

test('survey results: frequencies, banner significance, NPS, quality flags', () => {
  const qs = [
    { id: 'G', type: 'single', text: 'Group', options: [{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }] },
    { id: 'U', type: 'multi', text: 'Use', options: [{ code: 'x', label: 'X' }, { code: 'y', label: 'Y' }] },
    { id: 'N', type: 'nps', text: 'Recommend' },
    { id: 'M', type: 'matrix', text: 'Rate', rows: [{ code: 'r1', label: 'R1' }], options: [{ code: '1', label: 'Low' }, { code: '2', label: 'High' }] },
  ];
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: String(i), answers: { G: i < 100 ? 'a' : 'b', U: i < 100 ? (i < 80 ? ['x'] : ['y']) : (i < 120 ? ['x', 'y'] : ['y']), N: i % 10 === 0 ? 3 : 10, M: { r1: i % 2 ? '2' : '1' } } }));
  const r = surveyResults(qs, rows, 'G');
  const use = r.questions[1] as { rows: { pct: number; byBanner?: { pct: number; sig: string[] }[] }[] };
  assert.equal(use.rows[0].pct, 0.5); // 80 + 20 of 200
  assert.deepEqual(use.rows[0].byBanner!.map((c) => c.pct), [0.8, 0.2]);
  assert.deepEqual(use.rows[0].byBanner![0].sig, ['B']);
  assert.deepEqual(use.rows[0].byBanner![1].sig, []);
  const nps = r.questions[2] as { nps: number };
  assert.equal(nps.nps, 80);
  assert.deepEqual(qualityFlags(qs, { M: { a: '1', b: '1', c: '1', d: '1' } }, 30, 10), ['speeder', 'straightliner']);
  const mq = [{ id: 'M', type: 'matrix', text: '' }, { id: 'T', type: 'text', text: '' }];
  assert.deepEqual(qualityFlags(mq, { M: { a: '1', b: '1', c: '1', d: '1' }, T: 'asdfasdf' }, 900, 10), ['straightliner', 'gibberish']);
  assert.deepEqual(qualityFlags(mq, { M: { a: '1', b: '2', c: '1', d: '1' }, T: 'Pricing was unclear' }, 900, 10), []);
});
