import { describe, expect, it } from 'vitest';
import { getNextDailyCronRun } from './next-cron-run.js';

describe('getNextDailyCronRun', () => {
  it('returns same-day run when before scheduled time (UTC)', () => {
    const from = new Date('2026-06-19T01:00:00.000Z');
    const next = getNextDailyCronRun('0 3 * * *', from, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-19T03:00:00.000Z');
  });

  it('returns next day when after scheduled time (UTC)', () => {
    const from = new Date('2026-06-19T04:00:00.000Z');
    const next = getNextDailyCronRun('0 3 * * *', from, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-20T03:00:00.000Z');
  });

  it('uses cron timezone (Europe/Moscow) for next run', () => {
    const from = new Date('2026-06-21T06:00:00.000Z'); // 09:00 MSK
    const next = getNextDailyCronRun('0 10 * * *', from, 'Europe/Moscow');
    expect(next?.toISOString()).toBe('2026-06-21T07:00:00.000Z'); // 10:00 MSK
  });

  it('rolls to next day in cron timezone after scheduled time', () => {
    const from = new Date('2026-06-21T08:00:00.000Z'); // 11:00 MSK
    const next = getNextDailyCronRun('0 10 * * *', from, 'Europe/Moscow');
    expect(next?.toISOString()).toBe('2026-06-22T07:00:00.000Z');
  });
});
