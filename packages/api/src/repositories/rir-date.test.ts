import { describe, expect, it } from 'vitest';
import { asDateOnly } from './rir-repository.js';

describe('asDateOnly', () => {
  it('keeps YYYY-MM-DD strings', () => {
    expect(asDateOnly('2026-07-21')).toBe('2026-07-21');
  });

  it('strips ISO timestamps to date', () => {
    expect(asDateOnly('2026-07-21T00:00:00.000Z')).toBe('2026-07-21');
  });

  it('formats Date at UTC midnight', () => {
    expect(asDateOnly(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-07-21');
  });

  it('returns null for empty values', () => {
    expect(asDateOnly(null)).toBeNull();
    expect(asDateOnly('')).toBeNull();
  });
});
