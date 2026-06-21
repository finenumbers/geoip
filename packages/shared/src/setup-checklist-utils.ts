import type { SetupChecklistResponse } from './api-contracts/index.js';

/** True while any required (non-optional) onboarding step is incomplete. */
export function hasPendingSetupSteps(steps: SetupChecklistResponse['steps']): boolean {
  return steps.some((step) => !step.done && !step.optional);
}

/** True when required onboarding is complete — yellow setup banner can be hidden. */
export function isSetupComplete(checklist: SetupChecklistResponse): boolean {
  return !hasPendingSetupSteps(checklist.steps);
}

/** Dataset exists but materialized views are still warming up after import or restart. */
export function isDatasetInitializing(
  datasetDate: string | null | undefined,
  mvStatus: 'ready' | 'refreshing' | 'unavailable' | null | undefined,
): boolean {
  return datasetDate != null && datasetDate !== '' && mvStatus === 'refreshing';
}
