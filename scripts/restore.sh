#!/usr/bin/env bash
# Restore a backup into a NEW, empty database and check it.
#
#   RESTORE_DATABASE_URL=postgresql://sampledge:…@host:5432/sampledge_restored  scripts/restore.sh backups/sampledge-….dump
#
# The target database must exist and be empty (create it owned by the application role). The script
# refuses a non-empty target, verifies the checksum, restores, and prints row counts so they can be
# compared with production. Point the API at the restored database only after checking them.
set -euo pipefail
FILE="${1:?usage: scripts/restore.sh <backup.dump>}"
URL="${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL to the empty target database}"
if [ -f "$FILE.sha256" ]; then
  [ "$(sha256sum "$FILE" | awk '{print $1}')" = "$(cat "$FILE.sha256")" ] || { echo "checksum mismatch: $FILE" >&2; exit 1; }
fi
TABLES="$(psql "$URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$TABLES" = "0" ] || { echo "target database is not empty ($TABLES tables); refusing to restore over it" >&2; exit 1; }
# Data loads before the row-level-security and policy entries (post-data), so the application role can restore.
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$URL" "$FILE"
psql "$URL" -At -c "SELECT 'migrations', count(*) FROM _prisma_migrations" \
  -c "SELECT 'tenants', count(*) FROM \"Tenant\"" -c "SELECT 'projects', count(*) FROM \"Project\"" \
  -c "SELECT 'responses', count(*) FROM \"Response\"" -c "SELECT 'audit entries', count(*) FROM \"AuditLog\"" \
  -c "SELECT 'tables with forced RLS', count(*) FROM pg_class WHERE relforcerowsecurity"
echo "restore complete"
