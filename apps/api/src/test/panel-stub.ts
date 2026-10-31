/**
 * A local stand-in for the Turn2Opinion panel backend, built from its OpenAPI description, for
 * tests only. It reproduces the envelope ({status, message, data}), bearer tokens that work only on
 * the panel that issued them (403 otherwise), and the routes the adapter calls. Its numbers are
 * made up; nothing here says what the real backend returns inside `data`.
 */
import { createServer, type Server } from 'node:http';

export type StubRequest = { panel: string; method: string; path: string; body: unknown; auth: string | undefined };

export type StubFeedItem = { responseID: string; status: string; updatedAt: string; [k: string]: unknown };

export async function startPanelStub() {
  const requests: StubRequest[] = [];
  /** Projects synced through PUT /api/v1/sampledge/project, per panel and pid. */
  const projects = new Map<string, unknown>();
  /** Response feed per panel and pid, set by the test. */
  const feed = new Map<string, StubFeedItem[]>();
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const [, panel, ...rest] = (req.url ?? '/').split('/');
      const path = `/${rest.join('/')}`;
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      const auth = req.headers.authorization;
      requests.push({ panel, method: req.method ?? 'GET', path, body, auth });
      const send = (code: number, payload: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (!auth?.startsWith('Bearer ')) return send(401, { status: 'error', message: 'Unauthorized' });
      if (auth !== `Bearer tok-${panel}`) return send(403, { status: 'error', message: 'Token origin mismatch' });
      const ok = (data: unknown) => send(200, { status: 'success', message: 'OK (stub)', data });
      const m = req.method;
      if (m === 'GET' && path === '/api/v1/me/') return ok({ name: 'Sampledge app user (stub)', role: 'app' });
      if (m === 'POST' && path === '/api/v1/cpi/') return ok({ stub: true, input: body });
      if (m === 'GET' && path.startsWith('/api/v1/cpi/categories')) return ok([{ category: 'B2C (stub)' }]);
      if (m === 'GET' && path.startsWith('/api/v1/feasibility/options/')) return ok([{ value: 'stub-option' }]);
      if (m === 'POST' && path === '/api/v1/feasibility/') return ok({ stub: true, filterReceived: body });
      // The panel's Sampledge routes (routes/sampledge.js in the model patch).
      const [route, query = ''] = path.split('?');
      const qs = new URLSearchParams(query);
      if (route.startsWith('/api/v1/sampledge/')) {
        const r = route.slice('/api/v1/sampledge'.length);
        if (m === 'POST' && r === '/feasibility') return ok({ stub: true, country: (body as { country?: string })?.country, total: 120, active: 48, byGender: { female: 30, male: 18 }, received: body });
        if (m === 'PUT' && r === '/project') {
          const b = body as { pid: string; markets: { marketID: string; quotas?: unknown[] }[] };
          projects.set(`${panel}:${b.pid}`, b);
          return ok({ pid: b.pid, status: 'Drafted', markets: b.markets.map((x) => ({ marketID: x.marketID, quotas: (x.quotas ?? []).length })) });
        }
        if (r === '/questions') return ok({ builtIn: ['gender', 'age', 'ageBand', 'region', 'category'], questions: [{ name: 'car_ownership', label: 'Do you own a car? (stub)', type: 'radio', options: [{ label: 'Yes', value: 'yes' }] }] });
        const rp = r.match(/^\/respondent-profile\/([^/]+)$/);
        if (rp) return ok({ respondentID: rp[1], panel, countryCode: 'US', ageBand: '30-34', gender: 'female', stub: true });
        const pr = r.match(/^\/project\/([^/]+)(\/responses)?$/);
        if (pr) {
          const key = `${panel}:${decodeURIComponent(pr[1])}`;
          if (!projects.has(key)) return send(404, { status: 'error', message: 'Unknown project' });
          if (!pr[2]) {
            const synced = projects.get(key) as { markets: { marketID: string; completes?: number }[] };
            const items = feed.get(key) ?? [];
            const n = (st: string) => items.filter((x) => x.status === st).length;
            const share = (v: number, i: number) => Math.floor(v / synced.markets.length) + (i === 0 ? v % synced.markets.length : 0);
            return ok({ pid: pr[1], status: 'Drafted', stub: true, markets: synced.markets.map((m, i) => ({
              marketID: m.marketID, status: 'Drafted', target: m.completes ?? null,
              counts: { complete: share(n('complete'), i), terminate: share(n('terminate'), i), qualityTerminate: share(n('qualityterminate'), i) },
              incidence: n('complete') + n('terminate') ? Math.round((n('complete') / (n('complete') + n('terminate'))) * 1000) / 1000 : null, medianLoiMinutes: 11,
            })) });
          }
          const all = [...(feed.get(key) ?? [])].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.responseID.localeCompare(b.responseID));
          const limit = Number(qs.get('limit') ?? 100);
          let rows = all;
          const cur = qs.get('cursor');
          if (cur) {
            const c = JSON.parse(Buffer.from(cur, 'base64url').toString()) as { t: string; id: string };
            rows = all.filter((x) => x.updatedAt > c.t || (x.updatedAt === c.t && x.responseID > c.id));
          }
          const page = rows.slice(0, limit);
          const last = page[page.length - 1];
          return ok({ items: page, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ t: last.updatedAt, id: last.responseID })).toString('base64url') : null });
        }
        return send(404, { status: 'error', message: 'Not found (stub)' });
      }
      const pm = path.match(/^\/api\/v1\/project\/([^/]+)(\/qualified)?$/);
      if (pm) {
        if (pm[1] === 'boom') return send(500, { status: 'error', message: 'Internal error (stub)' });
        if (m === 'GET') return ok({ id: pm[1], stub: true, qualified: !!pm[2] });
        if (m === 'POST' || m === 'PATCH' || m === 'DELETE') return ok({ id: pm[1], accepted: true, method: m });
      }
      return send(404, { status: 'error', message: 'Not found (stub)' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    requests,
    projects,
    feed,
    url: (panel: string) => `http://127.0.0.1:${port}/${panel}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
