import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowsePage } from '@/pages/BrowsePage';

const startExport = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  ),
  useSearch: () => ({ sort: '[]', filters: '[]' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/use-table-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/use-table-export')>();
  return {
    ...actual,
    useTableExport: () => ({
      state: 'idle',
      errorMessage: null,
      estimatedRows: null,
      startExport,
      reset: vi.fn(),
      isBusy: false,
    }),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    dataset: vi.fn().mockResolvedValue({ datasetFingerprint: 'fp-1', exportMaxRows: 5_000_000 }),
    table: vi.fn().mockResolvedValue({
      rows: [],
      pagination: { page: 1, pageSize: 100, totalRows: 0 },
      meta: { countSource: 'exact' },
    }),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

function renderBrowse() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowsePage tableType="city" />
    </QueryClientProvider>,
  );
}

describe('BrowsePage export CSV', () => {
  beforeEach(() => {
    startExport.mockClear();
  });

  it('renders export button and starts export with current query', async () => {
    const user = userEvent.setup();
    renderBrowse();

    const button = screen.getByTestId('browse-export-csv');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', expect.stringContaining('ZIP-архив'));

    await user.click(button);
    expect(startExport).toHaveBeenCalledWith('city', [], []);
  });
});
