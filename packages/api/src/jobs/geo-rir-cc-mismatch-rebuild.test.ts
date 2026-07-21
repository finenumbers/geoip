import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

const clientQuery = vi.fn();
const queryMock = vi.fn();

vi.mock('../db/client.js', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  withDirectPoolClient: vi.fn(async (fn: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
    fn({ query: clientQuery }),
  ),
}));

vi.mock('../repositories/rir-repository.js', () => ({
  isRirDatasetReady: vi.fn(),
}));

const { isRirDatasetReady } = await import('../repositories/rir-repository.js');
const { rebuildGeoRirCcMismatches } = await import('./geo-rir-cc-mismatch-rebuild.js');

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function okResult(rows: unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

describe('rebuildGeoRirCcMismatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery.mockResolvedValue(okResult());
    queryMock.mockResolvedValue(okResult([{ ready: true }]));
    vi.mocked(isRirDatasetReady).mockResolvedValue(true);
  });

  it('skips truncate when datasets are not ready (force)', async () => {
    vi.mocked(isRirDatasetReady).mockResolvedValue(false);

    const result = await rebuildGeoRirCcMismatches(log, { force: true });

    expect(result).toBeNull();
    const sql = clientQuery.mock.calls.map(([s]) => String(s));
    expect(sql.some((s) => s.includes('pg_advisory_lock'))).toBe(true);
    expect(sql.some((s) => s.includes('TRUNCATE geo_rir_cc_mismatches'))).toBe(false);
    expect(sql.some((s) => s.includes("status = 'running'"))).toBe(false);
    expect(sql.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('claims stale running when force is false', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('pg_advisory_lock') || s.includes('pg_advisory_unlock')) {
        return okResult();
      }
      if (s.includes('UPDATE geo_rir_cc_mismatch_state') && s.includes("status = 'running'")) {
        expect(s).toContain("status = 'running' AND updated_at < NOW()");
        expect(s).toContain('never');
        expect(s).toContain('failed');
        return okResult([{ id: 1 }], 1);
      }
      if (s.includes('TRUNCATE')) return okResult();
      if (s.includes('WITH inserted AS')) return okResult([{ count: '2' }]);
      if (s.includes("status = 'ready'")) return okResult([], 1);
      return okResult();
    });

    const result = await rebuildGeoRirCcMismatches(log, { force: false });
    expect(result).toEqual({ rowCount: 2 });
  });

  it('zeros row_count and sets duration_ms on failure after truncate', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('pg_advisory_lock') || s.includes('pg_advisory_unlock')) {
        return okResult();
      }
      if (s.includes("status = 'running'")) return okResult([], 1);
      if (s.includes('TRUNCATE')) return okResult();
      if (s.includes('WITH inserted AS')) throw new Error('insert blew up');
      if (s.includes("status = 'failed'")) {
        expect(s).toContain('row_count = 0');
        expect(s).toContain('duration_ms = $2');
        return okResult([], 1);
      }
      return okResult();
    });

    await expect(rebuildGeoRirCcMismatches(log, { force: true })).rejects.toThrow('insert blew up');

    const failedCall = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'failed'"),
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[1]?.[0]).toContain('insert blew up');
    expect(typeof failedCall?.[1]?.[1]).toBe('number');
  });
});
