import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  loadEnv: vi.fn(() => ({
    TABLE_MAX_PAGE_SIZE: 100,
    TABLE_MAX_OFFSET_PAGE: 10,
    EXPORT_MAX_ROWS: 50_000,
  })),
}));

const { validateTableQueryLimits, validateExportRowLimit } = await import('./query-limits.js');

describe('query-limits', () => {
  it('rejects pageSize above configured maximum', () => {
    expect(validateTableQueryLimits(1, 101, false)).toMatchObject({
      ok: false,
      path: 'pageSize',
    });
  });

  it('rejects deep offset pagination', () => {
    expect(validateTableQueryLimits(11, 50, false)).toMatchObject({
      ok: false,
      path: 'page',
    });
  });

  it('allows keyset pagination beyond offset page cap', () => {
    expect(validateTableQueryLimits(500, 50, true)).toEqual({ ok: true });
  });

  it('rejects export above row cap', () => {
    expect(validateExportRowLimit(50_001)).toMatchObject({ ok: false });
  });
});
