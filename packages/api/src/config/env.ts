import { z } from 'zod';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),
  GEOIP_LK_EMAIL: z.string().optional().default(''),
  GEOIP_LK_PASSWORD: z.string().optional().default(''),
  IMPORT_API_KEY: z.string().min(8),
  IMPORT_CRON_CRON: z.string().default('0 3 * * *'),
  IMPORT_DOWNLOAD_DIR: z.string().default('/tmp/geoip-import'),
  IMPORT_ZIP_CACHE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  IMPORT_SKIP_UNCHANGED_DATASET: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  IMPORT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  EXPORT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
