#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cp -n .env.example .env 2>/dev/null || true
docker compose up postgres -d
echo "Waiting for postgres..."
sleep 3
pnpm install
pnpm db:migrate
pnpm dev
