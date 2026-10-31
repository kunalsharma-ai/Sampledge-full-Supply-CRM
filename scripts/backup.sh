#!/usr/bin/env bash
# Logical backup of the Sampledge database (custom format, compressed) with a checksum and retention.
#
#   BACKUP_DATABASE_URL=postgresql://postgres:…@host:5432/sampledge  scripts/backup.sh [backup-dir]
#
# Run it with a superuser or a BYPASSRLS role: tables force row-level security, so the API's own
# role cannot dump them completely. Keeps the newest $BACKUP_KEEP_DAYS days (default 14).
set -euo pipefail
URL="${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (a superuser or BYPASSRLS role)}"
DIR="${1:-${BACKUP_DIR:-./backups}}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/sampledge-$STAMP.dump"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$FILE.partial" "$URL"
mv "$FILE.partial" "$FILE"
sha256sum "$FILE" | awk '{print $1}' > "$FILE.sha256"
# Sanity check: the archive must list the tables we expect.
pg_restore --list "$FILE" | grep -qE 'TABLE DATA public "?Project"? ' || { echo "backup looks incomplete: no Project data" >&2; exit 1; }
find "$DIR" -name 'sampledge-*.dump*' -type f -mtime +"$KEEP" -delete
echo "$FILE ($(du -h "$FILE" | cut -f1))"
