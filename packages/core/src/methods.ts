/**
 * Advanced research methods: experimental designs and their analyses.
 *
 * - MaxDiff: balanced design generator (item frequency, pair co-occurrence and position balance)
 *   and counting scores.
 * - Choice-based conjoint: level-balanced random design with minimal overlap, and aggregate
 *   multinomial-logit part-worths (effects coding) with attribute importances.
 * - Van Westendorp price sensitivity meter: OPP, IPP, PMC and PME by interpolated intersections.
 * - Gabor-Granger: demand curve and revenue-maximising price.
 * - TURF: optimal portfolio reach (exhaustive when small enough, greedy otherwise).
 *
 * Self-contained (no imports) so it runs in the browser, the API and the test runner unchanged.
 * Hierarchical Bayes estimation is not implemented: MaxDiff uses counts, conjoint an aggregate MNL.
 */

function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// ───────────────────────── MaxDiff

export type MaxDiffDesign = {
  items: number;
  perSet: number;
  setsPerVersion: number;
  versions: number[][][]; // version → set → item indexes (0-based)
  diagnostics: { appearancesMin: number; appearancesMax: number; pairMin: number; pairMax: number; positionMaxDeviation: number };
};

/** Sets per version needed so each item shows about `timesShown` times (3 is the usual minimum). */
export function maxDiffSetsNeeded(items: number, perSet: number, timesShown = 3) {
  return Math.ceil((items * timesShown) / perSet);
}

export function maxDiffDesign(opts: { items: number; perSet: number; sets?: number; versions?: number; seed?: number }): MaxDiffDesign {
  const { items, perSet } = opts;
  if (items < 3) throw new Error('MaxDiff needs at least 3 items');
  if (perSet < 2 || perSet >= items) throw new Error('Items per set must be at least 2 and fewer than the number of items');
  const sets = opts.sets ?? maxDiffSetsNeeded(items, perSet);
  const nVersions = Math.max(1, opts.versions ?? 1);
  const r = prng(opts.seed ?? 1);
  const freq = new Array(items).fill(0);
  const pairs = Array.from({ length: items }, () => new Array(items).fill(0));
  const pos = Array.from({ length: items }, () => new Array(perSet).fill(0));
  const versions: number[][][] = [];
  for (let v = 0; v < nVersions; v++) {
    const version: number[][] = [];
    const vFreq = new Array(items).fill(0);
    for (let s = 0; s < sets; s++) {
      const set: number[] = [];
      while (set.length < perSet) {
        let best = -1;
        let bestCost = Infinity;
        for (let i = 0; i < items; i++) {
          if (set.includes(i)) continue;
          // Within-version frequency dominates, then overall frequency, then pair co-occurrence.
          const cost = vFreq[i] * 1000 + freq[i] * 10 + set.reduce((a, j) => a + pairs[i][j], 0) + r() * 0.5;
          if (cost < bestCost) { bestCost = cost; best = i; }
        }
        set.push(best);
      }
      // Position balance: place the item least often seen in each position.
      const ordered: number[] = [];
      const left = [...set];
      for (let p = 0; p < perSet; p++) {
        left.sort((a, b) => pos[a][p] - pos[b][p] || r() - 0.5);
        const it = left.shift()!;
        ordered.push(it);
        pos[it][p]++;
      }
      for (const i of set) { freq[i]++; vFreq[i]++; for (const j of set) if (i !== j) pairs[i][j]++; }
      version.push(ordered);
    }
    versions.push(version);
  }
  const pairVals: number[] = [];
  for (let i = 0; i < items; i++) for (let j = i + 1; j < items; j++) pairVals.push(pairs[i][j]);
  const expectedPos = (sets * nVersions * perSet) / items / perSet;
  const posDev = Math.max(...pos.flat().map((x) => Math.abs(x - expectedPos)));
  return {
    items, perSet, setsPerVersion: sets, versions,
    diagnostics: { appearancesMin: Math.min(...freq), appearancesMax: Math.max(...freq), pairMin: Math.min(...pairVals), pairMax: Math.max(...pairVals), positionMaxDeviation: round(posDev, 2) },
  };
}

export type MaxDiffAnswer = { set: number[]; best: number; worst: number };

/** Counting analysis: (best − worst) / times shown, per item, rescaled 0–100 for display. */
export function maxDiffScores(items: string[], answers: MaxDiffAnswer[]) {
  const shown = new Array(items.length).fill(0);
  const best = new Array(items.length).fill(0);
  const worst = new Array(items.length).fill(0);
  for (const a of answers) {
    if (a.best === a.worst || !a.set.includes(a.best) || !a.set.includes(a.worst)) continue;
    a.set.forEach((i) => shown[i]++);
    best[a.best]++;
    worst[a.worst]++;
  }
  const raw = items.map((_, i) => (shown[i] ? (best[i] - worst[i]) / shown[i] : 0));
  return items
    .map((label, i) => ({ item: label, shown: shown[i], best: best[i], worst: worst[i], score: round(raw[i]), index: round(((raw[i] + 1) / 2) * 100, 1) }))
    .sort((a, b) => b.score - a.score);
}

// ───────────────────────── Choice-based conjoint

export type Attribute = { name: string; levels: string[] };
export type ConjointTask = { alternatives: number[][] }; // alternative → level index per attribute
export type ConjointDesign = { attributes: Attribute[]; versions: ConjointTask[][]; levelBalance: number };

export function conjointDesign(opts: { attributes: Attribute[]; tasks: number; alternatives: number; versions?: number; seed?: number }): ConjointDesign {
  const { attributes, tasks, alternatives } = opts;
  if (attributes.length < 2) throw new Error('Conjoint needs at least 2 attributes');
  if (attributes.some((a) => a.levels.length < 2)) throw new Error('Each attribute needs at least 2 levels');
  const r = prng(opts.seed ?? 7);
  const counts = attributes.map((a) => new Array(a.levels.length).fill(0));
  const versions: ConjointTask[][] = [];
  for (let v = 0; v < Math.max(1, opts.versions ?? 10); v++) {
    const vt: ConjointTask[] = [];
    for (let t = 0; t < tasks; t++) {
      const alts: number[][] = [];
      for (let a = 0; a < alternatives; a++) {
        let alt: number[];
        let guard = 0;
        do {
          alt = attributes.map((attr, k) => {
            // Least-used level not already in this task where possible (minimal overlap), random tiebreak.
            const used = new Set(alts.map((x) => x[k]));
            const cands = attr.levels.map((_, l) => l).filter((l) => used.size >= attr.levels.length || !used.has(l));
            cands.sort((x, y) => counts[k][x] - counts[k][y] || r() - 0.5);
            return cands[0];
          });
          guard++;
        } while (alts.some((x) => x.every((l, k) => l === alt[k])) && guard < 20);
        alt.forEach((l, k) => counts[k][l]++);
        alts.push(alt);
      }
      vt.push({ alternatives: alts });
    }
    versions.push(vt);
  }
  const balance = Math.max(...counts.map((c) => Math.max(...c) - Math.min(...c)));
  return { attributes, versions, levelBalance: balance };
}

export type ConjointChoice = { task: ConjointTask; chosen: number | null }; // null = none / skipped

/**
 * Aggregate multinomial logit with effects coding, fitted by Newton–Raphson.
 * Returns part-worth utilities per level (zero-centred within each attribute) and importances.
 */
export function conjointEstimate(attributes: Attribute[], choices: ConjointChoice[], iterations = 50) {
  const params = attributes.reduce((s, a) => s + a.levels.length - 1, 0);
  const encode = (alt: number[]) => {
    const x: number[] = [];
    attributes.forEach((a, k) => {
      const L = a.levels.length;
      for (let l = 0; l < L - 1; l++) x.push(alt[k] === l ? 1 : alt[k] === L - 1 ? -1 : 0);
    });
    return x;
  };
  const data = choices.filter((c) => c.chosen !== null).map((c) => ({ X: c.task.alternatives.map(encode), y: c.chosen as number }));
  if (!data.length) throw new Error('No choices to estimate from');
  let beta = new Array(params).fill(0);
  let ll = 0;
  for (let it = 0; it < iterations; it++) {
    const g = new Array(params).fill(0);
    const H = Array.from({ length: params }, () => new Array(params).fill(0));
    ll = 0;
    for (const { X, y } of data) {
      const u = X.map((x) => x.reduce((s, xi, i) => s + xi * beta[i], 0));
      const m = Math.max(...u);
      const e = u.map((v) => Math.exp(v - m));
      const z = e.reduce((a, b) => a + b, 0);
      const p = e.map((v) => v / z);
      ll += Math.log(p[y]);
      const xbar = new Array(params).fill(0);
      X.forEach((x, j) => x.forEach((xi, i) => (xbar[i] += p[j] * xi)));
      for (let i = 0; i < params; i++) g[i] += X[y][i] - xbar[i];
      X.forEach((x, j) => {
        for (let a = 0; a < params; a++) for (let b = 0; b < params; b++) H[a][b] -= p[j] * (x[a] - xbar[a]) * (x[b] - xbar[b]);
      });
    }
    for (let i = 0; i < params; i++) H[i][i] -= 1e-6; // ridge for stability
    const step = solve(H, g.map((v) => -v));
    beta = beta.map((b, i) => b + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  let k = 0;
  const partWorths = attributes.map((a) => {
    const vals = a.levels.slice(0, -1).map(() => beta[k++]);
    vals.push(-vals.reduce((s, v) => s + v, 0));
    return { attribute: a.name, levels: a.levels.map((level, i) => ({ level, utility: round(vals[i]) })) };
  });
  const ranges = partWorths.map((pw) => Math.max(...pw.levels.map((l) => l.utility)) - Math.min(...pw.levels.map((l) => l.utility)));
  const total = ranges.reduce((s, x) => s + x, 0) || 1;
  const nullLl = data.reduce((s, d) => s + Math.log(1 / d.X.length), 0);
  return {
    partWorths,
    importance: attributes.map((a, i) => ({ attribute: a.name, importance: round(ranges[i] / total, 3) })),
    fit: { choices: data.length, logLikelihood: round(ll, 2), mcFaddenR2: round(1 - ll / nullLl, 3) },
  };
}

function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Share of preference for products in a market simulation (logit rule). */
export function conjointSimulate(est: ReturnType<typeof conjointEstimate>, products: Record<string, string>[]) {
  const u = products.map((pr) => est.partWorths.reduce((s, pw) => s + (pw.levels.find((l) => l.level === pr[pw.attribute])?.utility ?? 0), 0));
  const e = u.map((v) => Math.exp(v - Math.max(...u)));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => round(v / z, 4));
}

// ───────────────────────── Van Westendorp

export type VwAnswer = { tooCheap: number; cheap: number; expensive: number; tooExpensive: number };

function crossing(prices: number[], a: number[], b: number[]) {
  for (let i = 1; i < prices.length; i++) {
    const d0 = a[i - 1] - b[i - 1];
    const d1 = a[i] - b[i];
    if (d0 === 0) return prices[i - 1];
    if (Math.sign(d0) !== Math.sign(d1)) return round(prices[i - 1] + ((prices[i] - prices[i - 1]) * d0) / (d0 - d1), 2);
  }
  return null;
}

export function vanWestendorp(answers: VwAnswer[], steps = 200) {
  const valid = answers.filter((a) => [a.tooCheap, a.cheap, a.expensive, a.tooExpensive].every((x) => Number.isFinite(x) && x >= 0) && a.tooCheap <= a.cheap && a.cheap <= a.expensive && a.expensive <= a.tooExpensive);
  if (valid.length < 2) throw new Error('Need at least 2 consistent answers (too cheap ≤ cheap ≤ expensive ≤ too expensive)');
  const lo = Math.min(...valid.map((a) => a.tooCheap));
  const hi = Math.max(...valid.map((a) => a.tooExpensive));
  const prices = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
  const n = valid.length;
  const share = (f: (a: VwAnswer) => boolean) => valid.filter(f).length / n;
  const tooCheap = prices.map((p) => share((a) => a.tooCheap >= p));
  const cheap = prices.map((p) => share((a) => a.cheap >= p));
  const expensive = prices.map((p) => share((a) => a.expensive <= p));
  const tooExpensive = prices.map((p) => share((a) => a.tooExpensive <= p));
  const notCheap = cheap.map((x) => 1 - x);
  const notExpensive = expensive.map((x) => 1 - x);
  return {
    n, excluded: answers.length - n,
    points: {
      pointOfMarginalCheapness: crossing(prices, tooCheap, notCheap),
      optimalPricePoint: crossing(prices, tooCheap, tooExpensive),
      indifferencePricePoint: crossing(prices, cheap, expensive),
      pointOfMarginalExpensiveness: crossing(prices, tooExpensive, notExpensive),
    },
    curves: prices.map((p, i) => ({ price: round(p, 2), tooCheap: round(tooCheap[i], 3), cheap: round(cheap[i], 3), expensive: round(expensive[i], 3), tooExpensive: round(tooExpensive[i], 3) })),
  };
}

// ───────────────────────── Gabor-Granger

/** answers: per respondent, price → would buy. Demand at each price is the share saying yes. */
export function gaborGranger(prices: number[], answers: Record<number, boolean>[]) {
  const ps = [...prices].sort((a, b) => a - b);
  const curve = ps.map((p) => {
    const asked = answers.filter((a) => p in a);
    const demand = asked.length ? asked.filter((a) => a[p]).length / asked.length : 0;
    return { price: p, n: asked.length, demand: round(demand, 3), revenueIndex: round(p * demand, 3) };
  });
  const best = curve.reduce((a, b) => (b.revenueIndex > a.revenueIndex ? b : a), curve[0]);
  // Arc elasticities between adjacent price points.
  const elasticity = curve.slice(1).map((c, i) => {
    const a = curve[i];
    const dq = (c.demand - a.demand) / ((c.demand + a.demand) / 2 || 1);
    const dp = (c.price - a.price) / ((c.price + a.price) / 2);
    return { from: a.price, to: c.price, elasticity: round(dq / dp, 2) };
  });
  return { curve, revenueMaximisingPrice: best.price, elasticity };
}

// ───────────────────────── TURF

function combos(n: number, k: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return Math.round(c);
}

/**
 * reach[r][i] = respondent r would choose item i. Returns the best portfolio of size k
 * (exhaustive search up to `maxCombos`, otherwise greedy) and the incremental reach ladder.
 */
export function turf(items: string[], reach: boolean[][], k: number, opts: { maxCombos?: number; weights?: number[] } = {}) {
  const n = items.length;
  if (k < 1 || k > n) throw new Error('Portfolio size must be between 1 and the number of items');
  const w = opts.weights ?? reach.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const evalSet = (set: number[]) => {
    let r = 0;
    let f = 0;
    reach.forEach((row, ri) => { const hits = set.filter((i) => row[i]).length; if (hits) r += w[ri]; f += hits * w[ri]; });
    return { reach: r / total, frequency: f / total };
  };
  let best: number[] = [];
  let method: 'exhaustive' | 'greedy' = 'greedy';
  if (combos(n, k) <= (opts.maxCombos ?? 200_000)) {
    method = 'exhaustive';
    let bestVal = -1;
    let bestFreq = -1;
    const cur: number[] = [];
    const rec = (start: number) => {
      if (cur.length === k) {
        const v = evalSet(cur);
        if (v.reach > bestVal + 1e-12 || (Math.abs(v.reach - bestVal) < 1e-12 && v.frequency > bestFreq)) { bestVal = v.reach; bestFreq = v.frequency; best = [...cur]; }
        return;
      }
      for (let i = start; i <= n - (k - cur.length); i++) { cur.push(i); rec(i + 1); cur.pop(); }
    };
    rec(0);
  } else {
    while (best.length < k) {
      let bi = -1;
      let bv = -1;
      for (let i = 0; i < n; i++) if (!best.includes(i)) { const v = evalSet([...best, i]).reach; if (v > bv) { bv = v; bi = i; } }
      best.push(bi);
    }
  }
  // Ladder: order the chosen items by incremental reach.
  const ladder: { item: string; reach: number; increment: number }[] = [];
  const chosen: number[] = [];
  const pool = [...best];
  let prev = 0;
  while (pool.length) {
    pool.sort((a, b) => evalSet([...chosen, b]).reach - evalSet([...chosen, a]).reach);
    const i = pool.shift()!;
    chosen.push(i);
    const r = evalSet(chosen).reach;
    ladder.push({ item: items[i], reach: round(r, 4), increment: round(r - prev, 4) });
    prev = r;
  }
  const v = evalSet(best);
  return { method, portfolio: best.map((i) => items[i]), reach: round(v.reach, 4), frequency: round(v.frequency, 3), ladder };
}
