import { z } from 'zod';

export const DEFAULT_GEOIP_LK_BASE_URL = 'https://geoip.noc.gov.ru';

export const runtimeSettingsSchema = z.object({
  geoipLk: z
    .object({
      baseUrl: z.string().url().default(DEFAULT_GEOIP_LK_BASE_URL),
    })
    .default({}),
  import: z
    .object({
      cron: z.string().min(1).default('0 10 * * *'),
      cronTimezone: z.string().default('Europe/Moscow'),
      pollIntervalMs: z.number().int().positive().default(5000),
      staleMinutes: z.number().int().min(5).max(120).default(20),
      downloadDir: z.string().default('/tmp/geoip-import'),
      zipCacheEnabled: z.boolean().default(true),
      skipUnchangedDataset: z.boolean().default(false),
      stagingSnapshotEnabled: z.boolean().default(true),
      historyLimit: z.number().int().min(1).max(100).default(10),
    })
    .default({}),
  export: z
    .object({
      dir: z.string().default('/tmp/geoip-exports'),
      pollIntervalMs: z.number().int().positive().default(5000),
      retentionDays: z.number().int().min(1).default(7),
      retentionLimit: z.number().int().min(1).default(100),
      maxRows: z.number().int().positive().default(5_000_000),
    })
    .default({}),
  api: z
    .object({
      authEnabled: z.boolean().default(false),
      corsOrigin: z.string().default('http://localhost:5173'),
      port: z.number().int().positive().default(3000),
      rateLimitMax: z.number().int().positive().default(100),
      rateLimitWindowMs: z.number().int().positive().default(60_000),
    })
    .default({}),
  table: z
    .object({
      maxPageSize: z.number().int().min(1).max(500).default(200),
      maxOffsetPage: z.number().int().min(1).default(500),
    })
    .default({}),
  database: z
    .object({
      poolMax: z.number().int().positive().default(20),
      statementTimeoutMs: z.number().int().positive().default(30_000),
    })
    .default({}),
  asnMap: z
    .object({
      batchSize: z.number().int().positive().default(50_000),
      workers: z.number().int().positive().default(6),
    })
    .default({}),
  logging: z
    .object({
      level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
      accessLogEnabled: z.boolean().default(true),
    })
    .default({}),
  backup: z
    .object({
      intervalSeconds: z.number().int().positive().default(86_400),
      retentionDays: z.number().int().min(0).default(14),
    })
    .default({}),
});

export const runtimeSecretsSchema = z.object({
  geoipLk: z
    .object({
      email: z.string().default(''),
      password: z.string().default(''),
    })
    .default({}),
  api: z
    .object({
      importApiKey: z.string().default(''),
      apiKey: z.string().default(''),
    })
    .default({}),
  admin: z
    .object({
      username: z.string().default(''),
      passwordHash: z.string().default(''),
      sessionSecret: z.string().default(''),
    })
    .default({}),
  integrations: z
    .object({
      googleMapsApiKey: z.string().default(''),
    })
    .default({}),
});

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeSecrets = z.infer<typeof runtimeSecretsSchema>;

export const adminConfigPatchSchema = z.object({
  settings: runtimeSettingsSchema.deepPartial().optional(),
  secrets: z
    .object({
      geoipLk: z
        .object({
          email: z.string().optional(),
          password: z.string().optional(),
        })
        .optional(),
      api: z
        .object({
          importApiKey: z.string().min(8).optional(),
          apiKey: z.string().min(8).optional(),
        })
        .optional(),
      admin: z
        .object({
          username: z.string().min(1).optional(),
          password: z.string().min(8).optional(),
          currentPassword: z.string().optional(),
        })
        .optional(),
      integrations: z
        .object({
          googleMapsApiKey: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type AdminConfigPatch = z.infer<typeof adminConfigPatchSchema>;

export const adminSetupSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

export const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type MaskedSecretField = {
  hasValue: boolean;
  masked: string;
};

export type AdminConfigResponse = {
  settings: RuntimeSettings;
  secrets: {
    geoipLk: { email: string; password: MaskedSecretField };
    api: { importApiKey: MaskedSecretField; apiKey: MaskedSecretField };
    admin: { username: string; password: MaskedSecretField };
    integrations: { googleMapsApiKey: MaskedSecretField };
  };
  meta: {
    version: number;
    updatedAt: string | null;
    setupComplete: boolean;
    migratedFromEnv: boolean;
  };
  reloadHints: {
    requiresApiRestart: string[];
    requiresImportWorkerRestart: string[];
    requiresExportWorkerRestart: string[];
    requiresWebReload: string[];
    requiresBackupRestart: string[];
  };
};

export type PublicRuntimeConfig = {
  googleMapsApiKey: string;
};

export type AdminSessionInfo = {
  username: string;
  expiresAt: string;
};

export type AdminReloadStatus = {
  configUpdatedAt: string | null;
  pendingReload: AdminConfigResponse['reloadHints'];
};
