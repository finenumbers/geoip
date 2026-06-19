import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  getCachedReadyResponse,
  invalidateReadyCache,
  setCachedReadyResponse,
  READY_CACHE_TTL_MS,
} from './ready-cache.js';

describe('ready-cache', () => {
  afterEach(() => {
    invalidateReadyCache();
    vi.useRealTimers();
  });

  it('returns cached payload within TTL', () => {
    const payload = {
      status: 'ready' as const,
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      timestamp: '2026-06-19T00:00:00.000Z',
    };
    setCachedReadyResponse(payload);
    expect(getCachedReadyResponse()).toEqual(payload);
  });

  it('expires cache after TTL', () => {
    vi.useFakeTimers();
    setCachedReadyResponse({
      status: 'degraded' as const,
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: false,
        importRunning: true,
      },
      timestamp: '2026-06-19T00:00:00.000Z',
    });
    vi.advanceTimersByTime(READY_CACHE_TTL_MS + 1);
    expect(getCachedReadyResponse()).toBeNull();
  });
});
