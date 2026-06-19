import { describe, expect, it } from 'vitest';
import {
  needsDeepPageBootstrap,
  shouldWarnOffsetPageJump,
} from './browse-sort-hints.js';

const supportsKeyset = (sortJson: string) => {
  try {
    const parsed = JSON.parse(sortJson) as Array<{ field: string }>;
    return parsed.length <= 1;
  } catch {
    return true;
  }
};

describe('browse sort hints', () => {
  it('detects deep page bootstrap without cursor', () => {
    expect(needsDeepPageBootstrap(5, '[{"field":"country_name","dir":"desc"}]', undefined, supportsKeyset)).toBe(true);
    expect(needsDeepPageBootstrap(5, '[{"field":"country_name","dir":"desc"}]', 10, supportsKeyset)).toBe(false);
    expect(needsDeepPageBootstrap(1, '[]', undefined, supportsKeyset)).toBe(false);
  });

  it('warns on deep offset jumps for non-keyset sorts', () => {
    const multiSort = '[{"field":"asn","dir":"asc"},{"field":"network","dir":"asc"}]';
    expect(shouldWarnOffsetPageJump(50, multiSort, supportsKeyset)).toBe(true);
    expect(shouldWarnOffsetPageJump(2, multiSort, supportsKeyset)).toBe(false);
  });
});
