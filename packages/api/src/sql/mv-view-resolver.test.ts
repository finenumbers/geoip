import { describe, expect, it } from 'vitest';
import { isRuScopedCityQuery, resolveBrowseView } from './mv-view-resolver.js';

describe('mv-view-resolver', () => {
  it('uses partial RU MV for city + country_iso_code=RU', () => {
    const filters = [{ field: 'country_iso_code', op: 'eq' as const, value: 'RU' }];
    expect(isRuScopedCityQuery(filters)).toBe(true);
    const resolved = resolveBrowseView('city', filters);
    expect(resolved.view).toBe('mv_city_blocks_ru');
    expect(resolved.filters).toEqual([]);
    expect(resolved.ruPartial).toBe(true);
  });

  it('uses partial RU MV with additional filters', () => {
    const filters = [
      { field: 'country_iso_code', op: 'eq' as const, value: 'RU' },
      { field: 'city_name', op: 'contains' as const, value: 'Mos' },
    ];
    const resolved = resolveBrowseView('city', filters);
    expect(resolved.view).toBe('mv_city_blocks_ru');
    expect(resolved.filters).toHaveLength(1);
    expect(resolved.filters[0]?.field).toBe('city_name');
  });

  it('keeps full MV without RU filter', () => {
    const filters = [{ field: 'country_iso_code', op: 'eq' as const, value: 'DE' }];
    const resolved = resolveBrowseView('city', filters);
    expect(resolved.view).toBe('mv_city_blocks_analytics');
    expect(resolved.ruPartial).toBe(false);
  });

  it('keeps full MV when RU conflicts with another country filter', () => {
    const filters = [
      { field: 'country_iso_code', op: 'eq' as const, value: 'RU' },
      { field: 'country_iso_code', op: 'eq' as const, value: 'DE' },
    ];
    expect(isRuScopedCityQuery(filters)).toBe(false);
    expect(resolveBrowseView('city', filters).view).toBe('mv_city_blocks_analytics');
  });

  it('country table always uses country MV', () => {
    const filters = [{ field: 'country_iso_code', op: 'eq' as const, value: 'RU' }];
    expect(resolveBrowseView('country', filters).view).toBe('mv_country_blocks_analytics');
  });
});
