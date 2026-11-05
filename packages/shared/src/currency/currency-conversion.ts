/**
 * Currency conversion utilities for handling base units (e.g., cents) to display units (e.g., dollars)
 */

import { getCurrencyFormat } from './currency-format';

/**
 * Get the number of decimal places for a currency
 */
export function getCurrencyDecimals(currencyCode: string): number {
  const format = getCurrencyFormat(currencyCode);
  return format.decimalPlaces;
}

/**
 * Convert from base units (e.g., cents) to display units (e.g., dollars)
 * @param amount Amount in base units (smallest unit of currency)
 * @param currencyCode ISO currency code
 * @returns Amount in display units
 */
export function fromBaseUnits(amount: number | bigint, currencyCode: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  // Convert BigInt to number safely
  const numAmount = typeof amount === 'bigint' ? Number(amount) : amount;
  if (decimals === 0) {
    return numAmount; // No conversion needed for currencies without decimals
  }
  return numAmount / Math.pow(10, decimals);
}

/**
 * Convert from display units (e.g., dollars) to base units (e.g., cents)
 * @param amount Amount in display units
 * @param currencyCode ISO currency code
 * @returns Amount in base units (smallest unit of currency)
 */
export function toBaseUnits(amount: number, currencyCode: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  if (decimals === 0) {
    return Math.round(amount); // Round to ensure integer for non-decimal currencies
  }
  return Math.round(amount * Math.pow(10, decimals));
}

/**
 * Check if a currency has decimal places
 */
export function hasDecimals(currencyCode: string): boolean {
  return getCurrencyDecimals(currencyCode) > 0;
}

/**
 * Get the currency minor unit multiplier (e.g., 100 for USD, 1 for JPY)
 */
export function getCurrencyMultiplier(currencyCode: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  return Math.pow(10, decimals);
}
