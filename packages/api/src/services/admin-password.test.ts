import { describe, expect, it } from 'vitest';
import { hashAdminPassword, verifyAdminPassword } from './admin-password.js';

describe('admin-password', () => {
  it('hashes and verifies password', () => {
    const hash = hashAdminPassword('secret-password');
    expect(verifyAdminPassword('secret-password', hash)).toBe(true);
    expect(verifyAdminPassword('wrong', hash)).toBe(false);
  });
});
