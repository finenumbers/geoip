import { afterEach, describe, expect, it } from 'vitest';
import {
  checkAdminAuthRateLimit,
  resetAdminAuthRateLimitForTests,
} from './admin-auth-rate-limit.js';

describe('checkAdminAuthRateLimit', () => {
  afterEach(() => {
    resetAdminAuthRateLimitForTests();
  });

  it('allows up to five attempts per window', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(checkAdminAuthRateLimit('203.0.113.1', now)).toBe(true);
    }
    expect(checkAdminAuthRateLimit('203.0.113.1', now)).toBe(false);
  });

  it('resets after the window expires', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      checkAdminAuthRateLimit('203.0.113.1', now);
    }
    expect(checkAdminAuthRateLimit('203.0.113.1', now + 15 * 60 * 1000)).toBe(true);
  });
});
