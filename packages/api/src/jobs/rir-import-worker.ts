import cron, { type ScheduledTask } from 'node-cron';
import { loadEnv, resetEnvCache } from '../config/env.js';
import {
  loadRuntimeConfig,
  subscribeConfigChanges,
} from '../config/runtime-config.js';
import { watchConfigFileChanges } from '../config/config-reload-watcher.js';
import { logger, createChildLogger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { query } from '../db/client.js';
import {
  createRirImportRun,
  failOrphanedRunningRirImports,
  getQueuedRirImports,
  getRirDatasetState,
  recoverStaleRirImportRuns,
} from '../repositories/rir-repository.js';
import {
  releaseOrphanedRirImportLock,
  releaseRirImportLock,
  tryAcquireRirImportLock,
} from './rir-import-lock.js';
import { runRirImportPipeline } from './rir-import-pipeline.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';

const STALE_MINUTES = 30;

let pollInProgress = false;
let cronTask: ScheduledTask | null = null;
let restartPoll: ((intervalMs: number) => void) | null = null;

/** Clear orphaned running rows when we can take the advisory lock (no live owner). */
async function recoverOrphanedImportsIfLockFree(): Promise<void> {
  const acquired = await tryAcquireRirImportLock();
  if (!acquired) return;
  try {
    const n = await failOrphanedRunningRirImports();
    if (n > 0) {
      logger.warn({ cleared: n }, 'Failed orphaned RIR import runs (lock was free)');
    }
  } finally {
    await releaseRirImportLock();
  }
}

async function pollQueuedRirImports(): Promise<void> {
  if (pollInProgress) {
    logger.debug('RIR import poll skipped — previous poll still running');
    return;
  }
  pollInProgress = true;
  try {
    const stale = await recoverStaleRirImportRuns(STALE_MINUTES);
    if (stale > 0) {
      logger.warn({ stale }, 'Marked stale RIR import runs as failed');
    }
    await recoverOrphanedImportsIfLockFree();

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

  const env = loadEnv();
  if (!env.RIR_IMPORT_CRON_ENABLED) {
    logger.info('RIR import cron disabled in settings');
    return;
  }
  if (!env.RIR_IMPORT_CRON_CRON) return;

  cronTask = cron.schedule(
    env.RIR_IMPORT_CRON_CRON,
    async () => {
      const config = loadRuntimeConfig();
      if (!config.settings.rirImport.enabled) {
        logger.debug('Cron RIR import skipped — disabled in settings');
        return;
      }
      const current = loadEnv();
      logger.info(
        { tz: current.RIR_IMPORT_CRON_TZ, cron: current.RIR_IMPORT_CRON_CRON },
        'Cron RIR import triggered',
      );
      const result = await createRirImportRun('cron');
      if (!result.conflict) {
        logger.info({ importRunId: result.importRunId }, 'Cron RIR import queued');
      } else {
        logger.info({ importRunId: result.importRunId }, 'Cron RIR import skipped — already running');
      }
    },
    { timezone: env.RIR_IMPORT_CRON_TZ },
  );
  logger.info(
    { cron: env.RIR_IMPORT_CRON_CRON, tz: env.RIR_IMPORT_CRON_TZ },
    'RIR import cron scheduled',
  );
}

function applyRuntimeConfigReload(): void {
  resetEnvCache();
  const env = loadEnv();
  restartPoll?.(env.IMPORT_POLL_INTERVAL_MS);
  scheduleRirImportCron();
  logger.info('RIR import worker reloaded runtime config');
}

async function main(): Promise<void> {
  logger.info('RIR import worker starting');

  await migrate();
  await recoverStaleRirImportRuns(STALE_MINUTES);
  await recoverOrphanedImportsIfLockFree();

  const running = await query<{ id: string }>(
    `SELECT id FROM rir_import_runs WHERE status = 'running' LIMIT 1`,
  );
  if (running.rows.length === 0) {
    await releaseOrphanedRirImportLock();
    logger.info('Released orphaned RIR import advisory lock on startup');
  }

  registerWorkerShutdown(async () => {
    cronTask?.stop();
  });

  const env = loadEnv();
  restartPoll = startWorkerPoll(async () => {
    try {
      await pollQueuedRirImports();
    } catch (err) {
      logger.error({ err }, 'RIR poll error');
    }
  }, env.IMPORT_POLL_INTERVAL_MS);

  scheduleRirImportCron();
  subscribeConfigChanges(applyRuntimeConfigReload);
  watchConfigFileChanges();

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
