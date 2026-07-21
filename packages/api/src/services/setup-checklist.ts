import {
  isAdminAccountConfigured,
  isExternalLookupApiKeyConfigured,
  isGoogleMapsConfigured,
  isGrchcConfigured,
  hasPendingSetupSteps,
  type SetupChecklistResponse,
} from '@geoip/shared';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { isRirDatasetReady } from '../repositories/rir-repository.js';

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

  let rirDatasetImported = false;
  try {
    rirDatasetImported = await isRirDatasetReady();
  } catch {
    rirDatasetImported = false;
  }

  const adminDone = isAdminAccountConfigured(secrets);
  const externalApiKeyDone = isExternalLookupApiKeyConfigured(secrets);
  const grchcDone = isGrchcConfigured(secrets);
  const mapsDone = isGoogleMapsConfigured(secrets);
  const autoImportsDone =
    config.settings.import.enabled === true &&
    config.settings.rirImport.enabled === true &&
    Boolean(config.settings.import.cron?.trim()) &&
    Boolean(config.settings.rirImport.cron?.trim());

  const steps: SetupChecklistResponse['steps'] = [
    {
      id: 'adminAccount',
      label: 'Создать учётную запись администратора',
      done: adminDone,
      href: '/admin/setup',
    },
    {
      id: 'externalLookupApiKey',
      label: 'Сгенерировать API-ключ External IP Lookup',
      done: externalApiKeyDone,
      href: '/admin/setup-api-key',
    },
    {
      id: 'grchcCredentials',
      label: 'Указать учётные данные ЛК ГРЧЦ',
      done: grchcDone,
      href: '/admin?section=grchc',
    },
    {
      id: 'datasetImported',
      label: 'Импортировать датасет ГРЧЦ',
      done: datasetImported,
      href: '/admin?section=overview',
    },
    {
      id: 'rirDatasetImported',
      label: 'Импортировать датасет RIR+IANA',
      done: rirDatasetImported,
      href: '/admin?section=overview',
    },
    {
      id: 'autoImportsConfigured',
      label: 'Включить автоимпорты ГРЧЦ и RIR+IANA и задать расписание',
      done: autoImportsDone,
      href: '/admin?section=general',
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
