#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DATABASE_URL="${DATABASE_URL:-postgresql://geoip:geoip@localhost:5433/geoip}"

mkdir -p "$BACKUP_DIR"
OUTPUT="$BACKUP_DIR/geoip_${TIMESTAMP}.sql.gz"

echo "Writing backup to $OUTPUT"
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$OUTPUT"
echo "Done ($(du -h "$OUTPUT" | awk '{print $1}'))"
