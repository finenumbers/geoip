export const READY_CACHE_TTL_MS = 8_000;

export type ReadyResponse = {
  status: 'ready' | 'degraded' | 'not_ready';
  checks: {
    database: boolean;
    dataset: boolean;
    materializedViews: boolean;
    productionIndexes: boolean;
    asnMapping: boolean;
    importRunning: boolean;
  };
  timestamp: string;
};

let readyCache: { expiresAt: number; payload: ReadyResponse } | null = null;

export function getCachedReadyResponse(): ReadyResponse | null {
  if (!readyCache || readyCache.expiresAt <= Date.now()) {
    readyCache = null;
    return null;
  }
  return readyCache.payload;
}

export function setCachedReadyResponse(payload: ReadyResponse): void {
  readyCache = {
    expiresAt: Date.now() + READY_CACHE_TTL_MS,
    payload,
  };
}

export function invalidateReadyCache(): void {
  readyCache = null;
}
