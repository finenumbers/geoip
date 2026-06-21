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

#region agent log
DEBUG_LOG="${GEOIP_DEBUG_LOG:-/data/geoip/config/.debug-entrypoint.log}"
_map_line="$(sed -n '2p' /etc/nginx/conf.d/default.conf 2>/dev/null || echo 'missing')"
_has_proxy_env="false"
[ -f "$PROXY_ENV" ] && _has_proxy_env="true"
_api_key_configured="false"
[ -n "$API_KEY" ] && _api_key_configured="true"
echo "geoip_web debug H1: hasProxyEnv=${_has_proxy_env} apiKeyConfigured=${_api_key_configured} mapLine=${_map_line}" >&2
#endregion

exec "$@"
