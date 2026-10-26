#!/usr/bin/env bash
# Daily backup of the production database (docker-compose.prod.yml), proven restorable.
#
#   infra/scripts/backup.sh                       # from the repository root on the server
#   crontab: 30 2 * * * cd /opt/asistcontrol && infra/scripts/backup.sh >> backups/backup.log 2>&1
#
# 1. Dumps the database (pg_dump custom format, compressed).
# 2. Restores that dump into a scratch database and compares row counts: a backup nobody
#    has restored is a hope, not a backup.
# 3. Deletes dumps older than BACKUP_KEEP_DAYS.
#
# Copy BACKUP_DIR off this server (NAS, external disk, company cloud). The secrets are NOT
# copied here on purpose: keep .env.production (above all DEVICE_SECRETS_KEY) in a password
# manager, apart from the data it protects.
#
#   BACKUP_DIR        where dumps go (default: ./backups)
#   BACKUP_KEEP_DAYS  days to keep (default: 14)
#   COMPOSE_ENV_FILE  env file of the stack (default: .env.production)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
DB=asistcontrol
DB_USER=asistcontrol
CHECK_DB=restore_check

psql() { "${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -v ON_ERROR_STOP=1 -qtA "$@"; }

umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y-%m-%d_%H%M)
file="$BACKUP_DIR/asistcontrol-$stamp.dump"

echo "[$(date -Is)] dumping $DB"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USER" -d "$DB" -Fc > "$file.partial"
mv "$file.partial" "$file"

echo "[$(date -Is)] restoring into $CHECK_DB to prove the dump works"
psql -d postgres -c "DROP DATABASE IF EXISTS $CHECK_DB" -c "CREATE DATABASE $CHECK_DB"
trap 'psql -d postgres -c "DROP DATABASE IF EXISTS $CHECK_DB" >/dev/null 2>&1 || true' EXIT
"${COMPOSE[@]}" exec -T postgres pg_restore -U "$DB_USER" -d "$CHECK_DB" --no-owner --exit-on-error \
  < "$file"

counts="SELECT concat_ws(',', (SELECT count(*) FROM users), (SELECT count(*) FROM employees),
  (SELECT count(*) FROM attendance_events), (SELECT count(*) FROM _prisma_migrations))"
live=$(psql -d "$DB" -c "$counts")
restored=$(psql -d "$CHECK_DB" -c "$counts")
# Rows may arrive between the dump and this count, and none are ever deleted (soft deletes,
# immutable punches): the restored copy can only be equal or behind, never ahead or empty.
IFS=, read -r lu le la lm <<<"$live"
IFS=, read -r ru re ra rm <<<"$restored"
if (( rm != lm || ru > lu || re > le || ra > la || (lu > 0 && ru == 0) )); then
  echo "restore check FAILED: live users,employees,events,migrations=$live restored=$restored" >&2
  exit 1
fi
echo "[$(date -Is)] ok: $file ($(du -h "$file" | cut -f1)); users=$ru employees=$re events=$ra"

find "$BACKUP_DIR" -name 'asistcontrol-*.dump' -mtime +"$KEEP_DAYS" -print -delete \
  | sed 's/^/deleted old backup: /'
