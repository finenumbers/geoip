import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReadyResponse, SetupChecklistResponse } from '@geoip/shared';
import { SystemStatusBanner } from './SystemStatusBanner';

const mockUseSystemReadyStatus = vi.fn();
const mockPathname = vi.fn(() => '/browse/city');

vi.mock('@/hooks/useSystemReadyStatus', () => ({
  useSystemReadyStatus: () => mockUseSystemReadyStatus(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useRouterState: (opts: { select: (s: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mockPathname() } }),
}));

const pendingChecklist: SetupChecklistResponse = {
  blockingReady: false,
  steps: [
    { id: 'adminAccount', label: 'Admin', done: false, href: '/admin/setup' },
    { id: 'externalLookupApiKey', label: 'API key', done: false, href: '/admin/setup-api-key' },
    { id: 'grchcCredentials', label: 'GRChC', done: false, href: '/admin?section=grchc' },
    { id: 'datasetImported', label: 'Import', done: false },
    { id: 'googleMapsKey', label: 'Maps', done: false, optional: true },
  ],
};

function renderBanner(checklist?: SetupChecklistResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (checklist) {
    client.setQueryData(['setup-checklist'], checklist);
  }
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusBanner />
    </QueryClientProvider>,
  );
}

describe('SystemStatusBanner', () => {
  beforeEach(() => {
    mockUseSystemReadyStatus.mockReset();
    mockPathname.mockReturnValue('/browse/city');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when system is ready', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'ready',
      checks: { database: true, dataset: true, materializedViews: true, productionIndexes: true, asnMapping: true, importRunning: false },
      isReadyError: false,
      isInitializing: false,
      failedChecks: [],
    });

    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows database failure when not_ready', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready',
      checks: { database: false, dataset: false, materializedViews: false, productionIndexes: false, asnMapping: false, importRunning: false },
      isReadyError: false,
      isInitializing: false,
      failedChecks: ['database', 'dataset', 'materializedViews', 'productionIndexes', 'asnMapping'],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/Система не готова/i)).toBeInTheDocument();
    expect(screen.getByText(/База данных: Недоступна/i)).toBeInTheDocument();
  });

  it('shows amber banner when degraded', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'degraded',
      checks: { database: true, dataset: true, materializedViews: true, productionIndexes: true, asnMapping: false, importRunning: true },
      isReadyError: false,
      isInitializing: false,
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/ограничениями/i)).toBeInTheDocument();
  });

  it('shows initializing banner during MV warmup', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready' as ReadyResponse['status'],
      checks: { database: true, dataset: true, materializedViews: false, productionIndexes: true, asnMapping: true, importRunning: false },
      isReadyError: false,
      isInitializing: true,
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/Инициализация/i)).toBeInTheDocument();
  });

  it('hides expected not_ready banner on dashboard during onboarding', () => {
    mockPathname.mockReturnValue('/');
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready',
      checks: { database: true, dataset: false, materializedViews: false, productionIndexes: false, asnMapping: false, importRunning: false },
      isReadyError: false,
      isInitializing: false,
      failedChecks: ['dataset', 'materializedViews', 'productionIndexes', 'asnMapping'],
    });

    const { container } = renderBanner(pendingChecklist);
    expect(container).toBeEmptyDOMElement();
  });
});
