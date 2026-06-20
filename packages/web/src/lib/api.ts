import type {
  DatasetState,
  FacetValuesResponse,
  FilterClause,
  ImportRun,
  ImportRunListResponse,
  LookupResponse,
  MetricsResponse,
  ReadyResponse,
  SetupChecklistResponse,
  TableResponse,
} from '@geoip/shared';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function formatErrorBody(body: unknown, fallback: string): { message: string; details?: unknown } {
  if (body == null || typeof body !== 'object') {
    return { message: fallback };
  }
  const record = body as { message?: string; error?: string; details?: unknown };
  const message = record.message ?? record.error ?? fallback;
  return { message, details: record.details };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const { message, details } = formatErrorBody(body, res.statusText);
    throw new ApiError(res.status, message, details);
  }

  return res.json() as Promise<T>;
}

export const api = {
  ready: () => request<ReadyResponse>('/ready'),
  setupChecklist: () => request<SetupChecklistResponse>('/public/setup-checklist'),
  dataset: () => request<DatasetState>('/dataset/active'),
  imports: (limit = 10) => request<ImportRunListResponse>(`/imports?limit=${limit}`),
  importById: (id: string) => request<ImportRun>(`/imports/${id}`),
  lookup: (
    ip: string,
    options?: { include?: Array<'city' | 'country' | 'asn'>; signal?: AbortSignal },
  ) =>
    request<LookupResponse>('/lookup', {
      method: 'POST',
      body: JSON.stringify({ ip, include: options?.include }),
      signal: options?.signal,
    }),
  table: (tableType: 'city' | 'country', params: URLSearchParams, signal?: AbortSignal) =>
    request<TableResponse>(`/table/${tableType}?${params.toString()}`, { signal }),
  facetValues: (
    tableType: 'city' | 'country',
    field: string,
    search = '',
    limit = 50,
    contextFilters: FilterClause[] = [],
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      tableType,
      field,
      search,
      limit: String(limit),
    });
    if (contextFilters.length > 0) {
      params.set('contextFilters', JSON.stringify(contextFilters));
    }
    return request<FacetValuesResponse>(`/table/metadata/facet?${params.toString()}`, { signal });
  },
  metrics: () => request<MetricsResponse>('/metrics'),
};
