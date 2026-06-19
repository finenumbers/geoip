import { migrate } from '../db/migrate.js';
import { rebuildProductionIndexes } from '../sql/swap.js';
import { populateBlockAsnMappings } from '../sql/asn-mapping.js';
import { markAsnMappingReady } from '../sql/asn-mapping-status.js';
import { logger } from '../config/logger.js';
import { closeDb } from '../db/client.js';

async function main(): Promise<void> {
  await migrate();
  logger.info('Rebuilding production indexes');
  await rebuildProductionIndexes();
  logger.info('Starting ASN mapping backfill');
  const counts = await populateBlockAsnMappings(logger);
  markAsnMappingReady();
  logger.info(counts, 'ASN mapping backfill complete');
  await closeDb();
}

main().catch((err) => {
  logger.error(err, 'ASN backfill failed');
  process.exit(1);
});
