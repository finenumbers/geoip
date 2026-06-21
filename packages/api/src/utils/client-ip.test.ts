import { describe, expect, it } from 'vitest';
import { clientIp, publicClientIp } from './client-ip.js';

describe('clientIp', () => {
  it('uses first public X-Forwarded-For address', () => {
    const ip = clientIp({
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    } as never);
    expect(ip).toBe('203.0.113.5');
  });

  it('skips private hops in X-Forwarded-For', () => {
    const ip = clientIp({
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '192.168.65.1, 203.0.113.9' },
    } as never);
    expect(ip).toBe('203.0.113.9');
  });

  it('falls back to X-Real-IP', () => {
    const ip = clientIp({
      ip: '127.0.0.1',
      headers: { 'x-real-ip': '198.51.100.2' },
    } as never);
    expect(ip).toBe('198.51.100.2');
  });
});

describe('publicClientIp', () => {
  it('returns null for private addresses', () => {
    const ip = publicClientIp({
      ip: '192.168.65.1',
      headers: { 'x-real-ip': '192.168.65.1' },
    } as never);
    expect(ip).toBeNull();
  });

  it('returns public address when available', () => {
    const ip = publicClientIp({
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    } as never);
    expect(ip).toBe('203.0.113.5');
  });
});
