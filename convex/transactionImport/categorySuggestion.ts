import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { standardizeMerchantName } from '../lib/merchantUtils';

/**
 * Context for category suggestion.
 */
export interface TransactionContext {
  merchantName?: string;
  originalStatement?: string;
  amount: bigint;
  plaidCategory: string[];
  date?: string;
  bankAccountId?: Id<'bankAccount'>;
}

/**
 * Result of category suggestion
 */
export interface CategorySuggestionResult {
  categoryId: Id<'category'> | undefined;
  categoryName?: string;
  confidence?: number;
  matchType?:
    | 'merchant_mapping'
    | 'merchant_suggestion'
    | 'history_merchant'
    | 'history_statement'
    | 'no_history'
    | 'low_confidence'
    | 'rule_applied'
    | 'transfer_detected';
}

/**
 * Internal structure for tracking historical matches
 */
interface HistoricalMatch {
  categoryId: Id<'category'>;
  date: string;
  matchType: 'merchant_name' | 'original_statement';
  recencyScore: number;
}

/**
 * Internal structure for aggregating category votes
 */
interface CategoryVote {
  categoryId: Id<'category'>;
  votes: number;
  weightedVotes: number;
}

/**
 * Pre-processed historical transaction data for efficient batch lookups
 */
interface HistoricalTransactionData {
  standardizedMerchantName: string;
  originalStatement: string | undefined;
  categoryId: Id<'category'>;
  date: string;
  amountDirection: 'positive' | 'negative';
}

/**
 * Cache for batch category suggestions to avoid repeated queries
 */
export interface CategorySuggestionCache {
  eligibleCategories: Doc<'category'>[];
  eligibleCategoryIds: Set<string>;
  historicalData: HistoricalTransactionData[];
  mappingCache: Map<string, CategorySuggestionResult | null>;
  /** Map of standardized merchant name → suggestedCategoryIds (from user's previous categorizations) */
  merchantSuggestionCache: Map<string, Id<'category'>[]>;
}

/** Confidence threshold for using history-based prediction */
const CONFIDENCE_THRESHOLD = 0.7;

/** Maximum number of historical transactions to load for batch processing */
const MAX_HISTORY_TRANSACTIONS = 200;

/**
 * Calculate recency score using exponential decay.
 * Returns 1.0 for today, ~0.5 at 90 days, ~0.25 at 180 days.
 */
function calculateRecencyScore(dateStr: string, nowTimestamp: number): number {
  const txTime = new Date(dateStr).getTime();
  const daysDiff = (nowTimestamp - txTime) / (1000 * 60 * 60 * 24);
  // Exponential decay with half-life around 90 days
  return Math.exp(-daysDiff / 130);
}

/**
 * Aggregate matches into category votes, sorted by weighted votes (descending).
 */
function aggregateVotes(matches: HistoricalMatch[]): CategoryVote[] {
  const voteMap = new Map<string, CategoryVote>();

  for (const match of matches) {
    const key = match.categoryId;
    const existing = voteMap.get(key);
    if (existing) {
      existing.votes++;
      existing.weightedVotes += match.recencyScore;
    } else {
      voteMap.set(key, {
        categoryId: match.categoryId,
        votes: 1,
        weightedVotes: match.recencyScore,
      });
    }
  }

  return Array.from(voteMap.values()).sort((a, b) => b.weightedVotes - a.weightedVotes);
}

/**
 * Calculate confidence score based on consistency, recency, and volume.
 * Formula: (consistencyRatio * 0.6) + (recencyBonus * 0.2) + (volumeConfidence * 0.2)
 */
function calculateConfidence(totalMatches: number, topVote: CategoryVote): number {
  if (totalMatches === 0) return 0;

  // Consistency: how often the same category is used
  const consistencyRatio = topVote.votes / totalMatches;

  // Recency: average recency score for this category
  const recencyBonus = topVote.weightedVotes / topVote.votes;

  // Volume: more data = more confidence (max out at 10 matches)
  const volumeConfidence = Math.min(1, totalMatches / 10);

  // Combined score
  const confidence = consistencyRatio * 0.6 + recencyBonus * 0.2 + volumeConfidence * 0.2;

  return Math.round(confidence * 100) / 100;
}

/**
 * Get eligible categories for suggestion:
 * - categoryType === 'custom' (or undefined, which defaults to custom)
 * - In expense group (categoryGroup.type === 'expense')
 * - Not deleted
 */
async function getEligibleCategoriesForSuggestion(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<Doc<'category'>[]> {
  // Get expense-type groups
  const expenseGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId_type', (q) => q.eq('workspaceId', workspaceId).eq('type', 'expense'))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const expenseGroupIds = new Set(expenseGroups.map((g) => g._id));

  // Get all categories for this workspace
  const categories = await ctx.db
    .query('category')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  // Filter: custom type + in expense group
  return categories.filter((c) => {
    const isCustom = !c.categoryType || c.categoryType === 'custom';
    const inExpenseGroup = expenseGroupIds.has(c.categoryGroupId);
    return isCustom && inExpenseGroup && !c.isArchived;
  });
}

/**
 * Initialize a cache for batch category suggestions.
 * Call this once at the start of a batch import, then pass the cache to suggestCategoryForTransactionWithCache.
 */
export async function initializeCategorySuggestionCache(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<CategorySuggestionCache> {
  // Load eligible categories
  const eligibleCategories = await getEligibleCategoriesForSuggestion(ctx, workspaceId);
  const eligibleCategoryIds = new Set(eligibleCategories.map((c) => c._id));

  // Load historical reviewed transactions once
  const reviewedTransactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
      q.eq('workspaceId', workspaceId).eq('reviewStatus', 'reviewed').eq('isDeleted', false)
    )
    .order('desc')
    .take(MAX_HISTORY_TRANSACTIONS);

  // Pre-process historical data for efficient lookups
  const historicalData: HistoricalTransactionData[] = [];

  for (const tx of reviewedTransactions) {
    const txMerchantName = tx.importDetails?.merchantName;
    if (!txMerchantName) continue;

    const standardizedName = standardizeMerchantName(txMerchantName);
    if (!standardizedName) continue;

    // Get first categorized movement from eligible categories
    const categorizedMovement = tx.movements?.find((m) => m.categoryId && eligibleCategoryIds.has(m.categoryId));
    if (!categorizedMovement?.categoryId) continue;

    const txAmount = tx.totalAmount ?? 0n;
    const amountDirection: 'positive' | 'negative' = txAmount >= 0n ? 'positive' : 'negative';

    historicalData.push({
      standardizedMerchantName: standardizedName,
      originalStatement: tx.importDetails?.originalStatement?.toLowerCase(),
      categoryId: categorizedMovement.categoryId,
      date: tx.date,
      amountDirection,
    });
  }

  // Build merchant suggestion cache from merchants with user's previous categorizations
  const merchantSuggestionCache = new Map<string, Id<'category'>[]>();
  const merchantsWithSuggestions = await ctx.db
    .query('merchant')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  for (const merchant of merchantsWithSuggestions) {
    // Skip merchants without suggestions
    if (!merchant.suggestedCategoryIds || merchant.suggestedCategoryIds.length === 0) continue;

    // Resolve merchant name (check globalMerchantId if local name is empty)
    let merchantName = merchant.name;
    if (!merchantName && merchant.globalMerchantId) {
      const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
      merchantName = globalMerchant?.name;
    }
    if (!merchantName) continue;

    const standardizedName = standardizeMerchantName(merchantName);
    if (!standardizedName) continue;

    // Store the suggestion array (most recent first)
    merchantSuggestionCache.set(standardizedName, merchant.suggestedCategoryIds);
  }

  return {
    eligibleCategories,
    eligibleCategoryIds,
    historicalData,
    mappingCache: new Map(),
    merchantSuggestionCache,
  };
}

/**
 * Check orgMerchantCategoryMapping for an existing high-confidence mapping.
 * Uses the cache to avoid repeated lookups for the same merchant.
 */
async function lookupMerchantMapping(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  standardizedName: string,
  amountDirection: 'positive' | 'negative',
  cache: CategorySuggestionCache
): Promise<CategorySuggestionResult | null> {
  const cacheKey = `${standardizedName}|${amountDirection}`;

  // Check cache first
  if (cache.mappingCache.has(cacheKey)) {
    return cache.mappingCache.get(cacheKey) ?? null;
  }

  const mapping = await ctx.db
    .query('orgMerchantCategoryMapping')
    .withIndex('by_workspaceId_merchantName_amountDirection', (q) =>
      q.eq('workspaceId', workspaceId).eq('merchantName', standardizedName).eq('amountDirection', amountDirection)
    )
    .first();

  // Skip if no mapping, mapping failed, or no category assigned
  if (!mapping || mapping.categorizationFailed || !mapping.categoryId) {
    cache.mappingCache.set(cacheKey, null);
    return null;
  }

  // Inflows without user categorization default to Ready to Assign. A model's
  // expense-category guess (including older saved guesses) must not override that.
  if (amountDirection === 'positive' && mapping.source !== 'manual') {
    cache.mappingCache.set(cacheKey, null);
    return null;
  }

  // Verify the category still exists and is not deleted or archived
  const category = await ctx.db.get(mapping.categoryId);
  if (!category || category.workspaceId !== workspaceId || category.isDeleted || category.isArchived) {
    cache.mappingCache.set(cacheKey, null);
    return null;
  }

  const result: CategorySuggestionResult = {
    categoryId: mapping.categoryId,
    categoryName: category.name,
    confidence: mapping.confidence ?? 1.0,
    matchType: 'merchant_mapping',
  };

  cache.mappingCache.set(cacheKey, result);
  return result;
}

/**
 * Look up category suggestion from merchant's suggestedCategoryIds (user's previous categorizations).
 * Only applies to expenses: this directionless list must not categorize income as spending.
 * Returns the first valid (non-deleted) category from the suggestions.
 */
function lookupMerchantSuggestion(
  standardizedName: string,
  amountDirection: 'positive' | 'negative',
  cache: CategorySuggestionCache
): CategorySuggestionResult | null {
  // Inflows can use direction-specific manual mappings or reviewed history instead.
  if (amountDirection !== 'negative') {
    return null;
  }

  const suggestedCategoryIds = cache.merchantSuggestionCache.get(standardizedName);
  if (!suggestedCategoryIds || suggestedCategoryIds.length === 0) {
    return null;
  }

  // Find first valid (non-deleted) category from suggestions
  for (const categoryId of suggestedCategoryIds) {
    // Use the pre-loaded eligibleCategoryIds Set for O(1) validation
    if (cache.eligibleCategoryIds.has(categoryId)) {
      const category = cache.eligibleCategories.find((c) => c._id === categoryId);
      if (category) {
        return {
          categoryId,
          categoryName: category.name,
          confidence: 0.95,
          matchType: 'merchant_suggestion',
        };
      }
    }
  }

  // No valid suggestions found
  return null;
}

/**
 * Predict category from pre-loaded historical data (no DB queries).
 */
function predictFromHistoryWithCache(
  standardizedMerchantName: string,
  originalStatement: string | undefined,
  amountDirection: 'positive' | 'negative',
  cache: CategorySuggestionCache
): CategorySuggestionResult {
  const matches: HistoricalMatch[] = [];
  const now = Date.now();
  const queryStatement = originalStatement?.toLowerCase();

  for (const histTx of cache.historicalData) {
    // Check amount direction
    if (histTx.amountDirection !== amountDirection) continue;

    // Check merchant name match
    if (histTx.standardizedMerchantName === standardizedMerchantName) {
      matches.push({
        categoryId: histTx.categoryId,
        date: histTx.date,
        matchType: 'merchant_name',
        recencyScore: calculateRecencyScore(histTx.date, now),
      });
      continue;
    }

    // Check original statement match (fallback)
    if (queryStatement && histTx.originalStatement && histTx.originalStatement === queryStatement) {
      matches.push({
        categoryId: histTx.categoryId,
        date: histTx.date,
        matchType: 'original_statement',
        recencyScore: calculateRecencyScore(histTx.date, now),
      });
    }
  }

  // No matches found
  if (matches.length === 0) {
    return { categoryId: undefined, matchType: 'no_history', confidence: 0 };
  }

  // Aggregate votes and calculate confidence
  const categoryVotes = aggregateVotes(matches);
  const topCategory = categoryVotes[0];
  const confidence = calculateConfidence(matches.length, topCategory);

  // If confidence is below threshold, don't suggest
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { categoryId: undefined, matchType: 'low_confidence', confidence };
  }

  // Find the category name
  const category = cache.eligibleCategories.find((c) => c._id === topCategory.categoryId);
  if (!category) {
    return { categoryId: undefined, matchType: 'no_history', confidence: 0 };
  }

  // Determine match type based on primary match source
  const primaryMatchType = matches.find((m) => m.categoryId === topCategory.categoryId)?.matchType;

  return {
    categoryId: topCategory.categoryId,
    categoryName: category.name,
    confidence,
    matchType: primaryMatchType === 'merchant_name' ? 'history_merchant' : 'history_statement',
  };
}

/**
 * Suggest a category for a transaction during batch import.
 * Uses a pre-initialized cache to avoid repeated database queries.
 *
 * @param ctx - Mutation context for database access
 * @param workspaceId - The workspace to get categories from
 * @param transactionContext - Information about the transaction
 * @param cache - Pre-initialized cache from initializeCategorySuggestionCache
 * @returns CategorySuggestionResult with suggested categoryId (or undefined if low confidence)
 */
export async function suggestCategoryForTransactionWithCache(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionContext: TransactionContext,
  cache: CategorySuggestionCache
): Promise<CategorySuggestionResult> {
  if (cache.eligibleCategories.length === 0) {
    return { categoryId: undefined };
  }

  // Standardize merchant name
  const rawMerchantName = transactionContext.merchantName ?? transactionContext.originalStatement;
  if (!rawMerchantName) {
    return { categoryId: undefined, matchType: 'no_history', confidence: 0 };
  }

  const standardizedName = standardizeMerchantName(rawMerchantName);
  if (!standardizedName) {
    return { categoryId: undefined, matchType: 'no_history', confidence: 0 };
  }

  const amountDirection = transactionContext.amount >= 0n ? 'positive' : 'negative';

  // Step 1: Check merchant suggestions (user's previous categorizations).
  // For expenses, the merchant's ordered suggestion list is the user's latest intent and
  // should beat older LLM/manual mappings.
  const suggestionResult = lookupMerchantSuggestion(standardizedName, amountDirection, cache);
  if (suggestionResult) {
    return suggestionResult;
  }

  // Step 2: Check existing mapping (uses cache for repeated lookups)
  const mappingResult = await lookupMerchantMapping(ctx, workspaceId, standardizedName, amountDirection, cache);
  if (mappingResult) {
    return mappingResult;
  }

  // Step 3: Predict from cached historical data (no DB queries)
  const historyResult = predictFromHistoryWithCache(
    standardizedName,
    transactionContext.originalStatement,
    amountDirection,
    cache
  );

  return historyResult;
}

/**
 * Suggest a category for a transaction during import (single transaction version).
 * For batch imports, use initializeCategorySuggestionCache + suggestCategoryForTransactionWithCache instead.
 *
 * @param ctx - Mutation context for database access
 * @param workspaceId - The workspace to get categories from
 * @param transactionContext - Information about the transaction
 * @returns CategorySuggestionResult with suggested categoryId (or undefined if low confidence)
 */
export async function suggestCategoryForTransaction(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionContext: TransactionContext
): Promise<CategorySuggestionResult> {
  // For single transactions, create a temporary cache
  const cache = await initializeCategorySuggestionCache(ctx, workspaceId);
  return suggestCategoryForTransactionWithCache(ctx, workspaceId, transactionContext, cache);
}
