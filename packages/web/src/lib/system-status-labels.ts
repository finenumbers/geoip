import { ui } from '@/lib/ui-strings';

export type SystemCheckId =
  | 'database'
  | 'dataset'
  | 'materializedViews'
  | 'productionIndexes'
  | 'asnMapping';

export type SystemCheckState = 'ok' | 'pending' | 'fail';

const CHECK_LABELS: Record<SystemCheckId, string> = {
  database: ui.dashboard.checkDbLabel,
  dataset: ui.dashboard.checkDatasetLabel,
  materializedViews: ui.dashboard.checkMvLabel,
  productionIndexes: ui.dashboard.checkIndexesLabel,
  asnMapping: ui.dashboard.checkAsnLabel,
};

const CHECK_STATUS_TEXT: Record<SystemCheckId, Record<SystemCheckState, string>> = {
  database: {
    ok: ui.dashboard.checkDbOk,
    pending: ui.dashboard.checkDbFail,
    fail: ui.dashboard.checkDbFail,
  },
  dataset: {
    ok: ui.dashboard.checkDatasetOk,
    pending: ui.dashboard.checkDatasetFail,
    fail: ui.dashboard.checkDatasetFail,
  },
  materializedViews: {
    ok: ui.dashboard.checkMvOk,
    pending: ui.dashboard.checkMvPending,
    fail: ui.dashboard.checkMvFail,
  },
  productionIndexes: {
    ok: ui.dashboard.checkIndexesOk,
    pending: ui.dashboard.checkIndexesFail,
    fail: ui.dashboard.checkIndexesFail,
  },
  asnMapping: {
    ok: ui.dashboard.checkAsnOk,
    pending: ui.dashboard.checkAsnFail,
    fail: ui.dashboard.checkAsnFail,
  },
};

export function resolveSystemCheckState(
  checkId: SystemCheckId,
  ok: boolean,
  pending = false,
): SystemCheckState {
  if (ok) return 'ok';
  if (pending && checkId === 'materializedViews') return 'pending';
  return 'fail';
}

export function formatSystemCheckLabel(checkId: SystemCheckId): string {
  return CHECK_LABELS[checkId];
}

export function formatSystemCheckStatus(
  checkId: SystemCheckId,
  ok: boolean,
  pending = false,
): { text: string; state: SystemCheckState } {
  const state = resolveSystemCheckState(checkId, ok, pending);
  return { text: CHECK_STATUS_TEXT[checkId][state], state };
}

export function systemCheckStatusClass(state: SystemCheckState): string {
  if (state === 'ok') return 'text-green-700';
  if (state === 'pending') return 'text-amber-600';
  return 'text-red-600';
}

export function formatMaterializedViewsStatus(input: {
  checks?: Record<string, boolean> | null;
  initializing?: boolean;
  mvStatus?: string | null;
}): { text: string; state: SystemCheckState } {
  const { checks, initializing = false, mvStatus } = input;

  if (checks) {
    const pending = initializing && Boolean(checks.dataset) && !checks.materializedViews;
    return formatSystemCheckStatus('materializedViews', Boolean(checks.materializedViews), pending);
  }

  const ok = mvStatus === 'ready';
  const pending =
    mvStatus === 'refreshing' || (initializing && mvStatus != null && mvStatus !== 'ready');
  return formatSystemCheckStatus('materializedViews', ok, pending && !ok);
}
