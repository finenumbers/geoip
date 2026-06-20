import { loadRuntimeConfig, toEnvCompat, type EnvCompat } from './runtime-config.js';

export type Env = EnvCompat;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  cachedEnv = toEnvCompat(loadRuntimeConfig());
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
