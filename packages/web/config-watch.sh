#!/bin/sh
set -e

CONFIG_DIR="${CONFIG_DATA_DIR:-/data/geoip/config}"
PROXY_ENV="$CONFIG_DIR/proxy.env"
LAST_HASH=""

hash_file() {
  if [ -f "$PROXY_ENV" ]; then
    cksum "$PROXY_ENV" 2>/dev/null || wc -c < "$PROXY_ENV"
  else
    echo "missing"
  fi
}

reload_nginx_if_needed() {
  current="$(hash_file)"
  if [ "$current" != "$LAST_HASH" ]; then
    LAST_HASH="$current"
    if [ -f "$PROXY_ENV" ]; then
      # shellcheck disable=SC1090
      . "$PROXY_ENV"
    fi
    export API_KEY="${API_KEY:-}"
    envsubst '${API_KEY}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
    nginx -s reload 2>/dev/null || true
  fi
}

while true; do
  reload_nginx_if_needed
  sleep 5
done
