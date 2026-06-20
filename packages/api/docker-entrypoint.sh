#!/bin/sh
set -e

for dir in /tmp/geoip-import /tmp/geoip-exports; do
  if [ -d "$dir" ]; then
    chown -R node:node "$dir" 2>/dev/null || true
  fi
done

exec su-exec node "$@"
