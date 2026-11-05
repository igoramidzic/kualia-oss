import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import type { EmbeddedMovement } from '../transactions/types';

export const SORT_ORDER_GAP = 100; // Gap between items (0, 100, 200, 300...)
export const MIN_GAP_THRESHOLD = 10; // Restructure when gap < 10

/**
 * Calculate a sortOrder value between two existing values
 */
export function calculateSortOrderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) {
    return 0;
  }
  if (prev === null) {
    // Insert before first item (allow negative values for correct ordering)
    return next! - SORT_ORDER_GAP;
  }
  if (next === null) {
    // Insert after last item
    return prev + SORT_ORDER_GAP;
  }
  // Insert between two items
  const gap = next - prev;
  if (gap < MIN_GAP_THRESHOLD) {
    // Gap too small, return midpoint (will trigger restructuring)
    return Math.floor((prev + next) / 2);
  }
  return Math.floor((prev + next) / 2);
}

/**
 * Restructure sortOrder values for categories in a group
 * Renumbers all categories with gaps of SORT_ORDER_GAP
 */
export async function restructureCategorySortOrders(
  ctx: MutationCtx,
  categoryGroupId: Id<'categoryGroup'>
): Promise<void> {
  const categories = await ctx.db
    .query('category')
    .withIndex('by_categoryGroupId_sortOrder', (q) => q.eq('categoryGroupId', categoryGroupId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  // Sort by current sortOrder
  const sortedCategories = categories.sort((a, b) => a.sortOrder - b.sortOrder);

  // Renumber with gaps
  const timestamp = new Date().toISOString();
  for (let i = 0; i < sortedCategories.length; i++) {
    await ctx.db.patch(sortedCategories[i]._id, {
      sortOrder: i * SORT_ORDER_GAP,
      updatedAt: timestamp,
    });
  }
}

/**
 * Helper function to enrich a category with its type from the category group
 */
export async function enrichCategoryWithType(
  ctx: QueryCtx,
  category: Doc<'category'>
): Promise<Doc<'category'> & { type: 'expense' | 'credit_card' }> {
  const group = await ctx.db.get(category.categoryGroupId);
  if (!group) {
    // If group not found, default to expense
    return { ...category, type: 'expense' as const };
  }

  return { ...category, type: group.type };
}

/**
 * Helper function to get the iconName for a category.
 * Hardcodes "CreditCard" icon for credit card categories.
 */
export function getCategoryIconName(
  category: Doc<'category'>,
  groupType: 'expense' | 'credit_card' | undefined
): string | undefined {
  // Check if this is a credit card category
  const isCreditCard = category.categoryType === 'credit_card' || groupType === 'credit_card';

  if (isCreditCard) {
    return 'CreditCard';
  }

  // Return the stored iconName for non-credit-card categories
  return category.iconName;
}

/**
 * Helper function to get category with stats
 * Returns monthly spending and assignment data from aggregated tables
 */
export async function enrichCategoryWithStats(ctx: QueryCtx, category: Doc<'category'>, workspaceId: Id<'workspace'>) {
  // Get category group for type enrichment (needed to determine if credit card)
  const enriched = await enrichCategoryWithType(ctx, category);
  const isCreditCard = enriched.type === 'credit_card';

  // Query categoryBudget for all assignments (one row per category with map)
  const budget = await ctx.db
    .query('categoryBudget')
    .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', category._id))
    .first();

  // Extract assignments from monthlyAssignedAmounts map
  const monthlyAmounts = budget?.monthlyAssignedAmounts ?? {};
  const assignmentsByMonth = Object.entries(monthlyAmounts)
    .map(([yearMonthStr, assignedAmount]) => ({
      yearMonth: parseInt(yearMonthStr, 10),
      assignedAmount,
    }))
    .sort((a, b) => a.yearMonth - b.yearMonth);

  // Calculate total assigned
  const totalAssigned = assignmentsByMonth.reduce((sum, b) => sum + b.assignedAmount, 0n);

  // Query spending based on category type
  let spendingByMonth: Array<{ yearMonth: number; amount: bigint }> = [];
  let totalSpending = 0n;

  if (isCreditCard) {
    // For credit card categories, read creditMonthlySpending directly from category (no longer a separate table)
    // Note: creditMonthlySpending keys are in YYYYMM format (e.g., "202401")
    const creditMonthlySpending = category.creditMonthlySpending ?? {};
    const spendingEntries = Object.entries(creditMonthlySpending)
      .map(([yearMonthStr, spending]) => ({
        yearMonth: parseInt(yearMonthStr, 10),
        // spendingAmount is negative, convert to positive for display
        amount: spending.spendingAmount < 0n ? -spending.spendingAmount : 0n,
      }))
      .sort((a, b) => a.yearMonth - b.yearMonth);

    spendingByMonth = spendingEntries;
    totalSpending = spendingByMonth.reduce((sum, s) => sum + s.amount, 0n);
  } else {
    // For regular categories, read monthlySpending directly from category (no separate table)
    // Extract and sort monthlySpending map entries
    // Note: monthlySpending keys are in YYYYMM format (e.g., "202401")
    const monthlySpending = category.monthlySpending ?? {};
    const spendingEntries = Object.entries(monthlySpending)
      .map(([yearMonthStr, spending]) => ({
        yearMonth: parseInt(yearMonthStr, 10),
        amount: spending.outflowAmount, // outflowAmount is stored as positive
      }))
      .sort((a, b) => a.yearMonth - b.yearMonth);

    spendingByMonth = spendingEntries;
    totalSpending = spendingByMonth.reduce((sum, s) => sum + s.amount, 0n);
  }

  // For backward compatibility: calculate transactionCount as months with spending
  const transactionCount = spendingByMonth.filter((s) => s.amount > 0n).length;

  return {
    ...enriched,
    spendingByMonth,
    assignmentsByMonth,
    totalSpending,
    totalAssigned,
    // Backward compatibility fields
    transactionCount,
    totalAmount: totalSpending, // Same as totalSpending for compatibility
  };
}

/**
 * Spending delta for batch updating category spending records
 */
export interface SpendingDelta {
  categoryId: Id<'category'>;
  yearMonth: number;
  amountDelta: bigint;
  transactionCountDelta: bigint;
}

/**
 * Transaction with movements for aggregation
 */
type TransactionForAggregation = {
  _id: Id<'transaction'>;
  date: string;
  movements: EmbeddedMovement[];
};

/**
 * Aggregate spending deltas from transactions being deleted/recategorized
 *
 * This function performs a single pass through transactions to calculate
 * all spending changes grouped by (categoryId, yearMonth). This allows
 * batch updating spending records instead of calling mutations for each movement.
 *
 * @param transactions - Transactions being processed
 * @param deletedCategoryIds - Categories being deleted
 * @param newCategoryId - If recategorizing, the target category ID
 * @returns Map of spending deltas keyed by "categoryId:yearMonth"
 */
export function aggregateSpendingDeltas(
  transactions: TransactionForAggregation[],
  deletedCategoryIds: Array<Id<'category'>>,
  newCategoryId?: Id<'category'>
): Map<string, SpendingDelta> {
  const deltasByKey = new Map<string, SpendingDelta>();

  for (const txn of transactions) {
    const yearMonth = dateToYearMonth(txn.date);

    for (const movement of txn.movements) {
      // Only process movements with deleted categories
      if (!movement.categoryId || !deletedCategoryIds.includes(movement.categoryId)) {
        continue;
      }

      // Skip credit card transfers (handled separately by existing mutations)
      if (movement.creditCardTransfer) {
        continue;
      }

      // Reverse spending from old category
      const oldKey = `${movement.categoryId}:${yearMonth}`;
      if (!deltasByKey.has(oldKey)) {
        deltasByKey.set(oldKey, {
          categoryId: movement.categoryId,
          yearMonth,
          amountDelta: 0n,
          transactionCountDelta: 0n,
        });
      }
      const oldDelta = deltasByKey.get(oldKey)!;
      oldDelta.amountDelta -= movement.amount; // Reverse the spending
      oldDelta.transactionCountDelta -= 1n; // Decrement transaction count

      // If recategorizing, add spending to new category
      if (newCategoryId) {
        const newKey = `${newCategoryId}:${yearMonth}`;
        if (!deltasByKey.has(newKey)) {
          deltasByKey.set(newKey, {
            categoryId: newCategoryId,
            yearMonth,
            amountDelta: 0n,
            transactionCountDelta: 0n,
          });
        }
        const newDelta = deltasByKey.get(newKey)!;
        newDelta.amountDelta += movement.amount; // Add the spending
        newDelta.transactionCountDelta += 1n; // Increment transaction count
      }
    }
  }

  return deltasByKey;
}
