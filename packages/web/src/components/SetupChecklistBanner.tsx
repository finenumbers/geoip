import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import type { SetupChecklistResponse } from '@geoip/shared';
import { api } from '@/lib/api';
import { adminLinkForSetupStep } from '@/lib/admin-sections';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

export function SetupChecklistBanner({ className }: { className?: string }) {
  const { data: checklist } = useQuery({
    queryKey: ['setup-checklist'],
    queryFn: api.setupChecklist,
    refetchInterval: 30_000,
  });

  if (!checklist || checklist.blockingReady) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950',
        className,
      )}
    >
      <p className="mb-2 font-medium">{ui.setup.title}</p>
      <SetupChecklistSteps checklist={checklist} />
    </div>
  );
}

export function SetupChecklistPanel({ className }: { className?: string }) {
  const { data: checklist, isLoading } = useQuery({
    queryKey: ['setup-checklist'],
    queryFn: api.setupChecklist,
    refetchInterval: 30_000,
  });

  if (isLoading || !checklist) {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium">{ui.setup.title}</p>
      <SetupChecklistSteps checklist={checklist} />
      {checklist.blockingReady && (
        <p className="text-sm text-green-700">{ui.setup.allBlockingDone}</p>
      )}
    </div>
  );
}

function SetupChecklistSteps({ checklist }: { checklist: SetupChecklistResponse }) {
  return (
    <ul className="space-y-1.5">
      {checklist.steps.map((step) => {
        const link = !step.done ? adminLinkForSetupStep(step.id, step.href) : null;

        return (
          <li key={step.id} className="flex items-start gap-2">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            )}
            <span className={cn(step.done && 'text-muted line-through')}>
              {step.label}
              {step.optional && (
                <span className="ml-1 text-xs text-muted">({ui.setup.optional})</span>
              )}
              {link && (
                <>
                  {' '}
                  <Link
                    to={link.to}
                    search={'search' in link ? link.search : undefined}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {ui.setup.openStep}
                  </Link>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
