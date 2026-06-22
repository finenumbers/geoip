import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { isSetupComplete } from '@geoip/shared';
import { useSystemReadyStatus } from '@/hooks/useSystemReadyStatus';
import { api } from '@/lib/api';
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
    isInitializing,
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

  if (isInitializing) {
    return (
      <StatusBanner
        variant="initializing"
        title={ui.dashboard.statusInitializing}
        body={ui.dashboard.initializingBanner}
        testId="system-status-banner"
      />
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
      </StatusBanner>
    );
  }

  if (status === 'degraded') {
    const reasons: string[] = [];
    if (checks?.importRunning) {
      reasons.push(ui.systemBanner.importRunning);
    }
    if (checks && !checks.asnMapping) {
      reasons.push(
        `${formatSystemCheckLabel('asnMapping')}: ${formatSystemCheckStatus('asnMapping', false).text}`,
      );
    }

    return (
      <StatusBanner
        variant="warning"
        title={ui.systemBanner.titleDegraded}
        testId="system-status-banner"
      >
        {reasons.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </StatusBanner>
    );
  }

  return null;
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
