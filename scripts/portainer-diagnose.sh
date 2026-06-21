#!/usr/bin/env bash
# Portainer deploy diagnostics — inspect stack directories and compose merge.
set -euo pipefail

report() {
  printf '[portainer-diagnose] %s\n' "$1"
}

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
    report "stack=$stack_dir hasPackages=$has_packages hasRootCompose=$has_compose hasInfraPgbouncer=$has_infra"
  done
else
  report "no stack directories under /data/compose"
fi

report "hostname=$(hostname 2>/dev/null || echo unknown) pwd=$(pwd) inPortainerData=$([[ -d /data/compose ]] && echo true || echo false) composeDirCount=${#STACK_DIRS[@]}"

if command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
  build_count=$(docker compose -f docker-compose.yml config 2>/dev/null | grep -c '^    build:' || echo 0)
  report "root compose build stanzas=$build_count cwd=$(pwd)"
fi

if command -v docker >/dev/null 2>&1 && [[ -n "${COMPOSE_FILE:-}" ]] && [[ -f docker-compose.yml ]]; then
  merged=$(COMPOSE_FILE="$COMPOSE_FILE" docker compose config 2>/dev/null || true)
  if [[ -n "$merged" ]]; then
    img_count=$(printf '%s\n' "$merged" | grep -c '^    image: ghcr.io/finenumbers/' || echo 0)
    build_left=$(printf '%s\n' "$merged" | grep -c '^    build:' || echo 0)
    report "COMPOSE_FILE=$COMPOSE_FILE ghcrImages=$img_count buildStanzas=$build_left"
  fi
fi

if command -v docker >/dev/null 2>&1 && [[ -f infra/portainer/stack.compose.yml ]]; then
  merged=$(docker compose -f infra/portainer/stack.compose.yml config 2>/dev/null || true)
  if [[ -n "$merged" ]]; then
    img_count=$(printf '%s\n' "$merged" | grep -c '^    image: ghcr.io/finenumbers/' || echo 0)
    build_left=$(printf '%s\n' "$merged" | grep -c '^    build:' || echo 0)
    report "portainer stack ghcrImages=$img_count buildStanzas=$build_left"
  else
    report "portainer stack config failed"
  fi
fi

report "done — stack dirs scanned: ${#STACK_DIRS[@]:-0}"
