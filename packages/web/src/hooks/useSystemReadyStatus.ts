import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isDatasetInitializing } from '@geoip/shared';
import { api } from '@/lib/api';
import {
  collectDataPlaneProcesses,
  dataPlaneHasProgress,
} from '@/lib/data-plane-processes';
import { collectFailedSystemChecks, isMaterializedViewsWarmup } from '@/lib/system-status-labels';

export function useSystemReadyStatus() {
  const datasetQuery = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: (query) =>
      isDatasetInitializing(query.state.data?.datasetDate, query.state.data?.mvStatus)
        ? 10_000
        : 30_000,
  });
  const {
    data: dataset,
    isError: datasetError,
    error: datasetErr,
    isLoading: isDatasetLoading,
    isFetching: isDatasetFetching,
  } = datasetQuery;

  const datasetDate = dataset?.datasetDate ?? null;
  const mvStatus = dataset?.mvStatus;

  const rirQuery = useQuery({
    queryKey: ['rir-status'],
    queryFn: api.rirStatus,
    refetchInterval: (query) => (query.state.data?.status === 'importing' ? 10_000 : 30_000),
    retry: false,
  });

  const readyQuery = useQuery({
    queryKey: ['ready'],
    queryFn: api.ready,
    refetchInterval: (query) => {
      if (query.state.data?.status === 'ready' && rirQuery.data?.status !== 'importing') {
        const mvRefreshing = isDatasetInitializing(datasetDate, mvStatus);
        if (!mvRefreshing) return false;
      }
      if (isDatasetInitializing(datasetDate, mvStatus)) return 10_000;
      if (rirQuery.data?.status === 'importing') return 10_000;
      const checks = query.state.data?.checks;
      if (checks?.dataset && !checks.materializedViews) return 10_000;
      if (checks?.importRunning) return 10_000;
      return false;
    },
  });

  const checks = readyQuery.data?.checks;
  const datasetPending = (isDatasetLoading || isDatasetFetching) && !dataset;
  const isMvWarmup = isMaterializedViewsWarmup(checks, mvStatus, datasetPending);

  const processes = useMemo(
    () =>
      collectDataPlaneProcesses({
        checks,
        mvStatus,
        datasetPending,
        isMvWarmup,
        rir: rirQuery.data ?? null,
      }),
    [checks, mvStatus, datasetPending, isMvWarmup, rirQuery.data],
  );

  const isInitializing = dataPlaneHasProgress(processes);

  const failedChecks = useMemo(
    () => collectFailedSystemChecks(checks, isMvWarmup),
    [checks, isMvWarmup],
  );

  return {
    ready: readyQuery.data,
    status: readyQuery.data?.status,
    checks,
    isReadyLoading: readyQuery.isLoading,
    isReadyError: readyQuery.isError,
    readyError: readyQuery.error,
    isDatasetLoading: datasetPending,
    dataset,
    datasetDate,
    mvStatus,
    datasetError,
    datasetErr,
    rirStatus: rirQuery.data,
    processes,
    isInitializing,
    failedChecks,
  };
}
