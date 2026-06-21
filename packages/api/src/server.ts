import { mkdirSync } from 'node:fs';
import { loadEnv, resetEnvCache } from './config/env.js';
import { logger } from './config/logger.js';
import { migrate } from './db/migrate.js';
import { closeDb } from './db/client.js';
import { buildApp } from './app.js';
import { ensureProductionIndexes, recreateMaterializedViewsInBackground } from './sql/swap.js';
import { recoverStaleImportRuns } from './jobs/import-orphan-recovery.js';
import { ensureAsnMappingsInBackground } from './sql/asn-backfill.js';
import { ensureDatasetCachesInBackground } from './sql/filter-count-cache-ensure.js';
import { ensureDatasetVolumesInBackground } from './sql/dataset-volumes-backfill.js';
import { subscribeConfigChanges } from './config/runtime-config.js';
import { watchConfigFileChanges } from './config/config-reload-watcher.js';

async function main(): Promise<void> {
  const env = loadEnv();
  mkdirSync(env.IMPORT_DOWNLOAD_DIR, { recursive: true });
  mkdirSync(env.EXPORT_DIR, { recursive: true });

  await migrate();
  await recoverStaleImportRuns();
  await ensureProductionIndexes({ deferMvRecreate: true });

  const app = await buildApp();
  ensureAsnMappingsInBackground(logger);
  ensureDatasetCachesInBackground();
  ensureDatasetVolumesInBackground();
  recreateMaterializedViewsInBackground();

  subscribeConfigChanges(() => {
    resetEnvCache();
    logger.info('API reloaded runtime config from volume');
  });
  const stopConfigWatch = watchConfigFileChanges();

  const shutdown = async () => {
    logger.info('Shutting down');
    stopConfigWatch();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'API server started');
}

main().catch((err) => {
  logger.error({ err }, 'Server failed to start');
  process.exit(1);
});
