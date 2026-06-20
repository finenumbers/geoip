import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveFiltersBar } from './ActiveFiltersBar.js';

describe('ActiveFiltersBar', () => {
  it('renders nothing when there are no filters', () => {
    const { container } = render(<ActiveFiltersBar filters={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders chips and removes a single-value filter', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <ActiveFiltersBar
        filters={[
          {
            id: 'country_iso_code',
            field: 'country_iso_code',
            label: 'ISO страны',
            displayValue: 'RU',
          },
        ]}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('Активные фильтры:')).toBeInTheDocument();
    expect(screen.getByText(/ISO страны:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Убрать фильтр ISO страны' }));
    expect(onRemove).toHaveBeenCalledWith('country_iso_code', undefined);
  });

  it('passes removeValue for multi-select chips', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <ActiveFiltersBar
        filters={[
          {
            id: 'city_name:Moscow',
            field: 'city_name',
            label: 'Город',
            displayValue: 'Moscow',
            removeValue: 'Moscow',
          },
        ]}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Убрать фильтр Город: Moscow' }));
    expect(onRemove).toHaveBeenCalledWith('city_name', 'Moscow');
  });
});
