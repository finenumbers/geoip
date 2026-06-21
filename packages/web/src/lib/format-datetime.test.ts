import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format-datetime';

describe('formatDateTime', () => {
  it('formats ISO in given timezone', () => {
    const formatted = formatDateTime('2026-06-22T07:00:00.000Z', 'Europe/Moscow');
    expect(formatted).toMatch(/22\.06\.2026/);
    expect(formatted).toMatch(/10:00:00/);
  });

  it('returns em dash for empty input', () => {
    expect(formatDateTime(null, 'Europe/Moscow')).toBe('—');
  });
});
