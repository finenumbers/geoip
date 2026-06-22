import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReadyResponse } from '@geoip/shared';
import { SystemStatusBanner } from './SystemStatusBanner';

const mockUseSystemReadyStatus = vi.fn();

vi.mock('@/hooks/useSystemReadyStatus', () => ({
  useSystemReadyStatus: () => mockUseSystemReadyStatus(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusBanner />
    </QueryClientProvider>,
  );
}

describe('SystemStatusBanner', () => {
  beforeEach(() => {
    mockUseSystemReadyStatus.mockReset();
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
});
