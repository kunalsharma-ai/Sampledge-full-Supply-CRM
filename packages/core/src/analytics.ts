/**
 * Insight Studio statistics. The dataset is a SIMULATED respondent-level file (deterministic seed),
 * but every statistic computed from it is real: weighted counts, column %, two-proportion z-tests,
 * cell weighting and k-means segmentation.
 */
import { rng } from './utils';

export type Resp = { id: number; age: string; gender: string; region: string; brand: string; aware: number; consider: number; purchase: number; loyal: number; nps: number; price: number; quality: number; innovation: number; wave: number };
export const vars = {
  age: ['18–34', '35–54', '55+'],
  gender: ['Female', 'Male'],
  region: ['North America', 'Europe', 'APAC'],
  brand: ['Brand Aurora', 'Brand Borealis', 'Brand Cirrus', 'Brand Delta'],
} as const;
export type CatVar = keyof typeof vars;
export const metrics = { aware: 'Aware', consider: 'Consider', purchase: 'Purchased (P3M)', loyal: 'Loyal', promoter: 'NPS promoter (9–10)' } as const;
export type Metric = keyof typeof metrics;

export function makeDataset(n = 1200): Resp[] {
  const r = rng(424242);
  const pick = <T,>(a: readonly T[], w?: number[]) => { if (!w) return a[Math.floor(r() * a.length)]; let x = r() * w.reduce((s, v) => s + v, 0); for (let i = 0; i < a.length; i++) { x -= w[i]; if (x <= 0) return a[i]; } return a[a.length - 1]; };
  return Array.from({ length: n }, (_, id) => {
    const age = pick(vars.age, [0.42, 0.36, 0.22]); // skewed young: weighting corrects to 33/37/30
    const gender = pick(vars.gender, [0.55, 0.45]);
    const region = pick(vars.region, [0.4, 0.35, 0.25]);
    const brand = pick(vars.brand, [0.32, 0.28, 0.24, 0.16]);
    const youth = age === '18–34' ? 1 : age === '35–54' ? 0.5 : 0;
    const bBoost = { 'Brand Aurora': 0.12, 'Brand Borealis': 0.04, 'Brand Cirrus': -0.02, 'Brand Delta': -0.08 }[brand]!;
    const aware = r() < 0.72 + bBoost ? 1 : 0;
    const consider = aware && r() < 0.55 + bBoost + youth * 0.08 ? 1 : 0;
    const purchase = consider && r() < 0.5 + bBoost * 1.5 ? 1 : 0;
    const loyal = purchase && r() < 0.48 + (region === 'APAC' ? 0.1 : 0) ? 1 : 0;
    const nps = Math.max(0, Math.min(10, Math.round(6.4 + bBoost * 10 + (loyal ? 1.8 : 0) + (r() - 0.5) * 5)));
    const seg = Math.floor(r() * 3);
    const c = [[0.75, 0.35, 0.4], [0.3, 0.8, 0.45], [0.45, 0.5, 0.85]][seg];
    return { id, age, gender, region, brand, aware, consider, purchase, loyal, nps, price: c[0] + (r() - 0.5) * 0.3, quality: c[1] + (r() - 0.5) * 0.3, innovation: c[2] + (r() - 0.5) * 0.3 + youth * 0.05, wave: Math.floor(r() * 8) };
  });
}

export const ageTargets: Record<string, number> = { '18–34': 0.33, '35–54': 0.37, '55+': 0.3 };
export function weights(d: Resp[], on: boolean) {
  if (!on) return d.map(() => 1);
  const share: Record<string, number> = {};
  d.forEach((x) => (share[x.age] = (share[x.age] ?? 0) + 1 / d.length));
  return d.map((x) => ageTargets[x.age] / share[x.age]);
}

const isHit = (x: Resp, m: Metric) => (m === 'promoter' ? x.nps >= 9 : x[m] === 1);

export type Cell = { base: number; hits: number; pct: number; sigHigher: string[] };
/** Crosstab of metric incidence by `row` (category variable) × `col` (category variable), with column-letter significance (95%). */
export function crosstab(d: Resp[], w: number[], row: CatVar, col: CatVar, metric: Metric) {
  const cols = vars[col] as readonly string[];
  const rows = vars[row] as readonly string[];
  const letters = cols.map((_, i) => String.fromCharCode(65 + i));
  const table = rows.map((rv) =>
    cols.map((cv) => {
      let base = 0, hits = 0, effN = 0, w2 = 0;
      d.forEach((x, i) => { if (x[row] === rv && x[col] === cv) { base += w[i]; w2 += w[i] * w[i]; if (isHit(x, metric)) hits += w[i]; } });
      effN = w2 ? (base * base) / w2 : 0; // Kish effective base for weighted tests
      return { base, hits, pct: base ? hits / base : 0, effN, sigHigher: [] as string[] };
    }),
  );
  // two-proportion z-test between every pair of columns within a row
  table.forEach((r) => r.forEach((a, i) => r.forEach((b, j) => {
    if (i === j || a.effN < 30 || b.effN < 30) return;
    const p = (a.pct * a.effN + b.pct * b.effN) / (a.effN + b.effN);
    const se = Math.sqrt(p * (1 - p) * (1 / a.effN + 1 / b.effN));
    if (se > 0 && (a.pct - b.pct) / se > 1.96) a.sigHigher.push(letters[j]);
  })));
  const totals = cols.map((cv) => { let base = 0; d.forEach((x, i) => { if (x[col] === cv) base += w[i]; }); return base; });
  return { rows, cols, letters, table, totals };
}

/** Deterministic k-means (k-means++ seeding from fixed RNG). */
export function kmeans(points: number[][], k = 3, iters = 25) {
  const r = rng(99);
  const cents: number[][] = [points[Math.floor(r() * points.length)].slice()];
  while (cents.length < k) {
    const d2 = points.map((p) => Math.min(...cents.map((c) => c.reduce((s, v, i) => s + (v - p[i]) ** 2, 0))));
    let x = r() * d2.reduce((s, v) => s + v, 0);
    let idx = 0; for (; idx < d2.length; idx++) { x -= d2[idx]; if (x <= 0) break; }
    cents.push(points[Math.min(idx, points.length - 1)].slice());
  }
  let assign = points.map(() => 0);
  for (let t = 0; t < iters; t++) {
    assign = points.map((p) => { let best = 0, bd = Infinity; cents.forEach((c, ci) => { const dd = c.reduce((s, v, i) => s + (v - p[i]) ** 2, 0); if (dd < bd) { bd = dd; best = ci; } }); return best; });
    cents.forEach((c, ci) => { const m = points.filter((_, i) => assign[i] === ci); if (m.length) c.splice(0, c.length, ...c.map((_, d) => m.reduce((s, p) => s + p[d], 0) / m.length)); });
  }
  return { centroids: cents, assign };
}
