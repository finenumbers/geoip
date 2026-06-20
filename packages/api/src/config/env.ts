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
  API_KEY: z.string().min(8).optional(),
  API_AUTH_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Daily import schedule (minute hour * * *), interpreted in IMPORT_CRON_TZ. Default: 20:00 Moscow. */
  IMPORT_CRON_CRON: z
    .string()
    .default('0 20 * * *')
    .transform((value) => value.trim() || '0 20 * * *'),
  IMPORT_CRON_TZ: z.string().default('Europe/Moscow'),
  IMPORT_DOWNLOAD_DIR: z.string().default('/tmp/geoip-import'),
  EXPORT_DIR: z.string().default('/tmp/geoip-exports'),
  IMPORT_ZIP_CACHE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  IMPORT_SKIP_UNCHANGED_DATASET: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  IMPORT_STAGING_SNAPSHOT_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  IMPORT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  IMPORT_STALE_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  EXPORT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  EXPORT_RETENTION_LIMIT: z.coerce.number().int().min(1).default(100),
  EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(5_000_000),
  TABLE_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(200),
  TABLE_MAX_OFFSET_PAGE: z.coerce.number().int().min(1).default(500),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  ASN_MAP_BATCH_SIZE: z.coerce.number().int().positive().default(50_000),
  ASN_MAP_WORKERS: z.coerce.number().int().positive().default(6),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ACCESS_LOG_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).transform((data) => ({
  ...data,
  API_KEY: data.API_KEY ?? data.IMPORT_API_KEY,
}));

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
