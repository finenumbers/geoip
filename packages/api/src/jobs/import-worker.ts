import { loadEnv } from '../config/env.js';
import { logger, createChildLogger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { recoverStaleImportRuns } from './import-orphan-recovery.js';
import { releaseOrphanedImportLock } from './import-lock.js';
import { getRunningImport } from '../repositories/dataset-repository.js';
import { getQueuedImports } from '../services/import-service.js';
import { runImportPipeline } from './import-pipeline.js';
import cron from 'node-cron';
import { createImportRun } from '../services/import-service.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';

let pollInProgress = false;

async function pollQueuedImports(): Promise<void> {
  if (pollInProgress) {
    logger.debug('Import poll skipped — previous poll still running');
    return;
  }
  pollInProgress = true;
  try {
    const queued = await getQueuedImports();
    for (const job of queued) {
      const childLogger = createChildLogger({ importRunId: job.id });
      await runImportPipeline(job.id, childLogger);
    }
  } finally {
    pollInProgress = false;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info('Import worker starting');

  await migrate();
  await recoverStaleImportRuns();
  const running = await getRunningImport();
  if (!running) {
    await releaseOrphanedImportLock();
    logger.info('Released orphaned import advisory lock on startup');
  }

  registerWorkerShutdown();

  const poll = async () => {
    try {
      await pollQueuedImports();
    } catch (err) {
      logger.error({ err }, 'Poll error');
    }
  };

  startWorkerPoll(poll, env.IMPORT_POLL_INTERVAL_MS);

  if (env.IMPORT_CRON_CRON) {
    cron.schedule(
      env.IMPORT_CRON_CRON,
      async () => {
        logger.info({ tz: env.IMPORT_CRON_TZ, cron: env.IMPORT_CRON_CRON }, 'Cron import triggered');
        const result = await createImportRun('cron');
        if (!result.conflict) {
          logger.info({ importRunId: result.importRunId }, 'Cron import queued');
        }
      },
      { timezone: env.IMPORT_CRON_TZ },
    );
    logger.info(
      { cron: env.IMPORT_CRON_CRON, tz: env.IMPORT_CRON_TZ },
      'Import cron scheduled',
    );
  }
}

main().catch((err) => {
  logger.error({ err }, 'Import worker failed');
  process.exit(1);
});
