/**
 * Utility functions for merchant name handling
 */

/**
 * Standardize merchant name by removing common unwanted patterns
 * This function is used during merchant creation to ensure consistent naming
 * and reduce duplicate merchants.
 *
 * This differs from normalizeMerchantName in convex/categorization/helpers.ts:
 * - normalizeMerchantName: Used for fuzzy matching (less aggressive, preserves more info)
 * - standardizeMerchantName: Used for merchant creation (more aggressive, reduces duplicates)
 *
 * @param name - The raw merchant name to standardize
 * @returns The standardized merchant name (may be empty string if all content is removed)
 *
 * @example
 * standardizeMerchantName("Starbucks Inc Store #123") // => "starbucks"
 * standardizeMerchantName("SQ *Coffee Shop") // => "coffee shop"
 * standardizeMerchantName("Amazon.com LLC") // => "amazoncom"
 */
export function standardizeMerchantName(name: string): string {
  return (
    name
      .toLowerCase()
      // Remove common legal suffixes
      .replace(/\b(inc|llc|ltd|corp|corporation|company|co|b\.?v\.?|gmbh|s\.?a\.?|plc)\b\.?/gi, '')
      // Remove location identifiers (e.g., "Store #123", "Location 456")
      .replace(/\b(store|location|branch)\s*#?\d+/gi, '')
      // Remove transaction metadata patterns
      .replace(/\b(payment|purchase|pos|debit|credit|card)\b/gi, '')
      // Remove common payment processor patterns (e.g., "SQ *", "PP *")
      // Only matches if followed by asterisk and space to avoid false positives
      .replace(/^(sq|sp|pp|ach|etf|tst)\s*\*\s+/gi, '')
      // Remove dates in common formats
      .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, '')
      // Remove standalone numbers at the end
      .replace(/\s+\d+\s*$/g, '')
      // Remove punctuation except spaces
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}
