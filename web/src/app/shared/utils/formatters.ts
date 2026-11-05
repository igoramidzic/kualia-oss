/**
 * Formatting Utilities
 *
 * Common formatting functions for displaying data
 */

// Re-export currency formatters from shared package
export { formatCompactCurrency, formatCurrency } from '@kualia/shared/currency';

/**
 * Parse date string in yyyy-mm-dd format to Date object in local timezone
 * This prevents timezone shifts when displaying dates
 */
const parseDateString = (dateString: string): Date => {
  // Check if the date string is in yyyy-mm-dd format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  // For other formats, fallback to default Date parsing
  return new Date(dateString);
};

/**
 * Format date
 */
export const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions, locale = 'en-US'): string => {
  const dateObj = typeof date === 'string' ? parseDateString(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(dateObj);
};

/**
 * Format date to MM/DD/YYYY format
 */
export const formatDateMMDDYYYY = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseDateString(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(dateObj);
};

/**
 * Format relative time (e.g., "2 hours ago")
 */
export const formatRelativeTime = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseDateString(date) : date;
  const now = new Date();
  const diff = now.getTime() - dateObj.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
};

/**
 * Format file size
 */
export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

/**
 * Format phone number (US format)
 */
export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  const match = /^(\d{3})(\d{3})(\d{4})$/.exec(cleaned);

  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }

  return phone;
};

/**
 * Truncate text with ellipsis
 */
export const truncate = (text: string, maxLength: number, suffix = '...'): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Format month string (YYYYMM) to readable format
 */
export const formatMonth = (monthString: string): string => {
  if (monthString.length !== 6) return monthString;

  const year = monthString.substring(0, 4);
  const month = parseInt(monthString.substring(4, 6), 10);

  const date = new Date(parseInt(year), month - 1);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
};

/**
 * Parse currency input string to number
 * Handles various formats like "1,234.56", "$1234.56", etc.
 */
export const parseCurrencyInput = (input: string): number => {
  // Remove currency symbols and whitespace
  const cleaned = input.replace(/[$,\s]/g, '');

  // Handle empty or invalid input
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;

  // Parse the number
  const parsed = parseFloat(cleaned);

  // Return 0 for invalid numbers
  return isNaN(parsed) ? 0 : parsed;
};
