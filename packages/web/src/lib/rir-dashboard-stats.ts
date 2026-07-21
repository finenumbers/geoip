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

export function rirDatasetLoaded(state: RirDatasetStateResponse | undefined): boolean {
  return Boolean(state && state.status === 'ready' && state.rowCount > 0);
}
