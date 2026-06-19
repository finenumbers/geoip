import { ApiError } from '@/lib/api';

export function formatQueryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Не удалось загрузить данные';
}

export function QueryErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800">
      {formatQueryErrorMessage(error)}
    </div>
  );
}
