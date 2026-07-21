import type { Logger } from 'pino';
import { query } from '../db/client.js';

/** Public transfer feeds (best-effort; missing sources are skipped). */
const TRANSFER_SOURCES = [
  {
    sourceRir: 'ripencc',
    url: 'https://ftp.ripe.net/pub/stats/ripencc/transfers/transfers_latest.json',
  },
] as const;

type TransferRow = {
  transferId: string | null;
  resourceType: string | null;
  resourceRange: string;
  fromOrg: string | null;
  toOrg: string | null;
  transferredAt: string | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function normalizeTransfer(item: unknown): TransferRow | null {
  const obj = asRecord(item);
  if (!obj) return null;

  const resourceRange =
    pickString(obj, ['prefix', 'resource', 'range', 'cidr', 'ip_version_prefix']) ??
    pickString(asRecord(obj.resource) ?? {}, ['prefix', 'value', 'range']);
  if (!resourceRange) return null;

  const transferredAtRaw = pickString(obj, [
    'transfer_date',
    'date',
    'transferred_at',
    'timestamp',
  ]);
  let transferredAt: string | null = null;
  if (transferredAtRaw) {
    const d = transferredAtRaw.slice(0, 10);
    transferredAt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }

  return {
    transferId: pickString(obj, ['id', 'transfer_id', 'uuid']),
    resourceType: pickString(obj, ['type', 'resource_type', 'ip_version']),
    resourceRange,
    fromOrg: pickString(obj, ['from', 'from_org', 'source_org', 'old_org']),
    toOrg: pickString(obj, ['to', 'to_org', 'recipient_org', 'new_org']),
    transferredAt,
    raw: obj,
  };
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asRecord(payload);
  if (!obj) return [];
  for (const key of ['transfers', 'data', 'items', 'results']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

export async function importRirTransfers(
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<{ imported: number; sources: number }> {
  let imported = 0;
  let sources = 0;

  for (const source of TRANSFER_SOURCES) {
    try {
      const res = await fetchImpl(source.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        log.warn({ url: source.url, status: res.status }, 'RIR transfers fetch failed');
        continue;
      }
      sources += 1;
      const payload = await res.json();
      const items = extractItems(payload);
      for (const item of items) {
        const row = normalizeTransfer(item);
        if (!row) continue;
        await query(
          `INSERT INTO rir_transfers (
             source_rir, transfer_id, resource_type, resource_range,
             from_org, to_org, transferred_at, raw
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::jsonb)
           ON CONFLICT (source_rir, transfer_id, resource_range) DO UPDATE SET
             resource_type = EXCLUDED.resource_type,
             from_org = EXCLUDED.from_org,
             to_org = EXCLUDED.to_org,
             transferred_at = EXCLUDED.transferred_at,
             raw = EXCLUDED.raw,
             imported_at = NOW()`,
          [
            source.sourceRir,
            row.transferId ?? `${row.resourceRange}:${row.transferredAt ?? 'unknown'}`,
            row.resourceType,
            row.resourceRange,
            row.fromOrg,
            row.toOrg,
            row.transferredAt,
            JSON.stringify(row.raw),
          ],
        );
        imported += 1;
      }
    } catch (err) {
      log.warn({ err, url: source.url }, 'RIR transfers import error');
    }
  }

  log.info({ imported, sources }, 'RIR transfers import finished');
  return { imported, sources };
}
