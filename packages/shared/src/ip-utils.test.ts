import { describe, expect, it } from 'vitest';
import { isPublicIpAddress } from './ip-utils.js';

describe('isPublicIpAddress', () => {
  it('accepts public IPv4', () => {
    expect(isPublicIpAddress('203.0.113.5')).toBe(true);
  });

  it('rejects private IPv4', () => {
    expect(isPublicIpAddress('192.168.1.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.1')).toBe(false);
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
  });

  it('rejects link-local and loopback IPv6', () => {
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fe80::1')).toBe(false);
  });
});
