import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ColumnTextFilterProps {
  placeholder: string;
  value: string;
  onApply: (value: string) => void;
  onClear: () => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  className?: string;
}

export function ColumnTextFilter({
  placeholder,
  value,
  onApply,
  onClear,
  inputMode,
  className,
}: ColumnTextFilterProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const hasValue = value.length > 0;

  return (
    <form
      className={cn('flex min-w-0 items-center gap-1', className)}
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft.trim());
      }}
    >
      <input
        type="text"
        inputMode={inputMode}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== value) onApply(draft.trim());
        }}
        placeholder={placeholder}
        className={cn(
          'min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary',
          hasValue ? 'border-primary/50' : 'border-border',
        )}
      />
      {hasValue && (
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted hover:bg-accent hover:text-foreground"
          aria-label={`Очистить ${placeholder}`}
          onClick={() => {
            setDraft('');
            onClear();
          }}
        >
          ×
        </button>
      )}
    </form>
  );
}
