import { isDatasetInitializing } from '@geoip/shared';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

type SystemInitializingBannerProps = {
  datasetDate?: string | null;
  mvStatus?: 'ready' | 'refreshing' | 'unavailable' | null;
  className?: string;
};

export function SystemInitializingBanner({
  datasetDate,
  mvStatus,
  className,
}: SystemInitializingBannerProps) {
  if (!isDatasetInitializing(datasetDate, mvStatus)) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950',
        className,
      )}
      data-testid="system-initializing-banner"
    >
      <p className="font-medium">{ui.systemBanner.titleInitializing}</p>
      <p className="mt-1 text-sky-900">{ui.systemBanner.initializingHint}</p>
      <ul className="mt-2 list-inside list-disc space-y-0.5 text-sky-900">
        <li>{ui.systemBanner.processGrchcMv}</li>
      </ul>
    </div>
  );
}
