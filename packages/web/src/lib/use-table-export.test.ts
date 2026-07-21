import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import { EXPORT_ROW_LIMIT_CODE } from '@geoip/shared';
import {
  formatExportError,
  formatExportRowLimitBlocked,
  isExportOverRowLimit,
  runTableExport,
  type TableExportClient,
} from '@/lib/use-table-export';

describe('formatExportError', () => {
  it('maps 503 to exportNotReady', () => {
    expect(formatExportError(new ApiError(503, 'Service unavailable'))).toBe(ui.browse.exportNotReady);
  });

  it('maps export row limit code to Russian admin hint', () => {
    expect(
      formatExportError(
        new ApiError(422, 'Validation error', undefined, EXPORT_ROW_LIMIT_CODE, 10_556_198, 5_000_000),
      ),
    ).toBe(ui.browse.exportRowLimitExceeded(10_556_198, 5_000_000));
  });

  it('maps generic 422 to message or row limit copy', () => {
    expect(formatExportError(new ApiError(422, 'Too many rows'))).toBe('Too many rows');
    expect(formatExportError(new ApiError(422, ''))).toBe(ui.browse.exportRowLimit);
  });
});

describe('isExportOverRowLimit', () => {
  it('detects when selection exceeds configured max', () => {
    expect(isExportOverRowLimit(10_556_198, 5_000_000)).toBe(true);
    expect(isExportOverRowLimit(221_911, 5_000_000)).toBe(false);
    expect(isExportOverRowLimit(0, 5_000_000)).toBe(false);
  });
});

describe('formatExportRowLimitBlocked', () => {
  it('mentions admin export settings', () => {
    expect(formatExportRowLimitBlocked(10_556_198, 5_000_000)).toContain('Admin');
    expect(formatExportRowLimitBlocked(10_556_198, 5_000_000)).not.toContain('Admin → Export');
  });
});

describe('runTableExport', () => {
  const filters = [{ field: 'country_iso_code', op: 'eq' as const, value: 'RU' }];
  const sort = [{ field: 'network', dir: 'asc' as const }];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates job, polls until succeeded, then downloads', async () => {
    const client: TableExportClient = {
      createTableExport: vi.fn().mockResolvedValue({
        id: 'job-1',
        status: 'queued',
        tableType: 'city',
        createdAt: new Date().toISOString(),
        estimatedRows: 42,
      }),
      getExportStatus: vi
        .fn()
        .mockResolvedValueOnce({ id: 'job-1', status: 'queued' })
        .mockResolvedValueOnce({ id: 'job-1', status: 'running' })
        .mockResolvedValueOnce({
          id: 'job-1',
          status: 'succeeded',
          rowCount: 42,
        }),
      downloadExport: vi.fn(),
    };

    const progress: string[] = [];
    const runPromise = runTableExport('city', filters, sort, client, {
      pollIntervalMs: 100,
      onProgress: ({ status }) => progress.push(status),
    });

    await vi.runAllTimersAsync();
    await runPromise;

    expect(client.createTableExport).toHaveBeenCalledWith(
      { tableType: 'city', filters, sort },
      undefined,
    );
    expect(client.getExportStatus).toHaveBeenCalledTimes(3);
    expect(client.downloadExport).toHaveBeenCalledWith('job-1', 'city');
    expect(progress).toEqual(['submitting', 'polling', 'downloading']);
  });

  it('throws when export job fails', async () => {
    const client: TableExportClient = {
      createTableExport: vi.fn().mockResolvedValue({
        id: 'job-2',
        status: 'queued',
        tableType: 'country',
        createdAt: new Date().toISOString(),
        estimatedRows: null,
      }),
      getExportStatus: vi.fn().mockResolvedValue({
        id: 'job-2',
        status: 'failed',
        errorMessage: 'disk full',
      }),
      downloadExport: vi.fn(),
    };

    await expect(
      runTableExport('country', filters, sort, client, { pollIntervalMs: 10 }),
    ).rejects.toThrow('disk full');
    expect(client.downloadExport).not.toHaveBeenCalled();
  });

  it('times out when job stays queued too long', async () => {
    const client: TableExportClient = {
      createTableExport: vi.fn().mockResolvedValue({
        id: 'job-3',
        status: 'queued',
        tableType: 'city',
        createdAt: new Date().toISOString(),
        estimatedRows: null,
      }),
      getExportStatus: vi.fn().mockResolvedValue({ id: 'job-3', status: 'queued' }),
      downloadExport: vi.fn(),
    };

    const runPromise = runTableExport('city', filters, sort, client, {
      pollIntervalMs: 1000,
      maxPollMs: 5000,
    });

    const assertion = expect(runPromise).rejects.toThrow(ui.browse.exportTimedOut);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
  });
});
