import { isGrchcConfigured } from '@geoip/shared';
import { loadEnv } from '../config/env.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { logger, createChildLogger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { recoverStaleImportRuns } from './import-orphan-recovery.js';
import { releaseOrphanedImportLock } from './import-lock.js';
import { getRunningImport } from '../repositories/dataset-repository.js';
import { getQueuedImports } from '../services/import-service.js';
import { runImportPipeline } from './import-pipeline.js';
import cron, { type ScheduledTask } from 'node-cron';
import { createImportRun } from '../services/import-service.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';
import { subscribeConfigChanges } from '../config/runtime-config.js';
import { watchConfigFileChanges } from '../config/config-reload-watcher.js';
import { resetEnvCache } from '../config/env.js';

let pollInProgress = false;
let cronTask: ScheduledTask | null = null;
let restartPoll: ((intervalMs: number) => void) | null = null;

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

function scheduleImportCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  const env = loadEnv();
  if (!env.IMPORT_CRON_CRON) return;

  if (!env.IMPORT_CRON_ENABLED) {
    logger.info('Import cron disabled in settings');
    return;
  }

  cronTask = cron.schedule(
    env.IMPORT_CRON_CRON,
    async () => {
      const config = loadRuntimeConfig();
      if (!config.settings.import.enabled) {
        logger.debug('Cron import skipped — disabled in settings');
        return;
      }
      if (!isGrchcConfigured(config.secrets)) {
        logger.debug('Cron import skipped — GRChC credentials not configured');
        return;
      }
      const current = loadEnv();
      logger.info(
        { tz: current.IMPORT_CRON_TZ, cron: current.IMPORT_CRON_CRON },
        'Cron import triggered',
      );
      const result = await createImportRun('cron');
      if (!result.conflict) {
        logger.info({ importRunId: result.importRunId }, 'Cron import queued');
      }
    },
    { timezone: env.IMPORT_CRON_TZ },
  );
  logger.info({ cron: env.IMPORT_CRON_CRON, tz: env.IMPORT_CRON_TZ }, 'Import cron scheduled');
}

function applyRuntimeConfigReload(): void {
  resetEnvCache();
  const env = loadEnv();
  restartPoll?.(env.IMPORT_POLL_INTERVAL_MS);
  scheduleImportCron();
  logger.info('Import worker reloaded runtime config');
}

async function main(): Promise<void> {
  logger.info('Import worker starting');

  await migrate();
  await recoverStaleImportRuns();
  const running = await getRunningImport();
  if (!running) {
    await releaseOrphanedImportLock();
    logger.info('Released orphaned import advisory lock on startup');
  }

  registerWorkerShutdown(async () => {
    cronTask?.stop();
  });

  const poll = async () => {
    try {
      await pollQueuedImports();
    } catch (err) {
      logger.error({ err }, 'Poll error');
    }
  };

  const env = loadEnv();
  restartPoll = startWorkerPoll(poll, env.IMPORT_POLL_INTERVAL_MS);
  scheduleImportCron();
  subscribeConfigChanges(applyRuntimeConfigReload);
  watchConfigFileChanges();
}

main().catch((err) => {
  logger.error({ err }, 'Import worker failed');
  process.exit(1);
});
