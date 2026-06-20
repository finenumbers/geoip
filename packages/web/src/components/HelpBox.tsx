import { cn } from '@/lib/utils';

export function HelpBox({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950',
        className,
      )}
    >
      <p className="mb-1 font-medium">{title}</p>
      <div className="space-y-1 text-blue-900">{children}</div>
    </div>
  );
}
