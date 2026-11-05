import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { standardizeMerchantName } from '../lib/merchantUtils';

/**
 * Result of a potential transaction match
 */
export interface MatchCandidate {
  manualTransactionId: Id<'transaction'>;
  confidence: number; // 0-100
  reason: string;
  matchFactors: {
    amountMatch: 'exact' | 'close' | 'different'; // Amount match type
    amountDifference: number; // Percentage difference (0-100)
    accountMatch: boolean;
    dateDelta: number; // days difference
    merchantSimilarity: number; // 0-1
  };
}

/**
 * Input parameters for finding a manual transaction match
 */
export interface MatchInput {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  amount: bigint;
  date: string;
  merchantName: string | undefined;
  /**
   * The raw Plaid import being matched. Optional — chat-import dedup uses this matcher too but has
   * no `transactionImportRaw` row, in which case the rejected-link guard is skipped.
   */
  rawTransactionId?: Id<'transactionImportRaw'>;
  rejectedLinkIds?: Id<'transactionImportRaw'>[];
}

/**
 * Cache for transaction matching to avoid repeated database queries.
 * Pre-loads all manual transactions and merchant names for the workspace.
 */
export interface TransactionMatchingCache {
  /** Manual transactions grouped by bank account ID */
  manualTransactionsByAccount: Map<Id<'bankAccount'>, Doc<'transaction'>[]>;
  /** Merchant names by merchant ID */
  merchantNames: Map<Id<'merchant'>, string>;
}

/**
 * Initialize the transaction matching cache for a workspace.
 * Call this once before processing multiple transactions.
 * Includes manual entries and entered planned transactions without an existing import.
 */
export async function initializeTransactionMatchingCache(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<TransactionMatchingCache> {
  // Entering a planned occurrence records source='scheduled', even when entered by the user.
  // It has already affected balances and must be linked just like a manual entry.
  const allManualTransactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) =>
      q.and(
        q.or(q.eq(q.field('source'), 'manual'), q.eq(q.field('source'), 'scheduled')),
        q.eq(q.field('isDeleted'), false),
        q.eq(q.field('type'), 'regular'),
        // Exclude transactions that already have a linked import
        q.eq(q.field('linkedRawTransactionId'), undefined),
        q.eq(q.field('transactionImportRawId'), undefined),
        q.eq(q.field('financeKitTransactionImportId'), undefined)
      )
    )
    .collect();

  // Group by bank account ID
  const manualTransactionsByAccount = new Map<Id<'bankAccount'>, Doc<'transaction'>[]>();
  for (const txn of allManualTransactions) {
    const existing = manualTransactionsByAccount.get(txn.bankAccountId) ?? [];
    existing.push(txn);
    manualTransactionsByAccount.set(txn.bankAccountId, existing);
  }

  // Collect all unique merchant IDs
  const merchantIds = new Set<Id<'merchant'>>();
  for (const txn of allManualTransactions) {
    if (txn.merchantId) {
      merchantIds.add(txn.merchantId);
    }
  }

  // Load all merchants and their names
  const merchantNames = new Map<Id<'merchant'>, string>();
  for (const merchantId of merchantIds) {
    const merchant = await ctx.db.get(merchantId);
    if (merchant) {
      // Resolve name from merchant or global merchant
      let name = merchant.name;
      if (!name && merchant.globalMerchantId) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        name = globalMerchant?.name;
      }
      if (name) {
        merchantNames.set(merchantId, name);
      }
    }
  }

  return {
    manualTransactionsByAccount,
    merchantNames,
  };
}

/**
 * Initialize the matching cache for a chat-file import. Unlike the Plaid path, chat-import dedup
 * matches incoming rows against ANY existing regular transaction on the chosen bank account
 * (manual entries, prior Plaid imports, prior chat imports), so the user doesn't get a duplicate
 * Starbucks just because they already typed it in or already uploaded last month's statement.
 */
export async function initializeChatImportMatchingCache(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  bankAccountId: Id<'bankAccount'>
): Promise<TransactionMatchingCache> {
  const transactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
      q.eq('workspaceId', workspaceId).eq('bankAccountId', bankAccountId).eq('isDeleted', false)
    )
    .filter((q) => q.eq(q.field('type'), 'regular'))
    .collect();

  const manualTransactionsByAccount = new Map<Id<'bankAccount'>, Doc<'transaction'>[]>();
  manualTransactionsByAccount.set(bankAccountId, transactions);

  const merchantIds = new Set<Id<'merchant'>>();
  for (const txn of transactions) {
    if (txn.merchantId) merchantIds.add(txn.merchantId);
  }

  const merchantNames = new Map<Id<'merchant'>, string>();
  for (const merchantId of merchantIds) {
    const merchant = await ctx.db.get(merchantId);
    if (!merchant) continue;
    let name = merchant.name;
    if (!name && merchant.globalMerchantId) {
      const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
      name = globalMerchant?.name;
    }
    if (name) merchantNames.set(merchantId, name);
  }

  return { manualTransactionsByAccount, merchantNames };
}

/**
 * Confidence scoring weights (NEW APPROACH)
 * Account is a critical gate (must match)
 * Amount, Date, and Merchant all contribute to confidence score
 * Amount no longer needs to match exactly - discrepancies trigger resolution UI
 */
const WEIGHTS = {
  amount: 40, // Exact match = 40pts, within 5% = 30pts, within 10% = 20pts, >10% diff = 0pts
  date: 30, // 0 days = 30pts, 1-3 days = 25pts, 4-7 days = 15pts, 8-14 days = 5pts
  merchant: 30, // Fuzzy match (word overlap)
};

/** Minimum confidence score to auto-link */
const CONFIDENCE_THRESHOLD = 65;

/** Maximum days apart for a potential match */
const MAX_DATE_DELTA_DAYS = 14;

/**
 * Find potential manual transaction match for an imported transaction.
 * Searches ALL manual transactions in the workspace for the given account.
 *
 * Matching criteria:
 * - Exact or similar amounts contribute up to 40 points
 * - Account must match (critical)
 * - Date must be within 14 days
 * - Merchant name similarity is a bonus
 *
 * Skips:
 * - Transfers
 * - Transactions with amount = 0
 * - Previously rejected links
 *
 * @deprecated Use findPotentialManualMatchWithCache for better performance when processing multiple transactions
 */
export async function findPotentialManualMatch(ctx: MutationCtx, input: MatchInput): Promise<MatchCandidate | null> {
  // Skip if amount is 0 (balance adjustments, etc.)
  if (input.amount === 0n) {
    return null;
  }

  // Query ALL manual transactions for this workspace and account
  // Exclude transactions that already have a linked import
  const manualTransactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
      q.eq('workspaceId', input.workspaceId).eq('bankAccountId', input.bankAccountId).eq('isDeleted', false)
    )
    .filter((q) =>
      q.and(
        q.or(q.eq(q.field('source'), 'manual'), q.eq(q.field('source'), 'scheduled')),
        q.eq(q.field('linkedRawTransactionId'), undefined),
        q.eq(q.field('transactionImportRawId'), undefined),
        q.eq(q.field('financeKitTransactionImportId'), undefined)
      )
    )
    .collect();

  if (manualTransactions.length === 0) {
    return null;
  }

  // Score each candidate
  // Rejection filtering is done inside calculateMatchScore
  const matches: MatchCandidate[] = [];

  for (const manual of manualTransactions) {
    const match = await calculateMatchScore(ctx, input, manual);
    if (match && match.confidence >= CONFIDENCE_THRESHOLD) {
      matches.push(match);
    }
  }

  // Return highest confidence match
  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches[0];
}

/**
 * Find potential manual transaction match using cached data.
 * This is the preferred method when processing multiple transactions in a batch.
 *
 * @param input - Match input parameters
 * @param cache - Pre-loaded cache of manual transactions and merchant names
 * @returns Best match candidate or null if no match found
 */
export function findPotentialManualMatchWithCache(
  input: MatchInput,
  cache: TransactionMatchingCache
): MatchCandidate | null {
  // Skip if amount is 0 (balance adjustments, etc.)
  if (input.amount === 0n) {
    return null;
  }

  // Get manual transactions for this bank account from cache
  const manualTransactions = cache.manualTransactionsByAccount.get(input.bankAccountId) ?? [];

  if (manualTransactions.length === 0) {
    return null;
  }

  // Score each candidate using cached merchant names
  // Rejection filtering is done inside calculateMatchScoreWithCache
  const matches: MatchCandidate[] = [];

  for (const manual of manualTransactions) {
    const match = calculateMatchScoreWithCache(input, manual, cache.merchantNames);
    if (match && match.confidence >= CONFIDENCE_THRESHOLD) {
      matches.push(match);
    }
  }

  // Return highest confidence match
  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches[0];
}

/**
 * Calculate match score between imported transaction and a manual transaction.
 * Returns null if the manual transaction should be skipped or doesn't meet criteria.
 *
 * NEW APPROACH: Amount no longer needs to match exactly.
 * Discrepancies are allowed and will trigger the resolution UI.
 */
async function calculateMatchScore(
  ctx: MutationCtx,
  imported: MatchInput,
  manual: Doc<'transaction'>
): Promise<MatchCandidate | null> {
  let score = 0;
  const factors: MatchCandidate['matchFactors'] = {
    amountMatch: 'different',
    amountDifference: 0,
    accountMatch: true, // Already filtered by account in query
    dateDelta: 0,
    merchantSimilarity: 0,
  };

  // Skip transfers
  if (manual.type === 'transfer') {
    return null;
  }

  // Skip non-regular transactions (starting_balance, balance_adjustment)
  if (manual.type !== 'regular') {
    return null;
  }

  // Skip if manual transaction has rejected this raw import (Plaid path only)
  if (imported.rawTransactionId && manual.rejectedLinkIds?.includes(imported.rawTransactionId)) {
    return null;
  }

  // Amount scoring (graduated - no longer a critical gate)
  const manualAmount = manual.totalAmount ?? 0n;
  const importedAmount = imported.amount;

  // Calculate percentage difference
  const absManual = manualAmount < 0n ? -manualAmount : manualAmount;
  const absImported = importedAmount < 0n ? -importedAmount : importedAmount;
  const maxAmount = absManual > absImported ? absManual : absImported;

  let amountDiffPercent = 0;
  if (maxAmount > 0n) {
    const diff = manualAmount > importedAmount ? manualAmount - importedAmount : importedAmount - manualAmount;
    const absDiff = diff < 0n ? -diff : diff;
    amountDiffPercent = Number((absDiff * 100n) / maxAmount);
  }
  factors.amountDifference = amountDiffPercent;

  // Score based on amount similarity
  if (importedAmount === manualAmount) {
    score += WEIGHTS.amount; // Full 40 points for exact match
    factors.amountMatch = 'exact';
  } else if (amountDiffPercent <= 5) {
    score += Math.round(WEIGHTS.amount * 0.75); // 30 points for within 5%
    factors.amountMatch = 'close';
  } else if (amountDiffPercent <= 10) {
    score += Math.round(WEIGHTS.amount * 0.5); // 20 points for within 10%
    factors.amountMatch = 'close';
  } else {
    // >10% difference - no amount points, but still consider for matching
    factors.amountMatch = 'different';
  }

  // Date within window (graduated scoring) - still a critical gate
  const daysDiff = daysBetween(imported.date, manual.date);
  factors.dateDelta = daysDiff;

  if (daysDiff > MAX_DATE_DELTA_DAYS) {
    return null; // Too far apart - hard gate
  }

  // Graduated date scoring per plan
  if (daysDiff === 0) {
    score += WEIGHTS.date; // Full 30 points for same day
  } else if (daysDiff <= 3) {
    score += Math.round(WEIGHTS.date * 0.83); // ~25 points for 1-3 days
  } else if (daysDiff <= 7) {
    score += Math.round(WEIGHTS.date * 0.5); // 15 points for 4-7 days
  } else {
    score += Math.round(WEIGHTS.date * 0.17); // ~5 points for 8-14 days
  }

  // Merchant similarity
  const manualMerchantName = await resolveMerchantName(ctx, manual.merchantId);
  const merchantScore = calculateMerchantSimilarity(imported.merchantName ?? '', manualMerchantName ?? '');
  factors.merchantSimilarity = merchantScore;
  score += Math.round(merchantScore * WEIGHTS.merchant);

  return {
    manualTransactionId: manual._id,
    confidence: Math.min(100, score),
    reason: buildMatchReason(factors),
    matchFactors: factors,
  };
}

/**
 * Calculate match score using cached merchant names (no database calls).
 * This is the synchronous version for batch processing.
 *
 * NEW APPROACH: Amount no longer needs to match exactly.
 * Discrepancies are allowed and will trigger the resolution UI.
 */
function calculateMatchScoreWithCache(
  imported: MatchInput,
  manual: Doc<'transaction'>,
  merchantNames: Map<Id<'merchant'>, string>
): MatchCandidate | null {
  let score = 0;
  const factors: MatchCandidate['matchFactors'] = {
    amountMatch: 'different',
    amountDifference: 0,
    accountMatch: true, // Already filtered by account in the cache
    dateDelta: 0,
    merchantSimilarity: 0,
  };

  // Skip transfers
  if (manual.type === 'transfer') {
    return null;
  }

  // Skip non-regular transactions (starting_balance, balance_adjustment)
  if (manual.type !== 'regular') {
    return null;
  }

  // Skip if manual transaction has rejected this raw import (Plaid path only)
  if (imported.rawTransactionId && manual.rejectedLinkIds?.includes(imported.rawTransactionId)) {
    return null;
  }

  // Amount scoring (graduated - no longer a critical gate)
  const manualAmount = manual.totalAmount ?? 0n;
  const importedAmount = imported.amount;

  // Calculate percentage difference
  const absManual = manualAmount < 0n ? -manualAmount : manualAmount;
  const absImported = importedAmount < 0n ? -importedAmount : importedAmount;
  const maxAmount = absManual > absImported ? absManual : absImported;

  let amountDiffPercent = 0;
  if (maxAmount > 0n) {
    const diff = manualAmount > importedAmount ? manualAmount - importedAmount : importedAmount - manualAmount;
    const absDiff = diff < 0n ? -diff : diff;
    amountDiffPercent = Number((absDiff * 100n) / maxAmount);
  }
  factors.amountDifference = amountDiffPercent;

  // Score based on amount similarity
  if (importedAmount === manualAmount) {
    score += WEIGHTS.amount; // Full 40 points for exact match
    factors.amountMatch = 'exact';
  } else if (amountDiffPercent <= 5) {
    score += Math.round(WEIGHTS.amount * 0.75); // 30 points for within 5%
    factors.amountMatch = 'close';
  } else if (amountDiffPercent <= 10) {
    score += Math.round(WEIGHTS.amount * 0.5); // 20 points for within 10%
    factors.amountMatch = 'close';
  } else {
    // >10% difference - no amount points, but still consider for matching
    factors.amountMatch = 'different';
  }

  // Date within window (graduated scoring) - still a critical gate
  const daysDiff = daysBetween(imported.date, manual.date);
  factors.dateDelta = daysDiff;

  if (daysDiff > MAX_DATE_DELTA_DAYS) {
    return null; // Too far apart - hard gate
  }

  // Graduated date scoring per plan
  if (daysDiff === 0) {
    score += WEIGHTS.date; // Full 30 points for same day
  } else if (daysDiff <= 3) {
    score += Math.round(WEIGHTS.date * 0.83); // ~25 points for 1-3 days
  } else if (daysDiff <= 7) {
    score += Math.round(WEIGHTS.date * 0.5); // 15 points for 4-7 days
  } else {
    score += Math.round(WEIGHTS.date * 0.17); // ~5 points for 8-14 days
  }

  // Merchant similarity - use cached merchant name
  const manualMerchantName = manual.merchantId ? merchantNames.get(manual.merchantId) : null;
  const merchantScore = calculateMerchantSimilarity(imported.merchantName ?? '', manualMerchantName ?? '');
  factors.merchantSimilarity = merchantScore;
  score += Math.round(merchantScore * WEIGHTS.merchant);

  return {
    manualTransactionId: manual._id,
    confidence: Math.min(100, score),
    reason: buildMatchReason(factors),
    matchFactors: factors,
  };
}

/**
 * Calculate days between two dates (absolute value)
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Resolve merchant name from merchant ID
 */
async function resolveMerchantName(ctx: MutationCtx, merchantId: Id<'merchant'> | undefined): Promise<string | null> {
  if (!merchantId) {
    return null;
  }

  const merchant = await ctx.db.get(merchantId);
  return merchant?.name ?? null;
}

/**
 * Calculate similarity between two merchant names.
 * Returns a score from 0 to 1.
 */
function calculateMerchantSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) {
    return 0;
  }

  // Standardize names for comparison
  const n1 = standardizeMerchantName(name1);
  const n2 = standardizeMerchantName(name2);

  // Empty after standardization
  if (!n1 || !n2) {
    return 0;
  }

  // Exact match after standardization
  if (n1 === n2) {
    return 1.0;
  }

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) {
    return 0.8;
  }

  // Word overlap (Jaccard similarity)
  const words1 = new Set(n1.split(/\s+/).filter((w) => w.length > 2));
  const words2 = new Set(n2.split(/\s+/).filter((w) => w.length > 2));

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  const intersection = [...words1].filter((w) => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

/**
 * Build a human-readable reason for the match
 */
function buildMatchReason(factors: MatchCandidate['matchFactors']): string {
  const parts: string[] = [];

  // Amount description
  if (factors.amountMatch === 'exact') {
    parts.push('Amount matches');
  } else if (factors.amountMatch === 'close') {
    parts.push(`Amount similar (${factors.amountDifference}% diff)`);
  } else {
    parts.push(`Amount differs (${factors.amountDifference}% diff)`);
  }

  // Date description
  if (factors.dateDelta === 0) {
    parts.push('same date');
  } else if (factors.dateDelta === 1) {
    parts.push('1 day apart');
  } else {
    parts.push(`${factors.dateDelta} days apart`);
  }

  // Merchant description
  if (factors.merchantSimilarity >= 0.8) {
    parts.push('same payee');
  } else if (factors.merchantSimilarity >= 0.5) {
    parts.push('similar payee');
  }

  return parts.join(', ');
}
