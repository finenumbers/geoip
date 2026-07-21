import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterClause, SortClause } from '@geoip/shared';
import { EXPORT_ROW_LIMIT_CODE } from '@geoip/shared';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui-strings';

export type ExportUiState = 'idle' | 'submitting' | 'polling' | 'downloading' | 'error';

export const EXPORT_POLL_INTERVAL_MS = 2000;
export const EXPORT_MAX_POLL_MS = 30 * 60 * 1000;

export type TableExportClient = {
  createTableExport: typeof api.createTableExport;
  getExportStatus: typeof api.getExportStatus;
  downloadExport: (id: string, tableType: 'city' | 'country' | 'rir') => void;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function formatExportError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) {
      return ui.browse.exportNotReady;
    }
    if (err.code === EXPORT_ROW_LIMIT_CODE && err.estimatedRows != null && err.maxRows != null) {
      return ui.browse.exportRowLimitExceeded(err.estimatedRows, err.maxRows);
    }
    if (err.status === 422) {
      return err.message || ui.browse.exportRowLimit;
    }
    return err.message || ui.browse.exportFailed;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return ui.browse.exportFailed;
}

export function isExportOverRowLimit(totalRows: number, exportMaxRows: number): boolean {
  return totalRows > 0 && totalRows > exportMaxRows;
}

export function formatExportRowLimitBlocked(totalRows: number, exportMaxRows: number): string {
  return ui.browse.exportRowLimitBlocked(totalRows, exportMaxRows);
}

export async function runTableExport(
  tableType: 'city' | 'country' | 'rir',
  filters: FilterClause[],
  sort: SortClause[],
  client: TableExportClient,
  options?: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    maxPollMs?: number;
    onProgress?: (progress: { estimatedRows: number | null; status: ExportUiState }) => void;
  },
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? EXPORT_POLL_INTERVAL_MS;
  const maxPollMs = options?.maxPollMs ?? EXPORT_MAX_POLL_MS;
  const signal = options?.signal;

  options?.onProgress?.({ estimatedRows: null, status: 'submitting' });

  const created = await client.createTableExport({ tableType, filters, sort }, signal);
  options?.onProgress?.({ estimatedRows: created.estimatedRows, status: 'polling' });

  const deadline = Date.now() + maxPollMs;
  let status = await client.getExportStatus(created.id, signal);

  while (status.status === 'queued' || status.status === 'running') {
    if (Date.now() > deadline) {
      throw new Error(ui.browse.exportTimedOut);
    }
    await sleep(pollIntervalMs, signal);
    status = await client.getExportStatus(created.id, signal);
  }

  if (status.status === 'failed') {
    throw new Error(status.errorMessage ?? ui.browse.exportFailed);
  }

  options?.onProgress?.({ estimatedRows: status.rowCount ?? created.estimatedRows, status: 'downloading' });
  client.downloadExport(created.id, tableType);
}

export function useTableExport() {
  const [state, setState] = useState<ExportUiState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [estimatedRows, setEstimatedRows] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setErrorMessage(null);
    setEstimatedRows(null);
  }, []);

  const startExport = useCallback(
    async (tableType: 'city' | 'country' | 'rir', filters: FilterClause[], sort: SortClause[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState('submitting');
      setErrorMessage(null);
      setEstimatedRows(null);

      try {
        await runTableExport(tableType, filters, sort, api, {
          signal: controller.signal,
          onProgress: ({ estimatedRows: rows, status }) => {
            if (controller.signal.aborted) return;
            setEstimatedRows(rows);
            setState(status);
          },
        });

        if (abortRef.current === controller) {
          abortRef.current = null;
          setState('idle');
          setEstimatedRows(null);
          setErrorMessage(null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        abortRef.current = null;
        setState('error');
        setErrorMessage(formatExportError(err));
      }
    },
    [],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const isBusy = state === 'submitting' || state === 'polling' || state === 'downloading';

  return { state, errorMessage, estimatedRows, startExport, reset, isBusy };
}
