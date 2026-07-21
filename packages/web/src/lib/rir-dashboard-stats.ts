import type { RirDatasetStateResponse } from '@geoip/shared';
import { ui } from '@/lib/ui-strings';

/** All six NRO delegated sources in Dashboard display order. */
export const RIR_DASHBOARD_REGISTRY_IDS = [
  'ripencc',
  'arin',
  'apnic',
  'afrinic',
  'lacnic',
  'iana',
] as const;

export type RirDashboardRegistryId = (typeof RIR_DASHBOARD_REGISTRY_IDS)[number];

/** @deprecated Prefer RIR_DASHBOARD_REGISTRY_IDS (includes IANA). */
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

export type RirRegistryDetail = {
  id: RirDashboardRegistryId;
  label: string;
  rowCount: number;
  snapshotDate: string | null;
};

export function rirRegistryLabel(id: RirDashboardRegistryId): string {
  switch (id) {
    case 'ripencc':
      return ui.dashboard.rirRegistryRipencc;
    case 'arin':
      return ui.dashboard.rirRegistryArin;
    case 'apnic':
      return ui.dashboard.rirRegistryApnic;
    case 'afrinic':
      return ui.dashboard.rirRegistryAfrinic;
    case 'lacnic':
      return ui.dashboard.rirRegistryLacnic;
    case 'iana':
      return ui.dashboard.rirRegistryIana;
  }
}

export function rirRegistryDetails(
  state: RirDatasetStateResponse | undefined,
): RirRegistryDetail[] {
  return RIR_DASHBOARD_REGISTRY_IDS.map((id) => ({
    id,
    label: rirRegistryLabel(id),
    rowCount: state?.rowsByRegistry[id] ?? 0,
    snapshotDate: state?.snapshotsByRegistry?.[id] ?? null,
  }));
}

/** Five regional RIRs (excludes IANA). Kept for Admin/tests that still split planes. */
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

export function rirDatasetLoaded(state: RirDatasetStateResponse | undefined): boolean {
  return Boolean(state && state.status === 'ready' && state.rowCount > 0);
}
