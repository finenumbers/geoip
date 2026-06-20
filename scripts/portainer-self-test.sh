#!/usr/bin/env bash
# End-to-end Portainer deploy simulation — writes evidence to debug log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_PATH="$ROOT/.cursor/debug-5fd4d1.log"
SESSION_ID="5fd4d1"
ENDPOINT="http://127.0.0.1:7902/ingest/02332259-3549-48bf-a861-1deae571b22d"
SIM=/tmp/portainer-e2e-test-$$
RUN_ID="${DEBUG_RUN_ID:-self-test}"

log_event() {
  local hypothesis_id="$1" location="$2" message="$3" data_json="$4"
  local ts line
  ts=$(($(date +%s) * 1000))
  line=$(printf '{"sessionId":"%s","runId":"%s","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s}\n' \
    "$SESSION_ID" "$RUN_ID" "$hypothesis_id" "$location" "$message" "$data_json" "$ts")
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '%s\n' "$line" >> "$LOG_PATH"
  curl -sS -X POST "$ENDPOINT" -H 'Content-Type: application/json' -H "X-Debug-Session-Id: $SESSION_ID" -d "$line" >/dev/null 2>&1 || true
}

mkdir -p "$SIM/infra/portainer" "$SIM/infra/pgbouncer" "$SIM/scripts"
cp "$ROOT/docker-compose.yml" "$ROOT/docker-compose.prod.yml" "$SIM/"
cp "$ROOT/infra/portainer/docker-compose.images.yml" "$ROOT/infra/portainer/stack.compose.yml" "$SIM/infra/portainer/"
cp "$ROOT/infra/pgbouncer/"* "$SIM/infra/pgbouncer/"
cp "$ROOT/scripts/backup-postgres.sh" "$SIM/scripts/"

has_packages=false
[[ -d "$SIM/packages" ]] && has_packages=true
log_event "A" "portainer-self-test:setup" "simulated Portainer stack dir" \
  "{\"simDir\":\"$SIM\",\"hasPackages\":$has_packages}"

# Old path: build fails
old_out=$(cd "$SIM/infra/portainer" && docker compose -f stack.compose.yml build 2>&1 || true)
old_fail=false
echo "$old_out" | grep -q 'packages: no such file' && old_fail=true
log_event "B" "portainer-self-test:old-path" "stack.compose.yml build result" \
  "{\"failedAsExpected\":$old_fail,\"snippet\":\"$(echo "$old_out" | tail -1 | sed 's/"/\\"/g')\"}"

# New path: no build, GHCR images only
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:infra/portainer/docker-compose.images.yml
new_cfg=$(cd "$SIM" && docker compose config 2>/dev/null || true)
build_count=$(printf '%s\n' "$new_cfg" | grep -c '^    build:' || true)
ghcr_count=$(printf '%s\n' "$new_cfg" | grep -c '^    image: ghcr.io/finenumbers/' || true)
build_out=$(cd "$SIM" && docker compose build 2>&1 || true)
no_build=false
echo "$build_out" | grep -q 'No services to build' && no_build=true
log_event "D" "portainer-self-test:new-path" "COMPOSE_FILE config and build" \
  "{\"buildStanzaCount\":$build_count,\"ghcrImageCount\":$ghcr_count,\"noServicesToBuild\":$no_build}"

# GHCR pull
pull_out=$(cd "$SIM" && docker compose pull api web 2>&1 || true)
api_pulled=false
web_pulled=false
echo "$pull_out" | grep -q 'geoip-api.*Pulled\|geoip-api.*up to date' && api_pulled=true
echo "$pull_out" | grep -q 'geoip-web.*Pulled\|geoip-web.*up to date' && web_pulled=true
log_event "D" "portainer-self-test:ghcr-pull" "GHCR image pull" \
  "{\"apiPulled\":$api_pulled,\"webPulled\":$web_pulled}"

# Health check on pulled api image (one-off container, no stack up)
health_out=$(docker run --rm --entrypoint node ghcr.io/finenumbers/geoip-api:latest -e "console.log('image-ok')" 2>&1 || true)
image_runs=false
echo "$health_out" | grep -q 'image-ok' && image_runs=true
log_event "D" "portainer-self-test:api-image" "api image runs" "{\"nodeExecOk\":$image_runs}"

rm -rf "$SIM"

passed=0
$old_fail && ((passed++)) || true
$no_build && ((passed++)) || true
[[ "$build_count" -eq 0 ]] && ((passed++)) || true
$api_pulled && ((passed++)) || true
$web_pulled && ((passed++)) || true
$image_runs && ((passed++)) || true

log_event "SUMMARY" "portainer-self-test:done" "test results" \
  "{\"checksPassed\":$passed,\"checksTotal\":6,\"allPassed\":$([ "$passed" -eq 6 ] && echo true || echo false)}"

echo "Portainer self-test: $passed/6 checks passed"
echo "Log: $LOG_PATH"
[ "$passed" -eq 6 ]
