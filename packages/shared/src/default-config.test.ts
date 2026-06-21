import { describe, expect, it } from 'vitest';
import {
  applyEnvironmentProfile,
  createFreshSecrets,
  DEFAULT_RUNTIME_SETTINGS,
  isGrchcConfigured,
} from './default-config.js';

describe('default-config', () => {
  it('createFreshSecrets leaves personal fields empty and generates import key only', () => {
    const secrets = createFreshSecrets();
    expect(secrets.geoipLk.email).toBe('');
    expect(secrets.geoipLk.password).toBe('');
    expect(secrets.integrations.googleMapsApiKey).toBe('');
    expect(secrets.admin.username).toBe('');
    expect(secrets.api.importApiKey.length).toBeGreaterThanOrEqual(64);
    expect(secrets.api.apiKey).toBe('');
    expect(secrets.admin.sessionSecret.length).toBeGreaterThanOrEqual(64);
  });

  it('applyEnvironmentProfile enables auth in production', () => {
    const prod = applyEnvironmentProfile(DEFAULT_RUNTIME_SETTINGS, 'production');
    expect(prod.api.authEnabled).toBe(true);
    const dev = applyEnvironmentProfile(DEFAULT_RUNTIME_SETTINGS, 'development');
    expect(dev.api.authEnabled).toBe(false);
  });

  it('isGrchcConfigured requires email and password', () => {
    expect(isGrchcConfigured(createFreshSecrets())).toBe(false);
    expect(
      isGrchcConfigured({
        ...createFreshSecrets(),
        geoipLk: { email: 'a@b.c', password: 'secret' },
      }),
    ).toBe(true);
  });
});
