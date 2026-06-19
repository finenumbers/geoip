import type { Logger } from 'pino';
import { getImportRunById } from '../repositories/dataset-repository.js';

export async function logImportBenchmarkSummary(
  importRunId: string,
  log: Logger,
): Promise<void> {
  const run = await getImportRunById(importRunId);
  if (!run?.steps?.length) return;

  const steps: Record<string, number> = {};
  let trackedMs = 0;
  for (const step of run.steps) {
    if (step.durationMs == null) continue;
    steps[step.name] = step.durationMs;
    trackedMs += step.durationMs;
  }

  const wallMs =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  log.info(
    {
      importRunId,
      datasetDate: run.datasetDate,
      wallMs,
      trackedMs,
      steps,
      counts: run.counts,
    },
    'Import benchmark summary',
  );
}
