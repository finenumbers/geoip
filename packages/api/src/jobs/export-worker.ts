import { mkdirSync } from 'node:fs';
import { loadEnv, resetEnvCache } from '../config/env.js';
import { logger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { processQueuedExports } from '../services/export-service.js';
import { pruneExportHistory } from '../jobs/export-retention.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';
import { subscribeConfigChanges } from '../config/runtime-config.js';
import { watchConfigFileChanges } from '../config/config-reload-watcher.js';

async function main(): Promise<void> {
  const env = loadEnv();
  mkdirSync(env.EXPORT_DIR, { recursive: true });
  logger.info('Export worker starting');

  await migrate();
  registerWorkerShutdown();

  let retentionRunning = false;
  let restartPoll: ((intervalMs: number) => void) | null = null;

  const poll = async () => {
    try {
      // Per-job readiness (MV vs RIR) is handled inside processExportJob.
      await processQueuedExports();
    } catch (err) {
      logger.error({ err }, 'Export poll error');
    }

    if (!retentionRunning) {
      retentionRunning = true;
      try {
        await pruneExportHistory(logger);
      } catch (err) {
        logger.error({ err }, 'Export retention error');
      } finally {
        retentionRunning = false;
      }
    }
  };

  restartPoll = startWorkerPoll(poll, env.EXPORT_POLL_INTERVAL_MS);

  subscribeConfigChanges(() => {
    resetEnvCache();
    const current = loadEnv();
    mkdirSync(current.EXPORT_DIR, { recursive: true });
    restartPoll?.(current.EXPORT_POLL_INTERVAL_MS);
    logger.info('Export worker reloaded runtime config');
  });
  watchConfigFileChanges();
}

main().catch((err) => {
  logger.error({ err }, 'Export worker failed');
  process.exit(1);
});
