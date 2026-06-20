import { z } from 'zod';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const defaultConfigDir = resolve(__dirname, '../../../../data/config');

const bootstrapSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),
  CONFIG_DATA_DIR: z.string().default(defaultConfigDir),
  CONFIG_MASTER_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type BootstrapEnv = z.infer<typeof bootstrapSchema>;

let cachedBootstrap: BootstrapEnv | null = null;

export function loadBootstrapEnv(): BootstrapEnv {
  if (cachedBootstrap) return cachedBootstrap;
  const parsed = bootstrapSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid bootstrap environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cachedBootstrap = parsed.data;
  return cachedBootstrap;
}

export function resetBootstrapEnvCache(): void {
  cachedBootstrap = null;
}
