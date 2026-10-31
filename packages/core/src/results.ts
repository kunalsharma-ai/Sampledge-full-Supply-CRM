/**
 * Survey results from real responses: per-question frequencies, numeric summaries, NPS, matrix
 * distributions, an optional banner (crosstab by one single-choice question) with column-proportion
 * significance letters, and respondent quality flags. Import-free (structural types only).
 */

type Opt = { code: string; label: string };
type Q = { id: string; type: string; text: string; options?: Opt[]; rows?: Opt[] };
type Ans = string | string[] | number | Record<string, string>;
/** `weight` defaults to 1. `codes` holds coded open ends: question id → code list. */
export type ResultRow = { id: string; answers: Record<string, Ans>; weight?: number; codes?: Record<string, string[]> };
export type Codeframes = Record<string, { code: string; label: string }[]>;

export type FreqRow = { code: string; label: string; count: number; pct: number; byBanner?: { count: number; base: number; pct: number; sig: string[] }[] };
export type QuestionResult =
  | { id: string; text: string; type: 'single' | 'multi'; base: number; rows: FreqRow[] }
  | { id: string; text: string; type: 'numeric'; base: number; mean: number; median: number; min: number; max: number; byBanner?: { base: number; mean: number }[] }
  | { id: string; text: string; type: 'nps'; base: number; nps: number; promoters: number; passives: number; detractors: number; byBanner?: { base: number; nps: number }[] }
  | { id: string; text: string; type: 'matrix'; base: number; rows: { code: string; label: string; dist: { code: string; label: string; pct: number }[] }[] }
  | { id: string; text: string; type: 'text'; base: number; samples: string[]; coded?: FreqRow[] };

const r1 = (x: number) => Math.round(x * 1000) / 1000;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/**
 * Letters of banner columns this column is significantly higher than (two-proportion z, 95%).
 * `n` is the effective base (equal to the count of interviews when unweighted); columns under 30 are skipped.
 */
function sigLetters(cols: { p: number; n: number }[]) {
  return cols.map((a) => cols.flatMap((b, j) => {
    if (a === b || a.n < 30 || b.n < 30) return [];
    const pooled = (a.p * a.n + b.p * b.n) / (a.n + b.n);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
    return se > 0 && (a.p - b.p) / se > 1.96 ? [String.fromCharCode(65 + j)] : [];
  }));
}
const wOf = (r: ResultRow) => r.weight ?? 1;
const wsum = (rs: ResultRow[]) => rs.reduce((a, r) => a + wOf(r), 0);
/** Kish effective sample size: (Σw)² / Σw². */
export function effectiveBase(weights: number[]) {
  const s = weights.reduce((a, b) => a + b, 0), s2 = weights.reduce((a, b) => a + b * b, 0);
  return s2 ? (s * s) / s2 : 0;
}
const neff = (rs: ResultRow[]) => effectiveBase(rs.map(wOf));

export function surveyResults(questions: Q[], responses: ResultRow[], bannerId?: string, codeframes: Codeframes = {}) {
  const banner = bannerId ? questions.find((q) => q.id === bannerId && q.type === 'single' && q.options?.length) : undefined;
  const bannerCols = banner ? banner.options!.map((o, i) => ({ ...o, letter: String.fromCharCode(65 + i), base: responses.filter((r) => r.answers[banner.id] === o.code).length })) : [];
  const inCol = (r: ResultRow, i: number) => banner && r.answers[banner.id] === bannerCols[i].code;

  /** Weighted shares per option, with banner columns and significance letters when a banner is set. */
  const freqRows = (opts: Opt[], answered: ResultRow[], has: (r: ResultRow, code: string) => boolean): FreqRow[] => {
    const wBase = wsum(answered);
    return opts.map((o) => {
      const hit = answered.filter((r) => has(r, o.code));
      const row: FreqRow = { code: o.code, label: o.label, count: hit.length, pct: wBase ? r1(wsum(hit) / wBase) : 0 };
      if (banner) {
        const cols = bannerCols.map((_, i) => { const b = answered.filter((r) => inCol(r, i)); const c = b.filter((r) => has(r, o.code)); const wb = wsum(b); return { count: c.length, base: b.length, p: wb ? wsum(c) / wb : 0, n: neff(b) }; });
        const sig = sigLetters(cols);
        row.byBanner = cols.map((c, i) => ({ count: c.count, base: c.base, pct: r1(c.p), sig: sig[i] }));
      }
      return row;
    });
  };
  const wMean = (rs: ResultRow[], q: string) => { const v = rs.map((r) => ({ x: Number(r.answers[q]), w: wOf(r) })).filter((v) => Number.isFinite(v.x)); const sw = v.reduce((a, b) => a + b.w, 0); return { n: v.length, mean: sw ? r1(v.reduce((a, b) => a + b.x * b.w, 0) / sw) : 0, xs: v.map((y) => y.x) }; };

  const out: QuestionResult[] = [];
  for (const q of questions) {
    const answered = responses.filter((r) => r.answers[q.id] !== undefined && r.answers[q.id] !== '');
    const base = answered.length;
    if (q.type === 'single' || q.type === 'multi') {
      const has = (r: ResultRow, code: string) => { const a = r.answers[q.id]; return Array.isArray(a) ? a.includes(code) : a === code; };
      out.push({ id: q.id, text: q.text, type: q.type, base, rows: freqRows(q.options ?? [], answered, has) });
    } else if (q.type === 'numeric' || q.type === 'scale') {
      const m = wMean(answered, q.id);
      const v = m.xs;
      out.push({
        id: q.id, text: q.text, type: 'numeric', base: v.length, mean: m.mean, median: median(v), min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0,
        ...(banner ? { byBanner: bannerCols.map((_, i) => { const x = wMean(answered.filter((r) => inCol(r, i)), q.id); return { base: x.n, mean: x.mean }; }) } : {}),
      });
    } else if (q.type === 'nps') {
      const score = (rs: ResultRow[]) => {
        const v = rs.map((r) => ({ x: Number(r.answers[q.id]), w: wOf(r) })).filter((v) => Number.isFinite(v.x));
        const sw = v.reduce((a, b) => a + b.w, 0) || 1;
        const p = v.filter((y) => y.x >= 9).reduce((a, b) => a + b.w, 0) / sw, d = v.filter((y) => y.x <= 6).reduce((a, b) => a + b.w, 0) / sw;
        return { base: v.length, p, d, nps: v.length ? Math.round((p - d) * 100) : 0 };
      };
      const all = score(answered);
      out.push({ id: q.id, text: q.text, type: 'nps', base: all.base, nps: all.nps, promoters: all.base ? r1(all.p) : 0, detractors: all.base ? r1(all.d) : 0, passives: all.base ? r1(1 - all.p - all.d) : 0, ...(banner ? { byBanner: bannerCols.map((_, i) => { const s = score(answered.filter((r) => inCol(r, i))); return { base: s.base, nps: s.nps }; }) } : {}) });
    } else if (q.type === 'matrix') {
      out.push({
        id: q.id, text: q.text, type: 'matrix', base,
        rows: (q.rows ?? []).map((row) => ({ code: row.code, label: row.label, dist: (q.options ?? []).map((o) => ({ code: o.code, label: o.label, pct: base ? r1(wsum(answered.filter((r) => (r.answers[q.id] as Record<string, string>)?.[row.code] === o.code)) / wsum(answered)) : 0 })) })),
      });
    } else if (q.type === 'text') {
      const frame = codeframes[q.id];
      const coded = frame?.length ? freqRows(frame, answered, (r, code) => !!r.codes?.[q.id]?.includes(code)) : undefined;
      out.push({ id: q.id, text: q.text, type: 'text', base, samples: answered.slice(0, 20).map((r) => String(r.answers[q.id]).slice(0, 300)), ...(coded ? { coded } : {}) });
    }
  }
  const weighted = responses.some((r) => r.weight !== undefined && r.weight !== 1);
  return { base: responses.length, weighted, weightedBase: Math.round(wsum(responses) * 10) / 10, effectiveBase: Math.round(neff(responses) * 10) / 10, banner: banner ? { id: banner.id, text: banner.text, cols: bannerCols.map(({ code, label, letter, base }) => ({ code, label, letter, base })) } : null, questions: out };
}

// ───────────────────────── Respondent quality

export type QualityFlag = 'speeder' | 'straightliner' | 'duplicate' | 'gibberish';

/**
 * Flags for a completed interview. Flags never remove a respondent on their own: rejecting one is a
 * 'Rejecting respondents' approval.
 * - speeder: finished in under a third of the expected interview length (and under 60 s minimum)
 * - straightliner: the same answer on every row of a matrix with 4+ rows
 * - gibberish: an open answer that is keyboard-mashing or a repeated character
 * - duplicate: decided by the caller (same respondent reference already completed)
 */
export function qualityFlags(questions: Q[], answers: Record<string, Ans>, seconds: number, loiMinutes: number): QualityFlag[] {
  const flags: QualityFlag[] = [];
  if (seconds < Math.max(60, (loiMinutes * 60) / 3)) flags.push('speeder');
  for (const q of questions) {
    const a = answers[q.id];
    if (q.type === 'matrix' && a && typeof a === 'object' && !Array.isArray(a)) {
      const vals = Object.values(a);
      if (vals.length >= 4 && new Set(vals).size === 1) { flags.push('straightliner'); break; }
    }
  }
  for (const q of questions) {
    const a = answers[q.id];
    if (q.type === 'text' && typeof a === 'string' && a.trim().length >= 4) {
      const t = a.trim().toLowerCase();
      if (/^(.)\1{3,}$/.test(t) || /^[asdfghjkl;]{5,}$/.test(t) || /^[qwertyuiop]{6,}$/.test(t) || /^[^aeiouy\s\d]{7,}$/.test(t)) { flags.push('gibberish'); break; }
    }
  }
  return flags;
}
