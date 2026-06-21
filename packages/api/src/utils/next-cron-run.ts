type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

/** Map wall-clock in IANA timezone to UTC instant (handles DST via iteration). */
function zonedLocalToUtc(parts: ZonedParts, timeZone: string): Date {
  const { year, month, day, hour, minute } = parts;
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let i = 0; i < 5; i++) {
    const zoned = getZonedParts(new Date(utcMs), timeZone);
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0);
    const diffMs = desiredMs - actualMs;
    if (diffMs === 0) break;
    utcMs += diffMs;
  }

  return new Date(utcMs);
}

function addCalendarDaysInTimeZone(parts: ZonedParts, days: number, timeZone: string): ZonedParts {
  const anchor = zonedLocalToUtc({ ...parts, hour: 12, minute: 0 }, timeZone);
  return getZonedParts(new Date(anchor.getTime() + days * 86_400_000), timeZone);
}

/** Next run for daily cron: fixed minute + hour, wildcard day/month/dow. */
export function getNextDailyCronRun(
  expression: string,
  from = new Date(),
  timeZone = 'UTC',
): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minutePart, hourPart, dayPart, monthPart, dowPart] = parts;
  if (dayPart !== '*' || monthPart !== '*' || dowPart !== '*') return null;

  const minute = Number(minutePart);
  const hour = Number(hourPart);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const nowZoned = getZonedParts(from, timeZone);
  let candidate = zonedLocalToUtc(
    { year: nowZoned.year, month: nowZoned.month, day: nowZoned.day, hour, minute },
    timeZone,
  );

  if (candidate <= from) {
    const tomorrow = addCalendarDaysInTimeZone(nowZoned, 1, timeZone);
    candidate = zonedLocalToUtc(
      { year: tomorrow.year, month: tomorrow.month, day: tomorrow.day, hour, minute },
      timeZone,
    );
  }

  return candidate;
}
