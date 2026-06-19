import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/imports', label: 'Импорты' },
  { to: '/browse/city', label: 'Таблица' },
  { to: '/lookup', label: 'IP Lookup' },
  { to: '/admin', label: 'Admin' },
];

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: dataset } = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-border bg-card p-4 flex flex-col gap-2">
        <h1 className="text-lg font-semibold mb-4">GeoIP Analytics</h1>
        {nav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'px-3 py-2 rounded-md text-sm hover:bg-accent',
              pathname === item.to && 'bg-accent text-primary',
            )}
          >
            {item.label}
          </Link>
        ))}
      </aside>
      <div className="flex-1 flex flex-col">
        <header className="border-b border-border px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-muted">ГРЧЦ РФ GeoIP</span>
          <div className="flex items-center gap-3 text-sm">
            {dataset?.datasetDate && (
              <span className="px-2 py-1 rounded bg-accent">
                Dataset: {dataset.datasetDate}
              </span>
            )}
            {dataset?.mvStatus && (
              <span
                className={cn(
                  'px-2 py-1 rounded',
                  dataset.mvStatus === 'ready' ? 'text-green-400' : 'text-yellow-400',
                )}
              >
                MV: {dataset.mvStatus}
              </span>
            )}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
