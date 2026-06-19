interface ActiveFilterChip {
  field: string;
  label: string;
  displayValue: string;
}

interface ActiveFiltersBarProps {
  filters: ActiveFilterChip[];
  onRemove: (field: string) => void;
}

export function ActiveFiltersBar({ filters, onRemove }: ActiveFiltersBarProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <span className="text-muted">Активные фильтры:</span>
      {filters.map((filter) => (
        <span
          key={filter.field}
          className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
        >
          <span className="truncate">
            <span className="text-muted">{filter.label}:</span> {filter.displayValue}
          </span>
          <button
            type="button"
            className="shrink-0 text-muted hover:text-foreground"
            aria-label={`Убрать фильтр ${filter.label}`}
            onClick={() => onRemove(filter.field)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
