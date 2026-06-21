import { describe, expect, it } from 'vitest';
import { secureStringEqual } from './secure-compare.js';

describe('secureStringEqual', () => {
  it('returns true for matching strings', () => {
    expect(secureStringEqual('secret-key', 'secret-key')).toBe(true);
  });

  it('returns false for mismatched strings of same length', () => {
    expect(secureStringEqual('secret-key', 'secret-kex')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(secureStringEqual('short', 'much-longer-value')).toBe(false);
  });

  it('returns false when expected is empty', () => {
    expect(secureStringEqual('anything', '')).toBe(false);
  });
});
