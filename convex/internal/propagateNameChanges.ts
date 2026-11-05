import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { buildSearchText, resolveMerchantName } from '../transactions/helpers';

/**
 * Internal mutation to propagate merchant name changes to transaction searchText
 *
 * When a merchant name is updated, all transactions with that merchant need their
 * searchText rebuilt to include the new merchant name for search functionality.
 */
export const propagateMerchantNameChange = internalMutation({
  args: {
    merchantId: v.id('merchant'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { merchantId, workspaceId }) => {
    // Get the new merchant name
    const newMerchantName = await resolveMerchantName(ctx, merchantId, undefined);

    // Find all transactions with this merchant
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_merchantId', (q) => q.eq('workspaceId', workspaceId).eq('merchantId', merchantId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const now = new Date().toISOString();
    let updated = 0;

    // Update each transaction's searchText
    for (const transaction of transactions) {
      // Extract category names from embedded movements
      const categoryNames = transaction.movements.map((m) => m.categoryName).filter((n): n is string => !!n);

      // Rebuild searchText with new merchant name
      const searchText = buildSearchText(
        newMerchantName,
        categoryNames,
        transaction.totalAmount,
        transaction.type,
        transaction.notes
      );

      await ctx.db.patch(transaction._id, {
        searchText,
        updatedAt: now,
      });
      updated++;
    }

    return { updated };
  },
});

/**
 * Internal mutation to propagate category name changes to transaction searchText
 *
 * When a category name is updated, all transactions with movements using that category
 * need their searchText and embedded movement categoryName rebuilt.
 */
export const propagateCategoryNameChange = internalMutation({
  args: {
    categoryId: v.id('category'),
    workspaceId: v.id('workspace'),
    newCategoryName: v.string(),
  },
  handler: async (ctx, { categoryId, workspaceId, newCategoryName }) => {
    // Find all transactions in this workspace that may have this category in movements
    // Since we can't directly query by embedded array contents, we query by workspace
    // and filter in-memory
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const now = new Date().toISOString();
    let updated = 0;

    for (const transaction of transactions) {
      // Check if any movement has this categoryId
      const hasCategory = transaction.movements.some((m) => m.categoryId === categoryId);

      if (hasCategory) {
        // Update the categoryName in embedded movements
        const updatedMovements = transaction.movements.map((m) => {
          if (m.categoryId === categoryId) {
            return { ...m, categoryName: newCategoryName };
          }
          return m;
        });

        // Get merchant name
        const merchantName = await resolveMerchantName(ctx, transaction.merchantId, transaction.importDetails);

        // Extract updated category names
        const categoryNames = updatedMovements.map((m) => m.categoryName).filter((n): n is string => !!n);

        // Rebuild searchText
        const searchText = buildSearchText(
          merchantName,
          categoryNames,
          transaction.totalAmount,
          transaction.type,
          transaction.notes
        );

        await ctx.db.patch(transaction._id, {
          movements: updatedMovements,
          searchText,
          updatedAt: now,
        });
        updated++;
      }
    }

    return { updated };
  },
});

/**
 * Internal mutation to propagate bank account name changes to transaction searchText
 *
 * NOTE: This is now a no-op because bank account name is no longer included in searchText.
 * Bank account filtering uses the bankAccountId index instead for performance.
 * Keeping this function for backward compatibility in case it's called from existing code.
 */
export const propagateBankAccountNameChange = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    workspaceId: v.id('workspace'),
    newBankAccountName: v.string(),
  },
  handler: async () => {
    // No-op: bank account name is no longer in searchText
    return { updated: 0 };
  },
});
