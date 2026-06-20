#!/bin/sh
set -e

for dir in /tmp/geoip-import /tmp/geoip-exports "${CONFIG_DATA_DIR:-/data/geoip/config}"; do
  if [ -n "$dir" ]; then
    mkdir -p "$dir"
    chown -R node:node "$dir" 2>/dev/null || true
  fi
done

exec su-exec node "$@"
