# Runbook

## Health and signals
- `GET /api/v1/health`: database reachable and `outboxPending` (workflow events waiting).
- `GET /api/v1/metrics` (Bearer `METRICS_TOKEN`): `http_requests_total`, `http_request_duration_seconds`, `sampledge_outbox_pending`, `sampledge_outbox_dead`, `sampledge_active_sessions`, memory, uptime.
- Every response has `X-Request-Id`; error bodies include `requestId`. With `LOG_FORMAT=json` each request is one log line with the id, route, status, duration, tenant and user. Search logs by the id a user quotes.

Suggested alerts: `sampledge_outbox_dead > 0`; `sampledge_outbox_pending` above 100 for 10 minutes; 5xx rate above 1% for 5 minutes; p95 latency above 1 s for 10 minutes.

## Workflow events stuck or failing
Events retry 5 times and keep `lastError`. List them:
`SELECT id, type, attempts, "lastError" FROM "OutboxEvent" WHERE "processedAt" IS NULL ORDER BY "createdAt";`
Fix the cause, then requeue: `UPDATE "OutboxEvent" SET attempts = 0, "lockedUntil" = NULL WHERE id = '…';` Handlers are idempotent, so a requeue is safe.

## Backups
`BACKUP_DATABASE_URL=postgresql://sampledge_ops:…@db/sampledge scripts/backup.sh /backups` writes `sampledge-<UTC time>.dump` and a `.sha256`, checks the archive lists table data, and deletes backups older than `BACKUP_KEEP_DAYS` (14). Run it daily and copy the files off the database host.

## Restore (verified in the build container: 26 projects, 51 audit entries and 25 RLS-forced tables restored)
1. Create an empty database owned by the application role: `CREATE DATABASE sampledge_restored OWNER sampledge;`
2. `RESTORE_DATABASE_URL=postgresql://sampledge:…@db/sampledge_restored scripts/restore.sh /backups/sampledge-….dump` (verifies the checksum, refuses a non-empty target, prints row counts).
3. Compare counts with the source, then point `DATABASE_URL` at the restored database and restart the API.
Data loads before the policies are re-created, so the application role can restore; it cannot *dump* (use `sampledge_ops`).

## Workspaces (tenants)
Create a workspace and its first platform admin on the server, as the operations role:
`cd apps/api && node dist/tenant.js create --name "Acme Research" --slug acme --admin-email ops@acme.example --admin-name "Ana Ops"`.
A new person gets a temporary password printed once; an existing account is added with its password unchanged. `node dist/tenant.js list` shows every workspace with its member count. Retention policies are set per workspace in Admin & Security → Data retention and run daily from the worker; each run is in that workspace's audit trail.

## Security events
- Revoke a person's access: remove their membership; their sessions stop at the next request. To end sessions immediately: `UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = '…';`
- Rotate `JWT_SECRET`: every session ends; people sign in again.
- Check isolation at any time: `GET /api/v1/admin/security` as an administrator must show `enforced: true`.
- Audit trail: `GET /api/v1/audit?entity=…&take=100`, paged with `X-Next-Cursor`.

## AI provider
`GET /api/v1/ai/status` shows the provider and month spend. At the cap (`AI_MONTHLY_CAP_USD`) tasks fall back to rules automatically. To switch the model off immediately, set `AI_PROVIDER=rules` and restart; nothing else changes.

Before changing a prompt, a task version or the model, run the evaluation set and compare: `node dist/ai/evals/run.js` (rules, free), `node dist/ai/evals/run.js --provider anthropic --md evals.md` (the model; about 17 calls). It exits non-zero on any critical failure. Admins also see the scorecard on the Automation page and can run it on the connected model there.

## Load test
`node scripts/load-test.mjs --url http://staging:4000 --concurrency 20 --seconds 60` against a seeded staging stack, never production. Give several instances comma-separated (`--url http://a:4000,http://b:4000`) to spread requests round-robin. Rate limits are shared by all instances, so raise `RATE_LIMIT` for the test or it measures the rate limiter.

## Several instances
`node scripts/multi-instance-check.mjs --urls http://a:4000,http://b:4000 --login-limit $LOGIN_RATE_LIMIT` checks sessions, idempotency, the outbox worker, live updates and the shared sign-in limit across instances. A user locked out by the sign-in limit can be released early with `DELETE FROM "RateLimitBucket" WHERE "blockedUntil" > now();` (all addresses).
