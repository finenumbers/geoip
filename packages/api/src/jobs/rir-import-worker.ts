import {
  FIXED_RIR_IMPORT_CRON,
  FIXED_RIR_IMPORT_TIMEZONE,
} from '@geoip/shared';
import cron, { type ScheduledTask } from 'node-cron';
import { loadEnv } from '../config/env.js';
import { logger, createChildLogger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import {
  createRirImportRun,
  getQueuedRirImports,
  getRunningRirImport,
  recoverStaleRirImportRuns,
} from '../repositories/rir-repository.js';
import { releaseOrphanedRirImportLock } from './rir-import-lock.js';
import { runRirImportPipeline } from './rir-import-pipeline.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';

let pollInProgress = false;
let cronTask: ScheduledTask | null = null;

async function pollQueuedRirImports(): Promise<void> {
  if (pollInProgress) {
    logger.debug('RIR import poll skipped — previous poll still running');
    return;
  }
  pollInProgress = true;
  try {
    const queued = await getQueuedRirImports();
    for (const job of queued) {
      const childLogger = createChildLogger({ rirImportRunId: job.id });
      await runRirImportPipeline(job.id, childLogger);
    }
  } finally {
    pollInProgress = false;
  }
}

function scheduleRirImportCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  cronTask = cron.schedule(
    FIXED_RIR_IMPORT_CRON,
    async () => {
      logger.info(
        { tz: FIXED_RIR_IMPORT_TIMEZONE, cron: FIXED_RIR_IMPORT_CRON },
        'Cron RIR import triggered',
      );
      const result = await createRirImportRun('cron');
      if (!result.conflict) {
        logger.info({ importRunId: result.importRunId }, 'Cron RIR import queued');
      } else {
        logger.info({ importRunId: result.importRunId }, 'Cron RIR import skipped — already running');
      }
    },
    { timezone: FIXED_RIR_IMPORT_TIMEZONE },
  );
  logger.info(
    { cron: FIXED_RIR_IMPORT_CRON, tz: FIXED_RIR_IMPORT_TIMEZONE },
    'RIR import cron scheduled',
  );
}

async function main(): Promise<void> {
  logger.info('RIR import worker starting');

  await migrate();
  await recoverStaleRirImportRuns();
  const running = await getRunningRirImport();
  if (!running) {
    await releaseOrphanedRirImportLock();
    logger.info('Released orphaned RIR import advisory lock on startup');
  }

  registerWorkerShutdown(async () => {
    cronTask?.stop();
  });

  const env = loadEnv();
  startWorkerPoll(async () => {
    try {
      await pollQueuedRirImports();
    } catch (err) {
      logger.error({ err }, 'RIR poll error');
    }
  }, env.IMPORT_POLL_INTERVAL_MS);

  scheduleRirImportCron();

  // Kick an initial import if dataset empty
  const { getRirDatasetState } = await import('../repositories/rir-repository.js');
  const state = await getRirDatasetState();
  if (state.rowCount === 0 && state.status !== 'importing') {
    const result = await createRirImportRun('api');
    if (!result.conflict) {
      logger.info({ importRunId: result.importRunId }, 'Initial RIR import queued (empty dataset)');
    }
  }
}

main().catch((err) => {
  logger.error({ err }, 'RIR import worker failed');
  process.exit(1);
});
