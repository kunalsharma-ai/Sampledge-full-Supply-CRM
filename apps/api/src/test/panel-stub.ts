/**
 * A local stand-in for the Turn2Opinion panel backend, built from its OpenAPI description, for
 * tests only. It reproduces the envelope ({status, message, data}), bearer tokens that work only on
 * the panel that issued them (403 otherwise), and the routes the adapter calls. Its numbers are
 * made up; nothing here says what the real backend returns inside `data`.
 */
import { createServer, type Server } from 'node:http';

export type StubRequest = { panel: string; method: string; path: string; body: unknown; auth: string | undefined };

export async function startPanelStub() {
  const requests: StubRequest[] = [];
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
    url: (panel: string) => `http://127.0.0.1:${port}/${panel}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
