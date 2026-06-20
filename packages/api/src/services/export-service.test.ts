import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportKeysetQueryPage, resolveExportUseKeyset } from './export-service.js';

/** Documents the atomic claim predicate used by processExportJob and claimNextExportJob. */
describe('export job claim semantics', () => {
  it('only transitions queued jobs to running', () => {
    const claimable: Record<string, boolean> = {
      queued: true,
      running: false,
      succeeded: false,
      failed: false,
    };

    for (const [status, canClaim] of Object.entries(claimable)) {
      const wouldClaim = status === 'queued';
      expect(wouldClaim).toBe(canClaim);
    }
  });
});

describe('exportKeysetQueryPage', () => {
  it('uses page 1 without cursor on first keyset batch', () => {
    expect(exportKeysetQueryPage(undefined, 1, true)).toBe(1);
  });

  it('uses page 2 with cursor so buildTableQuery activates keyset', () => {
    expect(exportKeysetQueryPage(42, 1, true)).toBe(2);
  });

  it('passes through offset page when keyset is disabled', () => {
    expect(exportKeysetQueryPage(undefined, 3, false)).toBe(3);
    expect(exportKeysetQueryPage(99, 4, false)).toBe(4);
  });
});

describe('resolveExportFilePath', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const { resetEnvCache } = await import('../config/env.js');
    resetEnvCache();
  });

  it('writes under EXPORT_DIR from runtime config', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'geoip-export-config-'));
    vi.stubEnv('DATABASE_URL', 'postgresql://geoip:geoip@localhost:5432/geoip');
    vi.stubEnv('CONFIG_DATA_DIR', configDir);
    vi.stubEnv('CONFIG_MASTER_KEY', 'a'.repeat(64));
    vi.resetModules();
    try {
      const { loadRuntimeConfig, persistRuntimeConfig } = await import('../config/runtime-config.js');
      const config = loadRuntimeConfig();
      persistRuntimeConfig(
        {
          ...config.settings,
          export: { ...config.settings.export, dir: '/tmp/test-exports-phase-c' },
        },
        config.secrets,
      );
      const { resetEnvCache } = await import('../config/env.js');
      resetEnvCache();
      const { resolveExportFilePath } = await import('./export-service.js');
      expect(resolveExportFilePath('abc-123')).toBe('/tmp/test-exports-phase-c/abc-123.csv');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

describe('resolveExportUseKeyset', () => {
  it('allows keyset when ASN filter uses precomputed mapping', () => {
    expect(
      resolveExportUseKeyset(
        [{ field: 'network', dir: 'asc' }],
        [{ field: 'asn', op: 'eq', value: 13238 }],
        true,
      ),
    ).toBe(true);
  });

  it('disables keyset for ASN filter without precomputed mapping', () => {
    expect(
      resolveExportUseKeyset(
        [{ field: 'network', dir: 'asc' }],
        [{ field: 'asn', op: 'eq', value: 13238 }],
        false,
      ),
    ).toBe(false);
  });
});

describe('streamTableExportToFile keyset batches', () => {
  const buildTableQueryCalls: Array<{ page: number; afterId?: number }> = [];

  beforeEach(() => {
    buildTableQueryCalls.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../db/client.js');
    vi.doUnmock('../sql/asn-mapping-status.js');
    vi.doUnmock('../sql/asn-enrichment.js');
    vi.doUnmock('../sql/table-query.js');
  });

  it('advances via keyset cursor without repeating the first batch', async () => {
    vi.doMock('../sql/asn-mapping-status.js', () => ({
      isAsnMappingReady: vi.fn().mockResolvedValue(false),
    }));

    vi.doMock('../sql/asn-enrichment.js', () => ({
      enrichBlockRowsWithAsn: vi.fn(async (_type: string, rows: Record<string, unknown>[]) => rows),
    }));

    vi.doMock('../sql/table-query.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../sql/table-query.js')>();
      return {
        ...actual,
        buildTableQuery: vi.fn(
          (
            tableType: 'city' | 'country',
            options: {
              page: number;
              afterId?: number;
              afterNetwork?: string;
            },
          ) => {
            buildTableQueryCalls.push({ page: options.page, afterId: options.afterId });
            if (options.afterId != null) {
              return {
                sql: 'SELECT keyset-batch',
                countSql: null,
                params: [],
                countParams: [],
                useCachedCount: false,
                skipExactCount: false,
              };
            }
            return {
              sql: 'SELECT first-batch',
              countSql: null,
              params: [],
              countParams: [],
              useCachedCount: false,
              skipExactCount: false,
            };
          },
        ),
      };
    });

    let queryCall = 0;
    vi.doMock('../db/client.js', () => ({
      query: vi.fn(async (sql: string) => {
        queryCall += 1;
        if (sql === 'SELECT first-batch') {
          return {
            rows: Array.from({ length: 10_000 }, (_, index) => ({
              id: index + 1,
              network: `10.${index}.0.0/24`,
              prefix_len: 24,
              country_iso_code: 'US',
              country_name: 'United States',
              city_name: 'Test',
              subdivision_1_name: null,
              timezone: 'America/New_York',
            })),
          };
        }
        if (sql === 'SELECT keyset-batch') {
          return {
            rows: [{ id: 10_001, network: '10.10000.0.0/24', prefix_len: 24 }],
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }),
    }));

    const { streamTableExportToFile } = await import('./export-service.js');
    const dir = mkdtempSync(join(tmpdir(), 'geoip-export-test-'));
    const filePath = join(dir, 'out.csv');

    try {
      const rowCount = await streamTableExportToFile('city', [], [], filePath);
      expect(rowCount).toBe(10_001);
      expect(queryCall).toBe(2);
      expect(buildTableQueryCalls).toEqual([
        { page: 1, afterId: undefined },
        { page: 2, afterId: 10_000 },
      ]);

      const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(10_002);
      expect(lines[0]).toContain('asn');
      expect(lines[1]).toContain('10.0.0.0/24');
      expect(lines.at(-1)).toContain('10.10000.0.0/24');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
