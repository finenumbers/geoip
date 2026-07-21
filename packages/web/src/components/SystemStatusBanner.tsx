import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { isSetupComplete } from '@geoip/shared';
import { useSystemReadyStatus } from '@/hooks/useSystemReadyStatus';
import { api } from '@/lib/api';
import {
  dataPlaneHasIssues,
  dataPlaneHasProgress,
} from '@/lib/data-plane-processes';
import {
  formatSystemCheckLabel,
  formatSystemCheckStatus,
  shouldHideSystemBannerForSetupPage,
} from '@/lib/system-status-labels';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

export function SystemStatusBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const {
    status,
    checks,
    isReadyError,
    isReadyLoading,
    processes,
    failedChecks,
  } = useSystemReadyStatus();
  const { data: checklist } = useQuery({
    queryKey: ['setup-checklist'],
    queryFn: api.setupChecklist,
  });
  const setupPending = checklist != null && !isSetupComplete(checklist);

  if (
    shouldHideSystemBannerForSetupPage(pathname, setupPending, isReadyError, checks)
  ) {
    return null;
  }

  if (isReadyError) {
    return (
      <StatusBanner
        variant="error"
        title={ui.systemBanner.titleUnavailable}
        testId="system-status-banner"
      />
    );
  }

  if (isReadyLoading && !status && processes.length === 0) {
    return null;
  }

  const hasProgress = dataPlaneHasProgress(processes);
  const hasIssues = dataPlaneHasIssues(processes);

  if (hasProgress) {
    return (
      <StatusBanner
        variant="initializing"
        title={ui.systemBanner.titleInitializing}
        body={ui.systemBanner.initializingHint}
        testId="system-status-banner"
      >
        <ProcessList processes={processes} />
      </StatusBanner>
    );
  }

  if (status === 'not_ready') {
    return (
      <StatusBanner
        variant="error"
        title={ui.systemBanner.titleNotReady}
        testId="system-status-banner"
      >
        {failedChecks.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5">
            {failedChecks.map((checkId) => {
              const { text } = formatSystemCheckStatus(checkId, false);
              return (
                <li key={checkId}>
                  {formatSystemCheckLabel(checkId)}: {text}
                </li>
              );
            })}
          </ul>
        )}
        {processes.length > 0 && <ProcessList processes={processes} />}
      </StatusBanner>
    );
  }

  if (status === 'degraded' || hasIssues) {
    const legacyReasons: string[] = [];
    if (status === 'degraded' && checks?.importRunning) {
      // Covered by processes when present; keep fallback if processes empty.
      if (!processes.some((p) => p.id === 'grchc-import')) {
        legacyReasons.push(ui.systemBanner.importRunning);
      }
    }
    if (status === 'degraded' && checks && !checks.asnMapping) {
      if (!processes.some((p) => p.id === 'grchc-asn')) {
        legacyReasons.push(
          `${formatSystemCheckLabel('asnMapping')}: ${formatSystemCheckStatus('asnMapping', false).text}`,
        );
      }
    }

    return (
      <StatusBanner
        variant="warning"
        title={ui.systemBanner.titleDegraded}
        testId="system-status-banner"
      >
        {(processes.length > 0 || legacyReasons.length > 0) && (
          <ul className="mt-2 list-inside list-disc space-y-0.5">
            {processes.map((process) => (
              <li key={process.id}>{process.text}</li>
            ))}
            {legacyReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </StatusBanner>
    );
  }

  return null;
}

function ProcessList({
  processes,
}: {
  processes: Array<{ id: string; text: string }>;
}) {
  if (processes.length === 0) return null;
  return (
    <ul className="mt-2 list-inside list-disc space-y-0.5">
      {processes.map((process) => (
        <li key={process.id}>{process.text}</li>
      ))}
    </ul>
  );
}

function StatusBanner({
  variant,
  title,
  body,
  children,
  testId,
}: {
  variant: 'error' | 'warning' | 'initializing';
  title: string;
  body?: string;
  children?: React.ReactNode;
  testId: string;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-950',
    warning: 'border-amber-200 bg-amber-50 text-amber-950',
    initializing: 'border-sky-200 bg-sky-50 text-sky-950',
  } as const;

  return (
    <div
      className={cn('rounded-lg border px-4 py-3 text-sm', styles[variant])}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{title}</p>
        <Link
          to="/"
          className="shrink-0 text-sm font-medium underline-offset-2 hover:underline"
        >
          {ui.systemBanner.detailsLink}
        </Link>
      </div>
      {body && <p className="mt-1 opacity-90">{body}</p>}
      {children}
    </div>
  );
}
