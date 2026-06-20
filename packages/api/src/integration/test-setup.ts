import { closeDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { isFixtureDatasetReady, seedFixtureDataset } from './seed-fixture-dataset.js';

export const runIntegration = process.env.RUN_INTEGRATION === '1';

/** Migrate and load fixtures/csv so table/browse endpoints return 200 in CI. */
export async function prepareIntegrationDb(): Promise<void> {
  await migrate();
  await seedFixtureDataset();
}

/** True when MVs are ready and fixture rows are queryable. */
export async function requiresDataset(): Promise<boolean> {
  return isFixtureDatasetReady();
}

export async function teardownIntegrationDb(): Promise<void> {
  await closeDb();
}
