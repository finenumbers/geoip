#!/bin/sh
set -e

export API_KEY="${API_KEY:-}"
envsubst '${API_KEY}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
