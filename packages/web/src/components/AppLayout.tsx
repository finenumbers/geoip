import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Search,
  Table2,
  Settings,
  Code2,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { fetchClientPublicIp } from '@/lib/client-public-ip';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';
import { DEFAULT_BROWSE_SEARCH } from '@/lib/table-query-state';
import { isSetupComplete } from '@geoip/shared';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

const nav: NavItem[] = [
  {
    to: '/',
    label: ui.nav.dashboard,
    icon: LayoutDashboard,
    match: (pathname) => pathname === '/',
  },
  {
    to: '/browse/city',
    label: ui.nav.table,
    icon: Table2,
    match: (pathname) => pathname.startsWith('/browse'),
  },
  {
    to: '/lookup',
    label: ui.nav.lookup,
    icon: Search,
    match: (pathname) => pathname.startsWith('/lookup'),
  },
  {
    to: '/api-docs',
    label: ui.nav.apiDocs,
    icon: Code2,
    match: (pathname) => pathname.startsWith('/api-docs'),
  },
  {
    to: '/admin',
    label: ui.nav.admin,
    icon: Settings,
    match: (pathname) => pathname.startsWith('/admin'),
  },
];

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: dataset } = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: 30_000,
  });
  const { data: checklist } = useQuery({
    queryKey: ['setup-checklist'],
    queryFn: api.setupChecklist,
    refetchInterval: 30_000,
  });
  const { data: clientIpData, isFetching: clientIpLoading } = useQuery({
    queryKey: ['client-public-ip'],
    queryFn: async () => {
      const ip = await fetchClientPublicIp();
      return ip ? { ip } : null;
    },
    staleTime: 5 * 60_000,
  });
  const showAdminBadge = checklist != null && !isSetupComplete(checklist);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col items-center gap-2 border-r border-border bg-card py-4">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);

          return (
            <Link
              key={item.to}
              to={item.to}
              search={item.to.startsWith('/browse') ? DEFAULT_BROWSE_SEARCH : undefined}
              title={item.label}
              aria-label={item.label}
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent hover:text-foreground',
                active && 'bg-accent text-primary',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
              {item.to === '/admin' && showAdminBadge && (
                <span
                  className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500"
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </aside>

      <div className="flex h-dvh flex-col pl-16">
        <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border bg-card/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span className="text-lg font-bold text-black">{ui.appTitle}</span>
          <div className="flex items-center gap-3 text-sm">
            {clientIpLoading && (
              <span className="text-muted">
                {ui.header.yourIp}: …
              </span>
            )}
            {!clientIpLoading && clientIpData?.ip && (
              <Link
                to="/lookup"
                search={{ ip: clientIpData.ip }}
                className="hover:underline"
              >
                {ui.header.yourIp}:{' '}
                <span className="font-bold text-foreground">{clientIpData.ip}</span>
              </Link>
            )}
            {dataset?.datasetDate && (
              <span>
                {ui.datasetBadge}:{' '}
                <span className="font-bold text-foreground">{dataset.datasetDate}</span>
              </span>
            )}
            {dataset?.mvStatus && (
              <span
                className={cn(
                  'font-bold',
                  dataset.mvStatus === 'ready' ? 'text-green-600' : 'text-amber-600',
                )}
              >
                MV: {dataset.mvStatus}
              </span>
            )}
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
