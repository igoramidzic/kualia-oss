/**
 * Month Utilities
 *
 * Helper functions for working with yearMonth format (YYYYMM as number)
 */

/**
 * Get current year-month in YYYYMM format from current date
 */
export function getCurrentYearMonth(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 0-indexed to 1-indexed
  return year * 100 + month;
}

/**
 * Convert a Date to year-month in YYYYMM format.
 */
export function dateToYearMonth(date: Date): number {
  return date.getFullYear() * 100 + date.getMonth() + 1;
}

/**
 * Helper function to get the previous month, handling year boundaries
 */
export function getPreviousYearMonth(yearMonth: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (month === 1) {
    return (year - 1) * 100 + 12;
  }
  return yearMonth - 1;
}

/**
 * Helper function to get the next month, handling year boundaries
 */
export function getNextYearMonth(yearMonth: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (month === 12) {
    return (year + 1) * 100 + 1;
  }
  return yearMonth + 1;
}

/**
 * Convert yearMonth (YYYYMM number) to query parameter string
 */
export function yearMonthToQueryParam(yearMonth: number): string {
  return yearMonth.toString();
}

/**
 * Parse query parameter string to yearMonth (YYYYMM number)
 * Returns null if invalid
 */
export function queryParamToYearMonth(param: string | null): number | null {
  if (!param) return null;
  const parsed = parseInt(param, 10);
  if (isNaN(parsed)) return null;
  if (!validateYearMonth(parsed)) return null;
  return parsed;
}

/**
 * Format yearMonth (YYYYMM number) to display string (e.g., "November 2025")
 */
export function formatYearMonth(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  const date = new Date(year, month - 1, 1); // month is 0-indexed in Date constructor
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Validate yearMonth format (YYYYMM)
 * Must be a valid 6-digit number with month between 01-12 and year >= 1000
 */
export function validateYearMonth(yearMonth: number): boolean {
  // Check if it's a valid number
  if (isNaN(yearMonth) || yearMonth < 100000 || yearMonth > 999999) {
    return false;
  }

  // Extract month (last 2 digits)
  const month = yearMonth % 100;
  if (month < 1 || month > 12) {
    return false;
  }

  // Extract year (first 4 digits)
  const year = Math.floor(yearMonth / 100);
  if (year < 1000 || year > 9999) {
    return false;
  }

  return true;
}

/**
 * Get year from yearMonth (YYYYMM number)
 */
export function getYearFromYearMonth(yearMonth: number): number {
  return Math.floor(yearMonth / 100);
}

/**
 * Get month from yearMonth (YYYYMM number)
 * Returns 1-12
 */
export function getMonthFromYearMonth(yearMonth: number): number {
  return yearMonth % 100;
}

/**
 * Subtract N months from a yearMonth, handling year boundaries
 */
export function subtractMonths(yearMonth: number, count: number): number {
  let year = getYearFromYearMonth(yearMonth);
  let month = getMonthFromYearMonth(yearMonth);
  month -= count;
  while (month < 1) {
    month += 12;
    year--;
  }
  return year * 100 + month;
}

/**
 * Format yearMonth (YYYYMM number) to short month name + year (e.g., "Jan 2025")
 */
export function formatMonthShort(yearMonth: number): string {
  const year = getYearFromYearMonth(yearMonth);
  const month = getMonthFromYearMonth(yearMonth);
  const date = new Date(year, month - 1, 1); // month is 0-indexed in Date constructor
  const monthShort = date.toLocaleDateString('en-US', { month: 'short' });
  return `${monthShort} ${year}`;
}
