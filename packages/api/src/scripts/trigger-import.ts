import { migrate } from '../db/migrate.js';
import { createImportRun } from '../services/import-service.js';
import { closeDb } from '../db/client.js';

async function main(): Promise<void> {
  await migrate();

  const result = await createImportRun('api');
  if (result.conflict) {
    console.error(`Import already in progress: ${result.importRunId ?? 'unknown'}`);
    process.exit(2);
  }

  console.log(JSON.stringify({ importRunId: result.importRunId, status: 'queued' }));
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
