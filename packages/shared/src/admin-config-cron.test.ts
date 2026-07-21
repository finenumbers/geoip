import { describe, expect, it } from 'vitest';
import { dailyCronToTime, timeToDailyCron } from './admin-config.js';

describe('dailyCronToTime / timeToDailyCron', () => {
  it('round-trips HH:MM through daily cron', () => {
    expect(dailyCronToTime('0 10 * * *')).toBe('10:00');
    expect(dailyCronToTime('30 6 * * *')).toBe('06:30');
    expect(timeToDailyCron('10:00')).toBe('0 10 * * *');
    expect(timeToDailyCron('06:30')).toBe('30 6 * * *');
  });
});
