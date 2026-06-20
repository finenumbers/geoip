import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoutes } from './health.js';
import { invalidateReadyCache } from '../services/ready-cache.js';

vi.mock('../db/client.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  getDatasetState: vi.fn(),
  getRunningImport: vi.fn().mockResolvedValue(null),
}));

vi.mock('../sql/asn-mapping-status.js', () => ({
  isAsnMappingReady: vi.fn().mockResolvedValue(true),
}));

vi.mock('../sql/swap.js', () => ({
  productionIndexesOk: vi.fn().mockResolvedValue(true),
}));

vi.mock('../sql/recreate-materialized-views.js', () => ({
  materializedViewsExist: vi.fn().mockResolvedValue(true),
}));

const { getDatasetState } = await import('../repositories/dataset-repository.js');

describe('GET /api/v1/ready', () => {
  afterEach(() => {
    invalidateReadyCache();
    vi.mocked(getDatasetState).mockReset();
  });

  it('returns 200 when status is ready', async () => {
    vi.mocked(getDatasetState).mockResolvedValue({
      datasetDate: '2026-06-20',
      mvStatus: 'ready',
    } as never);

    const app = Fastify();
    await registerHealthRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready' });
    await app.close();
  });

  it('returns 503 when status is not_ready', async () => {
    vi.mocked(getDatasetState).mockResolvedValue({
      datasetDate: null,
      mvStatus: 'unavailable',
    } as never);

    const app = Fastify();
    await registerHealthRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'not_ready' });
    await app.close();
  });

  it('returns 503 when status is degraded', async () => {
    vi.mocked(getDatasetState).mockResolvedValue({
      datasetDate: '2026-06-20',
      mvStatus: 'ready',
    } as never);
    const { getRunningImport } = await import('../repositories/dataset-repository.js');
    vi.mocked(getRunningImport).mockResolvedValue({ id: 1 } as never);

    const app = Fastify();
    await registerHealthRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded' });
    await app.close();
  });
});
