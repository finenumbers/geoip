import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SystemInitializingBanner } from './SystemInitializingBanner';

describe('SystemInitializingBanner', () => {
  it('renders when dataset exists and MV is refreshing', () => {
    render(<SystemInitializingBanner datasetDate="2026-06-20" mvStatus="refreshing" />);
    expect(screen.getByTestId('system-initializing-banner')).toBeTruthy();
    expect(screen.getByText(/Инициализация/i)).toBeTruthy();
    expect(screen.getByText(/ГРЧЦ: подготовка материализованных/i)).toBeTruthy();
  });

  it('does not render when MV is ready', () => {
    const { container } = render(
      <SystemInitializingBanner datasetDate="2026-06-20" mvStatus="ready" />,
    );
    expect(container.textContent).toBe('');
  });
});

