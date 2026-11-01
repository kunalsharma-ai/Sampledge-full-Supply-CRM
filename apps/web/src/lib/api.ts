'use client';
/**
 * Browser client for the Sampledge API. Requests go to same-origin /api/v1 (Next rewrites them to
 * the API server), so the httpOnly session cookie is sent automatically and never readable by JS.
 */
import type { CrmStage, LifecycleStage, ModuleId, Opportunity, Permission, Project, Role, SurveyDef, SurveySummary, Vendor } from './core';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}
/** Thrown when the API cannot be reached at all (not running, network down). */
export class ApiUnreachable extends Error {}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await apiWithCursor<T>(path, init)).body;
}

/** Like `api`, and also returns the list cursor (`X-Next-Cursor`) when the API has more rows. */
export async function apiWithCursor<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ body: T; next: string | null }> {
  const method = init.method ?? 'GET';
  // Every write carries an Idempotency-Key, so the one automatic retry after a dropped connection
  // cannot apply the same change twice (the API replays the first response instead).
  const key = method === 'GET' ? undefined : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const send = () => fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let r: Response;
  try {
    r = await send();
  } catch {
    try { r = await send(); } catch { throw new ApiUnreachable('API unreachable'); }
  }
  // The Next proxy answers 500/502/504 with a non-JSON body when the API process is down.
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { if (r.status >= 500) throw new ApiUnreachable('API unreachable'); }
  if (!r.ok) {
    const m = (body as { message?: unknown } | null)?.message;
    throw new ApiError(r.status, typeof m === 'string' ? m : Array.isArray(m) ? m.join('; ') : `Request failed (${r.status})`, body);
  }
  return { body: body as T, next: r.headers.get('x-next-cursor') };
}

const withCursor = (path: string, cursor: string) => `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`;

/** One page of a list plus the cursor for the next one. */
export async function apiPage<T>(path: string, cursor?: string | null) {
  const r = await apiWithCursor<T[]>(cursor ? withCursor(path, cursor) : path);
  return { rows: r.body, next: r.next };
}

/**
 * Every page of a list, for screens that work on the whole set (boards, totals, search).
 * Stops after `maxRows` and says so, rather than loading without limit.
 */
export async function apiAll<T>(path: string, maxRows = 5000): Promise<T[] & { truncated?: boolean }> {
  const out: T[] & { truncated?: boolean } = [];
  let cursor: string | null = null;
  do {
    const { rows, next }: { rows: T[]; next: string | null } = await apiPage<T>(path, cursor);
    out.push(...rows);
    cursor = next;
  } while (cursor && out.length < maxRows);
  if (cursor) out.truncated = true;
  return out;
}

export type Session = {
  user: { id: string; name: string; email: string; mfaEnabled: boolean };
  tenant: { id: string; name: string; slug: string };
  role: Role;
  vendorId: string | null;
  clientId: string | null;
  permissions: Permission[];
  modules: Record<ModuleId, 'full' | 'read' | 'scoped' | 'none'>;
};

export const demoLoginsEnabled = process.env.NEXT_PUBLIC_DEMO_LOGINS !== 'false';
export const DEMO_PASSWORD = 'demo1234';
export const demoEmail = (role: Role) => `${role.replace(/_/g, '.')}@demo.sampledge.test`;

// ───────────────────────── API record shapes → the web's shared record types
type ApiProject = Omit<Project, 'type' | 'start' | 'deadline' | 'vendors' | 'quotas' | 'surveyId' | 'demo'> & {
  audience: Project['type']; start: string; deadline: string;
  quotas: { key: string; label: string; target: number; count: number }[];
  allocations?: { vendorId: string }[]; surveys?: { id: string }[];
  cpiCost?: number; budget?: number; costIncurred?: number;
};
export const fromApiProject = (p: ApiProject): Project => ({
  ...p,
  type: p.audience,
  stage: p.stage as LifecycleStage,
  start: p.start.slice(0, 10),
  deadline: p.deadline.slice(0, 10),
  cpiCost: p.cpiCost ?? 0,
  budget: p.budget ?? 0,
  costIncurred: p.costIncurred ?? 0,
  vendors: [...new Set((p.allocations ?? []).map((a) => a.vendorId))],
  quotas: p.quotas.map((q) => ({ id: q.key, label: q.label, target: q.target, achieved: q.count })),
  surveyId: p.surveys?.[0]?.id,
  demo: true,
});

type ApiOpp = Omit<Opportunity, 'type' | 'ir' | 'created' | 'lastTouch' | 'demo' | 'lossReason' | 'margin'> & {
  audience: Opportunity['type']; incidence: number; createdAt: string; lastTouch: string; lossReason: string | null; margin?: number; projectId: string | null;
};
export const fromApiOpp = (o: ApiOpp): Opportunity & { projectId?: string | null } => ({
  ...o, stage: o.stage as CrmStage, type: o.audience, ir: o.incidence, margin: o.margin ?? 0, created: o.createdAt.slice(0, 10), lastTouch: o.lastTouch.slice(0, 10),
  lossReason: o.lossReason ?? undefined, demo: true,
});

export type ApiSurvey = Omit<SurveySummary, 'demo' | 'questions' | 'projectId'> & { projectId: string | null; questionCount: number; hasDefinition: boolean; currentVersion: number };
export const fromApiSurvey = (s: ApiSurvey): SurveySummary => ({ ...s, projectId: s.projectId ?? undefined, questions: s.questionCount, demo: true });

export type ApiVendor = Vendor;

export type ApiApproval = { id: string; agentId: string | null; kind: string; title: string; projectId: string | null; amount: number | null; status: 'pending' | 'approved' | 'rejected'; createdAt: string; canDecide: boolean; requestedBy: string; decidedBy: string | null };
export type ApiNotification = { id: string; title: string; body: string; module: string; read: boolean; createdAt: string };
export type ApiAgent = {
  id: string; key: string; name: string; description: string; enabled: boolean; available: boolean; unavailable: string | null; requiresApprovalFor: string[];
  everyMinutes: number; settings: Record<string, number>; nextRunAt: string | null; lastRunAt: string | null;
  runs30d: number; successRate: number | null; avgMs: number | null; produced30d: { notifications: number; approvals: number; messages: number };
};
export type ApiSurveyDetail = ApiSurvey & { definition: SurveyDef | null };

export function relTime(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}
