import { describe, expect, it } from 'vitest';
import { sortFacetItemsBySearch } from './facet-search-utils.js';

describe('sortFacetItemsBySearch', () => {
  it('ranks prefix matches before substring-only matches', () => {
    const items = sortFacetItemsBySearch(
      [
        { value: 'BigCo Seven Network Partner', count: 100 },
        { value: 'Seven Network Inc.', count: 5 },
      ],
      'Se',
      10,
    );

    expect(items.map((i) => i.value)).toEqual(['Seven Network Inc.', 'BigCo Seven Network Partner']);
  });

  it('keeps count order when no search needle', () => {
    const items = sortFacetItemsBySearch(
      [
        { value: 'B', count: 1 },
        { value: 'A', count: 10 },
      ],
      '',
      10,
    );
    expect(items.map((i) => i.value)).toEqual(['A', 'B']);
  });
});
