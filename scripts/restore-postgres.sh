#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup.sql.gz>" >&2
  echo "Restores into DATABASE_URL (default: postgresql://geoip:geoip@localhost:5433/geoip)" >&2
  exit 1
fi

BACKUP_FILE="$1"
DATABASE_URL="${DATABASE_URL:-postgresql://geoip:geoip@localhost:5433/geoip}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "Restoring $BACKUP_FILE into $DATABASE_URL"
gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "Restore complete"
