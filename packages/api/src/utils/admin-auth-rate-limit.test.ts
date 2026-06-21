import { afterEach, describe, expect, it } from 'vitest';
import {
  isAdminAuthRateLimited,
  recordAdminAuthFailure,
  resetAdminAuthRateLimitForTests,
} from './admin-auth-rate-limit.js';

describe('admin auth rate limit', () => {
  afterEach(() => {
    resetAdminAuthRateLimitForTests();
  });

  it('blocks after five failed attempts', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(isAdminAuthRateLimited('203.0.113.1', now)).toBe(false);
      recordAdminAuthFailure('203.0.113.1', now);
    }
    expect(isAdminAuthRateLimited('203.0.113.1', now)).toBe(true);
  });

  it('resets after the window expires', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      recordAdminAuthFailure('203.0.113.1', now);
    }
    expect(isAdminAuthRateLimited('203.0.113.1', now + 15 * 60 * 1000)).toBe(false);
  });
});
