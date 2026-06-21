import type {
  DatasetState,
  ExportCreateResponse,
  ExportRequest,
  ExportStatusResponse,
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
import { EXPORT_ROW_LIMIT_CODE } from '@geoip/shared';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
    public estimatedRows?: number,
    public maxRows?: number,
  ) {
    super(message);
  }
}

function formatErrorBody(body: unknown, fallback: string): {
  message: string;
  details?: unknown;
  code?: string;
  estimatedRows?: number;
  maxRows?: number;
} {
  if (body == null || typeof body !== 'object') {
    return { message: fallback };
  }
  const record = body as {
    message?: string;
    error?: string;
    details?: unknown;
    code?: string;
    estimatedRows?: number;
    maxRows?: number;
  };
  const message = record.message ?? record.error ?? fallback;
  return {
    message,
    details: record.details,
    code: record.code,
    estimatedRows: record.estimatedRows,
    maxRows: record.maxRows,
  };
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
    const { message, details, code, estimatedRows, maxRows } = formatErrorBody(body, res.statusText);
    throw new ApiError(res.status, message, details, code, estimatedRows, maxRows);
  }

  return res.json() as Promise<T>;
}

export const api = {
  ready: async (): Promise<ReadyResponse> => {
    const res = await fetch(`${API_BASE}/ready`);
    const body = (await res.json().catch(() => ({}))) as ReadyResponse;
    if (!res.ok && res.status !== 503) {
      const { message, details, code, estimatedRows, maxRows } = formatErrorBody(body, res.statusText);
      throw new ApiError(res.status, message, details, code, estimatedRows, maxRows);
    }
    return body;
  },
  setupChecklist: () => request<SetupChecklistResponse>('/public/setup-checklist'),
  clientIp: () => request<{ ip: string | null }>('/public/client-ip'),
  externalIp: () => request<{ ip: string | null }>('/public/external-ip'),
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
  createTableExport: (body: ExportRequest, signal?: AbortSignal) =>
    request<ExportCreateResponse>('/exports/table', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  getExportStatus: (id: string, signal?: AbortSignal) =>
    request<ExportStatusResponse>(`/exports/${id}`, { signal }),
  downloadExport: (id: string, tableType: 'city' | 'country'): void => {
    const anchor = document.createElement('a');
    anchor.href = `${API_BASE}/exports/${id}/download`;
    anchor.download = `geoip-${tableType}-export-${id}.zip`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  },
};
