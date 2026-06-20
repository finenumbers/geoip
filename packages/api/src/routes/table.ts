import type { FastifyInstance } from 'fastify';
import type { FilterClause } from '@geoip/shared';
import { validateTableQueryProfile, profileValidationToFieldErrors, isAllowedFacetField, normalizeFiltersForQuery } from '@geoip/shared';
import { queryTable, getFilterMetadata, seekTablePage } from '../services/table-service.js';
import { getFacetValues } from '../services/facet-service.js';
import { recordTableQueryMetric } from '../routes/metrics.js';
import {
  defaultFacetField,
  parseJsonArrayParam,
  parseTableQueryInput,
} from './table-query-parse.js';

function recordTableQueryStats(
  result: Awaited<ReturnType<typeof queryTable>>,
  filters: unknown[],
): void {
  if ('error' in result || !result.meta?.queryMs) return;
  recordTableQueryMetric({
    queryMs: result.meta.queryMs,
    mode: result.meta.paginationMode === 'keyset' ? 'keyset' : 'offset',
    hasFilters: Array.isArray(filters) && filters.length > 0,
  });
}

const dataPlanePreHandlers = (app: FastifyInstance) =>
  [app.verifyApiKeyIfEnabled, app.ensureMaterializedViewsReady] as const;

export async function registerTableRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [...dataPlanePreHandlers(app)] };

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

  app.get('/api/v1/table/metadata/filters', guards, async (request) => {
    const tableType = (request.query as { tableType?: string }).tableType ?? 'city';
    const type = tableType === 'country' ? 'country' : 'city';
    return getFilterMetadata(type);
  });

  app.get('/api/v1/table/metadata/facet', guards, async (request, reply) => {
    const q = request.query as {
      tableType?: string;
      field?: string;
      search?: string;
      limit?: string;
      contextFilters?: string;
    };
    const tableType = q.tableType === 'country' ? 'country' : 'city';
    const field = q.field ?? defaultFacetField(tableType);
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

    return getFacetValues(tableType, field, search, limit, contextFilters);
  });

  app.post<{ Params: { tableType: string } }>(
    '/api/v1/table/:tableType/seek',
    guards,
    async (request, reply) => {
      const tableType = request.params.tableType === 'country' ? 'country' : 'city';
      const result = await seekTablePage(tableType, request.body as Record<string, unknown>);
      if ('error' in result) {
        return reply.status(422).send({ error: 'Validation error', details: result.error });
      }
      return result;
    },
  );
}
