import { ui } from '@/lib/ui-strings';
import { isDatasetInitializing } from '@geoip/shared';

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

const CORE_CHECK_IDS: SystemCheckId[] = [
  'database',
  'dataset',
  'materializedViews',
  'productionIndexes',
  'asnMapping',
];

export function collectFailedSystemChecks(
  checks: Record<string, boolean> | undefined,
  initializing = false,
): SystemCheckId[] {
  if (!checks) return [];
  return CORE_CHECK_IDS.filter((checkId) => {
    const pending =
      checkId === 'materializedViews' &&
      initializing &&
      Boolean(checks.dataset) &&
      !checks.materializedViews;
    return resolveSystemCheckState(checkId, Boolean(checks[checkId]), pending) === 'fail';
  });
}

export function formatSystemStatusLabel(
  status: string | undefined,
  datasetDate: string | null | undefined,
  mvStatus: string | null | undefined,
): string {
  if (isDatasetInitializing(datasetDate, mvStatus as 'ready' | 'refreshing' | 'unavailable' | undefined)) {
    return ui.dashboard.statusInitializing;
  }
  if (status === 'ready') return ui.dashboard.statusReady;
  if (status === 'degraded') return ui.dashboard.statusDegraded;
  return ui.dashboard.statusNotReady;
}

export function systemStatusColorClass(
  status: string | undefined,
  datasetDate: string | null | undefined,
  mvStatus: string | null | undefined,
): string {
  if (isDatasetInitializing(datasetDate, mvStatus as 'ready' | 'refreshing' | 'unavailable' | undefined)) {
    return 'text-amber-600';
  }
  if (status === 'ready') return 'text-green-600';
  if (status === 'degraded') return 'text-amber-600';
  return 'text-red-600';
}

/** True while MV is warming up — from dataset mvStatus or /ready arriving before /dataset. */
export function isMaterializedViewsWarmup(
  checks: Record<string, boolean> | undefined,
  mvStatus: 'ready' | 'refreshing' | 'unavailable' | null | undefined,
  isDatasetLoading: boolean,
): boolean {
  if (!checks?.database || !checks?.dataset || checks.materializedViews) return false;
  if (mvStatus === 'unavailable') return false;
  if (mvStatus === 'refreshing') return true;
  // /ready can report dataset+!mv before /dataset/active returns mvStatus
  if (isDatasetLoading || mvStatus == null) return true;
  return false;
}

/** Hide global status banner when onboarding checklist already covers the same state. */
export function shouldHideSystemBannerForSetupPage(
  pathname: string,
  setupPending: boolean,
  isReadyError: boolean,
  checks: Record<string, boolean> | undefined,
): boolean {
  if (!setupPending) return false;
  const hasSetupChecklistUi = pathname === '/' || pathname.startsWith('/admin');
  if (!hasSetupChecklistUi) return false;
  if (isReadyError) return false;
  if (checks?.database === false) return false;
  return true;
}
