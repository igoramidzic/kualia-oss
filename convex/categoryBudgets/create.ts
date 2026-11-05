import { v } from 'convex/values';

import { mutation } from '../_generated/server';

/**
 * @deprecated This function is no longer needed. Budgets are now created lazily
 * when transactions occur or when users explicitly set budget amounts.
 * Use `upsertCategoryBudget` to create individual budgets, or budgets will be
 * automatically created when transactions are added via `updateCategorySpendingForTransaction`.
 *
 * Create category budgets for all categories for a given month
 * This creates a budget entry for each category (workspace-specific and system categories)
 * If a budget already exists for a category/month combination, it will be skipped
 */
export const createCategoryBudgetsForMonth = mutation({
  args: {
    workspaceId: v.id('workspace'),
    yearMonth: v.number(),
  },
  handler: async () => {
    // Deprecated: Budgets are now created lazily
    // Return empty result for backward compatibility
    return { created: 0, skipped: 0 };
  },
});
