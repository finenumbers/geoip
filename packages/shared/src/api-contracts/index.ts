import { z } from 'zod';
import { FILTER_OPERATORS } from '../constants.js';

export const importStatusSchema = z.enum([
  'queued',
  'running',
  'validating',
  'swapping',
  'refreshing_mv',
  'succeeded',
  'failed',
]);

export const importTriggerSchema = z.enum(['manual', 'cron', 'api']);

export const importRunStepSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  durationMs: z.number().nullable(),
  rows: z.number().nullable(),
  message: z.string().nullable().optional(),
});

export const importRunSchema = z.object({
  id: z.string().uuid(),
  datasetDate: z.string().nullable(),
  status: importStatusSchema,
  triggeredBy: importTriggerSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  counts: z.object({
    cityBlocks: z.number(),
    countryBlocks: z.number(),
    asnBlocks: z.number(),
    rejected: z.number(),
  }),
  steps: z.array(importRunStepSchema).optional(),
});

export const importRunListSchema = z.object({
  items: z.array(importRunSchema),
});

export const datasetVolumesSchema = z.object({
  cityBlocks: z.number(),
  countryBlocks: z.number(),
  asnBlocks: z.number(),
  cityLocations: z.number(),
  countryLocations: z.number(),
  ruCityBlocks: z.number(),
  ipv4Addresses: z.string(),
  ipv6Addresses: z.string(),
});

export const datasetStateSchema = z.object({
  datasetDate: z.string().nullable(),
  activatedAt: z.string().datetime().nullable(),
  activeImportRunId: z.string().uuid().nullable(),
  mvStatus: z.enum(['ready', 'refreshing', 'unavailable']),
  datasetFingerprint: z.string().nullable(),
  volumes: datasetVolumesSchema,
  databaseSizeBytes: z.number().nullable(),
  nextImportAt: z.string().datetime().nullable(),
  displayTimezone: z.string(),
  serverNow: z.string().datetime(),
  exportMaxRows: z.number().int().positive(),
});

export const lookupSectionSchema = z.enum(['city', 'country', 'asn']);

export const lookupRequestSchema = z.object({
  ip: z.string().min(1),
  include: z.array(lookupSectionSchema).optional(),
});

export const geoBlockResultSchema = z.object({
  network: z.string(),
  geonameId: z.number().nullable(),
  continentName: z.string().nullable(),
  countryIsoCode: z.string().nullable(),
  countryName: z.string().nullable(),
  subdivision1Name: z.string().nullable(),
  subdivision2Name: z.string().nullable(),
  cityName: z.string().nullable(),
  timezone: z.string().nullable(),
  postalCode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyRadius: z.number().nullable(),
});

export const countryBlockResultSchema = z.object({
  network: z.string(),
  geonameId: z.number().nullable(),
  continentName: z.string().nullable(),
  countryIsoCode: z.string().nullable(),
  countryName: z.string().nullable(),
  subdivision1Name: z.string().nullable(),
  subdivision2Name: z.string().nullable(),
});

export const asnResultSchema = z.object({
  network: z.string(),
  asn: z.number(),
  organization: z.string().nullable(),
});

export const lookupResponseSchema = z.object({
  ip: z.string(),
  city: geoBlockResultSchema.nullable(),
  country: countryBlockResultSchema.nullable(),
  asn: asnResultSchema.nullable(),
  meta: z.object({
    datasetDate: z.string().nullable(),
    queriedAt: z.string().datetime(),
  }),
});

export const filterClauseSchema = z.object({
  field: z.string(),
  op: z.enum(FILTER_OPERATORS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]).optional(),
});

export const sortClauseSchema = z.object({
  field: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.array(sortClauseSchema).default([]),
  filters: z.array(filterClauseSchema).default([]),
  afterId: z.coerce.number().int().positive().optional(),
  afterNetwork: z.string().optional(),
  afterSortValue: z.string().optional(),
});

export const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalRows: z.number(),
  totalPages: z.number(),
});

export const tableBrowseRowSchema = z.object({
  id: z.number(),
  // GeoIP city/country
  network: z.string().optional(),
  prefixLen: z.number().nullable().optional(),
  countryIsoCode: z.string().nullable().optional(),
  countryName: z.string().nullable().optional(),
  cityName: z.string().nullable().optional(),
  subdivision1Name: z.string().nullable().optional(),
  asn: z.number().nullable().optional(),
  asnOrg: z.string().nullable().optional(),
  // RIR delegated
  registry: z.string().optional(),
  resourceType: z.string().optional(),
  rangeText: z.string().optional(),
  cc: z.string().nullable().optional(),
  status: z.string().optional(),
  allocatedAt: z.string().nullable().optional(),
  opaqueId: z.string().nullable().optional(),
  ipFamily: z.number().nullable().optional(),
  hostCount: z.string().nullable().optional(),
  startAsn: z.number().nullable().optional(),
  asnCount: z.number().nullable().optional(),
  sourceFile: z.string().optional(),
  snapshotDate: z.string().optional(),
});

export const tableResponseSchema = z.object({
  rows: z.array(tableBrowseRowSchema),
  pagination: paginationSchema,
  meta: z.object({
    datasetDate: z.string().nullable(),
    mvRefreshedAt: z.string().datetime().nullable(),
    queryMs: z.number(),
    countSource: z.enum(['cached', 'exact', 'estimated']).optional(),
    sortHint: z.enum(['slow_full_scan']).nullable().optional(),
    sortOverrideHint: z.enum(['ru_partial_network']).nullable().optional(),
    paginationWarning: z.enum(['offset_only']).nullable().optional(),
    browseView: z.string().optional(),
    paginationMode: z.enum(['keyset', 'offset']).optional(),
    nextCursor: z
      .object({
        afterId: z.number(),
        afterNetwork: z.string().optional(),
        afterSortValue: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),
});

export const exportRequestSchema = z.object({
  tableType: z.enum(['city', 'country', 'rir']),
  filters: z.array(filterClauseSchema).default([]),
  sort: z.array(sortClauseSchema).default([]),
});

export const exportCreateResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  tableType: z.enum(['city', 'country', 'rir']),
  createdAt: z.string().datetime(),
  estimatedRows: z.number().nullable(),
});

export const exportStatusResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  tableType: z.enum(['city', 'country', 'rir']),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  rowCount: z.number().nullable(),
});

export const rirDatasetStateResponseSchema = z.object({
  status: z.enum(['ready', 'importing', 'failed', 'unavailable']),
  lastSuccessAt: z.string().datetime().nullable(),
  lastSnapshotDate: z.string().nullable(),
  rowCount: z.number(),
  rowsByRegistry: z.record(z.number()),
  rowsByStatus: z.record(z.number()),
  snapshotsByRegistry: z.record(z.string()).default({}),
  lastError: z.string().nullable(),
});

export type RirDatasetStateResponse = z.infer<typeof rirDatasetStateResponseSchema>;

export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  checks: z.object({
    database: z.boolean(),
    dataset: z.boolean(),
    materializedViews: z.boolean(),
    productionIndexes: z.boolean(),
    asnMapping: z.boolean(),
    importRunning: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});

export const metricsResponseSchema = z.object({
  activeDatasetDate: z.string().nullable(),
  mvStatus: z.enum(['ready', 'refreshing', 'unavailable']),
  import: z.object({
    latestBenchmark: z
      .object({
        importRunId: z.string().uuid(),
        datasetDate: z.string().nullable(),
        wallMs: z.number(),
        steps: z.array(importRunStepSchema),
      })
      .nullable(),
  }),
  latency: z.object({
    lookupP95Ms: z.number(),
    tableQueryP95Ms: z.number(),
    sampleCount: z.object({
      lookup: z.number(),
      tableQuery: z.number(),
    }),
    tableQueryByMode: z
      .array(
        z.object({
          mode: z.enum(['keyset', 'offset']),
          filters: z.enum(['none', 'active']),
          p95Ms: z.number(),
          sampleCount: z.number(),
          requestCount: z.number(),
        }),
      )
      .optional(),
  }),
  pgStatStatements: z
    .array(
      z.object({
        query: z.string(),
        calls: z.number(),
        totalExecTimeMs: z.number(),
        meanExecTimeMs: z.number(),
      }),
    )
    .nullable()
    .optional(),
  timestamp: z.string().datetime(),
});

export type ImportRun = z.infer<typeof importRunSchema>;
export type DatasetState = z.infer<typeof datasetStateSchema>;
export type LookupResponse = z.infer<typeof lookupResponseSchema>;
export type FilterClause = z.infer<typeof filterClauseSchema>;
export type SortClause = z.infer<typeof sortClauseSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportCreateResponse = z.infer<typeof exportCreateResponseSchema>;
export type ExportStatusResponse = z.infer<typeof exportStatusResponseSchema>;
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
export type ImportRunListResponse = z.infer<typeof importRunListSchema>;
export type TableResponse = z.infer<typeof tableResponseSchema>;
export type TableBrowseRow = z.infer<typeof tableBrowseRowSchema>;

export const facetValuesResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      count: z.number(),
    }),
  ),
  meta: z
    .object({
      timedOut: z.boolean().optional(),
      sampledRows: z.number().int().nonnegative().optional(),
      source: z.enum(['cache', 'index', 'sample']).optional(),
    })
    .optional(),
});

export type FacetValuesResponse = z.infer<typeof facetValuesResponseSchema>;

export const setupChecklistStepSchema = z.object({
  id: z.enum(['adminAccount', 'externalLookupApiKey', 'grchcCredentials', 'datasetImported', 'googleMapsKey']),
  label: z.string(),
  done: z.boolean(),
  optional: z.boolean().optional(),
  href: z.string().optional(),
});

export const setupChecklistResponseSchema = z.object({
  steps: z.array(setupChecklistStepSchema),
  blockingReady: z.boolean(),
});

export type SetupChecklistResponse = z.infer<typeof setupChecklistResponseSchema>;
