import { query } from '../db/client.js';
import { logger } from '../config/logger.js';

const RDAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PEERINGDB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const RDAP_BASE: Record<string, string> = {
  ripencc: 'https://rdap.db.ripe.net',
  ripe: 'https://rdap.db.ripe.net',
  arin: 'https://rdap.arin.net/registry',
  apnic: 'https://rdap.apnic.net',
  lacnic: 'https://rdap.lacnic.net/rdap',
  afrinic: 'https://rdap.afrinic.net/rdap',
  iana: 'https://rdap.iana.org',
};

export type RirEnrichmentRequest = {
  registry: string;
  resourceType: string;
  rangeText: string;
  network: string | null;
  startAsn: number | null;
  opaqueId: string | null;
};

export type CachedEnrichment = {
  cacheKey: string;
  kind: string;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  fetchedAt: string;
  stale: boolean;
};

async function readCache(cacheKey: string): Promise<CachedEnrichment | null> {
  const result = await query<{
    cache_key: string;
    kind: string;
    payload: Record<string, unknown>;
    error_message: string | null;
    fetched_at: Date;
    expires_at: Date;
  }>(
    `SELECT cache_key, kind, payload, error_message, fetched_at, expires_at
     FROM rir_rdap_cache WHERE cache_key = $1`,
    [cacheKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    cacheKey: row.cache_key,
    kind: row.kind,
    payload: row.payload ?? {},
    errorMessage: row.error_message,
    fetchedAt: row.fetched_at.toISOString(),
    stale: row.expires_at.getTime() <= Date.now(),
  };
}

async function writeCache(
  cacheKey: string,
  kind: string,
  registry: string | null,
  resourceRef: string,
  payload: Record<string, unknown>,
  errorMessage: string | null,
  ttlMs: number,
): Promise<CachedEnrichment> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await query(
    `INSERT INTO rir_rdap_cache (cache_key, kind, registry, resource_ref, payload, error_message, fetched_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), $7)
     ON CONFLICT (cache_key) DO UPDATE SET
       kind = EXCLUDED.kind,
       registry = EXCLUDED.registry,
       resource_ref = EXCLUDED.resource_ref,
       payload = EXCLUDED.payload,
       error_message = EXCLUDED.error_message,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [cacheKey, kind, registry, resourceRef, JSON.stringify(payload), errorMessage, expiresAt],
  );
  return {
    cacheKey,
    kind,
    payload,
    errorMessage,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

function rdapBaseForRegistry(registry: string): string {
  return RDAP_BASE[registry.toLowerCase()] ?? RDAP_BASE.ripe!;
}

/** Build RDAP /ip/... path. CIDR slash must stay unencoded (APNIC/ARIN reject %2F). */
export function buildRdapIpPath(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return '/ip/';
  const slash = trimmed.lastIndexOf('/');
  if (slash > 0 && slash < trimmed.length - 1) {
    const address = trimmed.slice(0, slash);
    const prefix = trimmed.slice(slash + 1);
    if (/^\d{1,3}$/.test(prefix)) {
      return `/ip/${address}/${prefix}`;
    }
  }
  // start-end range or bare address: use first token only
  const start = trimmed.split('-')[0]?.trim() ?? trimmed;
  return `/ip/${start}`;
}

export function formatRdapHttpError(status: number, registry: string): string {
  if (status === 501) {
    return 'RDAP IANA не отдаёт объекты IP/ASN для этого запроса';
  }
  if (status === 404) {
    return 'В RDAP реестра нет объекта для этого диапазона (часто reserved/available)';
  }
  if (status === 400) {
    return `RDAP ${registry}: некорректный запрос (HTTP 400)`;
  }
  return `HTTP ${status}`;
}

function summarizeRdap(payload: Record<string, unknown>): Record<string, unknown> {
  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  const names: string[] = [];
  const roles: string[] = [];
  for (const ent of entities) {
    if (!ent || typeof ent !== 'object') continue;
    const e = ent as Record<string, unknown>;
    if (typeof e.handle === 'string') names.push(e.handle);
    if (Array.isArray(e.roles)) roles.push(...e.roles.map(String));
    const vcard = e.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const item of vcard[1] as unknown[]) {
        if (Array.isArray(item) && item[0] === 'fn' && typeof item[3] === 'string') {
          names.push(item[3]);
        }
      }
    }
  }
  return {
    handle: typeof payload.handle === 'string' ? payload.handle : null,
    name: typeof payload.name === 'string' ? payload.name : names[0] ?? null,
    type: typeof payload.type === 'string' ? payload.type : null,
    status: Array.isArray(payload.status) ? payload.status : [],
    country: typeof payload.country === 'string' ? payload.country : null,
    entities: names.slice(0, 8),
    roles: [...new Set(roles)].slice(0, 8),
    links: Array.isArray(payload.links) ? payload.links.slice(0, 5) : [],
    rawKeys: Object.keys(payload).slice(0, 20),
  };
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  registry?: string,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/rdap+json, application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const error =
        registry != null
          ? formatRdapHttpError(res.status, registry)
          : `HTTP ${res.status}`;
      return { ok: false, error };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function ensureRdap(
  req: RirEnrichmentRequest,
  fetchImpl: typeof fetch,
): Promise<CachedEnrichment> {
  const registry = req.registry.toLowerCase();
  const base = rdapBaseForRegistry(registry);
  let kind = 'rdap_ip';
  let resourceRef = req.network ?? req.rangeText;
  let url: string;

  if (req.resourceType === 'asn' && req.startAsn != null) {
    kind = 'rdap_asn';
    resourceRef = String(req.startAsn);
    url = `${base}/autnum/${req.startAsn}`;
  } else {
    const target = (req.network ?? req.rangeText ?? '').trim();
    resourceRef = target;
    url = `${base}${buildRdapIpPath(target)}`;
  }

  const cacheKey = `${kind}:${registry}:${resourceRef}`;
  const cached = await readCache(cacheKey);
  if (cached && !cached.stale && !cached.errorMessage) return cached;

  const fetched = await fetchJson(url, fetchImpl, registry);
  if (!fetched.ok) {
    logger.warn({ url, error: fetched.error }, 'RDAP fetch failed');
    return writeCache(cacheKey, kind, registry, resourceRef, {}, fetched.error, RDAP_TTL_MS / 7);
  }
  return writeCache(
    cacheKey,
    kind,
    registry,
    resourceRef,
    summarizeRdap(fetched.json),
    null,
    RDAP_TTL_MS,
  );
}

async function ensurePeeringDb(
  startAsn: number,
  fetchImpl: typeof fetch,
): Promise<CachedEnrichment | null> {
  const cacheKey = `peeringdb_asn:${startAsn}`;
  const cached = await readCache(cacheKey);
  if (cached && !cached.stale && !cached.errorMessage) return cached;

  const url = `https://www.peeringdb.com/api/net?asn=${startAsn}`;
  const fetched = await fetchJson(url, fetchImpl);
  if (!fetched.ok) {
    return writeCache(cacheKey, 'peeringdb_asn', null, String(startAsn), {}, fetched.error, PEERINGDB_TTL_MS / 7);
  }
  const data = Array.isArray(fetched.json.data) ? fetched.json.data : [];
  const first = (data[0] as Record<string, unknown> | undefined) ?? {};
  const summary = {
    name: first.name ?? null,
    aka: first.aka ?? null,
    website: first.website ?? null,
    info_type: first.info_type ?? null,
    info_traffic: first.info_traffic ?? null,
    info_scope: first.info_scope ?? null,
    asn: first.asn ?? startAsn,
    policy_general: first.policy_general ?? null,
  };
  return writeCache(cacheKey, 'peeringdb_asn', null, String(startAsn), summary, null, PEERINGDB_TTL_MS);
}

export async function enrichRirDelegation(
  req: RirEnrichmentRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rdap: CachedEnrichment; peeringdb: CachedEnrichment | null }> {
  const rdap = await ensureRdap(req, fetchImpl);
  let peeringdb: CachedEnrichment | null = null;
  if (req.resourceType === 'asn' && req.startAsn != null) {
    peeringdb = await ensurePeeringDb(req.startAsn, fetchImpl);
  }
  return { rdap, peeringdb };
}
