/**
 * Data processing: rim weighting (raking), weighting diagnostics, and open-end coding helpers.
 * Import-free so the browser, the API and the unit tests share one implementation.
 */

type Ans = string | string[] | number | Record<string, string>;
type Row = { id: string; answers: Record<string, Ans> };

/** Target shares per variable: question id → option code → share (each variable sums to 1). */
export type RimTargets = Record<string, Record<string, number>>;

export type RakeResult = {
  weights: Record<string, number>; // response id → weight (mean 1 over weighted rows)
  iterations: number;
  converged: boolean;
  maxDeviation: number; // largest |weighted share − target| after the last iteration
  efficiency: number; // effective base ÷ n
  effectiveBase: number;
  minWeight: number;
  maxWeight: number;
  excluded: number; // rows missing a weighting variable or with a code that has no target (weight 1, not raked)
  achieved: Record<string, Record<string, { target: number; unweighted: number; weighted: number }>>;
};

/**
 * Iterative proportional fitting over the target variables, with weights capped to [cap⁻¹, cap]
 * after each pass. Rows that lack a value for any target variable are left at weight 1 and counted
 * in `excluded`. Throws when a variable's targets do not sum to 1 (±0.5%) or a targeted code has no
 * respondents (raking cannot create people who are not in the sample).
 */
export function rake(rows: Row[], targets: RimTargets, opts: { maxIterations?: number; tolerance?: number; cap?: number } = {}): RakeResult {
  const vars = Object.keys(targets);
  if (!vars.length) throw new Error('Add at least one weighting variable');
  for (const v of vars) {
    const sum = Object.values(targets[v]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.005) throw new Error(`Targets for ${v} add up to ${(sum * 100).toFixed(1)}%, not 100%`);
  }
  const cap = opts.cap ?? 5;
  const tol = opts.tolerance ?? 0.001;
  const maxIt = opts.maxIterations ?? 100;
  const usable = rows.filter((r) => vars.every((v) => typeof r.answers[v] === 'string' && (r.answers[v] as string) in targets[v]));
  for (const v of vars) for (const [code, t] of Object.entries(targets[v])) {
    if (t > 0 && !usable.some((r) => r.answers[v] === code)) throw new Error(`No respondents with ${v} = ${code}, so its ${(t * 100).toFixed(1)}% target cannot be reached`);
  }
  const w = new Array(usable.length).fill(1);
  const share = (v: string) => {
    const tot = w.reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {};
    usable.forEach((r, i) => { const c = r.answers[v] as string; out[c] = (out[c] ?? 0) + w[i] / tot; });
    return out;
  };
  let it = 0;
  let dev = Infinity;
  while (it < maxIt && dev > tol) {
    it++;
    for (const v of vars) {
      const cur = share(v);
      usable.forEach((r, i) => { const c = r.answers[v] as string; if (cur[c]) w[i] *= targets[v][c] / cur[c]; });
    }
    const mean = w.reduce((a, b) => a + b, 0) / (w.length || 1);
    for (let i = 0; i < w.length; i++) w[i] = Math.min(cap, Math.max(1 / cap, w[i] / mean));
    dev = Math.max(...vars.flatMap((v) => { const s = share(v); return Object.entries(targets[v]).map(([c, t]) => Math.abs((s[c] ?? 0) - t)); }));
  }
  const weights: Record<string, number> = {};
  rows.forEach((r) => { weights[r.id] = 1; });
  usable.forEach((r, i) => { weights[r.id] = Math.round(w[i] * 10000) / 10000; });
  const all = rows.map((r) => weights[r.id]);
  const s = all.reduce((a, b) => a + b, 0), s2 = all.reduce((a, b) => a + b * b, 0);
  const eff = s2 ? (s * s) / s2 : 0;
  const achieved: RakeResult['achieved'] = {};
  for (const v of vars) {
    const ws = share(v);
    achieved[v] = Object.fromEntries(Object.entries(targets[v]).map(([c, t]) => [c, { target: t, unweighted: usable.length ? usable.filter((r) => r.answers[v] === c).length / usable.length : 0, weighted: Math.round((ws[c] ?? 0) * 10000) / 10000 }]));
  }
  return {
    weights, iterations: it, converged: dev <= tol, maxDeviation: Math.round(dev * 10000) / 10000,
    efficiency: rows.length ? Math.round((eff / rows.length) * 1000) / 1000 : 0, effectiveBase: Math.round(eff * 10) / 10,
    minWeight: Math.min(...all), maxWeight: Math.max(...all), excluded: rows.length - usable.length, achieved,
  };
}

// ───────────────────────── Open-end coding

export type Code = { code: string; label: string; keywords: string[] };

const STOP = new Set('a an and are as at be been but by can did do does for from get got had has have i if in is it its just me more my no not of on or our so than that the their them then there they this to too very was we were what when which who will with would you your really much also only about after again all am any because being both could each few into most other over same should some such through under until up very while why dont doesnt didnt cant im ive its isnt wasnt'.split(' '));
const tokens = (t: string) => t.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

/**
 * Suggests a codeframe from verbatims: the most frequent content words (after removing stop words
 * and a light stem) become codes with their co-occurring keywords. A starting point for a coder,
 * not a finished frame.
 */
export function suggestCodeframe(texts: string[], maxCodes = 8): Code[] {
  const docs = texts.map((t) => [...new Set(tokens(t).map(stem))]);
  // Show each stem as the word people actually wrote most often.
  const forms = new Map<string, Map<string, number>>();
  texts.forEach((t) => tokens(t).forEach((w) => { const m = forms.get(stem(w)) ?? new Map(); m.set(w, (m.get(w) ?? 0) + 1); forms.set(stem(w), m); }));
  const word = (st: string) => [...(forms.get(st) ?? new Map([[st, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const df = new Map<string, number>();
  docs.forEach((d) => d.forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const min = Math.max(2, Math.ceil(texts.length * 0.02));
  const ranked = [...df.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const codes: Code[] = [];
  const used = new Set<string>();
  for (const [w] of ranked) {
    if (codes.length >= maxCodes) break;
    if (used.has(w)) continue;
    // Words that mostly appear together with this one join it as keywords.
    const withW = docs.filter((d) => d.includes(w));
    const co = new Map<string, number>();
    withW.forEach((d) => d.forEach((x) => { if (x !== w && !used.has(x)) co.set(x, (co.get(x) ?? 0) + 1); }));
    const partners = [...co.entries()].filter(([x, n]) => n / withW.length >= 0.6 && (df.get(x) ?? 0) <= withW.length * 1.2).map(([x]) => x).slice(0, 3);
    [w, ...partners].forEach((x) => used.add(x));
    const shown = [w, ...partners].map(word);
    codes.push({ code: `C${codes.length + 1}`, label: shown.join(' / '), keywords: shown });
  }
  return codes;
}

/** Codes whose keywords appear in the text (stem match); 'other' when none match a non-empty answer. */
export function codeText(text: string, frame: Code[]): string[] {
  const words = new Set(tokens(text).map(stem));
  if (!words.size) return [];
  const hit = frame.filter((c) => c.keywords.some((k) => words.has(stem(k.toLowerCase()))) ).map((c) => c.code);
  return hit.length ? hit : ['other'];
}
