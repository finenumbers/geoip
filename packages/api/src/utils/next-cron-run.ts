/** Next run for daily cron: fixed minute + hour, wildcard day/month/dow. */
export function getNextDailyCronRun(expression: string, from = new Date()): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minutePart, hourPart, dayPart, monthPart, dowPart] = parts;
  if (dayPart !== '*' || monthPart !== '*' || dowPart !== '*') return null;

  const minute = Number(minutePart);
  const hour = Number(hourPart);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}
