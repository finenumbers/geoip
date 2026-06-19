import { describe, it, expect } from 'vitest';

function resolveStaleMinutesFromEnv(raw: string | undefined): number {
  const DEFAULT_STALE_MINUTES = 20;
  const envMinutes = Number(raw ?? DEFAULT_STALE_MINUTES);
  if (!Number.isFinite(envMinutes) || envMinutes < 5) return DEFAULT_STALE_MINUTES;
  return Math.min(Math.floor(envMinutes), 120);
}

describe('import orphan stale threshold', () => {
  it('defaults to 20 minutes', () => {
    expect(resolveStaleMinutesFromEnv(undefined)).toBe(20);
  });

  it('clamps invalid values to default', () => {
    expect(resolveStaleMinutesFromEnv('2')).toBe(20);
    expect(resolveStaleMinutesFromEnv('abc')).toBe(20);
  });

  it('caps at 120 minutes', () => {
    expect(resolveStaleMinutesFromEnv('999')).toBe(120);
  });
});
