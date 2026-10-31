#!/usr/bin/env node
// Checks that several API instances behind one database behave as one service. Run it against
// two (or more) API processes started with WORKER_INLINE=false plus a separate `node dist/worker.js`:
//
//   node scripts/multi-instance-check.mjs --urls http://localhost:4000,http://localhost:4001 --login-limit 30
//
// 1. a session signed in on one instance is accepted by the others, and sign-out on one ends it everywhere
// 2. an Idempotency-Key replay on another instance returns the stored response and writes nothing twice
// 3. a write on instance A queues outbox events that the separate worker processes, and the live
//    update reaches browsers connected to instance B (Postgres NOTIFY)
// 4. the sign-in rate limit is shared: --login-limit attempts across all instances, not per instance
//    (run this last: it blocks sign-in from this address for a minute)
//
// Creates one opportunity titled "Multi-instance check … (TEST)" and its feasibility requests in the
// demo workspace. Needs a seeded database. Do not point it at production.
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URLS = arg('urls', 'http://localhost:4000,http://localhost:4001').split(',').map((u) => `${u.replace(/\/$/, '')}/api/v1`);
const LOGIN_LIMIT = Number(arg('login-limit', 0));
if (URLS.length < 2) { console.error('give at least two --urls'); process.exit(2); }
const [A, B] = URLS;

let failed = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!cond) failed++;
  return cond;
};
const json = (base, method, p, { token, body, headers } = {}) =>
  fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));
const login = async (base) => {
  const r = await json(base, 'POST', '/auth/login', { body: { email: 'bizdev@demo.sampledge.test', password: 'demo1234', returnToken: true } });
  if (r.status !== 200) { console.error('sign-in failed', r.status, r.body); process.exit(1); }
  return r.body.token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens GET /live on an instance and collects the events it sends. */
async function listen(base, token) {
  const ctl = new AbortController();
  const events = [];
  const res = await fetch(`${base}/live`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctl.signal });
  if (res.status !== 200) throw new Error(`live stream refused: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const ready = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  return { events, close: () => { ctl.abort(); return ready; } };
}
const waitFor = async (fn, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(200); } return false; };

console.log(`Instances: ${URLS.join(', ')}\n`);

// 0. All instances up, same build
const health = await Promise.all(URLS.map((u) => json(u, 'GET', '/health')));
ok(health.every((h) => h.status === 200), 'every instance answers /health');
ok(new Set(health.map((h) => h.body?.version)).size === 1, 'every instance runs the same version', health.map((h) => h.body?.version).join(', '));

// 1. Sessions
const token = await login(A);
const meB = await json(B, 'GET', '/auth/me', { token });
ok(meB.status === 200 && meB.body?.user?.email === 'bizdev@demo.sampledge.test', 'session from instance A accepted by instance B');

// 2. Idempotency across instances
const clients = await json(A, 'GET', '/clients?take=1', { token });
const clientId = clients.body?.[0]?.id ?? clients.body?.items?.[0]?.id;
const title = `Multi-instance check ${new Date().toISOString().slice(0, 19)} (TEST)`;
const opp = { title, clientId, audience: 'B2B', countries: ['US', 'GB'], sampleSize: 300, incidence: 0.2, loi: 12, owner: 'Multi-instance check' };
const key = `mi-check-${Date.now()}`;
const first = await json(A, 'POST', '/opportunities', { token, body: opp, headers: { 'idempotency-key': key } });
ok(first.status === 201 && !!first.body?.id, 'write on instance A with an Idempotency-Key', `status ${first.status}`);
const replay = await json(B, 'POST', '/opportunities', { token, body: opp, headers: { 'idempotency-key': key } });
ok(replay.status === first.status && replay.headers.get('idempotent-replayed') === 'true' && replay.body?.id === first.body?.id, 'same key on instance B replays the stored response', `status ${replay.status}, replayed ${replay.headers.get('idempotent-replayed')}`);
const misuse = await json(B, 'POST', '/opportunities', { token, body: { ...opp, sampleSize: 301 }, headers: { 'idempotency-key': key } });
ok(misuse.status === 422, 'same key with a different body is refused on instance B', `status ${misuse.status}`);
const list = await json(B, 'GET', '/opportunities', { token });
const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
ok(rows.filter((o) => o.title === title).length === 1, 'the opportunity was created once');

// 3. Outbox worker and live updates across instances
const streamB = await listen(B, token);
const streamA = await listen(A, token);
await sleep(300);
const feas = await json(A, 'POST', `/opportunities/${first.body.id}/feasibility`, { token, body: {} });
ok(feas.status === 201 && feas.body?.created > 0, 'feasibility requested on instance A', `created ${feas.body?.created}`);
const gotB = await waitFor(() => streamB.events.some((e) => e.type === 'feasibility.requested'));
ok(gotB, 'live update for that write reached the browser on instance B (worker processed the outbox, NOTIFY fanned out)');
const gotQueued = await waitFor(() => streamB.events.some((e) => e.type === 'message.queued'));
ok(gotQueued, 'follow-on event (vendor message queued) also processed and delivered to instance B');
ok(streamA.events.some((e) => e.type === 'feasibility.requested'), 'instance A received the same live update');
const drained = await waitFor(async () => (await json(A, 'GET', '/health')).body?.outboxPending === 0);
ok(drained, 'outbox drained to zero by the worker');
await Promise.all([streamA.close(), streamB.close()]);

// Sign-out on B ends the session on A too
const out = await json(B, 'POST', '/auth/logout', { token });
const meA = await json(A, 'GET', '/auth/me', { token });
ok(out.status < 300 && meA.status === 401, 'sign-out on instance B ends the session on instance A', `logout ${out.status}, then /auth/me on A ${meA.status}`);

// 4. Shared sign-in limit
if (LOGIN_LIMIT > 0) {
  let first429 = 0;
  for (let i = 1; i <= LOGIN_LIMIT * URLS.length + 2; i++) {
    const r = await json(URLS[i % URLS.length], 'POST', '/auth/login', { body: { email: 'nobody@multi-instance.check', password: 'wrong-password' } });
    if (r.status === 429) { first429 = i; break; }
  }
  ok(first429 > 0 && first429 <= LOGIN_LIMIT + 1, `sign-in limit of ${LOGIN_LIMIT}/min is shared by all instances`, first429 ? `first refusal at attempt ${first429} of a per-instance ${LOGIN_LIMIT * URLS.length}` : 'never refused');
  const after = await Promise.all(URLS.map((u) => json(u, 'POST', '/auth/login', { body: { email: 'nobody@multi-instance.check', password: 'x' } })));
  ok(after.every((r) => r.status === 429), 'every instance refuses further attempts from this address');
} else console.log('SKIP  shared sign-in limit (pass --login-limit with the instances\' LOGIN_RATE_LIMIT)');

console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'}`);
process.exit(failed ? 1 : 0);
