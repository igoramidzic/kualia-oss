/**
 * High-level currency formatting utilities
 *
 * These functions work with base units (e.g., cents) and handle conversion automatically
 */

import { fromBaseUnits } from './currency-conversion';
import { formatCurrencyDisplay } from './currency-format';

/**
 * Format currency from base units (e.g., cents)
 * @param amountInBaseUnits Amount in base units (e.g., cents)
 * @param currency Currency code (default: USD)
 * @returns Formatted currency string
 */
export function formatCurrency(amountInBaseUnits: number | bigint, currency = 'USD'): string {
  // Convert from base units (e.g., cents) to display units (e.g., dollars)
  const amountInDisplayUnits = fromBaseUnits(amountInBaseUnits, currency);
  return formatCurrencyDisplay(amountInDisplayUnits, currency);
}

/**
 * Format currency in compact notation (e.g., $1.2k, $3.5M)
 * @param amountInBaseUnits Amount in base units (e.g., cents)
 * @param currency Currency code (default: USD)
 * @returns Formatted currency string in compact notation
 */
export function formatCompactCurrency(amountInBaseUnits: number | bigint, currency = 'USD'): string {
  // Convert from base units to display units
  const amountInDisplayUnits = Math.abs(fromBaseUnits(amountInBaseUnits, currency));
  const isNegative = typeof amountInBaseUnits === 'bigint' ? amountInBaseUnits < 0n : amountInBaseUnits < 0;

  let compactValue: string;
  let suffix = '';

  if (amountInDisplayUnits >= 1_000_000) {
    compactValue = (amountInDisplayUnits / 1_000_000).toFixed(1);
    suffix = 'M';
    // Remove unnecessary decimal if it's .0
    if (compactValue.endsWith('.0')) {
      compactValue = compactValue.slice(0, -2);
    }
  } else if (amountInDisplayUnits >= 10_000) {
    // For 10k and above, show as Xk with no decimals
    compactValue = Math.round(amountInDisplayUnits / 1_000).toString();
    suffix = 'k';
  } else if (amountInDisplayUnits >= 1_000) {
    // For 1k-9.9k, show one decimal if needed
    const rounded = amountInDisplayUnits / 1_000;
    compactValue = rounded >= 10 ? Math.round(rounded).toString() : rounded.toFixed(1);
    suffix = 'k';
    // Remove unnecessary .0
    if (compactValue.endsWith('.0')) {
      compactValue = compactValue.slice(0, -2);
    }
  } else {
    // For values less than 1000, show full amount without decimals
    compactValue = Math.round(amountInDisplayUnits).toString();
  }

  // Get currency symbol using a more reliable method
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Extract the currency symbol from a formatted zero
  const formatted = currencyFormatter.format(0);
  const symbol = formatted.replace(/[0-9]/g, '').trim();

  // Construct the formatted string with negative sign before currency symbol
  if (isNegative) {
    return `-${symbol}${compactValue}${suffix}`;
  }
  return `${symbol}${compactValue}${suffix}`;
}
