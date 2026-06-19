import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync, rmSync } from 'node:fs';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/client.js';
import { streamTableExportToFile } from '../services/export-service.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const EXPORT_BATCH_SIZE = 10_000;

describe.skipIf(!runIntegration)('export keyset streaming (Phase E1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await migrate();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('exports multiple batches with unique row ids (no first-batch repeat)', async () => {
    const filePath = '/tmp/geoip-export-keyset-e1.csv';
    try {
      const exported = await streamTableExportToFile('country', [], [], filePath);
      if (exported <= EXPORT_BATCH_SIZE) {
        return;
      }

      const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines.length).toBe(exported + 1);

      const ids = lines.slice(1).map((line) => Number(line.split(',')[0]));
      expect(new Set(ids).size).toBe(ids.length);

      const firstId = ids[0];
      const idAtSecondBatch = ids[EXPORT_BATCH_SIZE];
      expect(idAtSecondBatch).not.toBe(firstId);
    } finally {
      rmSync(filePath, { force: true });
    }
  }, 120_000);
});
