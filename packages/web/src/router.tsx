import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { ImportsPage } from '@/pages/ImportsPage';
import { LookupPage } from '@/pages/LookupPage';
import { AdminPage } from '@/pages/AdminPage';
import { BrowsePage } from '@/pages/BrowsePage';

const rootRoute = createRootRoute({
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const importsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/imports',
  component: ImportsPage,
});

const lookupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lookup',
  component: LookupPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPage,
});

const browseSearchSchema = (search: Record<string, unknown>) => ({
  page: Number(search.page ?? 1),
  pageSize: Number(search.pageSize ?? 50),
  sort: String(search.sort ?? '[]'),
  filters: String(search.filters ?? '[]'),
  afterId: search.afterId != null ? Number(search.afterId) : undefined,
  afterNetwork: search.afterNetwork != null ? String(search.afterNetwork) : undefined,
  afterSortValue: search.afterSortValue != null ? String(search.afterSortValue) : undefined,
});

const browseCityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/city',
  component: BrowsePage,
  validateSearch: browseSearchSchema,
});

const browseCountryRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/country',
  beforeLoad: () => {
    throw redirect({
      to: '/browse/city',
      search: {
        page: 1,
        pageSize: 50,
        sort: '[]',
        filters: '[]',
        afterId: undefined,
        afterNetwork: undefined,
        afterSortValue: undefined,
      },
    });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  importsRoute,
  lookupRoute,
  adminRoute,
  browseCityRoute,
  browseCountryRedirectRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
