import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ColumnTextFilterProps {
  placeholder: string;
  value: string;
  onApply: (value: string) => void;
  onClear: () => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  error?: string;
  validate?: (value: string) => string | null;
  onValidationError?: (message: string) => void;
  className?: string;
}

export function ColumnTextFilter({
  placeholder,
  value,
  onApply,
  onClear,
  inputMode,
  error: externalError,
  validate,
  onValidationError,
  className,
}: ColumnTextFilterProps) {
  const [draft, setDraft] = useState(value);
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    setDraft(value);
    if (value) setLocalError(undefined);
  }, [value]);

  const error = externalError ?? localError;
  const hasValue = value.length > 0;

  const tryApply = (raw: string) => {
    const trimmed = raw.trim();
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setLocalError(err);
        onValidationError?.(err);
        return;
      }
    }
    setLocalError(undefined);
    onApply(trimmed);
  };

  return (
    <div className={cn('min-w-0 w-full', className)}>
      <form
        className="flex min-w-0 w-full items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          tryApply(draft);
        }}
      >
        <input
          type="text"
          inputMode={inputMode}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (localError) setLocalError(undefined);
          }}
          onBlur={() => {
            if (draft.trim() !== value) tryApply(draft);
          }}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          className={cn(
            'min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm outline-none placeholder:font-bold focus:border-primary',
            hasValue ? 'border-primary/50' : 'border-border',
            error && 'border-red-500 focus:border-red-500',
          )}
        />
        {(hasValue || draft.trim().length > 0) && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted hover:bg-accent hover:text-foreground"
            aria-label={`Очистить ${placeholder}`}
            onClick={() => {
              setDraft('');
              setLocalError(undefined);
              onClear();
            }}
          >
            ×
          </button>
        )}
      </form>
      {error && (
        <p className="mt-0.5 whitespace-normal text-xs leading-tight text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
