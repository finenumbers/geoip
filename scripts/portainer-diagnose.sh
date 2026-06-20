#!/usr/bin/env bash
# Portainer deploy diagnostics — writes NDJSON to .cursor/debug-5fd4d1.log
set -euo pipefail

LOG_PATH="${DEBUG_LOG_PATH:-$(cd "$(dirname "$0")/.." && pwd)/.cursor/debug-5fd4d1.log}"
SESSION_ID="${DEBUG_SESSION_ID:-5fd4d1}"
RUN_ID="${DEBUG_RUN_ID:-pre-fix}"
ENDPOINT="${DEBUG_LOG_ENDPOINT:-http://127.0.0.1:7902/ingest/02332259-3549-48bf-a861-1deae571b22d}"

log_event() {
  local hypothesis_id="$1"
  local location="$2"
  local message="$3"
  local data_json="$4"
  local ts
  ts=$(($(date +%s) * 1000))
  local line
  line=$(printf '{"sessionId":"%s","runId":"%s","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s}\n' \
    "$SESSION_ID" "$RUN_ID" "$hypothesis_id" "$location" "$message" "$data_json" "$ts")
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '%s\n' "$line" >> "$LOG_PATH"
  curl -sS -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H "X-Debug-Session-Id: $SESSION_ID" \
    -d "$line" >/dev/null 2>&1 || true
}

# Hypothesis A/B: stack dir exists but monorepo source (packages/) missing
STACK_DIRS=()
if [[ -d /data/compose ]]; then
  while IFS= read -r d; do STACK_DIRS+=("$d"); done < <(find /data/compose -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
fi

if ((${#STACK_DIRS[@]} > 0)); then
  for stack_dir in "${STACK_DIRS[@]}"; do
    has_packages=false
    has_compose=false
    has_infra=false
    [[ -d "$stack_dir/packages" ]] && has_packages=true
    [[ -f "$stack_dir/docker-compose.yml" ]] && has_compose=true
    [[ -d "$stack_dir/infra/pgbouncer" ]] && has_infra=true
    log_event "A" "portainer-diagnose.sh:stack" "stack directory inventory" \
      "$(printf '{"stackDir":"%s","hasPackages":%s,"hasRootCompose":%s,"hasInfraPgbouncer":%s}' \
        "$stack_dir" "$has_packages" "$has_compose" "$has_infra")"
  done
fi

# Hypothesis C: Portainer container vs host — check from current shell
log_event "C" "portainer-diagnose.sh:host" "host context" \
  "$(printf '{"hostname":"%s","pwd":"%s","inPortainerData":%s,"composeDirCount":%s}' \
    "$(hostname 2>/dev/null || echo unknown)" "$(pwd)" \
    "$( [[ -d /data/compose ]] && echo true || echo false)" "${#STACK_DIRS[@]}")"

# Hypothesis D: compose merge would still request build
if command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
  build_count=$(docker compose -f docker-compose.yml config 2>/dev/null | grep -c '^    build:' || echo 0)
  log_event "D" "portainer-diagnose.sh:compose" "root compose build stanzas" \
    "{\"buildServiceCount\":$build_count,\"cwd\":\"$(pwd)\"}"
fi

if command -v docker >/dev/null 2>&1 && [[ -n "${COMPOSE_FILE:-}" ]] && [[ -f docker-compose.yml ]]; then
  merged=$(COMPOSE_FILE="$COMPOSE_FILE" docker compose config 2>/dev/null || true)
  if [[ -n "$merged" ]]; then
    img_count=$(printf '%s\n' "$merged" | grep -c '^    image: ghcr.io/finenumbers/' || echo 0)
    build_left=$(printf '%s\n' "$merged" | grep -c '^    build:' || echo 0)
    log_event "D" "portainer-diagnose.sh:compose-file" "COMPOSE_FILE merged config" \
      "{\"composeFile\":\"$COMPOSE_FILE\",\"ghcrImageCount\":$img_count,\"buildStanzaCount\":$build_left}"
  fi
fi

if command -v docker >/dev/null 2>&1 && [[ -f infra/portainer/stack.compose.yml ]]; then
  merged=$(docker compose -f infra/portainer/stack.compose.yml config 2>/dev/null || true)
  if [[ -n "$merged" ]]; then
    img_count=$(printf '%s\n' "$merged" | grep -c '^    image: ghcr.io/finenumbers/' || echo 0)
    build_left=$(printf '%s\n' "$merged" | grep -c '^    build:' || echo 0)
    log_event "D" "portainer-diagnose.sh:stack-compose" "portainer stack merged config" \
      "{\"ghcrImageCount\":$img_count,\"buildStanzaCount\":$build_left}"
  else
    log_event "D" "portainer-diagnose.sh:stack-compose" "portainer stack config failed" '{"error":"docker compose config failed"}'
  fi
fi

echo "Diagnostics written to: $LOG_PATH"
echo "Stack dirs scanned: ${#STACK_DIRS[@]:-0}"
