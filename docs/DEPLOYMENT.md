# Deployment

Sampledge runs as three processes: **Postgres 16**, the **API** (`apps/api`, NestJS, port 4000) and the **web app** (`apps/web`, Next.js, port 3000). The browser talks only to the web origin; Next forwards `/api/v1/*` to the API, so the session cookie stays first-party. The workflow worker runs inside the API unless `WORKER_INLINE=false`, in which case run `node dist/worker.js` as a fourth process.

## Database roles (row-level security)
Every tenant table has `FORCE ROW LEVEL SECURITY`. Postgres skips policies for superusers and `BYPASSRLS` roles, so:

| Role | Used by | Rights |
|---|---|---|
| `sampledge` | API, migrations | owns the database; **not** superuser, **not** BYPASSRLS |
| `sampledge_ops` | backups | `LOGIN BYPASSRLS`, member of `pg_read_all_data` |
| `postgres` | DBA only | superuser; never configured in the API |

`docker/db-init.sql` creates the application role for Docker. On a managed service, create the same roles by hand. The API logs a warning at start-up if it connects as a role that bypasses RLS, and **Admin → `GET /api/v1/admin/security`** reports what Postgres enforces for the current request.

## Environment
API (`apps/api/.env`, see `.env.example`): `DATABASE_URL`, `JWT_SECRET` (32+ random characters; production refuses `dev-` secrets), `WEB_ORIGIN`, `COOKIE_SECURE=true` behind HTTPS, `SESSION_HOURS`, `LOGIN_RATE_LIMIT`, `RATE_LIMIT`, `WORKER_INLINE`, `COMMS_HIGH_VOLUME`, `AI_PROVIDER` / `ANTHROPIC_API_KEY` / `AI_MONTHLY_CAP_USD`, `OIDC_*` for single sign-on, `LOG_FORMAT=json`, `METRICS_TOKEN`.
Web: `API_ORIGIN` (where Next forwards `/api/v1`), `NEXT_PUBLIC_DEMO_LOGINS=false` outside demos, `HSTS=true` when served over HTTPS.

## Steps
1. Create the database and roles (above).
2. `npx prisma migrate deploy` in `apps/api` (the API's Docker image does this on start).
3. Start the API and the web app (`docker compose up --build`, or the two images behind your load balancer). Do **not** run the seed outside demos: it truncates every table and refuses `NODE_ENV=production`.
4. Put both behind HTTPS. Keep `/api/v1/live` unbuffered (Server-Sent Events): for nginx, `proxy_buffering off` on that path.
5. Point Prometheus at `/api/v1/metrics` with `Authorization: Bearer $METRICS_TOKEN`.
6. Schedule `scripts/backup.sh` (see the runbook) and test a restore before go-live.

## Single sign-on
Register the app with your OpenID Connect provider as a confidential web client with redirect URI `https://<web origin>/api/v1/auth/sso/callback`, scopes `openid email profile`, PKCE S256. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_TENANT` (the workspace slug). People are not created on first sign-in; an administrator adds them first and the provider's verified e-mail must match. Tested against a local stub provider only; verify against your provider in staging.

## Capacity (measured, not a guarantee)
`node scripts/load-test.mjs --concurrency 20 --seconds 20` against one API process and a local Postgres in the build container: **307 requests/s, p50 58 ms, p95 137 ms, p99 179 ms, 0 errors** over a mix of signed-in reads (projects, dashboard, CRM, a 600-interview results computation) and public respondent starts. Results computation is the slowest call (p95 190 ms). Each tenant-scoped query runs in a short transaction to set the RLS tenant, which costs roughly one extra round trip. Re-measure on your hardware before sizing.
