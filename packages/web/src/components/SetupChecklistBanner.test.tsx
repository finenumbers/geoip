import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SetupChecklistResponse } from '@geoip/shared';
import { SetupChecklistBanner } from './SetupChecklistBanner';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const completeChecklist: SetupChecklistResponse = {
  blockingReady: true,
  steps: [
    { id: 'adminAccount', label: 'Admin', done: true },
    { id: 'externalLookupApiKey', label: 'API key', done: true },
    { id: 'grchcCredentials', label: 'GRChC', done: true },
    { id: 'datasetImported', label: 'Import', done: true },
    { id: 'googleMapsKey', label: 'Maps', done: false, optional: true },
  ],
};

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

function renderBanner(checklist: SetupChecklistResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(['setup-checklist'], checklist);

  return render(
    <QueryClientProvider client={queryClient}>
      <SetupChecklistBanner />
    </QueryClientProvider>,
  );
}

describe('SetupChecklistBanner', () => {
  it('does not render when required setup steps are complete', () => {
    const { container } = renderBanner(completeChecklist);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('setup-checklist-banner')).not.toBeInTheDocument();
  });

  it('renders when required setup steps are pending', () => {
    renderBanner(pendingChecklist);
    expect(screen.getByTestId('setup-checklist-banner')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});
