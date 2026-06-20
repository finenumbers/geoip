import { pathToFileURL } from 'node:url';
import { closeDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { seedFixtureDataset } from '../integration/seed-fixture-dataset.js';
import { logger } from '../config/logger.js';

async function main(): Promise<void> {
  await migrate();
  await seedFixtureDataset();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => {
      logger.error({ err }, 'Fixture seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
