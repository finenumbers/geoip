import type { FastifyInstance } from 'fastify';
import type { FilterClause, TableType } from '@geoip/shared';
import { validateTableQueryProfile, profileValidationToFieldErrors, isAllowedFacetField, normalizeFiltersForQuery } from '@geoip/shared';
import { queryTable } from '../services/table-service.js';
import { getFacetValues } from '../services/facet-service.js';
import { queryRirTable, getRirFacetValues } from '../services/rir-table-service.js';
import { queryAsnTable, getAsnFacetValues } from '../services/asn-table-service.js';
import {
  getCcMismatchFacetValues,
  getCcMismatchState,
  queryCcMismatchTable,
} from '../services/cc-mismatch-table-service.js';
import { recordTableQueryMetric } from '../routes/metrics.js';
import {
  defaultFacetField,
  parseJsonArrayParam,
  parseTableQueryInput,
} from './table-query-parse.js';

function recordTableQueryStats(
  result: { meta?: { queryMs?: number; paginationMode?: string } },
  filters: unknown[],
): void {
  if (!result.meta?.queryMs) return;
  recordTableQueryMetric({
    queryMs: result.meta.queryMs,
    mode: result.meta.paginationMode === 'keyset' ? 'keyset' : 'offset',
    hasFilters: Array.isArray(filters) && filters.length > 0,
  });
}

const dataPlanePreHandlers = (app: FastifyInstance) =>
  [app.verifyApiKeyIfEnabled, app.ensureMaterializedViewsReady] as const;

const rirPreHandlers = (app: FastifyInstance) =>
  [app.verifyApiKeyIfEnabled, app.ensureRirDatasetReady] as const;

function parseTableType(raw: string | undefined): TableType {
  if (raw === 'country' || raw === 'rir' || raw === 'asn') return raw;
  return 'city';
}

export async function registerTableRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [...dataPlanePreHandlers(app)] };
  const rirGuards = { preHandler: [...rirPreHandlers(app)] };

  app.get('/api/v1/table/city', guards, async (request, reply) => {
    const parsed = parseTableQueryInput(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.status(422).send({
        error: 'Validation error',
        details: { formErrors: [], fieldErrors: { [parsed.path]: [parsed.error] } },
      });
    }
    const result = await queryTable('city', parsed);
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    recordTableQueryStats(result, parsed.filters);
    return result;
  });

  app.get('/api/v1/table/country', guards, async (request, reply) => {
    const parsed = parseTableQueryInput(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.status(422).send({
        error: 'Validation error',
        details: { formErrors: [], fieldErrors: { [parsed.path]: [parsed.error] } },
      });
    }
    const result = await queryTable('country', parsed);
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    recordTableQueryStats(result, parsed.filters);
    return result;
  });

  app.get('/api/v1/table/rir', rirGuards, async (request, reply) => {
    const parsed = parseTableQueryInput(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.status(422).send({
        error: 'Validation error',
        details: { formErrors: [], fieldErrors: { [parsed.path]: [parsed.error] } },
      });
    }
    const result = await queryRirTable(parsed);
    if ('notReady' in result) {
      return reply.status(503).send({
        error: 'RirNotReady',
        message: 'RIR delegated snapshot is not ready yet. Retry shortly.',
      });
    }
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    recordTableQueryStats(result, parsed.filters);
    return result;
  });

  app.get('/api/v1/table/asn', guards, async (request, reply) => {
    const parsed = parseTableQueryInput(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.status(422).send({
        error: 'Validation error',
        details: { formErrors: [], fieldErrors: { [parsed.path]: [parsed.error] } },
      });
    }
    const result = await queryAsnTable(parsed);
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    recordTableQueryStats(result, parsed.filters);
    return result;
  });

  app.get(
    '/api/v1/table/cc-mismatch',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async (request, reply) => {
      const parsed = parseTableQueryInput(request.query as Record<string, unknown>);
      if (!parsed.ok) {
        return reply.status(422).send({
          error: 'Validation error',
          details: { formErrors: [], fieldErrors: { [parsed.path]: [parsed.error] } },
        });
      }
      const result = await queryCcMismatchTable(parsed);
      if ('error' in result) {
        return reply.status(422).send({ error: 'Validation error', details: result.error });
      }
      recordTableQueryStats(result, parsed.filters);
      return result;
    },
  );

  app.get(
    '/api/v1/table/cc-mismatch/state',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async () => getCcMismatchState(),
  );

  app.get(
    '/api/v1/table/cc-mismatch/facet',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async (request, reply) => {
      const q = request.query as {
        field?: string;
        search?: string;
        limit?: string;
        contextFilters?: string;
      };
      const field = q.field ?? 'grchc_cc';
      const search = q.search ?? '';
      const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);
      let contextFilters: FilterClause[] = [];
      if (q.contextFilters) {
        const contextParsed = parseJsonArrayParam(q.contextFilters, 'contextFilters');
        if (!contextParsed.ok) {
          return reply.status(422).send({
            error: 'Validation error',
            details: {
              formErrors: [],
              fieldErrors: { [contextParsed.path]: [contextParsed.error] },
            },
          });
        }
        contextFilters = contextParsed.value as FilterClause[];
      }
      const result = await getCcMismatchFacetValues(field, search, limit, contextFilters);
      if ('error' in result) {
        return reply.status(422).send({ error: 'Validation error', details: result.error });
      }
      return result;
    },
  );

  app.get('/api/v1/table/metadata/facet', async (request, reply) => {
    const q = request.query as {
      tableType?: string;
      field?: string;
      search?: string;
      limit?: string;
      contextFilters?: string;
    };
    const tableType = parseTableType(q.tableType);
    const field = q.field ?? defaultFacetField(tableType);
    const search = q.search ?? '';
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);

    if (tableType === 'rir') {
      await app.verifyApiKeyIfEnabled(request, reply);
      if (reply.sent) return;
      await app.ensureRirDatasetReady(request, reply);
      if (reply.sent) return;
    } else {
      await app.verifyApiKeyIfEnabled(request, reply);
      if (reply.sent) return;
      await app.ensureMaterializedViewsReady(request, reply);
      if (reply.sent) return;
    }

    let contextFilters: FilterClause[] = [];
    if (q.contextFilters) {
      const contextParsed = parseJsonArrayParam(q.contextFilters, 'contextFilters');
      if (!contextParsed.ok) {
        return reply.status(422).send({
          error: 'Validation error',
          details: {
            formErrors: [],
            fieldErrors: { [contextParsed.path]: [contextParsed.error] },
          },
        });
      }
      contextFilters = contextParsed.value as FilterClause[];
    }
    contextFilters = normalizeFiltersForQuery(contextFilters);

    const profileCheck = validateTableQueryProfile(tableType, [], contextFilters);
    if (!profileCheck.ok) {
      return reply
        .status(422)
        .send({ error: 'Validation error', details: profileValidationToFieldErrors(profileCheck.issues) });
    }

    if (!isAllowedFacetField(tableType, field)) {
      return reply.status(422).send({
        error: 'Validation error',
        details: profileValidationToFieldErrors([
          {
            path: 'field',
            message: `Unknown facet field "${field}" for ${tableType} table`,
          },
        ]),
      });
    }

    if (tableType === 'rir') {
      const result = await getRirFacetValues(field, search, limit, contextFilters);
      if ('notReady' in result) {
        return reply.status(503).send({
          error: 'RirNotReady',
          message: 'RIR delegated snapshot is not ready yet. Retry shortly.',
        });
      }
      if ('error' in result) {
        return reply.status(422).send({ error: 'Validation error', details: result.error });
      }
      return result;
    }

    if (tableType === 'asn') {
      const result = await getAsnFacetValues(field, search, limit, contextFilters);
      if ('error' in result) {
        return reply.status(422).send({ error: 'Validation error', details: result.error });
      }
      return result;
    }

    return getFacetValues(tableType, field, search, limit, contextFilters);
  });
}
