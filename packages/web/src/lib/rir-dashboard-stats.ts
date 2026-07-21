import type { RirDatasetStateResponse } from '@geoip/shared';

export const RIR_REGISTRY_IDS = [
  'ripencc',
  'arin',
  'apnic',
  'lacnic',
  'afrinic',
] as const;

export type RirRegistryId = (typeof RIR_REGISTRY_IDS)[number];

export type RirDashboardSlice = {
  rowCount: number;
  rowsByRegistry: Record<string, number>;
  loaded: boolean;
};

/** Five regional RIRs (excludes IANA). */
export function rirRegistriesSlice(state: RirDatasetStateResponse | undefined): RirDashboardSlice {
  const rowsByRegistry: Record<string, number> = {};
  let rowCount = 0;
  for (const id of RIR_REGISTRY_IDS) {
    const n = state?.rowsByRegistry[id] ?? 0;
    rowsByRegistry[id] = n;
    rowCount += n;
  }
  return {
    rowCount,
    rowsByRegistry,
    loaded: Boolean(state && state.status === 'ready' && rowCount > 0),
  };
}

/** IANA delegated layer only. */
export function ianaSlice(state: RirDatasetStateResponse | undefined): RirDashboardSlice {
  const n = state?.rowsByRegistry.iana ?? 0;
  return {
    rowCount: n,
    rowsByRegistry: { iana: n },
    loaded: Boolean(state && state.status === 'ready' && n > 0),
  };
}
