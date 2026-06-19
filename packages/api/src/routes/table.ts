import type { FastifyInstance } from 'fastify';
import type { FilterClause } from '@geoip/shared';
import { queryTable, getFilterMetadata } from '../services/table-service.js';
import { getFacetValues } from '../services/facet-service.js';
import { recordTableQueryLatency } from '../routes/metrics.js';

function parseTableQuery(query: Record<string, unknown>) {
  const page = query.page;
  const pageSize = query.pageSize;
  const sortRaw = query.sort;
  const filtersRaw = query.filters;

  let sort = [];
  let filters = [];

  if (typeof sortRaw === 'string') {
    try {
      sort = JSON.parse(sortRaw) as unknown[];
    } catch {
      sort = [];
    }
  } else if (Array.isArray(sortRaw)) {
    sort = sortRaw;
  }

  if (typeof filtersRaw === 'string') {
    try {
      filters = JSON.parse(filtersRaw) as unknown[];
    } catch {
      filters = [];
    }
  } else if (Array.isArray(filtersRaw)) {
    filters = filtersRaw;
  }

  return { page, pageSize, sort, filters, afterId: query.afterId, afterNetwork: query.afterNetwork, afterSortValue: query.afterSortValue };
}

export async function registerTableRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/table/city', async (request, reply) => {
    const q = parseTableQuery(request.query as Record<string, unknown>);
    const result = await queryTable('city', q);
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    if (result.meta?.queryMs) recordTableQueryLatency(result.meta.queryMs);
    return result;
  });

  app.get('/api/v1/table/country', async (request, reply) => {
    const q = parseTableQuery(request.query as Record<string, unknown>);
    const result = await queryTable('country', q);
    if ('error' in result) {
      return reply.status(422).send({ error: 'Validation error', details: result.error });
    }
    if (result.meta?.queryMs) recordTableQueryLatency(result.meta.queryMs);
    return result;
  });

  app.get('/api/v1/table/metadata/filters', async (request) => {
    const tableType = (request.query as { tableType?: string }).tableType ?? 'city';
    const type = tableType === 'country' ? 'country' : 'city';
    return getFilterMetadata(type);
  });

  app.get('/api/v1/table/metadata/facet', async (request, reply) => {
    const q = request.query as {
      tableType?: string;
      field?: string;
      search?: string;
      limit?: string;
      contextFilters?: string;
    };
    const tableType = q.tableType === 'country' ? 'country' : 'city';
    const field = q.field ?? 'city_name';
    const search = q.search ?? '';
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);

    let contextFilters: FilterClause[] = [];
    if (q.contextFilters) {
      try {
        contextFilters = JSON.parse(q.contextFilters) as FilterClause[];
      } catch {
        return reply.status(422).send({ error: 'Invalid contextFilters JSON' });
      }
    }

    return getFacetValues(tableType, field, search, limit, contextFilters);
  });
}
