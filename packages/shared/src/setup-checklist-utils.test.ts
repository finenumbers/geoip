import { describe, expect, it } from 'vitest';
import type { SetupChecklistResponse } from './api-contracts/index.js';
import { hasPendingSetupSteps, isSetupComplete, isDatasetInitializing } from './setup-checklist-utils.js';

const baseSteps: SetupChecklistResponse['steps'] = [
  { id: 'adminAccount', label: 'Admin', done: false },
  { id: 'externalLookupApiKey', label: 'API key', done: false },
  { id: 'grchcCredentials', label: 'GRChC', done: false },
  { id: 'datasetImported', label: 'Import', done: false },
  { id: 'googleMapsKey', label: 'Maps', done: false, optional: true },
];

describe('setup-checklist-utils', () => {
  it('has pending steps when a required step is incomplete', () => {
    expect(hasPendingSetupSteps(baseSteps)).toBe(true);
  });

  it('has no pending steps when required steps are done and optional is skipped', () => {
    const steps = baseSteps.map((step) =>
      step.optional ? step : { ...step, done: true },
    );
    expect(hasPendingSetupSteps(steps)).toBe(false);
    expect(isSetupComplete({ steps, blockingReady: true })).toBe(true);
  });

  it('still has no pending steps when optional maps step is incomplete', () => {
    const steps: SetupChecklistResponse['steps'] = [
      { id: 'adminAccount', label: 'Admin', done: true },
      { id: 'externalLookupApiKey', label: 'API key', done: true },
      { id: 'grchcCredentials', label: 'GRChC', done: true },
      { id: 'datasetImported', label: 'Import', done: true },
      { id: 'googleMapsKey', label: 'Maps', done: false, optional: true },
    ];
    expect(isSetupComplete({ steps, blockingReady: true })).toBe(true);
  });
});

describe('isDatasetInitializing', () => {
  it('is true when dataset exists and MV is refreshing', () => {
    expect(isDatasetInitializing('2026-06-20', 'refreshing')).toBe(true);
  });

  it('is false when MV is ready or dataset is missing', () => {
    expect(isDatasetInitializing('2026-06-20', 'ready')).toBe(false);
    expect(isDatasetInitializing(null, 'refreshing')).toBe(false);
  });
});
