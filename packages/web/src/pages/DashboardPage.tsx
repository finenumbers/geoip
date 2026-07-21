import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ImportRun, RirDatasetStateResponse, RirImportRun } from '@geoip/shared';
import { api } from '@/lib/api';
import { ui, importStatusLabel, importTriggerLabel } from '@/lib/ui-strings';
import { QueryErrorNotice } from '@/components/QueryErrorNotice';
import { SetupChecklistBanner } from '@/components/SetupChecklistBanner';
import { DEFAULT_DISPLAY_TIMEZONE } from '@geoip/shared';
import {
  formatSystemCheckLabel,
  formatSystemCheckStatus,
  formatSystemStatusLabel,
  systemCheckStatusClass,
  systemStatusColorClass,
  type SystemCheckId,
} from '@/lib/system-status-labels';
import { useSystemReadyStatus } from '@/hooks/useSystemReadyStatus';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format-datetime';
import { rirDatasetLoaded, rirRegistryDetails } from '@/lib/rir-dashboard-stats';

type ImportPlane = 'grchc' | 'rir';

type MergedImportRow = {
  plane: ImportPlane;
  id: string;
  datasetDate: string | null;
  status: string;
  triggeredBy: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type ImportDetailRun = {
  id: string;
  status: string;
  errorMessage: string | null;
  steps?: Array<{
    name: string;
    status: string;
    durationMs: number | null;
    rows: number | null;
    message?: string | null;
  }>;
};

function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms).toLocaleString('ru')} ms`;
  return `${(ms / 1000).toLocaleString('ru', { maximumFractionDigits: 1 })} s`;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—';
  return formatMs(new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('ru');
}

function formatBigCount(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const normalized = String(value).split('.')[0] ?? '0';
  if (normalized === '0') return '0';
  return BigInt(normalized).toLocaleString('ru');
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toLocaleString('ru', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${units[unitIndex]}`;
}

export function DashboardPage() {
  const [selectedImport, setSelectedImport] = useState<{
    plane: ImportPlane;
    id: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const {
    ready,
    status: systemStatus,
    dataset,
    datasetDate: hookDatasetDate,
    mvStatus: hookMvStatus,
    datasetError,
    datasetErr,
    isInitializing,
  } = useSystemReadyStatus();

  const {
    data: metrics,
    isError: metricsError,
    error: metricsErr,
  } = useQuery({
    queryKey: ['metrics'],
    queryFn: api.metrics,
    refetchInterval: 30_000,
  });
  const {
    data: imports,
    isError: importsError,
    error: importsErr,
  } = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.imports(10),
    refetchInterval: 15_000,
  });
  const {
    data: rirImports,
    isError: rirImportsError,
    error: rirImportsErr,
  } = useQuery({
    queryKey: ['rir-imports'],
    queryFn: () => api.rirImports(10),
    refetchInterval: 15_000,
  });
  const {
    data: rirStatus,
    isError: rirStatusError,
    error: rirStatusErr,
  } = useQuery({
    queryKey: ['rir-status'],
    queryFn: api.rirStatus,
    refetchInterval: 30_000,
  });
  const { data: ccMismatchState } = useQuery({
    queryKey: ['cc-mismatch-state'],
    queryFn: api.ccMismatchState,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5_000 : 60_000),
  });
  useEffect(() => {
    if (imports?.items.some((item) => item.status === 'succeeded')) {
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
    }
  }, [imports?.items, queryClient]);

  const registryDetails = useMemo(() => rirRegistryDetails(rirStatus), [rirStatus]);
  const rirLoaded = rirDatasetLoaded(rirStatus);

  const mergedImports = useMemo((): MergedImportRow[] => {
    const grchc: MergedImportRow[] = (imports?.items ?? []).map((run: ImportRun) => ({
      plane: 'grchc' as const,
      id: run.id,
      datasetDate: run.datasetDate,
      status: run.status,
      triggeredBy: run.triggeredBy,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }));
    const rir: MergedImportRow[] = (rirImports?.items ?? []).map((run: RirImportRun) => ({
      plane: 'rir' as const,
      id: run.id,
      datasetDate: run.datasetDate,
      status: run.status,
      triggeredBy: run.triggeredBy,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }));
    return [...grchc, ...rir].sort((a, b) => {
      const at = a.startedAt ?? '';
      const bt = b.startedAt ?? '';
      return bt.localeCompare(at);
    });
  }, [imports?.items, rirImports?.items]);

  const {
    data: importDetail,
    isError: importDetailError,
    error: importDetailErr,
    isFetching: importDetailLoading,
  } = useQuery({
    queryKey: ['import-detail', selectedImport?.plane, selectedImport?.id],
    queryFn: async (): Promise<ImportDetailRun> => {
      if (!selectedImport) throw new Error('No import selected');
      if (selectedImport.plane === 'rir') {
        return api.rirImportById(selectedImport.id);
      }
      return api.importById(selectedImport.id);
    },
    enabled: selectedImport != null,
  });

  const benchmark = metrics?.import.latestBenchmark;
  const benchmarkDate = benchmark?.datasetDate ?? dataset?.datasetDate ?? '—';
  const datasetDate = hookDatasetDate ?? metrics?.activeDatasetDate ?? null;
  const hasDataset = Boolean(datasetDate);
  const hasDatabaseVolume = Boolean(dataset?.databaseSizeBytes && dataset.databaseSizeBytes > 0);
  const mvStatus = metrics?.mvStatus ?? hookMvStatus;
  const volumes = dataset?.volumes;
  const displayTimezone =
    dataset?.displayTimezone ?? rirStatus?.displayTimezone ?? DEFAULT_DISPLAY_TIMEZONE;
  const rirDisplayTimezone = rirStatus?.displayTimezone ?? displayTimezone;
  const hasRirVolume = Boolean(rirStatus?.tableSizeBytes && rirStatus.tableSizeBytes > 0);

  const toggleImportDetail = (plane: ImportPlane, runId: string) => {
    setSelectedImport((current) =>
      current?.plane === plane && current.id === runId ? null : { plane, id: runId },
    );
  };

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto">
      <SetupChecklistBanner />
      {(datasetError ||
        metricsError ||
        importsError ||
        rirImportsError ||
        importDetailError ||
        rirStatusError) && (
        <QueryErrorNotice
          error={
            datasetErr ??
            metricsErr ??
            importsErr ??
            rirImportsErr ??
            importDetailErr ??
            rirStatusErr
          }
        />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        <Card title={ui.dashboard.systemStatus} summaryTitle>
          <SummaryHeadline className={systemStatusColorClass(systemStatus, datasetDate, mvStatus)}>
            {formatSystemStatusLabel(systemStatus, datasetDate, mvStatus)}
          </SummaryHeadline>
          {ready?.checks && (
            <StatusSummaryDetails checks={ready.checks} initializing={isInitializing} />
          )}
        </Card>

        <Card title={ui.dashboard.activeDataset} summaryTitle>
          <SummaryHeadline className={hasDataset ? 'text-green-600' : 'text-red-600'}>
            {datasetDate ?? '—'}
          </SummaryHeadline>
          <SummaryDetails>
            <DetailItem
              label={ui.dashboard.activated}
              value={formatDateTime(dataset?.activatedAt, displayTimezone)}
            />
            <DetailItem
              label={ui.dashboard.fingerprint}
              value={dataset?.datasetFingerprint ?? '—'}
              title={dataset?.datasetFingerprint ?? undefined}
            />
            <DetailItem
              label={ui.dashboard.activeImport}
              value={dataset?.activeImportRunId ? dataset.activeImportRunId.slice(0, 8) : '—'}
            />
            <DetailItem
              label={ui.dashboard.nextImport}
              value={formatDateTime(dataset?.nextImportAt, displayTimezone)}
            />
            <DetailItem
              label={ui.dashboard.serverTime}
              value={formatDateTime(dataset?.serverNow, displayTimezone)}
            />
          </SummaryDetails>
        </Card>

        <Card title={ui.dashboard.dataVolume} summaryTitle>
          <SummaryHeadline className={hasDatabaseVolume ? 'text-green-600' : 'text-red-600'}>
            {formatBytes(dataset?.databaseSizeBytes)}
          </SummaryHeadline>
          <SummaryDetails>
            <DetailItem label={ui.dashboard.cityBlocks} value={formatCount(volumes?.cityBlocks)} />
            <DetailItem label={ui.dashboard.cityLocations} value={formatCount(volumes?.cityLocations)} />
            <DetailItem label={ui.dashboard.ruCityBlocks} value={formatCount(volumes?.ruCityBlocks)} />
            <DetailItem label={ui.dashboard.asnBlocks} value={formatCount(volumes?.asnBlocks)} />
            <DetailItem label={ui.dashboard.ipv4Addresses} value={formatBigCount(volumes?.ipv4Addresses)} />
          </SummaryDetails>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        <Card title={ui.dashboard.rirRegistriesCard} summaryTitle>
          <div data-testid="dashboard-rir-registries">
            <SummaryHeadline className={rirImportStatusClass(rirStatus?.status, rirLoaded)}>
              {rirLoaded ? formatCount(rirStatus?.rowCount) : ui.dashboard.rirNotLoaded}
            </SummaryHeadline>
            <div className="mt-2 grid grid-cols-[minmax(6.5rem,8rem)_minmax(5rem,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-sm">
              {registryDetails.map((reg) => (
                <div key={reg.id} className="contents">
                  <span className="text-muted">{reg.label}:</span>
                  <span
                    className="min-w-0 tabular-nums text-right text-foreground"
                    title={`${reg.label}: ${formatCount(reg.rowCount)}`}
                  >
                    {formatCount(reg.rowCount)}
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-muted">
                    - {reg.snapshotDate ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title={ui.dashboard.rirActiveDataset} summaryTitle>
          <div data-testid="dashboard-rir-active-dataset">
            <SummaryHeadline className={rirLoaded ? 'text-green-600' : 'text-red-600'}>
              {rirStatus?.lastSnapshotDate ?? '—'}
            </SummaryHeadline>
            <SummaryDetails>
              <DetailItem
                label={ui.dashboard.rirImportStatus}
                value={rirImportStatusLabel(rirStatus?.status)}
                valueClassName={rirImportStatusClass(rirStatus?.status, rirLoaded)}
              />
              <DetailItem
                label={ui.dashboard.activated}
                value={formatDateTime(rirStatus?.lastSuccessAt, rirDisplayTimezone)}
              />
              <DetailItem
                label={ui.dashboard.activeImport}
                value={
                  rirStatus?.activeImportRunId
                    ? rirStatus.activeImportRunId.slice(0, 8)
                    : '—'
                }
              />
              <DetailItem
                label={ui.dashboard.nextImport}
                value={formatDateTime(rirStatus?.nextImportAt, rirDisplayTimezone)}
              />
              <DetailItem
                label={ui.dashboard.serverTime}
                value={formatDateTime(rirStatus?.serverNow, rirDisplayTimezone)}
              />
              {rirStatus?.lastError && (
                <DetailItem
                  label={ui.dashboard.rirLastError}
                  value={rirStatus.lastError}
                  title={rirStatus.lastError}
                  valueClassName="text-red-600"
                />
              )}
            </SummaryDetails>
          </div>
        </Card>

        <Card title={ui.dashboard.rirDataVolume} summaryTitle>
          <div data-testid="dashboard-rir-data-volume">
            <SummaryHeadline className={hasRirVolume ? 'text-green-600' : 'text-red-600'}>
              {formatBytes(rirStatus?.tableSizeBytes)}
            </SummaryHeadline>
            <SummaryDetails>
              <DetailItem
                label={ui.dashboard.rirTotalRows}
                value={formatCount(rirStatus?.volumes?.totalRows ?? rirStatus?.rowCount)}
              />
              <DetailItem
                label={ui.dashboard.ipv4Addresses}
                value={formatBigCount(rirStatus?.volumes?.ipv4Addresses)}
              />
              <DetailItem
                label={
                  <Link to="/cc-mismatch" className="text-muted underline-offset-2 hover:underline">
                    {ui.dashboard.rirCcMismatches}
                  </Link>
                }
                value={
                  ccMismatchState?.status === 'ready'
                    ? formatCount(ccMismatchState.rowCount)
                    : ccMismatchState?.status === 'running'
                      ? ui.dashboard.rirCcMismatchesRunning
                      : '—'
                }
              />
            </SummaryDetails>
          </div>
        </Card>
      </div>

      <Card title={ui.dashboard.recentImports}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2">{ui.dashboard.colPlane}</th>
              <th>{ui.dashboard.colId}</th>
              <th>{ui.dashboard.colDate}</th>
              <th>{ui.dashboard.colStatus}</th>
              <th>{ui.dashboard.colTrigger}</th>
              <th>{ui.dashboard.colWall}</th>
              <th>{ui.dashboard.colStarted}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mergedImports.map((run) => (
              <tr key={`${run.plane}-${run.id}`} className="border-b border-border">
                <td className="py-2">
                  {run.plane === 'rir' ? ui.dashboard.planeRir : ui.dashboard.planeGrchc}
                </td>
                <td className="font-mono text-xs">{run.id.slice(0, 8)}</td>
                <td>{run.datasetDate ?? '—'}</td>
                <td>{importStatusLabel(run.status)}</td>
                <td>{importTriggerLabel(run.triggeredBy)}</td>
                <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                <td>{formatDateTime(run.startedAt, displayTimezone)}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleImportDetail(run.plane, run.id)}
                    className="text-primary hover:underline"
                  >
                    {selectedImport?.plane === run.plane && selectedImport.id === run.id
                      ? ui.dashboard.hideSteps
                      : ui.dashboard.viewSteps}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selectedImport && (
          <ImportDetailPanel
            run={importDetail}
            loading={importDetailLoading}
            onClose={() => setSelectedImport(null)}
          />
        )}
      </Card>

      {benchmark && (
        <Card title={`${ui.dashboard.importBenchmark} (${benchmarkDate})`}>
          <p className="mb-3 text-sm text-muted">
            {ui.dashboard.wallTime}: {formatMs(benchmark.wallMs)} · {ui.dashboard.runId}{' '}
            {benchmark.importRunId.slice(0, 8)}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2">{ui.dashboard.colStep}</th>
                <th>{ui.dashboard.colDuration}</th>
                <th>{ui.dashboard.colRows}</th>
                <th>{ui.dashboard.colDetails}</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.steps.map((step) => (
                <tr key={step.name} className="border-b border-border">
                  <td className="py-2 font-mono text-xs">{step.name}</td>
                  <td>{formatMs(step.durationMs ?? 0)}</td>
                  <td>{step.rows ?? '—'}</td>
                  <td className="max-w-xs truncate text-xs text-muted">{step.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function rirImportStatusLabel(status: RirDatasetStateResponse['status'] | undefined): string {
  switch (status) {
    case 'ready':
      return ui.dashboard.rirStatusReady;
    case 'importing':
      return ui.dashboard.rirStatusImporting;
    case 'failed':
      return ui.dashboard.rirStatusFailed;
    default:
      return ui.dashboard.rirStatusUnavailable;
  }
}

function rirImportStatusClass(
  status: RirDatasetStateResponse['status'] | undefined,
  loaded: boolean,
): string {
  if (status === 'importing') return 'text-amber-700';
  if (status === 'failed') return 'text-red-600';
  if (loaded) return 'text-green-600';
  return 'text-red-600';
}

function ImportDetailPanel({
  run,
  loading,
  onClose,
}: {
  run: ImportDetailRun | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded border border-border bg-accent/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-medium">{ui.dashboard.importDetail}</h4>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-foreground">
          {ui.dashboard.hideSteps}
        </button>
      </div>
      {loading && <p className="text-sm text-muted">Загрузка...</p>}
      {!loading && run && (
        <>
          <div className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">ID:</span>
            <span className="font-mono text-xs">{run.id}</span>
            <span className="text-muted">{ui.dashboard.colStatus}:</span>
            <span>{importStatusLabel(run.status)}</span>
            {run.errorMessage && (
              <>
                <span className="text-muted">Ошибка:</span>
                <span className="text-red-600">{run.errorMessage}</span>
              </>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2">{ui.dashboard.colStep}</th>
                <th>{ui.dashboard.colStatus}</th>
                <th>{ui.dashboard.colDuration}</th>
                <th>{ui.dashboard.colRows}</th>
                <th>{ui.dashboard.colDetails}</th>
              </tr>
            </thead>
            <tbody>
              {(run.steps ?? []).map((step) => (
                <tr key={step.name} className="border-b border-border">
                  <td className="py-2 font-mono text-xs">{step.name}</td>
                  <td>{step.status}</td>
                  <td>{formatMs(step.durationMs ?? 0)}</td>
                  <td>{step.rows ?? '—'}</td>
                  <td className="max-w-xs truncate text-xs text-muted">{step.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function SummaryHeadline({
  children,
  className = 'text-foreground',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={`text-lg ${className}`}>{children}</p>;
}

function SummaryDetails({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 grid grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-sm">
      {children}
    </div>
  );
}

function StatusSummaryDetails({
  checks,
  initializing = false,
}: {
  checks: Record<string, boolean>;
  initializing?: boolean;
}) {
  const mvPending = initializing && Boolean(checks.dataset) && !checks.materializedViews;

  return (
    <div className="mt-2 grid grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-sm">
      <SystemCheckRow checkId="database" ok={Boolean(checks.database)} />
      <SystemCheckRow checkId="dataset" ok={Boolean(checks.dataset)} />
      <SystemCheckRow checkId="materializedViews" ok={Boolean(checks.materializedViews)} pending={mvPending} />
      <SystemCheckRow checkId="productionIndexes" ok={Boolean(checks.productionIndexes)} />
      <SystemCheckRow checkId="asnMapping" ok={Boolean(checks.asnMapping)} />
    </div>
  );
}

function SystemCheckRow({
  checkId,
  ok,
  pending = false,
}: {
  checkId: SystemCheckId;
  ok: boolean;
  pending?: boolean;
}) {
  const { text, state } = formatSystemCheckStatus(checkId, ok, pending);

  return (
    <>
      <span className="text-muted">{formatSystemCheckLabel(checkId)}:</span>
      <span className={systemCheckStatusClass(state)}>{text}</span>
    </>
  );
}

function DetailItem({
  label,
  value,
  title,
  valueClassName,
}: {
  label: ReactNode;
  value: string;
  title?: string;
  valueClassName?: string;
}) {
  return (
    <>
      <span className="text-muted">
        {label}:
      </span>
      <span
        className={cn('min-w-0 truncate', valueClassName ?? 'text-foreground')}
        title={title}
      >
        {value}
      </span>
    </>
  );
}

function Card({
  title,
  children,
  summaryTitle = false,
}: {
  title: string;
  children: React.ReactNode;
  summaryTitle?: boolean;
}) {
  return (
    <div
      className={
        summaryTitle
          ? 'flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4'
          : 'rounded-lg border border-border bg-card p-4'
      }
    >
      <h3
        className={
          summaryTitle
            ? 'mb-2 text-base font-bold'
            : 'mb-2 text-sm font-medium text-muted'
        }
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
