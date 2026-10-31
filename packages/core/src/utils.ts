export function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
export function sum(a: number[]) { return a.reduce((s, x) => s + x, 0); }
export function avg(a: number[]) { return a.length ? sum(a) / a.length : 0; }
/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
