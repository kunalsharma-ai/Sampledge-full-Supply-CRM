/**
 * Survey results from real responses: per-question frequencies, numeric summaries, NPS, matrix
 * distributions, an optional banner (crosstab by one single-choice question) with column-proportion
 * significance letters, and respondent quality flags. Import-free (structural types only).
 */

type Opt = { code: string; label: string };
type Q = { id: string; type: string; text: string; options?: Opt[]; rows?: Opt[] };
type Ans = string | string[] | number | Record<string, string>;
export type ResultRow = { id: string; answers: Record<string, Ans> };

export type FreqRow = { code: string; label: string; count: number; pct: number; byBanner?: { count: number; base: number; pct: number; sig: string[] }[] };
export type QuestionResult =
  | { id: string; text: string; type: 'single' | 'multi'; base: number; rows: FreqRow[] }
  | { id: string; text: string; type: 'numeric'; base: number; mean: number; median: number; min: number; max: number; byBanner?: { base: number; mean: number }[] }
  | { id: string; text: string; type: 'nps'; base: number; nps: number; promoters: number; passives: number; detractors: number; byBanner?: { base: number; nps: number }[] }
  | { id: string; text: string; type: 'matrix'; base: number; rows: { code: string; label: string; dist: { code: string; label: string; pct: number }[] }[] }
  | { id: string; text: string; type: 'text'; base: number; samples: string[] };

const r1 = (x: number) => Math.round(x * 1000) / 1000;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/** Letters of banner columns this column is significantly higher than (two-proportion z, 95%, n ≥ 30). */
function sigLetters(cols: { count: number; base: number }[]) {
  return cols.map((a) => cols.flatMap((b, j) => {
    if (a === b || a.base < 30 || b.base < 30) return [];
    const pa = a.count / a.base, pb = b.count / b.base;
    const p = (a.count + b.count) / (a.base + b.base);
    const se = Math.sqrt(p * (1 - p) * (1 / a.base + 1 / b.base));
    return se > 0 && (pa - pb) / se > 1.96 ? [String.fromCharCode(65 + j)] : [];
  }));
}

export function surveyResults(questions: Q[], responses: ResultRow[], bannerId?: string) {
  const banner = bannerId ? questions.find((q) => q.id === bannerId && q.type === 'single' && q.options?.length) : undefined;
  const bannerCols = banner ? banner.options!.map((o, i) => ({ ...o, letter: String.fromCharCode(65 + i), base: responses.filter((r) => r.answers[banner.id] === o.code).length })) : [];
  const inCol = (r: ResultRow, i: number) => banner && r.answers[banner.id] === bannerCols[i].code;

  const out: QuestionResult[] = [];
  for (const q of questions) {
    const answered = responses.filter((r) => r.answers[q.id] !== undefined && r.answers[q.id] !== '');
    const base = answered.length;
    if (q.type === 'single' || q.type === 'multi') {
      const has = (r: ResultRow, code: string) => { const a = r.answers[q.id]; return Array.isArray(a) ? a.includes(code) : a === code; };
      const rows: FreqRow[] = (q.options ?? []).map((o) => {
        const count = answered.filter((r) => has(r, o.code)).length;
        const row: FreqRow = { code: o.code, label: o.label, count, pct: base ? r1(count / base) : 0 };
        if (banner) {
          const cols = bannerCols.map((_, i) => { const b = answered.filter((r) => inCol(r, i)); const c = b.filter((r) => has(r, o.code)).length; return { count: c, base: b.length }; });
          const sig = sigLetters(cols);
          row.byBanner = cols.map((c, i) => ({ ...c, pct: c.base ? r1(c.count / c.base) : 0, sig: sig[i] }));
        }
        return row;
      });
      out.push({ id: q.id, text: q.text, type: q.type, base, rows });
    } else if (q.type === 'numeric' || q.type === 'scale') {
      const v = answered.map((r) => Number(r.answers[q.id])).filter(Number.isFinite);
      out.push({
        id: q.id, text: q.text, type: 'numeric', base: v.length, mean: v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : 0, median: median(v), min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0,
        ...(banner ? { byBanner: bannerCols.map((_, i) => { const x = answered.filter((r) => inCol(r, i)).map((r) => Number(r.answers[q.id])).filter(Number.isFinite); return { base: x.length, mean: x.length ? r1(x.reduce((a, b) => a + b, 0) / x.length) : 0 }; }) } : {}),
      });
    } else if (q.type === 'nps') {
      const score = (rs: ResultRow[]) => { const v = rs.map((r) => Number(r.answers[q.id])).filter(Number.isFinite); const p = v.filter((x) => x >= 9).length, d = v.filter((x) => x <= 6).length; return { base: v.length, p, d, nps: v.length ? Math.round(((p - d) / v.length) * 100) : 0 }; };
      const all = score(answered);
      out.push({ id: q.id, text: q.text, type: 'nps', base: all.base, nps: all.nps, promoters: all.base ? r1(all.p / all.base) : 0, detractors: all.base ? r1(all.d / all.base) : 0, passives: all.base ? r1((all.base - all.p - all.d) / all.base) : 0, ...(banner ? { byBanner: bannerCols.map((_, i) => { const s = score(answered.filter((r) => inCol(r, i))); return { base: s.base, nps: s.nps }; }) } : {}) });
    } else if (q.type === 'matrix') {
      out.push({
        id: q.id, text: q.text, type: 'matrix', base,
        rows: (q.rows ?? []).map((row) => ({ code: row.code, label: row.label, dist: (q.options ?? []).map((o) => ({ code: o.code, label: o.label, pct: base ? r1(answered.filter((r) => (r.answers[q.id] as Record<string, string>)?.[row.code] === o.code).length / base) : 0 })) })),
      });
    } else if (q.type === 'text') {
      out.push({ id: q.id, text: q.text, type: 'text', base, samples: answered.slice(0, 20).map((r) => String(r.answers[q.id]).slice(0, 300)) });
    }
  }
  return { base: responses.length, banner: banner ? { id: banner.id, text: banner.text, cols: bannerCols.map(({ code, label, letter, base }) => ({ code, label, letter, base })) } : null, questions: out };
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
