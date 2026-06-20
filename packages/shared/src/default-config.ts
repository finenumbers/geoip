import {
  runtimeSettingsSchema,
  runtimeSecretsSchema,
  type RuntimeSettings,
  type RuntimeSecrets,
} from './admin-config.js';

export function generateRandomKey(byteLength = 32): string {
  const arr = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(arr);
  } else {
    throw new Error('crypto.getRandomValues is not available');
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = runtimeSettingsSchema.parse({});

export function applyEnvironmentProfile(
  settings: RuntimeSettings,
  nodeEnv: 'development' | 'production' | 'test',
): RuntimeSettings {
  if (nodeEnv === 'production') {
    return runtimeSettingsSchema.parse({
      ...settings,
      api: {
        ...settings.api,
        authEnabled: true,
      },
      logging: {
        ...settings.logging,
        accessLogEnabled: true,
      },
    });
  }

  if (nodeEnv === 'development') {
    return runtimeSettingsSchema.parse({
      ...settings,
      api: {
        ...settings.api,
        authEnabled: false,
        corsOrigin: 'http://localhost:5173',
      },
    });
  }

  return settings;
}

/** Fresh install: system keys generated; personal GRChC / Google Maps left empty. */
export function createFreshSecrets(): RuntimeSecrets {
  const apiKey = generateRandomKey(32);
  return runtimeSecretsSchema.parse({
    geoipLk: { email: '', password: '' },
    api: { importApiKey: apiKey, apiKey },
    admin: { username: '', passwordHash: '', sessionSecret: generateRandomKey(32) },
    integrations: { googleMapsApiKey: '' },
  });
}

export function isGrchcConfigured(secrets: RuntimeSecrets): boolean {
  return Boolean(secrets.geoipLk.email.trim() && secrets.geoipLk.password);
}

export function isAdminAccountConfigured(secrets: RuntimeSecrets): boolean {
  return Boolean(secrets.admin.username && secrets.admin.passwordHash);
}

export function isGoogleMapsConfigured(secrets: RuntimeSecrets): boolean {
  return Boolean(secrets.integrations.googleMapsApiKey.trim());
}
