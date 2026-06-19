const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
    throw new ApiError(res.status, (body as { message?: string }).message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  ready: () => request<{ status: string; checks: Record<string, boolean> }>('/ready'),
  dataset: () =>
    request<{
      datasetDate: string | null;
      activatedAt: string | null;
      mvStatus: string;
    }>('/dataset/active'),
  imports: (limit = 50) => request<{ items: unknown[]; total: number }>(`/imports?limit=${limit}`),
  importDetail: (id: string) => request<unknown>(`/imports/${id}`),
  triggerImport: (apiKey: string) =>
    request<{ importRunId: string }>('/imports', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: JSON.stringify({ triggeredBy: 'manual' }),
    }),
  lookup: (
    ip: string,
    options?: { include?: Array<'city' | 'country' | 'asn'>; signal?: AbortSignal },
  ) =>
    request<unknown>('/lookup', {
      method: 'POST',
      body: JSON.stringify({ ip, include: options?.include }),
      signal: options?.signal,
    }),
  tableCity: (params: URLSearchParams) =>
    request<unknown>(`/table/city?${params.toString()}`),
  tableCountry: (params: URLSearchParams) =>
    request<unknown>(`/table/country?${params.toString()}`),
  filterMetadata: (tableType: string) =>
    request<unknown>(`/table/metadata/filters?tableType=${tableType}`),
  facetValues: (
    tableType: string,
    field: string,
    search = '',
    limit = 50,
    contextFilters: Array<{ field: string; op: string; value?: unknown }> = [],
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
    return request<{ items: Array<{ value: string; count: number }> }>(
      `/table/metadata/facet?${params.toString()}`,
      { signal },
    );
  },
  metrics: () => request<unknown>('/metrics'),
  createExport: (apiKey: string, body: unknown) =>
    request<{ id: string }>('/exports/table', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    }),
  exportStatus: (id: string) => request<unknown>(`/exports/${id}`),
};
