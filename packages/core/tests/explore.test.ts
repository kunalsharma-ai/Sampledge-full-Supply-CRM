import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { responseFlow, responseSegments, responseTrend, segmentationVariables } from '../src/explore.ts';
import { cxResponses, cxSurvey } from '../src/survey/demo-cx.ts';

const start = Date.UTC(2026, 8, 1);
const rows = cxResponses(600, 7).map((r, i) => ({ id: `r${i}`, answers: r.answers, completedAt: new Date(start + i * 50 * 60_000).toISOString() }));
const Q = cxSurvey.questions;

describe('respondent flow', () => {
  const f = responseFlow(Q, rows, 'Q1', 'Q5');
  it('counts everyone who answered both, and each source node splits into its links', () => {
    assert.equal(f.base, rows.filter((r) => r.answers.Q1 && typeof r.answers.Q5 === 'number').length);
    for (const n of f.nodes.filter((x) => x.side === 'from')) {
      const out = f.links.filter((l) => l.source === n.name).reduce((s, l) => s + l.value, 0);
      assert.ok(Math.abs(out - n.value) < 0.05, n.name);
    }
  });
  it('groups NPS into promoter, passive and detractor bands', () => {
    assert.deepEqual(new Set(f.nodes.filter((n) => n.side === 'to').map((n) => n.code)), new Set(['pro', 'pas', 'det']));
  });
  it('applies weights', () => {
    const wr = rows.map((r) => ({ ...r, weight: r.answers.Q1 === 'p1' ? 2 : 1 }));
    const p1 = responseFlow(Q, wr, 'Q1', 'Q5').nodes.find((n) => n.code === 'p1')!;
    assert.equal(p1.value, 2 * f.nodes.find((n) => n.code === 'p1')!.value);
  });
  it('rejects unsuitable questions', () => {
    assert.throws(() => responseFlow(Q, rows, 'Q1', 'Q1'), /different/);
    assert.throws(() => responseFlow(Q, rows, 'Q1', 'Q3'), /not a single-choice/);
  });
});

describe('fieldwork trend', () => {
  it('counts completes per day across the fieldwork span', () => {
    const t = responseTrend(Q, rows);
    assert.equal(t.interval, 'day');
    assert.equal(t.points.reduce((s, p) => s + p.completes, 0), rows.length);
    assert.equal(t.points[0].period, '2026-09-01');
  });
  it('computes NPS per week from the raw scores', () => {
    const t = responseTrend(Q, rows, { interval: 'week', questionId: 'Q5' });
    assert.equal(t.metric?.kind, 'nps');
    const wk = t.points[1];
    const inWeek = rows.filter((r) => { const d = new Date(r.completedAt); return d >= new Date(wk.period + 'T00:00:00Z') && d < new Date(new Date(wk.period + 'T00:00:00Z').getTime() + 7 * 86400000); });
    const s = inWeek.map((r) => r.answers.Q5 as number);
    assert.equal(wk.value, Math.round(((s.filter((v) => v >= 9).length - s.filter((v) => v <= 6).length) / s.length) * 100));
  });
  it('trends the share choosing an option', () => {
    const t = responseTrend(Q, rows, { questionId: 'Q1', code: 'p1' });
    assert.ok(t.points.every((p) => p.value === null || (p.value >= 0 && p.value <= 1)));
    assert.throws(() => responseTrend(Q, rows, { questionId: 'Q1' }), /option/);
  });
});

describe('segmentation', () => {
  it('uses rating, numeric and NPS questions only', () => {
    assert.deepEqual(segmentationVariables(Q).map((v) => v.id), ['Q2', 'Q4', 'Q5']);
  });
  const s = responseSegments(Q, rows, { k: 3 });
  it('assigns every complete respondent to a segment, largest first', () => {
    assert.equal(s.segments.reduce((a, x) => a + x.size, 0), s.base);
    assert.ok(s.segments.every((x, i, a) => i === 0 || a[i - 1].size >= x.size));
    assert.equal(s.map.points.length, s.base);
  });
  it('finds structure (segments explain a real share of variance) and is deterministic', () => {
    assert.ok(s.quality.betweenShare > 0.3, String(s.quality.betweenShare));
    assert.deepEqual(responseSegments(Q, rows, { k: 3 }).segments, s.segments);
  });
  it('refuses tiny bases', () => {
    assert.throws(() => responseSegments(Q, rows.slice(0, 20), { k: 3 }), /at least 30/);
  });
});

