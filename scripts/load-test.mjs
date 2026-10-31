#!/usr/bin/env node
// Small HTTP load test with no dependencies: N concurrent clients for D seconds over a mix of
// signed-in reads and public respondent starts. Reports throughput, latency percentiles and errors.
//
//   node scripts/load-test.mjs [--url http://localhost:4000] [--concurrency 20] [--seconds 20]
//   node scripts/load-test.mjs --url http://localhost:4000,http://localhost:4001   (round-robin over instances)
// Rate limits are shared by all instances (Postgres store), so raise RATE_LIMIT on the API for a run.
// Needs a seeded database (uses the demo executive account). Do not point it at production.
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASES = arg('url', process.env.API_URL ?? 'http://localhost:4000').split(',').map((u) => `${u.replace(/\/$/, '')}/api/v1`);
let rr = 0;
const base = () => BASES[rr++ % BASES.length];
const BASE = BASES[0];
const C = Number(arg('concurrency', 20));
const SECONDS = Number(arg('seconds', 20));

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'executive@demo.sampledge.test', password: 'demo1234', returnToken: true }) });
if (!login.ok) { console.error('sign-in failed', login.status, await login.text()); process.exit(1); }
const { token } = await login.json();
const auth = { authorization: `Bearer ${token}` };

const mix = [
  { name: 'GET /projects', w: 4, run: () => fetch(`${base()}/projects`, { headers: auth }) },
  { name: 'GET /dashboard/summary', w: 3, run: () => fetch(`${base()}/dashboard/summary`, { headers: auth }) },
  { name: 'GET /opportunities', w: 2, run: () => fetch(`${base()}/opportunities`, { headers: auth }) },
  { name: 'GET /surveys/sv-012/results', w: 1, run: () => fetch(`${base()}/surveys/sv-012/results?banner=S2`, { headers: auth }) },
  { name: 'POST /r/sv-cloud/start (public, refused: draft)', w: 2, run: () => fetch(`${base()}/r/sv-cloud/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'loadtest', respondent: 'anon' }) }) },
];
const bag = mix.flatMap((m) => Array(m.w).fill(m));
const stats = new Map(mix.map((m) => [m.name, { lat: [], errors: 0, codes: {} }]));
const end = Date.now() + SECONDS * 1000;

async function worker() {
  while (Date.now() < end) {
    const m = bag[Math.floor(Math.random() * bag.length)];
    const s = stats.get(m.name);
    const t0 = performance.now();
    try {
      const r = await m.run();
      await r.arrayBuffer();
      s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
      if (r.status >= 500 || r.status === 429) s.errors++;
    } catch { s.errors++; }
    s.lat.push(performance.now() - t0);
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: C }, worker));
const secs = (Date.now() - t0) / 1000;
const pct = (a, p) => a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(0) : '-';
let total = 0, errors = 0;
const all = [];
console.log(`\n${C} clients · ${secs.toFixed(1)} s · ${BASES.join(' + ')}\n`);
console.log('endpoint'.padEnd(36), 'req'.padStart(7), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'p99 ms'.padStart(8), 'errors'.padStart(7), ' statuses');
for (const [name, s] of stats) {
  total += s.lat.length; errors += s.errors; all.push(...s.lat);
  console.log(name.padEnd(36), String(s.lat.length).padStart(7), pct(s.lat, 0.5).padStart(8), pct(s.lat, 0.95).padStart(8), pct(s.lat, 0.99).padStart(8), String(s.errors).padStart(7), ' ' + JSON.stringify(s.codes));
}
console.log(`\ntotal ${total} requests · ${(total / secs).toFixed(0)} req/s · p50 ${pct(all, 0.5)} ms · p95 ${pct(all, 0.95)} ms · p99 ${pct(all, 0.99)} ms · errors ${errors}`);
process.exit(errors ? 1 : 0);
