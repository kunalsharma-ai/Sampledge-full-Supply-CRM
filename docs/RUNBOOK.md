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

## Security events
- Revoke a person's access: remove their membership; their sessions stop at the next request. To end sessions immediately: `UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = '…';`
- Rotate `JWT_SECRET`: every session ends; people sign in again.
- Check isolation at any time: `GET /api/v1/admin/security` as an administrator must show `enforced: true`.
- Audit trail: `GET /api/v1/audit?entity=…&take=100`, paged with `X-Next-Cursor`.

## AI provider
`GET /api/v1/ai/status` shows the provider and month spend. At the cap (`AI_MONTHLY_CAP_USD`) tasks fall back to rules automatically. To switch the model off immediately, set `AI_PROVIDER=rules` and restart; nothing else changes.

## Load test
`node scripts/load-test.mjs --url http://staging:4000 --concurrency 20 --seconds 60` against a seeded staging stack, never production. Raise `RATE_LIMIT` for the test or it measures the rate limiter.
