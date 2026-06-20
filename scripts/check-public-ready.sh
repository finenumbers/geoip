#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failures=0
warnings=0

fail() {
  echo "FAIL: $1" >&2
  failures=$((failures + 1))
}

warn() {
  echo "WARN: $1" >&2
  warnings=$((warnings + 1))
}

echo "Checking tracked files for secrets and local config..."

for forbidden in .env data/config backups packages/api/data packages/api/data/config; do
  if git ls-files --error-unmatch "$forbidden" >/dev/null 2>&1; then
    fail "Tracked forbidden path: $forbidden"
  fi
done

if git ls-files | grep -E '^\.env\.' | grep -v '^\.env\.example$' >/dev/null; then
  fail "Tracked .env.* files besides .env.example"
fi

if git ls-files | grep -E '(secrets\.enc|proxy\.env|meta\.json)$' >/dev/null; then
  fail "Tracked runtime config artifacts (secrets.enc, proxy.env, meta.json)"
fi

if git ls-files | grep -E '\.sql\.gz$' >/dev/null; then
  fail "Tracked .sql.gz backup files"
fi

patterns=(
  'AIza[0-9A-Za-z_-]{20,}'
  'change-me-in-production'
  'GEOIP_LK_EMAIL=.+@'
)

for pattern in "${patterns[@]}"; do
  if git grep -E "$pattern" -- ':!scripts/check-public-ready.sh' ':!docs/*' ':!.env.example' >/dev/null 2>&1; then
    fail "Suspicious pattern in tracked files: $pattern"
  fi
done

if git log --all --oneline -- .env 2>/dev/null | head -1 | grep -q .; then
  warn ".env was committed in git history — review before public push"
fi

if grep -E '^[[:space:]]+build:' docker-compose.yml docker-compose.portainer.yml >/dev/null 2>&1; then
  fail "docker-compose.yml and docker-compose.portainer.yml must not contain build: (Portainer deploy)"
fi

# Untracked local config that must never be committed
for local_config in data/config packages/api/data/config; do
  if [ -d "$local_config" ] && [ -n "$(ls -A "$local_config" 2>/dev/null || true)" ]; then
    if git check-ignore -q "$local_config" 2>/dev/null; then
      echo "OK: $local_config is gitignored"
    else
      warn "$local_config exists but is NOT gitignored — add to .gitignore"
    fi
  fi
done

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "$failures check(s) failed."
  exit 1
fi

echo "OK: repository looks ready for public release."
if [ "$warnings" -gt 0 ]; then
  echo "$warnings warning(s) — review before push."
fi
