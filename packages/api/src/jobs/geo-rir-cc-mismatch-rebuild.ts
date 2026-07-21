import type { Logger } from 'pino';
import { query, withDirectPoolClient } from '../db/client.js';
import { isRirDatasetReady } from '../repositories/rir-repository.js';

let ensureRunning = false;

async function isGrchcCountryReady(): Promise<boolean> {
  const result = await query<{ ready: boolean }>(
    `SELECT (mv_status = 'ready' AND country_row_count > 0) AS ready
     FROM dataset_state
     WHERE id = 1`,
  );
  return Boolean(result.rows[0]?.ready);
}

async function getCcMismatchStatus(): Promise<string | null> {
  const result = await query<{ status: string }>(
    `SELECT status FROM geo_rir_cc_mismatch_state WHERE id = 1`,
  );
  return result.rows[0]?.status ?? null;
}

/**
 * Full GRChC country-block ISO vs covering RIR delegated CC.
 * Materializes only mismatches into geo_rir_cc_mismatches.
 *
 * @param force when false, only claim + rebuild if status is never/failed (startup backfill).
 */
export async function rebuildGeoRirCcMismatches(
  log: Logger,
  options: { force?: boolean } = {},
): Promise<{ rowCount: number } | null> {
  const force = options.force !== false;
  const started = Date.now();
  return withDirectPoolClient(async (client) => {
    if (force) {
      await client.query(
        `UPDATE geo_rir_cc_mismatch_state
         SET status = 'running', last_error = NULL, updated_at = NOW()
         WHERE id = 1`,
      );
    } else {
      const claimed = await client.query(
        `UPDATE geo_rir_cc_mismatch_state
         SET status = 'running', last_error = NULL, updated_at = NOW()
         WHERE id = 1 AND status IN ('never', 'failed')
         RETURNING id`,
      );
      if ((claimed.rowCount ?? 0) === 0) {
        log.info('CC mismatch rebuild skipped — already running or ready');
        return null;
      }
    }

    try {
      await client.query('TRUNCATE geo_rir_cc_mismatches RESTART IDENTITY');
      const insert = await client.query<{ count: string }>(
        `WITH inserted AS (
           INSERT INTO geo_rir_cc_mismatches (
             country_block_id, network, grchc_cc, rir_cc, registry, range_text, rebuilt_at
           )
           SELECT
             cb.id,
             cb.network,
             cl.country_iso_code,
             rir.cc,
             rir.registry,
             rir.range_text,
             NOW()
           FROM geo_country_blocks cb
           JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
           JOIN LATERAL (
             SELECT r.cc, r.registry, r.range_text
             FROM rir_delegations r
             WHERE r.resource_type IN ('ipv4', 'ipv6')
               AND r.network IS NOT NULL
               AND r.network >>= cb.network
             ORDER BY masklen(r.network) DESC
             LIMIT 1
           ) rir ON true
           WHERE cl.country_iso_code IS NOT NULL
             AND rir.cc IS NOT NULL
             AND upper(cl.country_iso_code) IS DISTINCT FROM upper(rir.cc)
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM inserted`,
      );
      const rowCount = Number(insert.rows[0]?.count ?? 0);
      const durationMs = Date.now() - started;
      await client.query(
        `UPDATE geo_rir_cc_mismatch_state
         SET status = 'ready',
             row_count = $1::bigint,
             rebuilt_at = NOW(),
             duration_ms = $2::bigint,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = 1`,
        [rowCount, durationMs],
      );
      log.info({ rowCount, durationMs }, 'Rebuilt geo_rir_cc_mismatches');
      return { rowCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.query(
        `UPDATE geo_rir_cc_mismatch_state
         SET status = 'failed',
             last_error = $1,
             updated_at = NOW()
         WHERE id = 1`,
        [message.slice(0, 2000)],
      );
      throw err;
    }
  });
}

/** Post-deploy backfill when both datasets are ready but mismatch table was never built. */
export function ensureCcMismatchRebuildInBackground(log: Logger): void {
  if (ensureRunning) return;
  ensureRunning = true;

  void (async () => {
    try {
      const status = await getCcMismatchStatus();
      if (status !== 'never' && status !== 'failed') return;

      const [grchcReady, rirReady] = await Promise.all([
        isGrchcCountryReady(),
        isRirDatasetReady(),
      ]);
      if (!grchcReady || !rirReady) {
        log.info(
          { grchcReady, rirReady, status },
          'CC mismatch backfill deferred — datasets not ready',
        );
        return;
      }

      log.info({ status }, 'Starting CC mismatch background rebuild');
      await rebuildGeoRirCcMismatches(log, { force: false });
    } catch (err) {
      log.warn({ err }, 'CC mismatch background rebuild failed');
    } finally {
      ensureRunning = false;
    }
  })();
}
