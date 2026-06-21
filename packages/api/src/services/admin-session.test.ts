import { describe, expect, it } from 'vitest';
import { sessionCookieSecure } from './admin-session.js';

describe('sessionCookieSecure', () => {
  it('returns false for plain HTTP', () => {
    expect(sessionCookieSecure({ protocol: 'http' } as never)).toBe(false);
  });

  it('returns true for HTTPS', () => {
    expect(sessionCookieSecure({ protocol: 'https' } as never)).toBe(true);
  });
});
