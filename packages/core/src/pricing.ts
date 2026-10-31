/**
 * Rate-card CPI estimator shared by the Bidding CRM, Sample Exchange and AI vendor selection.
 * Produces ESTIMATES from each vendor's (demo) rate card. These are never presented as supplier
 * confirmations; Phase 4 adds real feasibility requests whose responses replace the estimate.
 */
import type { Vendor } from './demo/data';
import { clamp } from './utils';

export type Audience = 'B2C' | 'B2B' | 'Healthcare';
export type QuoteInput = { audience: Audience; country: string; n: number; ir: number; loi: number; deadlineDays?: number };

export function baseCpi(v: Vendor, a: Audience) {
  return a === 'B2C' ? v.cpiB2C : a === 'B2B' ? v.cpiB2B : v.cpiHC;
}

/** Industry-style adjustment: CPI rises as incidence falls and interview length grows. */
export function estimateCpi(v: Vendor, q: QuoteInput) {
  const irFactor = Math.sqrt(clamp(0.35 / Math.max(q.ir, 0.01), 0.75, 4));
  const loiFactor = Math.pow(clamp(q.loi, 3, 60) / 15, 0.6);
  return +(baseCpi(v, q.audience) * irFactor * loiFactor).toFixed(2);
}

/** Rough feasible completes within the field window, from response rate and reach (demo heuristic). */
export function estimateCapacity(v: Vendor, q: QuoteInput) {
  const reach = q.audience === 'B2C' ? 9000 : q.audience === 'B2B' ? 1800 : 700;
  return Math.round(reach * v.responseRate * 10 * q.ir * v.speed * ((q.deadlineDays ?? 14) / 14));
}

export function eligibleVendors(q: QuoteInput, vendors: Vendor[]) {
  return vendors.filter((v) => v.coverage.includes(q.country) && v.audiences.includes(q.audience));
}

export type Weights = { cpi: number; quality: number; reliability: number; response: number; coverage: number; speed: number };
export const defaultWeights: Weights = { cpi: 0.3, quality: 0.25, reliability: 0.2, response: 0.1, coverage: 0.05, speed: 0.1 };

/**
 * Explainable vendor ranking: each factor normalised 0..1 across eligible vendors, combined with
 * user-adjustable weights. Returns the per-factor contributions so the UI can explain the score.
 */
export function rankVendors(q: QuoteInput, vendors: Vendor[], w: Weights = defaultWeights) {
  const el = eligibleVendors(q, vendors);
  if (!el.length) return [];
  const cpis = el.map((v) => estimateCpi(v, q));
  const lo = Math.min(...cpis), hi = Math.max(...cpis);
  const norm = (x: number, a: number, b: number) => (b - a < 1e-9 ? 1 : (x - a) / (b - a));
  const field = (k: keyof Vendor) => el.map((v) => v[k] as number);
  const rng = (a: number[]) => [Math.min(...a), Math.max(...a)] as const;
  const [qa, qb] = rng(field('quality')), [ra, rb] = rng(field('reliability')), [pa, pb] = rng(field('responseRate')), [sa, sb] = rng(field('speed'));
  const cov = el.map((v) => v.coverage.length), [ca, cb] = rng(cov);
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  return el
    .map((v, i) => {
      const parts = {
        cpi: (1 - norm(cpis[i], lo, hi)) * w.cpi,
        quality: norm(v.quality, qa, qb) * w.quality,
        reliability: norm(v.reliability, ra, rb) * w.reliability,
        response: norm(v.responseRate, pa, pb) * w.response,
        coverage: norm(cov[i], ca, cb) * w.coverage,
        speed: norm(v.speed, sa, sb) * w.speed,
      };
      const score = Object.values(parts).reduce((s, x) => s + x, 0) / total;
      return { vendor: v, cpi: cpis[i], capacity: estimateCapacity(v, q), score, parts };
    })
    .sort((a, b) => b.score - a.score);
}

/** Greedy allocation of n completes across ranked vendors, respecting estimated capacity. */
export function allocate(q: QuoteInput, ranked: ReturnType<typeof rankVendors>) {
  let left = q.n;
  const out: { vendor: Vendor; completes: number; cpi: number }[] = [];
  for (const r of ranked) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, Math.round(r.capacity * 0.8)));
    if (take > 0) { out.push({ vendor: r.vendor, completes: take, cpi: r.cpi }); left -= take; }
  }
  return { lines: out, shortfall: Math.max(0, left), blendedCpi: out.reduce((s, l) => s + l.cpi * l.completes, 0) / Math.max(1, q.n - Math.max(0, left)) };
}
