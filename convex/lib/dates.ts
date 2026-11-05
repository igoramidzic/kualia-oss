export function parseCurrentYearMonth(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = typeof value === 'number' ? value.toString() : value;

  if (typeof normalized !== 'string' || !/^[0-9]{6}$/.test(normalized)) {
    throw new Error('currentYearMonth must be a YYYYMM string');
  }

  const month = parseInt(normalized.slice(4, 6), 10);
  if (month < 1 || month > 12) {
    throw new Error('currentYearMonth month must be between 01 and 12');
  }

  return parseInt(normalized, 10);
}

/**
 * Returns today's date in the given IANA timezone as a YYYY-MM-DD string. Falls back to UTC if the
 * timezone is missing or invalid. Used when an MCP caller (e.g. `kualia_create_transactions`)
 * omits `date` and we need to default to "today in the user's workspace".
 */
export function getCurrentDateForTimezone(timezone: string | undefined, now: Date = new Date()): string {
  const formatInTimezone = (tz: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) {
      throw new Error(`Failed to derive current date for timezone ${tz}`);
    }
    return `${year}-${month}-${day}`;
  };

  try {
    return formatInTimezone(timezone ?? 'UTC');
  } catch {
    return formatInTimezone('UTC');
  }
}

/**
 * Returns the epoch-ms timestamp of `isoDate` (YYYY-MM-DD) at the given local hour in an IANA
 * timezone. Falls back to UTC if the timezone is missing or invalid. The offset is sampled at
 * noon UTC of the target day, so a DST transition in the small hours of that same day resolves
 * to the post-transition offset — correct for any target hour after the switch.
 */
export function dateAtHourInTimezoneMs(isoDate: string, hour: number, timezone: string | undefined): number {
  const [year, month, day] = isoDate.split('-').map(Number);

  const offsetMinutesFor = (tz: string): number => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const roughDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const tzName = formatter.formatToParts(roughDate).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const offsetMatch = tzName.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!offsetMatch) {
      return 0;
    }
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    return sign * (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3] ?? '0', 10));
  };

  let offsetMinutes: number;
  try {
    offsetMinutes = offsetMinutesFor(timezone ?? 'UTC');
  } catch {
    offsetMinutes = 0;
  }

  return Date.UTC(year, month - 1, day, hour, 0, 0, 0) - offsetMinutes * 60 * 1000;
}

export function getCurrentYearMonthForTimezone(timezone: string | undefined): number {
  const now = new Date();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);

    const yearPart = parts.find((part) => part.type === 'year')?.value;
    const monthPart = parts.find((part) => part.type === 'month')?.value;

    if (!yearPart || !monthPart) {
      throw new Error('Failed to derive current month for timezone');
    }

    return parseInt(`${yearPart}${monthPart}`, 10);
  } catch {
    const fallbackParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);

    const fallbackYear = fallbackParts.find((part) => part.type === 'year')?.value;
    const fallbackMonth = fallbackParts.find((part) => part.type === 'month')?.value;

    if (!fallbackYear || !fallbackMonth) {
      throw new Error('Failed to derive current month for UTC timezone');
    }

    return parseInt(`${fallbackYear}${fallbackMonth}`, 10);
  }
}

export function dateToYearMonth(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number);
  return year * 100 + month;
}

export function addMonthsToYearMonth(yearMonth: number, months: number): number {
  const year = Math.floor(yearMonth / 100);
  const monthIndex = (yearMonth % 100) - 1 + months;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function getDueDateForMonth(anchorDate: string, year: number, month: number): string {
  const anchorDay = Number(anchorDate.split('-')[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`;
}

export function getDueDateForYear(anchorDate: string, year: number): string {
  const [, month, anchorDay] = anchorDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`;
}
