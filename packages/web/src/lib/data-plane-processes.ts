import type { ReadyResponse, RirDatasetStateResponse } from '@geoip/shared';
import { ui } from '@/lib/ui-strings';
import { isMaterializedViewsWarmup } from '@/lib/system-status-labels';

export type DataPlaneProcessKind = 'progress' | 'warning' | 'error';

export type DataPlaneProcess = {
  id: string;
  kind: DataPlaneProcessKind;
  text: string;
};

export type DataPlaneProcessInput = {
  checks?: ReadyResponse['checks'];
  mvStatus?: 'ready' | 'refreshing' | 'unavailable' | null;
  datasetPending?: boolean;
  isMvWarmup?: boolean;
  rir?: Pick<RirDatasetStateResponse, 'status' | 'lastError' | 'rowCount'> | null;
};

/** Active import / prep / init lines for the global system banner (GRChC + RIR). */
export function collectDataPlaneProcesses(input: DataPlaneProcessInput): DataPlaneProcess[] {
  const { checks, mvStatus, datasetPending = false, rir } = input;
  const mvWarmup =
    input.isMvWarmup ?? isMaterializedViewsWarmup(checks, mvStatus, datasetPending);
  const out: DataPlaneProcess[] = [];

  if (checks?.importRunning) {
    out.push({
      id: 'grchc-import',
      kind: 'progress',
      text: ui.systemBanner.processGrchcImport,
    });
  }

  if (mvWarmup || mvStatus === 'refreshing') {
    out.push({
      id: 'grchc-mv',
      kind: 'progress',
      text: ui.systemBanner.processGrchcMv,
    });
  }

  if (
    checks?.database &&
    checks.dataset &&
    checks.materializedViews &&
    checks.productionIndexes &&
    !checks.asnMapping &&
    !checks.importRunning
  ) {
    out.push({
      id: 'grchc-asn',
      kind: 'warning',
      text: ui.systemBanner.processGrchcAsn,
    });
  }

  if (rir?.status === 'importing') {
    out.push({
      id: 'rir-import',
      kind: 'progress',
      text: ui.systemBanner.processRirImport,
    });
  } else if (rir?.status === 'failed') {
    const detail = rir.lastError?.trim();
    out.push({
      id: 'rir-failed',
      kind: 'error',
      text: detail
        ? `${ui.systemBanner.processRirFailed}: ${detail}`
        : ui.systemBanner.processRirFailed,
    });
  }

  return out;
}

export function dataPlaneHasProgress(processes: DataPlaneProcess[]): boolean {
  return processes.some((p) => p.kind === 'progress');
}

export function dataPlaneHasIssues(processes: DataPlaneProcess[]): boolean {
  return processes.some((p) => p.kind === 'warning' || p.kind === 'error');
}
