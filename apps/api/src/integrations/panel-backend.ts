/**
 * Adapter for the Turn2Opinion panel backend (one service serving Turn2Opinion, MyFrequentRewards
 * and MyHealthOpinions; it tells the panels apart by host, and a token works only on the host
 * that issued it). Written from the backend's OpenAPI description
 * (docs/integrations/turn2opinion-openapi.yaml).
 *
 * Status: NOT VERIFIED against a running backend. The description types most request and response
 * bodies only as `object`, so this adapter
 *   - sends only fields the description names (CPI) or bodies the caller supplies unchanged,
 *   - returns the backend's `data` as it comes, without assuming field names,
 *   - is "not connected" unless a URL and an app token are configured for that panel.
 * Calls that change something on the panel (invites, soft launch, cancel) never run from here
 * directly: they go through a Sampledge approval and are sent once by the worker.
 */
import { Injectable, Logger } from '@nestjs/common';

export const PANELS = {
  t2o: 'Turn2Opinion',
  mfr: 'MyFrequentRewards',
  mho: 'MyHealthOpinions',
} as const;
export type PanelId = keyof typeof PANELS;
export const panelIds = Object.keys(PANELS) as PanelId[];

export type PanelConfig = { panel: PanelId; name: string; url: string | null; token: string | null; connected: boolean };

/** Per panel: PANEL_T2O_URL + PANEL_T2O_TOKEN (a long-lived app token issued by the backend's /user/apps). */
export function panelConfig(panel: PanelId): PanelConfig {
  const key = panel.toUpperCase();
  const url = process.env[`PANEL_${key}_URL`]?.replace(/\/+$/, '') || null;
  const token = process.env[`PANEL_${key}_TOKEN`] || null;
  return { panel, name: PANELS[panel], url, token, connected: !!(url && token) };
}

/** The workspace whose people may use the panel connection (the panels' owner). */
export const panelTenant = () => process.env.PANEL_BACKEND_TENANT ?? 'sampledge-demo';

export class PanelBackendError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export type PanelReply = { status: number; data: unknown; message: string | null };

const TIMEOUT_MS = Number(process.env.PANEL_TIMEOUT_MS ?? 15_000);
const MAX_BYTES = 2_000_000;

@Injectable()
export class PanelBackend {
  private log = new Logger('PanelBackend');

  /**
   * One request to a panel. Reads the backend's envelope ({status, message, data}); anything that
   * is not "success" becomes a PanelBackendError carrying the backend's message.
   */
  async call(panel: PanelId, method: string, path: string, body?: unknown): Promise<PanelReply> {
    const cfg = panelConfig(panel);
    if (!cfg.connected) throw new PanelBackendError(503, `${cfg.name} backend is not connected (set PANEL_${panel.toUpperCase()}_URL and PANEL_${panel.toUpperCase()}_TOKEN)`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${cfg.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json', ...(body !== undefined && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
        redirect: 'error',
      });
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? `timed out after ${TIMEOUT_MS} ms` : (e as Error).message;
      this.log.warn(`${panel} ${method} ${path}: ${msg}`);
      throw new PanelBackendError(502, `${cfg.name} backend unreachable: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new PanelBackendError(502, `${cfg.name} backend reply too large (${text.length} bytes)`);
    let env: { status?: unknown; message?: unknown; data?: unknown } | null = null;
    try { env = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const message = typeof env?.message === 'string' ? env.message : null;
    if (!res.ok || (env && env.status !== undefined && env.status !== 'success')) {
      const why = res.status === 401 ? 'token missing or not accepted'
        : res.status === 403 ? 'token issued for a different panel host (origin mismatch) or not allowed'
        : message ?? `HTTP ${res.status}`;
      throw new PanelBackendError(res.ok ? 502 : res.status, `${cfg.name} backend refused ${method} ${path}: ${why}`, env ?? text.slice(0, 500));
    }
    if (env === null) throw new PanelBackendError(502, `${cfg.name} backend sent a reply that is not JSON`);
    return { status: res.status, data: env.data ?? null, message };
  }

  // ───── Read-only calls (no approval needed)
  /** Verifies the token by reading the app user's own profile. */
  whoami(panel: PanelId) { return this.call(panel, 'GET', '/api/v1/me/'); }
  cpi(panel: PanelId, q: { category: string; subcategory?: string; ir: number; loi: number; country: string }) { return this.call(panel, 'POST', '/api/v1/cpi/', q); }
  cpiCategories(panel: PanelId, category?: string) { return this.call(panel, 'GET', `/api/v1/cpi/categories${category ? `?category=${encodeURIComponent(category)}` : ''}`); }
  feasibilityOptions(panel: PanelId, country: string, field: string) { return this.call(panel, 'GET', `/api/v1/feasibility/options/${encodeURIComponent(country)}/${encodeURIComponent(field)}`); }
  /** Count of panelists matching a filter. The filter's shape is the backend's; it is passed through unchanged. */
  feasibility(panel: PanelId, filter: Record<string, unknown>) { return this.call(panel, 'POST', '/api/v1/feasibility/', filter); }
  project(panel: PanelId, id: string) { return this.call(panel, 'GET', `/api/v1/project/${encodeURIComponent(id)}`); }
  qualified(panel: PanelId, id: string) { return this.call(panel, 'GET', `/api/v1/project/${encodeURIComponent(id)}/qualified`); }
}

/** Calls that change the panel, each behind an approval kind. Paths and methods from the description. */
export const panelActions = {
  invites: { method: 'POST', path: (id: string) => `/api/v1/project/${encodeURIComponent(id)}`, kind: 'High-volume communications', label: 'Schedule invites' },
  'soft-launch': { method: 'PATCH', path: (id: string) => `/api/v1/project/${encodeURIComponent(id)}`, kind: 'High-volume communications', label: 'Soft launch' },
  cancel: { method: 'DELETE', path: (id: string) => `/api/v1/project/${encodeURIComponent(id)}`, kind: 'Deleting records', label: 'Cancel project' },
} as const;
export type PanelAction = keyof typeof panelActions;
