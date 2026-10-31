/**
 * Exploratory views computed from recorded responses: respondent flow between two questions
 * (Sankey), a trend over fieldwork time, and attitudinal segmentation (k-means) with a 2D map.
 * Import-free so the browser, the API and the unit tests share one implementation.
 */

type Opt = { code: string; label: string };
type Q = { id: string; type: string; text: string; options?: Opt[]; rows?: Opt[] };
type Ans = string | string[] | number | Record<string, string>;
export type ExploreRow = { id: string; answers: Record<string, Ans>; weight?: number; completedAt?: string | Date | null };

const w = (r: ExploreRow) => r.weight ?? 1;
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const npsGroup = (v: number) => (v >= 9 ? 'pro' : v >= 7 ? 'pas' : 'det');
const npsOpts: Opt[] = [{ code: 'pro', label: 'Promoter (9–10)' }, { code: 'pas', label: 'Passive (7–8)' }, { code: 'det', label: 'Detractor (0–6)' }];

/** Questions that can be one side of a flow: single choice, or NPS grouped into its three bands. */
export function flowQuestions(questions: Q[]) {
  return questions.filter((q) => q.type === 'single' || q.type === 'nps').map((q) => ({ id: q.id, text: q.text }));
}

function categoryOf(q: Q, a: Ans | undefined): string | null {
  if (a === undefined || a === null || a === '') return null;
  if (q.type === 'nps') return typeof a === 'number' ? npsGroup(a) : null;
  return typeof a === 'string' ? a : null;
}
const optionsOf = (q: Q) => (q.type === 'nps' ? npsOpts : q.options ?? []);

export type Flow = {
  from: { id: string; text: string }; to: { id: string; text: string }; base: number;
  nodes: { name: string; side: 'from' | 'to'; code: string; label: string; value: number }[];
  links: { source: string; target: string; value: number; pctOfFrom: number }[];
};

/** Respondents who answered both questions, counted (weighted when rows carry weights) by answer pair. */
export function responseFlow(questions: Q[], rows: ExploreRow[], fromId: string, toId: string): Flow {
  const f = questions.find((q) => q.id === fromId), t = questions.find((q) => q.id === toId);
  if (!f || !t) throw new Error('Pick two questions from this survey');
  if (f.id === t.id) throw new Error('Pick two different questions');
  for (const q of [f, t]) if (q.type !== 'single' && q.type !== 'nps') throw new Error(`${q.id} is not a single-choice or NPS question`);
  const name = (q: Q, o: Opt) => `${q.id}: ${o.label}`;
  const cell = new Map<string, number>();
  const fromTot = new Map<string, number>();
  let base = 0;
  for (const r of rows) {
    const a = categoryOf(f, r.answers[f.id]), b = categoryOf(t, r.answers[t.id]);
    if (!a || !b) continue;
    base += w(r);
    cell.set(`${a}\u0000${b}`, (cell.get(`${a}\u0000${b}`) ?? 0) + w(r));
    fromTot.set(a, (fromTot.get(a) ?? 0) + w(r));
  }
  const toTot = new Map<string, number>();
  cell.forEach((v, k) => { const b = k.split('\u0000')[1]; toTot.set(b, (toTot.get(b) ?? 0) + v); });
  const nodes: Flow['nodes'] = [
    ...optionsOf(f).filter((o) => fromTot.get(o.code)).map((o) => ({ name: name(f, o), side: 'from' as const, code: o.code, label: o.label, value: round(fromTot.get(o.code)!, 2) })),
    ...optionsOf(t).filter((o) => toTot.get(o.code)).map((o) => ({ name: name(t, o), side: 'to' as const, code: o.code, label: o.label, value: round(toTot.get(o.code)!, 2) })),
  ];
  const links: Flow['links'] = [];
  for (const a of optionsOf(f)) for (const b of optionsOf(t)) {
    const v = cell.get(`${a.code}\u0000${b.code}`);
    if (v) links.push({ source: name(f, a), target: name(t, b), value: round(v, 2), pctOfFrom: round(v / fromTot.get(a.code)!) });
  }
  return { from: { id: f.id, text: f.text }, to: { id: t.id, text: t.text }, base: round(base, 1), nodes, links };
}

// ───────────────────────── Trend over fieldwork

export type TrendPoint = { period: string; completes: number; base: number; value: number | null };
export type Trend = { interval: 'day' | 'week'; metric: { questionId: string; code?: string; kind: 'nps' | 'mean' | 'share'; label: string } | null; points: TrendPoint[] };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
/** Monday of the ISO week, as a date string. */
const weekKey = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return dayKey(x); };

/**
 * Completes per day or week of completion, plus one metric per period: NPS for an NPS question,
 * the mean for a numeric one, or the share choosing `code` for a single/multi choice question.
 * Periods with no completes inside the fieldwork span are kept, with value null.
 */
export function responseTrend(questions: Q[], rows: ExploreRow[], opts: { interval?: 'day' | 'week'; questionId?: string; code?: string } = {}): Trend {
  const dated = rows.filter((r) => r.completedAt).map((r) => ({ r, d: new Date(r.completedAt as string) }));
  const span = dated.length ? (Math.max(...dated.map((x) => +x.d)) - Math.min(...dated.map((x) => +x.d))) / 86_400_000 : 0;
  const interval = opts.interval ?? (span > 60 ? 'week' : 'day');
  const key = interval === 'week' ? weekKey : dayKey;
  let metric: Trend['metric'] = null;
  const q = opts.questionId ? questions.find((x) => x.id === opts.questionId) : undefined;
  if (opts.questionId && !q) throw new Error(`Question ${opts.questionId} is not in this survey`);
  if (q) {
    if (q.type === 'nps') metric = { questionId: q.id, kind: 'nps', label: 'NPS' };
    else if (q.type === 'numeric') metric = { questionId: q.id, kind: 'mean', label: 'Mean' };
    else if (q.type === 'single' || q.type === 'multi') {
      const o = q.options?.find((x) => x.code === opts.code);
      if (!o) throw new Error(`Pick an answer option of ${q.id} to trend`);
      metric = { questionId: q.id, code: o.code, kind: 'share', label: `% ${o.label}` };
    } else throw new Error(`${q.id} (${q.type}) cannot be trended`);
  }
  const groups = new Map<string, ExploreRow[]>();
  dated.forEach(({ r, d }) => { const k = key(d); groups.set(k, [...(groups.get(k) ?? []), r]); });
  const keys = [...groups.keys()].sort();
  // Fill the gaps between the first and last period so quiet days show as gaps, not as joined lines.
  const all: string[] = [];
  if (keys.length) {
    const step = interval === 'week' ? 7 : 1;
    for (let d = new Date(keys[0] + 'T00:00:00Z'); dayKey(d) <= keys[keys.length - 1]; d.setUTCDate(d.getUTCDate() + step)) all.push(dayKey(d));
  }
  const points = all.map((period): TrendPoint => {
    const g = groups.get(period) ?? [];
    if (!metric) return { period, completes: g.length, base: g.length, value: null };
    const ans = g.map((r) => ({ a: r.answers[metric!.questionId], wt: w(r) })).filter((x) => x.a !== undefined && x.a !== null && x.a !== '');
    const tot = ans.reduce((s, x) => s + x.wt, 0);
    let value: number | null = null;
    if (tot > 0) {
      if (metric.kind === 'nps') { const n = ans.filter((x) => typeof x.a === 'number'); const t = n.reduce((s, x) => s + x.wt, 0); value = t ? Math.round(((n.filter((x) => (x.a as number) >= 9).reduce((s, x) => s + x.wt, 0) - n.filter((x) => (x.a as number) <= 6).reduce((s, x) => s + x.wt, 0)) / t) * 100) : null; }
      else if (metric.kind === 'mean') { const n = ans.filter((x) => typeof x.a === 'number'); const t = n.reduce((s, x) => s + x.wt, 0); value = t ? round(n.reduce((s, x) => s + (x.a as number) * x.wt, 0) / t, 2) : null; }
      else value = round(ans.filter((x) => (Array.isArray(x.a) ? x.a.includes(metric!.code!) : x.a === metric!.code)).reduce((s, x) => s + x.wt, 0) / tot);
    }
    return { period, completes: g.length, base: round(tot, 1), value };
  });
  return { interval, metric, points };
}

// ───────────────────────── Segmentation

/** A segmentation input: one number per respondent from a scale-like answer. */
type SegVar = { id: string; label: string; get: (a: Record<string, Ans>) => number | null };

/**
 * Scale-like variables: NPS, numeric, matrix rows with numeric codes, and single choice questions
 * whose option codes are all numbers (rating scales).
 */
export function segmentationVariables(questions: Q[]): SegVar[] {
  const out: SegVar[] = [];
  const num = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
  for (const q of questions) {
    if (q.type === 'nps' || q.type === 'numeric') out.push({ id: q.id, label: q.text, get: (a) => (typeof a[q.id] === 'number' ? (a[q.id] as number) : null) });
    else if (q.type === 'single' && q.options?.length && q.options.every((o) => num(o.code) !== null)) out.push({ id: q.id, label: q.text, get: (a) => (typeof a[q.id] === 'string' ? num(a[q.id] as string) : null) });
    else if (q.type === 'matrix' && q.rows?.length && q.options?.every((o) => num(o.code) !== null)) {
      for (const r of q.rows) out.push({ id: `${q.id}.${r.code}`, label: `${q.text}: ${r.label}`, get: (a) => { const m = a[q.id]; return m && typeof m === 'object' && !Array.isArray(m) && typeof m[r.code] === 'string' ? num(m[r.code]) : null; } });
    }
  }
  return out;
}

function prng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const d2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

/** Weighted k-means with k-means++ seeding; deterministic for a seed. Centroids are copies, never the input points. */
function kmeansW(pts: number[][], wts: number[], k: number, seed = 7, iters = 50) {
  const r = prng(seed);
  const cents: number[][] = [pts[Math.floor(r() * pts.length)].slice()];
  while (cents.length < k) {
    const dist = pts.map((p) => Math.min(...cents.map((c) => d2(c, p))));
    let x = r() * dist.reduce((s, v) => s + v, 0), i = 0;
    for (; i < dist.length - 1; i++) { x -= dist[i]; if (x <= 0) break; }
    cents.push(pts[i].slice());
  }
  let assign = pts.map(() => -1);
  for (let it = 0; it < iters; it++) {
    const next = pts.map((p) => { let best = 0, bd = Infinity; cents.forEach((c, ci) => { const dd = d2(c, p); if (dd < bd) { bd = dd; best = ci; } }); return best; });
    const moved = next.some((a, i) => a !== assign[i]);
    assign = next;
    cents.forEach((c, ci) => {
      let tw = 0; const sum = c.map(() => 0);
      pts.forEach((p, i) => { if (assign[i] === ci) { tw += wts[i]; p.forEach((v, d) => { sum[d] += v * wts[i]; }); } });
      if (tw) c.splice(0, c.length, ...sum.map((s) => s / tw));
    });
    if (!moved) break;
  }
  return { cents, assign };
}

/** First two principal components of standardised data, by power iteration with deflation. */
function pca2(z: number[][]) {
  const dims = z[0]?.length ?? 0;
  const cov = Array.from({ length: dims }, (_, i) => Array.from({ length: dims }, (_, j) => z.reduce((s, p) => s + p[i] * p[j], 0) / Math.max(1, z.length - 1)));
  const comps: number[][] = [];
  const total = cov.reduce((s, row, i) => s + row[i], 0) || 1;
  const explained: number[] = [];
  for (let c = 0; c < Math.min(2, dims); c++) {
    let v = Array.from({ length: dims }, (_, i) => 1 / Math.sqrt(dims) + i * 1e-3);
    for (let it = 0; it < 200; it++) {
      const nv = cov.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      const n = Math.hypot(...nv) || 1;
      v = nv.map((x) => x / n);
    }
    const lambda = cov.map((row) => row.reduce((s, x, j) => s + x * v[j], 0)).reduce((s, x, i) => s + x * v[i], 0);
    comps.push(v); explained.push(round(Math.max(0, lambda) / total, 3));
    for (let i = 0; i < dims; i++) for (let j = 0; j < dims; j++) cov[i][j] -= lambda * v[i] * v[j];
  }
  return { comps, explained };
}

export type Segmentation = {
  k: number; base: number; excluded: number;
  variables: { id: string; label: string; mean: number }[];
  segments: { id: number; name: string; size: number; share: number; means: Record<string, number>; distinct: { id: string; label: string; diff: number }[] }[];
  map: { explained: number[]; points: { x: number; y: number; segment: number }[] };
  quality: { betweenShare: number };
};

/**
 * k-means on standardised scale-like answers. Respondents missing any segmentation variable are
 * left out (counted in `excluded`). Segments are ordered by size and described by the variables
 * where their mean differs most from the total, in standard deviations.
 */
export function responseSegments(questions: Q[], rows: ExploreRow[], opts: { k?: number; variables?: string[]; maxPoints?: number } = {}): Segmentation {
  const k = Math.min(6, Math.max(2, Math.round(opts.k ?? 3)));
  let vars = segmentationVariables(questions);
  if (opts.variables?.length) vars = vars.filter((v) => opts.variables!.includes(v.id));
  if (vars.length < 2) throw new Error('Segmentation needs at least two rating, NPS or numeric questions');
  const usable: { r: ExploreRow; x: number[] }[] = [];
  for (const r of rows) { const x = vars.map((v) => v.get(r.answers)); if (x.every((v) => v !== null)) usable.push({ r, x: x as number[] }); }
  if (usable.length < k * 10) throw new Error(`Segmentation needs at least ${k * 10} complete answers to these questions; there are ${usable.length}`);
  const wts = usable.map((u) => w(u.r));
  const tw = wts.reduce((s, v) => s + v, 0);
  const mean = vars.map((_, d) => usable.reduce((s, u, i) => s + u.x[d] * wts[i], 0) / tw);
  const sd = vars.map((_, d) => Math.sqrt(usable.reduce((s, u, i) => s + wts[i] * (u.x[d] - mean[d]) ** 2, 0) / tw) || 1);
  const z = usable.map((u) => u.x.map((v, d) => (v - mean[d]) / sd[d]));
  const { cents, assign } = kmeansW(z, wts, k);
  // Share of total variance explained by the segments (between-segment / total sum of squares).
  const totalSS = z.reduce((s, p, i) => s + wts[i] * p.reduce((a, v) => a + v * v, 0), 0) || 1;
  const withinSS = z.reduce((s, p, i) => s + wts[i] * d2(p, cents[assign[i]]), 0);
  const raw = cents.map((c, ci) => {
    const size = assign.reduce((s, a, i) => s + (a === ci ? wts[i] : 0), 0);
    return { ci, size, c };
  }).filter((s) => s.size > 0).sort((a, b) => b.size - a.size);
  const order = new Map(raw.map((s, i) => [s.ci, i]));
  const segments = raw.map((s, i) => {
    const distinct = vars.map((v, d) => ({ id: v.id, label: v.label, diff: round(s.c[d], 2) })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 3);
    return {
      id: i, name: `Segment ${String.fromCharCode(65 + i)}`, size: round(s.size, 1), share: round(s.size / tw),
      means: Object.fromEntries(vars.map((v, d) => [v.id, round(s.c[d] * sd[d] + mean[d], 2)])), distinct,
    };
  });
  const { comps, explained } = pca2(z);
  const maxPoints = opts.maxPoints ?? 1500;
  const stride = Math.max(1, Math.ceil(z.length / maxPoints));
  const points = z.filter((_, i) => i % stride === 0).map((p, j) => ({
    x: round(p.reduce((s, v, d) => s + v * comps[0][d], 0), 3),
    y: comps[1] ? round(p.reduce((s, v, d) => s + v * comps[1][d], 0), 3) : 0,
    segment: order.get(assign[j * stride])!,
  }));
  return {
    k: segments.length, base: round(tw, 1), excluded: rows.length - usable.length,
    variables: vars.map((v, d) => ({ id: v.id, label: v.label, mean: round(mean[d], 2) })),
    segments, map: { explained, points }, quality: { betweenShare: round(1 - withinSS / totalSS, 3) },
  };
}
