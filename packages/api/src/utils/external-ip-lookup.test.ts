import { describe, expect, it, vi, afterEach } from 'vitest';
import { lookupServerPublicIp } from './external-ip-lookup.js';

describe('lookupServerPublicIp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns first public IP from providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('ipify')) {
          return new Response(JSON.stringify({ ip: '203.0.113.7' }), { status: 200 });
        }
        return new Response('', { status: 500 });
      }),
    );

    await expect(lookupServerPublicIp()).resolves.toBe('203.0.113.7');
  });

  it('falls back when first provider fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('ipify')) {
          return new Response('', { status: 503 });
        }
        if (url.includes('ifconfig.me')) {
          return new Response('198.51.100.4\n', { status: 200 });
        }
        return new Response('', { status: 500 });
      }),
    );

    await expect(lookupServerPublicIp()).resolves.toBe('198.51.100.4');
  });
});
