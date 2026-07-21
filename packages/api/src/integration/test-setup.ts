import { closeDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { isFixtureDatasetReady, seedFixtureDataset } from './seed-fixture-dataset.js';
import { seedRirFixtureDataset } from './seed-rir-fixture.js';
import { loadEnv } from '../config/env.js';

export const runIntegration = process.env.RUN_INTEGRATION === '1';

/** Migrate and load fixtures/csv so table/browse endpoints return 200 in CI. */
export async function prepareIntegrationDb(): Promise<void> {
  await migrate();
  await seedFixtureDataset();
  await seedRirFixtureDataset();
}

/** Headers for integration requests when API auth is enabled. */
export function integrationApiHeaders(): Record<string, string> {
  const env = loadEnv();
  if (!env.API_AUTH_ENABLED) return {};
  return { 'x-api-key': getIntegrationApiKey() };
}

/** API key from runtime config store (auto-generated on first boot; not from IMPORT_API_KEY env). */
export function getIntegrationApiKey(): string {
  return loadEnv().API_KEY;
}

/** True when MVs are ready and fixture rows are queryable. */
export async function requiresDataset(): Promise<boolean> {
  return isFixtureDatasetReady();
}

export async function teardownIntegrationDb(): Promise<void> {
  await closeDb();
}
