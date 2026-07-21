import type {
  AdminConfigResponse,
  AdminConfigPatch,
  AdminSessionInfo,
  AdminReloadStatus,
  PublicRuntimeConfig,
} from '@geoip/shared';

const ADMIN_BASE = '/api/v1/admin';

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = init?.method?.toUpperCase() ?? 'GET';
  let body = init?.body;

  if (body != null && body !== '' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Fastify rejects Content-Type: application/json with an empty body.
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && (body == null || body === '')) {
    body = '{}';
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    method,
    body,
    credentials: 'include',
    headers,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message: string }).message)
        : res.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export const adminApi = {
  authStatus: () => adminRequest<{ setupComplete: boolean }>('/auth/status'),
  me: () => adminRequest<AdminSessionInfo>('/auth/me'),
  login: (username: string, password: string) =>
    adminRequest<AdminSessionInfo>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => adminRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  setup: (username: string, password: string, confirmPassword: string) =>
    adminRequest<{ ok: boolean; username: string }>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirmPassword }),
    }),
  getConfig: () => adminRequest<AdminConfigResponse>('/config'),
  saveConfig: (patch: AdminConfigPatch) =>
    adminRequest<AdminConfigResponse>('/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  reloadStatus: () => adminRequest<AdminReloadStatus>('/config/reload-status'),
  testGrchc: () =>
    adminRequest<{ ok: boolean; downloadCount: number; latestDate: string | null }>(
      '/config/test/grchc',
      { method: 'POST' },
    ),
  triggerImport: () =>
    adminRequest<{ ok: boolean; importRunId?: string }>('/imports/trigger', {
      method: 'POST',
    }),
  rirStatus: () =>
    adminRequest<{
      status: string;
      lastSuccessAt: string | null;
      lastSnapshotDate: string | null;
      rowCount: number;
      rowsByRegistry: Record<string, number>;
      rowsByStatus: Record<string, number>;
      lastError: string | null;
    }>('/rir/status'),
  triggerRirImport: () =>
    adminRequest<{ importRunId: string; status: string }>('/rir/imports/trigger', {
      method: 'POST',
    }),
};

export type { AdminConfigResponse, AdminConfigPatch };

export async function fetchPublicRuntime(): Promise<PublicRuntimeConfig> {
  const res = await fetch('/api/v1/public/runtime');
  if (!res.ok) return { googleMapsApiKey: '', displayTimezone: '' };
  return res.json() as Promise<PublicRuntimeConfig>;
}
