import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  isStagingSnapshotMetaValid,
  restoreStagingSnapshot,
  stagingSnapshotPaths,
} from './staging-snapshot.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('staging-snapshot', () => {
  it('validates snapshot meta against fingerprint and counts', () => {
    const meta = {
      date: '20260619',
      fingerprint: 'abc123',
      counts: {
        stg_geo_city_blocks: 100,
        stg_geo_country_blocks: 10,
      },
      sizeBytes: 1024,
      createdAt: new Date().toISOString(),
    };

    expect(
      isStagingSnapshotMetaValid(meta, '20260619', 'abc123', 1024),
    ).toBe(true);

    expect(
      isStagingSnapshotMetaValid(meta, '20260619', 'wrong', 1024),
    ).toBe(false);
  });

  it('builds stable snapshot paths', () => {
    expect(stagingSnapshotPaths('/tmp/geoip-import', '20260619')).toEqual({
      dumpPath: '/tmp/geoip-import/snapshots/20260619/staging.dump',
      metaPath: '/tmp/geoip-import/snapshots/20260619/staging.dump.meta.json',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restore uses data-only section restore flags', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
        }),
      };
      return child as unknown as ReturnType<typeof spawn>;
    });

    await restoreStagingSnapshot(
      '/tmp/staging.dump',
      'postgresql://geoip:geoip@postgres:5432/geoip',
    );

    expect(spawn).toHaveBeenCalledWith(
      'pg_restore',
      expect.arrayContaining(['--data-only', '--disable-triggers']),
      expect.any(Object),
    );
  });
});
