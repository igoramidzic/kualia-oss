import { standardizeMerchantName } from './merchantUtils';

/**
 * Deterministic dedup key for chat-imported transactions. Two rows from the same bank account that
 * resolve to the same fingerprint are treated as the same transaction (e.g. the user uploaded the
 * same bank statement twice). Account scoping lives in the index, not the key.
 *
 * Format: `${date}|${amount}|${standardizedMerchant}` — pipe-separated to keep lookups trivially
 * debuggable in the dashboard. Empty merchant produces a trailing pipe, which is fine.
 */
export function buildImportFingerprint(input: {
  date: string;
  amount: bigint;
  merchantName: string | undefined;
}): string {
  const standardized = standardizeMerchantName(input.merchantName ?? '');
  return `${input.date}|${input.amount.toString()}|${standardized}`;
}
