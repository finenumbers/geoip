import { describe, expect, it } from 'vitest';
import {
  buildBrowseQueryParams,
  findBestCursorStart,
  seekBrowsePage,
} from './browse-pagination.js';
describe('browse-pagination', () => {
  it('findBestCursorStart uses nearest known cursor', () => {
    const stack = [null, { afterId: 10, afterNetwork: '1.0.0.0/8' }];
    expect(findBestCursorStart(stack, 3)).toEqual({
      startPage: 2,
      cursor: { afterId: 10, afterNetwork: '1.0.0.0/8' },
    });
  });

  it('findBestCursorStart falls back to page 1', () => {
    expect(findBestCursorStart([null], 5)).toEqual({ startPage: 1, cursor: null });
  });

  it('buildBrowseQueryParams includes cursor fields', () => {
    const params = buildBrowseQueryParams(2, 50, '[]', '[]', {
      afterId: 1,
      afterNetwork: '10.0.0.0/8',
      afterSortValue: 'RU',
    });
    expect(params.get('page')).toBe('2');
    expect(params.get('afterSortValue')).toBe('RU');
  });

  it('seekBrowsePage walks forward from page 1', async () => {
    const calls: Array<{ page: number; afterId: string | null }> = [];
    const { stack, cursor } = await seekBrowsePage(
      3,
      50,
      '[]',
      '[]',
      [null],
      async (params) => {
        const page = Number(params.get('page'));
        calls.push({ page, afterId: params.get('afterId') });
        return {
          meta: {
            nextCursor: {
              afterId: page * 100,
              afterNetwork: `10.${page}.0.0/24`,
            },
          },
        };
      },
    );
    expect(calls).toEqual([
      { page: 1, afterId: null },
      { page: 2, afterId: '100' },
    ]);
    expect(cursor).toEqual({ afterId: 200, afterNetwork: '10.2.0.0/24' });
    expect(stack[2]).toEqual(cursor);
  });
});
