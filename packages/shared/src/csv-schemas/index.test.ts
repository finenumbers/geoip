import { describe, it, expect } from 'vitest';
import { validateCsvHeaders, cityBlockCsvHeaders } from './index.js';

describe('validateCsvHeaders', () => {
  it('accepts valid city block headers', () => {
    const result = validateCsvHeaders([...cityBlockCsvHeaders], cityBlockCsvHeaders);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('rejects missing columns', () => {
    const result = validateCsvHeaders(['network', 'geoname_id'], cityBlockCsvHeaders);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('rejects extra columns', () => {
    const headers = [...cityBlockCsvHeaders, 'unexpected_col'];
    const result = validateCsvHeaders(headers, cityBlockCsvHeaders);
    expect(result.valid).toBe(false);
    expect(result.extra).toContain('unexpected_col');
  });
});
