const DEFAULT_TIMEZONE = 'Europe/Moscow';

export function formatDateTime(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timeZone.trim() || DEFAULT_TIMEZONE,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  } catch {
    return date.toLocaleString('ru-RU');
  }
}
