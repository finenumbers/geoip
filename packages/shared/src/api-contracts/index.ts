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
  total: z.number(),
});

export const datasetStateSchema = z.object({
  datasetDate: z.string().nullable(),
  activatedAt: z.string().datetime().nullable(),
  activeImportRunId: z.string().uuid().nullable(),
  mvStatus: z.enum(['ready', 'refreshing', 'unavailable']),
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

export const cityTableRowSchema = z.object({
  id: z.number(),
  network: z.string(),
  ipFamily: z.number(),
  prefixLen: z.number(),
  geonameId: z.number().nullable(),
  continentName: z.string().nullable(),
  countryIsoCode: z.string().nullable(),
  countryName: z.string().nullable(),
  subdivision1Name: z.string().nullable(),
  subdivision2Name: z.string().nullable(),
  cityName: z.string().nullable(),
  timezone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyRadius: z.number().nullable(),
  postalCode: z.string().nullable(),
  asn: z.number().nullable(),
  asnOrg: z.string().nullable(),
});

export const countryTableRowSchema = z.object({
  id: z.number(),
  network: z.string(),
  ipFamily: z.number(),
  prefixLen: z.number(),
  geonameId: z.number().nullable(),
  continentName: z.string().nullable(),
  countryIsoCode: z.string().nullable(),
  countryName: z.string().nullable(),
  subdivision1Name: z.string().nullable(),
  subdivision2Name: z.string().nullable(),
  asn: z.number().nullable(),
  asnOrg: z.string().nullable(),
});

export const tableResponseSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  pagination: paginationSchema,
  meta: z.object({
    datasetDate: z.string().nullable(),
    mvRefreshedAt: z.string().datetime().nullable(),
    queryMs: z.number(),
    countSource: z.enum(['cached', 'exact', 'estimated']).optional(),
    sortHint: z.enum(['slow_full_scan']).nullable().optional(),
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

export const filterMetadataSchema = z.object({
  fields: z.record(
    z.object({
      type: z.enum(['string', 'number', 'boolean']),
      distinctValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  ),
});

export const exportJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  tableType: z.enum(['city', 'country']),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  downloadPath: z.string().nullable(),
  errorMessage: z.string().nullable(),
  rowCount: z.number().nullable(),
});

export const exportRequestSchema = z.object({
  tableType: z.enum(['city', 'country']),
  filters: z.array(filterClauseSchema).default([]),
  sort: z.array(sortClauseSchema).default([]),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});

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

export type ImportRun = z.infer<typeof importRunSchema>;
export type DatasetState = z.infer<typeof datasetStateSchema>;
export type LookupRequest = z.infer<typeof lookupRequestSchema>;
export type LookupResponse = z.infer<typeof lookupResponseSchema>;
export type FilterClause = z.infer<typeof filterClauseSchema>;
export type SortClause = z.infer<typeof sortClauseSchema>;
export type TableQuery = z.infer<typeof tableQuerySchema>;
export type CityTableRow = z.infer<typeof cityTableRowSchema>;
export type CountryTableRow = z.infer<typeof countryTableRowSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
