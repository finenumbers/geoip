import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { migrate } from '../db/migrate.js';
import { processQueuedExports } from '../services/export-service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info('Export worker starting');

  await migrate();

  const poll = async () => {
    try {
      await processQueuedExports();
    } catch (err) {
      logger.error({ err }, 'Export poll error');
    }
  };

  await poll();
  setInterval(poll, env.EXPORT_POLL_INTERVAL_MS);
}

main().catch((err) => {
  logger.error({ err }, 'Export worker failed');
  process.exit(1);
});
