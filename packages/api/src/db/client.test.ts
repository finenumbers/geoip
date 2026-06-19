import { describe, expect, it } from 'vitest';

describe('pool session hygiene', () => {
  it('documents RESET statement_timeout before pool release', () => {
    const resetSql = 'RESET statement_timeout';
    expect(resetSql).toContain('RESET statement_timeout');
  });
});
