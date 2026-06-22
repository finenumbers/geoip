import { describe, expect, it, vi } from 'vitest';
import { formatAppBuildLabel } from './app-version';

describe('formatAppBuildLabel', () => {
  it('returns version only when build id is empty', () => {
    vi.stubEnv('VITE_APP_VERSION', '0.1.0');
    vi.stubEnv('VITE_APP_BUILD', '');
    expect(formatAppBuildLabel()).toBe('0.1.0');
  });

  it('appends short git sha when build id is set', () => {
    vi.stubEnv('VITE_APP_VERSION', '0.1.0');
    vi.stubEnv('VITE_APP_BUILD', 'c3ae7ac1234567890abcdef');
    expect(formatAppBuildLabel()).toBe('0.1.0 (c3ae7ac)');
  });

  it('falls back to dev when version is missing', () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    vi.stubEnv('VITE_APP_BUILD', '');
    expect(formatAppBuildLabel()).toBe('dev');
  });
});
