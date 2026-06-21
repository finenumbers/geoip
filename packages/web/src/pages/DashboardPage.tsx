import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportRun } from '@geoip/shared';
import { api } from '@/lib/api';
import { ui, importStatusLabel, importTriggerLabel } from '@/lib/ui-strings';
import { QueryErrorNotice } from '@/components/QueryErrorNotice';
import { SetupChecklistBanner } from '@/components/SetupChecklistBanner';
import { SystemInitializingBanner } from '@/components/SystemInitializingBanner';
import { isDatasetInitializing } from '@geoip/shared';
import {
  formatSystemCheckLabel,
  formatSystemCheckStatus,
  systemCheckStatusClass,
  type SystemCheckId,
} from '@/lib/system-status-labels';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format-datetime';

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

function systemStatusLabel(
  status: string | undefined,
  datasetDate: string | null,
  mvStatus: string | undefined,
): string {
  if (isDatasetInitializing(datasetDate, mvStatus as 'ready' | 'refreshing' | 'unavailable' | undefined)) {
    return ui.dashboard.statusInitializing;
  }
  if (status === 'ready') return ui.dashboard.statusReady;
  if (status === 'degraded') return ui.dashboard.statusDegraded;
  return ui.dashboard.statusNotReady;
}

function systemStatusClass(
  status: string | undefined,
  datasetDate: string | null,
  mvStatus: string | undefined,
): string {
  if (isDatasetInitializing(datasetDate, mvStatus as 'ready' | 'refreshing' | 'unavailable' | undefined)) {
    return 'text-amber-600';
  }
  if (status === 'ready') return 'text-green-600';
  if (status === 'degraded') return 'text-amber-600';
  return 'text-red-600';
}

export function DashboardPage() {
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: dataset,
    isError: datasetError,
    error: datasetErr,
  } = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: (query) =>
      isDatasetInitializing(query.state.data?.datasetDate, query.state.data?.mvStatus) ? 10_000 : 30_000,
  });
  const {
    data: ready,
    isError: readyError,
    error: readyErr,
  } = useQuery({
    queryKey: ['ready'],
    queryFn: api.ready,
    refetchInterval: (query) => {
      if (query.state.data?.status === 'ready') return false;
      if (isDatasetInitializing(dataset?.datasetDate, dataset?.mvStatus)) return 10_000;
      const checks = query.state.data?.checks;
      if (checks?.dataset && !checks.materializedViews) return 10_000;
      return false;
    },
  });
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

  useEffect(() => {
    if (imports?.items.some((item) => item.status === 'succeeded')) {
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
    }
  }, [imports?.items, queryClient]);
  const {
    data: importDetail,
    isError: importDetailError,
    error: importDetailErr,
    isFetching: importDetailLoading,
  } = useQuery({
    queryKey: ['import', selectedImportId],
    queryFn: () => api.importById(selectedImportId!),
    enabled: selectedImportId != null,
  });

  const benchmark = metrics?.import.latestBenchmark;
  const benchmarkDate = benchmark?.datasetDate ?? dataset?.datasetDate ?? '—';
  const datasetDate = dataset?.datasetDate ?? metrics?.activeDatasetDate ?? null;
  const hasDataset = Boolean(datasetDate);
  const hasDatabaseVolume = Boolean(dataset?.databaseSizeBytes && dataset.databaseSizeBytes > 0);
  const systemStatus = ready?.status;
  const mvStatus = metrics?.mvStatus ?? dataset?.mvStatus;
  const isInitializing = isDatasetInitializing(datasetDate, mvStatus);
  const volumes = dataset?.volumes;
  const displayTimezone = dataset?.displayTimezone ?? 'Europe/Moscow';

  const toggleImportDetail = (runId: string) => {
    setSelectedImportId((current) => (current === runId ? null : runId));
  };

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto">
      <SetupChecklistBanner />
      <SystemInitializingBanner datasetDate={datasetDate} mvStatus={mvStatus} />
      {(datasetError || metricsError || importsError || importDetailError || (readyError && !isInitializing)) && (
        <QueryErrorNotice
          error={datasetErr ?? metricsErr ?? importsErr ?? importDetailErr ?? readyErr}
        />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        <Card title={ui.dashboard.systemStatus} summaryTitle>
          <SummaryHeadline className={systemStatusClass(systemStatus, datasetDate, mvStatus)}>
            {systemStatusLabel(systemStatus, datasetDate, mvStatus)}
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

      <Card title={ui.dashboard.recentImports}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2">{ui.dashboard.colId}</th>
              <th>{ui.dashboard.colDate}</th>
              <th>{ui.dashboard.colStatus}</th>
              <th>{ui.dashboard.colTrigger}</th>
              <th>{ui.dashboard.colWall}</th>
              <th>{ui.dashboard.colStarted}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(imports?.items ?? []).map((run: ImportRun) => (
              <tr key={run.id} className="border-b border-border">
                <td className="py-2 font-mono text-xs">{run.id.slice(0, 8)}</td>
                <td>{run.datasetDate ?? '—'}</td>
                <td>{importStatusLabel(run.status)}</td>
                <td>{importTriggerLabel(run.triggeredBy)}</td>
                <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                <td>{formatDateTime(run.startedAt, displayTimezone)}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleImportDetail(run.id)}
                    className="text-primary hover:underline"
                  >
                    {selectedImportId === run.id ? ui.dashboard.hideSteps : ui.dashboard.viewSteps}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selectedImportId && (
          <ImportDetailPanel
            run={importDetail}
            loading={importDetailLoading}
            onClose={() => setSelectedImportId(null)}
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

function ImportDetailPanel({
  run,
  loading,
  onClose,
}: {
  run: ImportRun | undefined;
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
  label: string;
  value: string;
  title?: string;
  valueClassName?: string;
}) {
  return (
    <>
      <span className="text-muted">{label}:</span>
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
