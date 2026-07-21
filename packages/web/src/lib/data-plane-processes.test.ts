import { describe, expect, it } from 'vitest';
import {
  collectDataPlaneProcesses,
  dataPlaneHasProgress,
} from './data-plane-processes.js';

describe('collectDataPlaneProcesses', () => {
  it('lists GRChC import, MV warmup and RIR import together', () => {
    const processes = collectDataPlaneProcesses({
      checks: {
        database: true,
        dataset: true,
        materializedViews: false,
        productionIndexes: true,
        asnMapping: false,
        importRunning: true,
      },
      mvStatus: 'refreshing',
      rir: { status: 'importing', lastError: null, rowCount: 0 },
    });
    expect(processes.map((p) => p.id)).toEqual(['grchc-import', 'grchc-mv', 'rir-import']);
    expect(dataPlaneHasProgress(processes)).toBe(true);
  });

  it('surfaces RIR failure when GRChC is idle', () => {
    const processes = collectDataPlaneProcesses({
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      mvStatus: 'ready',
      rir: { status: 'failed', lastError: 'boom', rowCount: 0 },
    });
    expect(processes).toHaveLength(1);
    expect(processes[0]?.id).toBe('rir-failed');
    expect(processes[0]?.text).toContain('boom');
  });

  it('warns about ASN mapping when core is ready without import', () => {
    const processes = collectDataPlaneProcesses({
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: false,
        importRunning: false,
      },
      mvStatus: 'ready',
      rir: { status: 'ready', lastError: null, rowCount: 10 },
    });
    expect(processes.map((p) => p.id)).toEqual(['grchc-asn']);
  });
});
