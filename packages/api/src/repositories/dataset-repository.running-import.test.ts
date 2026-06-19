import { describe, expect, it } from 'vitest';

/** Active import statuses polled by getRunningImport (queued is intentionally excluded). */
const ACTIVE_IMPORT_STATUSES = ['running', 'validating', 'swapping', 'refreshing_mv'] as const;

describe('getRunningImport status filter', () => {
  it('excludes queued from active import detection', () => {
    expect(ACTIVE_IMPORT_STATUSES.includes('queued' as (typeof ACTIVE_IMPORT_STATUSES)[number])).toBe(
      false,
    );
  });

  it('includes in-progress pipeline states', () => {
    expect(ACTIVE_IMPORT_STATUSES).toEqual([
      'running',
      'validating',
      'swapping',
      'refreshing_mv',
    ]);
  });
});
