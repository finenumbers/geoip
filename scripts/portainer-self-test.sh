#!/usr/bin/env bash
# Portainer deploy simulation — mimics Portainer using ONLY the compose path file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM=/tmp/portainer-e2e-test-$$

report() {
  printf '[portainer-self-test] %s\n' "$1"
}

mkdir -p "$SIM/infra/portainer" "$SIM/infra/pgbouncer" "$SIM/scripts"
cp "$ROOT/docker-compose.portainer.yml" "$ROOT/docker-compose.yml" "$ROOT/docker-compose.prod.yml" "$SIM/"
cp "$ROOT/infra/portainer/stack.compose.yml" "$SIM/infra/portainer/"
cp "$ROOT/infra/pgbouncer/"* "$SIM/infra/pgbouncer/"

has_packages=false
[[ -d "$SIM/packages" ]] && has_packages=true
report "simDir=$SIM hasPackages=$has_packages"

legacy_ok=true
root_build=$(cd "$SIM" && docker compose -f docker-compose.yml build 2>&1 || true)
root_packages_err=false
echo "$root_build" | grep -q 'packages: no such file' && root_packages_err=true
echo "$root_build" | grep -q 'No services to build' || root_packages_err=true
report "docker-compose.yml packagesError=$root_packages_err noServicesToBuild=$(echo "$root_build" | grep -q 'No services to build' && echo true || echo false)"
$root_packages_err && legacy_ok=false

stack_build=$(cd "$SIM/infra/portainer" && docker compose -f stack.compose.yml build 2>&1 || true)
stack_packages_err=false
echo "$stack_build" | grep -q 'packages: no such file' && stack_packages_err=true
echo "$stack_build" | grep -q 'No services to build' || stack_packages_err=true
report "stack.compose.yml packagesError=$stack_packages_err noServicesToBuild=$(echo "$stack_build" | grep -q 'No services to build' && echo true || echo false)"
$stack_packages_err && legacy_ok=false

port_cfg=$(cd "$SIM" && docker compose -f docker-compose.portainer.yml config 2>/dev/null || true)
build_count=$(printf '%s\n' "$port_cfg" | grep -c '^    build:' || true)
ghcr_count=$(printf '%s\n' "$port_cfg" | grep -c '^    image: ghcr.io/finenumbers/' || true)
port_build=$(cd "$SIM" && docker compose -f docker-compose.portainer.yml build 2>&1 || true)
no_build=false
echo "$port_build" | grep -q 'No services to build' && no_build=true
report "docker-compose.portainer.yml buildStanzas=$build_count ghcrImages=$ghcr_count noServicesToBuild=$no_build"

pull_out=$(cd "$SIM" && docker compose -f docker-compose.portainer.yml pull api web 2>&1 || true)
api_pulled=false
web_pulled=false
echo "$pull_out" | grep -q 'geoip-api.*Pulled\|geoip-api.*up to date' && api_pulled=true
echo "$pull_out" | grep -q 'geoip-web.*Pulled\|geoip-web.*up to date' && web_pulled=true
report "ghcr pull apiPulled=$api_pulled webPulled=$web_pulled"

health_out=$(docker run --rm --entrypoint node ghcr.io/finenumbers/geoip-api:latest -e "console.log('image-ok')" 2>&1 || true)
image_runs=false
echo "$health_out" | grep -q 'image-ok' && image_runs=true
report "api image runs nodeExecOk=$image_runs"

rm -rf "$SIM"

passed=0
$legacy_ok && ((passed++)) || true
$no_build && ((passed++)) || true
[[ "$build_count" -eq 0 ]] && ((passed++)) || true
$api_pulled && ((passed++)) || true
$web_pulled && ((passed++)) || true
$image_runs && ((passed++)) || true

mount_sim=/tmp/portainer-mount-check-$$
mkdir "$mount_sim" && cp "$ROOT/docker-compose.portainer.yml" "$mount_sim/"
bind_count=$(cd "$mount_sim" && docker compose -f docker-compose.portainer.yml config 2>/dev/null | grep -cE '\./infra|\./scripts' || true)
config_ok=$(cd "$mount_sim" && docker compose -f docker-compose.portainer.yml config --quiet >/dev/null 2>&1 && echo true || echo false)
report "bindMountCount=$bind_count configValid=$config_ok"
rm -rf "$mount_sim"
[[ "$bind_count" -eq 0 ]] && [[ "$config_ok" == true ]] && ((passed++)) || true

report "checks passed: $passed/7"
[ "$passed" -eq 7 ]
