import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { importRuns } from '../db/schema.js';
import { getRunningImport } from '../repositories/dataset-repository.js';

export async function createImportRun(
  triggeredBy: 'manual' | 'cron' | 'api',
): Promise<{ conflict: boolean; importRunId?: string }> {
  const running = await getRunningImport();
  if (running) {
    return { conflict: true, importRunId: running.id };
  }

  const db = getDb();
  const [run] = await db
    .insert(importRuns)
    .values({ triggeredBy, status: 'queued' })
    .returning({ id: importRuns.id });

  return { conflict: false, importRunId: run?.id };
}

export async function getQueuedImports() {
  const db = getDb();
  return db
    .select()
    .from(importRuns)
    .where(eq(importRuns.status, 'queued'))
    .orderBy(importRuns.id);
}
