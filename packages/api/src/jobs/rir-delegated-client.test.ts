import { describe, expect, it, vi } from 'vitest';
import { RIR_DELEGATED_SOURCES } from '@geoip/shared';
import { probeAllRirSources } from './rir-delegated-client.js';

const SAMPLE = `
2.3|apnic|123|2|20200101|20260720|+1000
apnic|*|ipv4|*|1|summary
apnic|AU|ipv4|1.0.0.0|256|20110412|allocated|A91A7381
`;

describe('probeAllRirSources', () => {
  it('returns ok when all six sources are reachable and parseable', async () => {
    const fetchImpl = vi.fn(async () => new Response(SAMPLE, { status: 200 }));
    const result = await probeAllRirSources(fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.reachableCount).toBe(RIR_DELEGATED_SOURCES.length);
    expect(result.sources).toHaveLength(RIR_DELEGATED_SOURCES.length);
    expect(result.sources.every((s) => s.ok && (s.recordCount ?? 0) > 0)).toBe(true);
  });

  it('fails when any source returns non-2xx', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 2) return new Response('nope', { status: 503 });
      return new Response(SAMPLE, { status: 200 });
    });
    const result = await probeAllRirSources(fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.reachableCount).toBe(RIR_DELEGATED_SOURCES.length - 1);
    expect(result.sources.some((s) => !s.ok && s.httpStatus === 503)).toBe(true);
  });
});
