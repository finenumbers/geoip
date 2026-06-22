import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isDatasetInitializing } from '@geoip/shared';
import { api } from '@/lib/api';
import { collectFailedSystemChecks } from '@/lib/system-status-labels';

export function useSystemReadyStatus() {
  const {
    data: dataset,
    isError: datasetError,
    error: datasetErr,
  } = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: (query) =>
      isDatasetInitializing(query.state.data?.datasetDate, query.state.data?.mvStatus)
        ? 10_000
        : 30_000,
  });

  const datasetDate = dataset?.datasetDate ?? null;
  const mvStatus = dataset?.mvStatus;

  const readyQuery = useQuery({
    queryKey: ['ready'],
    queryFn: api.ready,
    refetchInterval: (query) => {
      if (query.state.data?.status === 'ready') return false;
      if (isDatasetInitializing(datasetDate, mvStatus)) return 10_000;
      const checks = query.state.data?.checks;
      if (checks?.dataset && !checks.materializedViews) return 10_000;
      return false;
    },
  });

  const isInitializing = isDatasetInitializing(datasetDate, mvStatus);

  const failedChecks = useMemo(
    () => collectFailedSystemChecks(readyQuery.data?.checks, isInitializing),
    [readyQuery.data?.checks, isInitializing],
  );

  return {
    ready: readyQuery.data,
    status: readyQuery.data?.status,
    checks: readyQuery.data?.checks,
    isReadyLoading: readyQuery.isLoading,
    isReadyError: readyQuery.isError,
    readyError: readyQuery.error,
    dataset,
    datasetDate,
    mvStatus,
    datasetError,
    datasetErr,
    isInitializing,
    failedChecks,
  };
}
