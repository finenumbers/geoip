import type { Logger } from 'pino';
import { query } from '../db/client.js';

/** Lightweight RPKI adoption aggregates (not full ROA dumps). */
const RPKI_SOURCES = [
  {
    sourceFile: 'nro-adoption-ripencc',
    url: 'https://ftp.ripe.net/pub/stats/ripencc/nro-adoption/nro-adoption-latest.csv',
  },
] as const;

function parseCsvLine(line: string): string[] {
  return line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
}

export async function importRirRpkiAdoption(
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<{ imported: number }> {
  let imported = 0;

  for (const source of RPKI_SOURCES) {
    try {
      const res = await fetchImpl(source.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        log.warn({ url: source.url, status: res.status }, 'RPKI adoption fetch failed');
        continue;
      }
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'));
      if (lines.length < 2) continue;

      const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
      await query(`DELETE FROM rir_rpki_adoption WHERE source_file = $1`, [source.sourceFile]);

      for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line);
        if (cols.length === 0) continue;
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = cols[i] ?? '';
        });

        const economy = row.economy || row.cc || row.country || null;
        const registry = row.registry || row.rir || 'ripencc';
        const metric =
          row.metric ||
          row.measure ||
          (row.rpki_adoption != null ? 'rpki_adoption' : null) ||
          headers.find((h) => h.includes('adoption')) ||
          'value';
        const valueRaw =
          row.value ||
          row.rpki_adoption ||
          row.adoption ||
          row.percentage ||
          cols[cols.length - 1] ||
          '';
        const valueNum = Number(valueRaw);
        const snapshotDate = row.date || row.snapshot_date || null;

        await query(
          `INSERT INTO rir_rpki_adoption (
             source_file, economy, registry, metric, value, snapshot_date, raw
           ) VALUES ($1, $2, $3, $4, $5, $6::date, $7::jsonb)`,
          [
            source.sourceFile,
            economy,
            registry,
            metric,
            Number.isFinite(valueNum) ? valueNum : null,
            snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ? snapshotDate : null,
            JSON.stringify(row),
          ],
        );
        imported += 1;
      }
    } catch (err) {
      log.warn({ err, url: source.url }, 'RPKI adoption import error');
    }
  }

  log.info({ imported }, 'RPKI adoption import finished');
  return { imported };
}
