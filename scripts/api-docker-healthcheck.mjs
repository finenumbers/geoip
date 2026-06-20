#!/usr/bin/env node
/**
 * Docker healthcheck: process up (/health) and acceptable readiness.
 * Passes during MV warmup (not_ready + materializedViews=false) so Compose can start dependents.
 */
const healthUrl = 'http://127.0.0.1:3000/api/v1/health';
const readyUrl = 'http://127.0.0.1:3000/api/v1/ready';

async function main() {
  const health = await fetch(healthUrl);
  if (!health.ok) process.exit(1);

  const ready = await fetch(readyUrl);
  const body = await ready.json();

  if (body.status === 'ready' || body.status === 'degraded') {
    process.exit(0);
  }

  if (body.status === 'not_ready' && body.checks?.database) {
    // Fresh install: empty DB before first import
    if (!body.checks.dataset) {
      process.exit(0);
    }
    // MV warmup after import
    if (body.checks.dataset && body.checks.materializedViews === false) {
      process.exit(0);
    }
  }

  process.exit(1);
}

main().catch(() => process.exit(1));
