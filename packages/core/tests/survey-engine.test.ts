import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, applyQuotas, displayOptions, evaluate, pipe, runQA, simulate, start } from '../src/survey/engine.ts';
import { cloudSurvey } from '../src/survey/demo-survey.ts';

test('conditions evaluate single, multi and compound answers', () => {
  const a = { S1: 'ft', Q1: ['aws', 'gcp'], Q3: 40 };
  assert.equal(evaluate({ q: 'S1', op: 'eq', value: 'ft' }, a), true);
  assert.equal(evaluate({ q: 'Q1', op: 'in', values: ['gcp'] }, a), true);
  assert.equal(evaluate({ q: 'Q1', op: 'nin', values: ['none'] }, a), true);
  assert.equal(evaluate({ all: [{ q: 'Q3', op: 'gte', value: 40 }, { not: { q: 'S1', op: 'eq', value: 'pt' } }] }, a), true);
  assert.equal(evaluate({ any: [{ q: 'Q3', op: 'gt', value: 90 }, { q: 'S9', op: 'answered' }] }, a), false);
});

test('screener terminates non-employed respondents', () => {
  let s = start(cloudSurvey);
  assert.equal(s.cursor, 'S1');
  s = answer(cloudSurvey, s, 'S1', 'none');
  assert.equal(s.outcome, 'screenout');
});

test('qualified path completes, skips hidden questions and honours goto', () => {
  const d = { ...cloudSurvey, quotas: [] };
  let s = start(d);
  const script: [string, unknown][] = [
    ['S1', 'ft'], ['S2', 'md'], ['S3', 'final'], ['S4', ['tech']], ['Q1', ['aws', 'az']], ['Q2', 'az'], ['Q3', 60],
    ['Q4', { posture: '4', identity: '3', workload: '2', data: '4' }], ['Q5', ['int', 'price', 'sup', 'comp']], ['Q6', 'flat'],
  ];
  for (const [q, v] of script) { assert.equal(s.cursor, q); s = answer(d, s, q, v as never); assert.ok(!('error' in s && s.error), String((s as { error?: string }).error)); }
  // flat budget → goto Q9 (skips Q7, Q8)
  assert.equal(s.cursor, 'Q9');
  s = answer(d, s, 'Q9', 9); s = answer(d, s, 'Q10', 'Great support'); s = answer(d, s, 'Q11', 5);
  // Q12 hidden because S3 != no
  assert.equal(s.cursor, 'END');
  s = answer(d, s, 'END', 'seen');
  assert.equal(s.outcome, 'complete');
});

test('validation rejects out-of-range numbers and exclusive combos', () => {
  const d = { ...cloudSurvey, quotas: [] };
  let s = start(d);
  for (const [q, v] of [['S1', 'ft'], ['S2', 'xs'], ['S3', 'final'], ['S4', ['tech']]] as const) s = answer(d, s, q, v as never);
  const bad = answer(d, s, 'Q1', ['aws', 'none']);
  assert.match(bad.error ?? '', /exclusive/i);
});

test('overquota fires when a full cell matches', () => {
  const d = { ...cloudSurvey, quotas: [{ id: 'x', label: 'Big', when: { q: 'S2', op: 'eq' as const, value: 'lg' }, target: 10, count: 10 }] };
  let s = start(d);
  s = answer(d, s, 'S1', 'ft');
  s = answer(d, s, 'S2', 'lg');
  assert.equal(s.outcome, 'overquota');
});

test('applyQuotas increments matching cells only', () => {
  const d2 = applyQuotas(cloudSurvey, { S2: 'lg', S3: 'final' });
  assert.equal(d2.quotas.find((q) => q.id === 'qt3')!.count, 89);
  assert.equal(d2.quotas.find((q) => q.id === 'qt1')!.count, 71);
});

test('randomisation is deterministic per respondent and anchors exclusive options', () => {
  const q = cloudSurvey.questions.find((x) => x.id === 'Q1')!;
  const a = displayOptions(q, 'resp-1').map((o) => o.code);
  const b = displayOptions(q, 'resp-1').map((o) => o.code);
  assert.deepEqual(a, b);
  assert.equal(a.at(-1), 'none');
});

test('piping substitutes answer labels', () => {
  assert.equal(pipe('Which of {{Q1}}?', cloudSurvey, { Q1: ['aws', 'gcp'] }), 'Which of Platform A, Platform C?');
});

test('simulation is deterministic and QA finds the seeded defects', () => {
  const a = simulate(cloudSurvey, 200, 3), b = simulate(cloudSurvey, 200, 3);
  assert.deepEqual(a.outcomes, b.outcomes);
  const { issues } = runQA(cloudSurvey);
  assert.ok(issues.some((i) => i.questionId === 'Q12' && /Reachability/.test(i.test)), 'Q12 unreachable');
  assert.ok(issues.some((i) => /ceo/.test(i.actual)), 'missing option ceo');
});
