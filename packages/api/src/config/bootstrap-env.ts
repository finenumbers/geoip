import { z } from 'zod';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const defaultConfigDir = resolve(__dirname, '../../../../data/config');

/** Build a postgres URL with proper encoding for special characters in credentials. */
export function buildPostgresUrl(
  user: string,
  password: string,
  host: string,
  port: number,
  database: string,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

const rawBootstrapSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_DIRECT_URL: z.string().min(1).optional(),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().optional(),
  DATABASE_HOST: z.string().default('pgbouncer'),
  DATABASE_PORT: z.coerce.number().default(6432),
  DATABASE_DIRECT_HOST: z.string().default('postgres'),
  DATABASE_DIRECT_PORT: z.coerce.number().default(5432),
  CONFIG_DATA_DIR: z.string().default(defaultConfigDir),
  CONFIG_MASTER_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type BootstrapEnv = {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL?: string;
  CONFIG_DATA_DIR: string;
  CONFIG_MASTER_KEY?: string;
  NODE_ENV: 'development' | 'production' | 'test';
};

function resolveDatabaseUrls(input: z.infer<typeof rawBootstrapSchema>): {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL?: string;
} {
  const hasComponents =
    input.POSTGRES_USER != null &&
    input.POSTGRES_PASSWORD != null &&
    input.POSTGRES_DB != null;

  if (hasComponents) {
    return {
      DATABASE_URL: buildPostgresUrl(
        input.POSTGRES_USER!,
        input.POSTGRES_PASSWORD!,
        input.DATABASE_HOST,
        input.DATABASE_PORT,
        input.POSTGRES_DB!,
      ),
      DATABASE_DIRECT_URL: buildPostgresUrl(
        input.POSTGRES_USER!,
        input.POSTGRES_PASSWORD!,
        input.DATABASE_DIRECT_HOST,
        input.DATABASE_DIRECT_PORT,
        input.POSTGRES_DB!,
      ),
    };
  }

  if (input.DATABASE_URL) {
    return {
      DATABASE_URL: input.DATABASE_URL,
      DATABASE_DIRECT_URL: input.DATABASE_DIRECT_URL,
    };
  }

  throw new Error(
    'Database connection not configured: set POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB or DATABASE_URL',
  );
}

let cachedBootstrap: BootstrapEnv | null = null;

export function loadBootstrapEnv(): BootstrapEnv {
  if (cachedBootstrap) return cachedBootstrap;
  const parsed = rawBootstrapSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid bootstrap environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  let urls: { DATABASE_URL: string; DATABASE_DIRECT_URL?: string };
  try {
    urls = resolveDatabaseUrls(parsed.data);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  cachedBootstrap = {
    DATABASE_URL: urls.DATABASE_URL,
    DATABASE_DIRECT_URL: urls.DATABASE_DIRECT_URL,
    CONFIG_DATA_DIR: parsed.data.CONFIG_DATA_DIR,
    CONFIG_MASTER_KEY: parsed.data.CONFIG_MASTER_KEY,
    NODE_ENV: parsed.data.NODE_ENV,
  };
  return cachedBootstrap;
}

export function resetBootstrapEnvCache(): void {
  cachedBootstrap = null;
}
