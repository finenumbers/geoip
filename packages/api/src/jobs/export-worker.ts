import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { processQueuedExports } from '../services/export-service.js';
import { pruneExportHistory } from '../jobs/export-retention.js';
import { registerWorkerShutdown, startWorkerPoll } from './worker-lifecycle.js';
import { isMaterializedViewsReadyForQueries } from '../sql/recreate-materialized-views.js';

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info('Export worker starting');

  await migrate();
  registerWorkerShutdown();

  let retentionRunning = false;

  const poll = async () => {
    try {
      if (await isMaterializedViewsReadyForQueries()) {
        await processQueuedExports();
      } else {
        logger.debug('Skipping export poll — materialized views not ready');
      }
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

  startWorkerPoll(poll, env.EXPORT_POLL_INTERVAL_MS);
}

main().catch((err) => {
  logger.error({ err }, 'Export worker failed');
  process.exit(1);
});
