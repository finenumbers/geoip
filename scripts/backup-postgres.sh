#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DATABASE_URL="${DATABASE_URL:-postgresql://geoip:geoip@localhost:5433/geoip}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
OUTPUT="$BACKUP_DIR/geoip_${TIMESTAMP}.sql.gz"

echo "[$(date -Iseconds)] Writing backup to $OUTPUT"
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$OUTPUT"
echo "[$(date -Iseconds)] Done ($(du -h "$OUTPUT" | awk '{print $1}'))"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'geoip_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
fi
