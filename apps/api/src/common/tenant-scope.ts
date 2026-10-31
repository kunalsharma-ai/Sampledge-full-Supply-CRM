/**
 * Per-request tenant scope for Postgres row-level security.
 *
 * A middleware opens an empty scope for every request; the auth guard fills in the caller's tenant
 * for authenticated routes. PrismaService reads it and sets `app.tenant_id` on the connection for
 * each query, so the database itself refuses rows from other tenants even if a service forgets a
 * `tenantId` filter. Code outside a request (worker, seed, public respondent routes, sign-in)
 * has no tenant in scope and runs as the system, relying on its explicit filters.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantScope = { tenantId?: string; inTx?: boolean };
export const tenantScope = new AsyncLocalStorage<TenantScope>();

/** Express middleware: one fresh, mutable scope per request. */
export function tenantScopeMiddleware(_req: unknown, _res: unknown, next: () => void) {
  tenantScope.run({}, next);
}

/** Run `fn` as a given tenant (used by tests and by background jobs that act for one tenant). */
export function asTenant<T>(tenantId: string, fn: () => PromiseLike<T>): Promise<T> {
  // Awaited inside the scope: Prisma queries are lazy and only run when awaited.
  return tenantScope.run({ tenantId }, async () => await fn());
}

/**
 * Narrow the current request's scope to one tenant once a public route has resolved it (the
 * survey a respondent opened, the workspace a person signed in to). From then on the database
 * enforces that tenant for the rest of the request. Refuses to switch an already-set tenant.
 */
export function enterTenant(tenantId: string) {
  const s = tenantScope.getStore();
  if (!s) return;
  if (s.tenantId && s.tenantId !== tenantId) throw new Error('This request is already scoped to another workspace');
  s.tenantId = tenantId;
}
