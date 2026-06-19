import { loadEnv } from '../config/env.js';
import { logger, createChildLogger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { recoverStaleImportRuns } from './import-orphan-recovery.js';
import { getQueuedImports } from '../services/import-service.js';
import { runImportPipeline } from './import-pipeline.js';
import cron from 'node-cron';
import { createImportRun } from '../services/import-service.js';

async function pollQueuedImports(): Promise<void> {
  const queued = await getQueuedImports();
  for (const job of queued) {
    const childLogger = createChildLogger({ importRunId: job.id });
    await runImportPipeline(job.id, childLogger);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info('Import worker starting');

  await migrate();
  await recoverStaleImportRuns();

  const poll = async () => {
    try {
      await pollQueuedImports();
    } catch (err) {
      logger.error({ err }, 'Poll error');
    }
  };

  await poll();
  setInterval(poll, env.IMPORT_POLL_INTERVAL_MS);

  if (env.IMPORT_CRON_CRON) {
    cron.schedule(env.IMPORT_CRON_CRON, async () => {
      logger.info('Cron import triggered');
      const result = await createImportRun('cron');
      if (!result.conflict) {
        logger.info({ importRunId: result.importRunId }, 'Cron import queued');
      }
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'Import worker failed');
  process.exit(1);
});
