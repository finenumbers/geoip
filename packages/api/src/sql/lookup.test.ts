import { describe, it, expect } from 'vitest';
import { validateIp } from './lookup.js';

describe('validateIp', () => {
  it('accepts valid IPv4', () => {
    expect(validateIp('8.8.8.8')).toBe('8.8.8.8');
  });

  it('accepts valid IPv6', () => {
    expect(validateIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('rejects invalid IP', () => {
    expect(validateIp('not-an-ip')).toBeNull();
    expect(validateIp('')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(validateIp('  1.1.1.1  ')).toBe('1.1.1.1');
  });
});
