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
    { id: 'datasetImported', label: 'Import GRChC', done: false, href: '/admin?section=overview' },
    { id: 'rirDatasetImported', label: 'Import RIR', done: false, href: '/admin?section=overview' },
    { id: 'autoImportsConfigured', label: 'Auto-imports', done: false, href: '/admin?section=general' },
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

  it('renders nothing when system is ready and idle', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'ready',
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      isReadyError: false,
      processes: [],
      failedChecks: [],
    });

    const { container } = renderBanner();
    expect(container.textContent).toBe('');
  });

  it('shows database failure when not_ready', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready',
      checks: {
        database: false,
        dataset: false,
        materializedViews: false,
        productionIndexes: false,
        asnMapping: false,
        importRunning: false,
      },
      isReadyError: false,
      processes: [],
      failedChecks: ['database', 'dataset', 'materializedViews', 'productionIndexes', 'asnMapping'],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeTruthy();
    expect(screen.getByText(/Система не готова/i)).toBeTruthy();
    expect(screen.getByText(/База данных: Недоступна/i)).toBeTruthy();
  });

  it('shows amber banner for ASN warning process', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'degraded',
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: false,
        importRunning: false,
      },
      isReadyError: false,
      processes: [
        { id: 'grchc-asn', kind: 'warning', text: 'ГРЧЦ: сопоставление ASN ещё не готово' },
      ],
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeTruthy();
    expect(screen.getByText(/ограничениями/i)).toBeTruthy();
    expect(screen.getByText(/сопоставление ASN/i)).toBeTruthy();
  });

  it('shows initializing banner with GRChC and RIR process lines', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready' as ReadyResponse['status'],
      checks: {
        database: true,
        dataset: true,
        materializedViews: false,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      isReadyError: false,
      processes: [
        {
          id: 'grchc-mv',
          kind: 'progress',
          text: 'ГРЧЦ: подготовка материализованных представлений (таблица, lookup и экспорт временно недоступны)',
        },
        { id: 'rir-import', kind: 'progress', text: 'RIR+IANA: выполняется импорт' },
      ],
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeTruthy();
    expect(screen.getByText(/Инициализация/i)).toBeTruthy();
    expect(screen.getByText(/ГРЧЦ: подготовка материализованных/i)).toBeTruthy();
    expect(screen.getByText(/RIR\+IANA: выполняется импорт/i)).toBeTruthy();
  });

  it('shows initializing instead of red not_ready while processes are in progress', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready',
      checks: {
        database: true,
        dataset: true,
        materializedViews: false,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      isReadyError: false,
      isReadyLoading: false,
      processes: [
        {
          id: 'grchc-mv',
          kind: 'progress',
          text: 'ГРЧЦ: подготовка материализованных представлений (таблица, lookup и экспорт временно недоступны)',
        },
      ],
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeTruthy();
    expect(screen.getByText(/Инициализация/i)).toBeTruthy();
    expect(screen.queryByText(/Система не готова/i)).toBeNull();
  });

  it('shows amber banner for RIR failure when GRChC is ready', () => {
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'ready',
      checks: {
        database: true,
        dataset: true,
        materializedViews: true,
        productionIndexes: true,
        asnMapping: true,
        importRunning: false,
      },
      isReadyError: false,
      processes: [
        { id: 'rir-failed', kind: 'error', text: 'RIR+IANA: ошибка импорта: boom' },
      ],
      failedChecks: [],
    });

    renderBanner();
    expect(screen.getByTestId('system-status-banner')).toBeTruthy();
    expect(screen.getByText(/ограничениями/i)).toBeTruthy();
    expect(screen.getByText(/RIR\+IANA: ошибка импорта/i)).toBeTruthy();
  });

  it('hides expected not_ready banner on dashboard during onboarding', () => {
    mockPathname.mockReturnValue('/');
    mockUseSystemReadyStatus.mockReturnValue({
      status: 'not_ready',
      checks: {
        database: true,
        dataset: false,
        materializedViews: false,
        productionIndexes: false,
        asnMapping: false,
        importRunning: false,
      },
      isReadyError: false,
      isReadyLoading: false,
      processes: [],
      failedChecks: ['dataset', 'materializedViews', 'productionIndexes', 'asnMapping'],
    });

    const { container } = renderBanner(pendingChecklist);
    expect(container.textContent).toBe('');
  });
});

