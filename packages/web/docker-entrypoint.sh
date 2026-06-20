#!/bin/sh
set -e

CONFIG_DIR="${CONFIG_DATA_DIR:-/data/geoip/config}"
PROXY_ENV="$CONFIG_DIR/proxy.env"

if [ -f "$PROXY_ENV" ]; then
  # shellcheck disable=SC1090
  . "$PROXY_ENV"
fi

export API_KEY="${API_KEY:-}"
envsubst '${API_KEY}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
