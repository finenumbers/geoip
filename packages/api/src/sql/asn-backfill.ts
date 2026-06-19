import type { Logger } from 'pino';
import { populateBlockAsnMappings } from '../sql/asn-mapping.js';
import { isAsnMappingReady, markAsnMappingReady } from '../sql/asn-mapping-status.js';

let backfillRunning = false;

/** Backfill ASN mappings when indexes exist but mapping tables are empty (post-deploy). */
export async function ensureAsnMappingsInBackground(logger: Logger): Promise<void> {
  if (backfillRunning) return;
  if (await isAsnMappingReady()) return;

  backfillRunning = true;
  logger.info('ASN mapping tables empty — starting background backfill');

  populateBlockAsnMappings(logger)
    .then((counts) => {
      markAsnMappingReady();
      logger.info(counts, 'Background ASN mapping complete');
    })
    .catch((err) => {
      logger.error({ err }, 'Background ASN mapping failed');
    })
    .finally(() => {
      backfillRunning = false;
    });
}
