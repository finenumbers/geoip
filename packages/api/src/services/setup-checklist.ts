import {
  isAdminAccountConfigured,
  isGoogleMapsConfigured,
  isGrchcConfigured,
  hasPendingSetupSteps,
  type SetupChecklistResponse,
} from '@geoip/shared';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { getDatasetState } from '../repositories/dataset-repository.js';

export async function buildSetupChecklist(): Promise<SetupChecklistResponse> {
  const config = loadRuntimeConfig();
  const { secrets } = config;

  let datasetImported = false;
  try {
    const state = await getDatasetState();
    datasetImported = state.datasetDate !== null;
  } catch {
    datasetImported = false;
  }

  const adminDone = isAdminAccountConfigured(secrets);
  const grchcDone = isGrchcConfigured(secrets);
  const mapsDone = isGoogleMapsConfigured(secrets);

  const steps: SetupChecklistResponse['steps'] = [
    {
      id: 'adminAccount',
      label: 'Создать учётную запись администратора',
      done: adminDone,
      href: '/admin/setup',
    },
    {
      id: 'grchcCredentials',
      label: 'Указать учётные данные ЛК ГРЧЦ',
      done: grchcDone,
      href: '/admin?section=grchc',
    },
    {
      id: 'datasetImported',
      label: 'Импортировать датасет GeoIP',
      done: datasetImported,
    },
    {
      id: 'googleMapsKey',
      label: 'Настроить Google Maps (опционально)',
      done: mapsDone,
      optional: true,
      href: '/admin?section=integrations',
    },
  ];

  return {
    steps,
    blockingReady: !hasPendingSetupSteps(steps),
  };
}
