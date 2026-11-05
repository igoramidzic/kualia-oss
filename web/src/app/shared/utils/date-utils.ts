/**
 * Formats a date string for display, handling timezone issues properly
 * @param dateString - ISO date string (e.g., "2025-09-11" or "2025-09-11T00:00:00")
 * @returns Formatted date string (e.g., "Sep 11, 2025")
 */
export function formatDateForDisplay(dateString: string | null): string {
  if (!dateString) return 'N/A';

  // Parse the date string as local time to avoid timezone issues
  // Split the date string and create date with local timezone
  const datePart = dateString.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };

  return date.toLocaleDateString('en-US', options);
}

/**
 * Formats a date string with time for display
 * @param dateString - ISO datetime string
 * @returns Formatted datetime string
 */
export function formatDateTimeForDisplay(dateString: string | null): string {
  if (!dateString) return 'N/A';

  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  return date.toLocaleDateString('en-US', options);
}

/**
 * Returns a human-readable time ago string
 * @param dateString - ISO datetime string
 * @returns Time ago string (e.g., "5 minutes ago", "2 hours ago")
 */
export function getTimeAgo(dateString: string | null): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) {
    return 'Just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Convert a number to its ordinal form (1st, 2nd, 3rd, etc.)
 * @param n - Number to convert
 * @returns Ordinal string (e.g., "1st", "2nd", "3rd", "21st")
 */
export function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Format a Date to YYYY-MM-DD string
 * @param date - Date object
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateToString(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((part) => part.type === type)?.value ?? '';
      return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      // Fall back to device-local dates for a missing or invalid workspace timezone.
    }
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
