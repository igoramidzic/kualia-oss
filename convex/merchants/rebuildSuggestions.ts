import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';

/**
 * Batch size for processing merchants to avoid OCC errors.
 * Processing too many merchants in a single transaction can cause
 * "Data read or written in this mutation changed while it was being run"
 * errors due to Convex's Optimistic Concurrency Control.
 */
const MERCHANT_BATCH_SIZE = 25;

/**
 * Rebuild merchant category and account suggestions for an entire workspace.
 *
 * This is used during Supabase migration to initialize suggestions from existing
 * transaction history. After migration, suggestions are updated incrementally
 * on each transaction create/update.
 *
 * For each merchant:
 * - suggestedCategoryIds: Up to 3 unique categories from most recent transactions
 * - suggestedBankAccountId: Most frequently used account (tie-break by most recent)
 *
 * This function uses batched processing with scheduled mutations to avoid OCC errors
 * when processing workspaces with many merchants.
 *
 * @returns Object indicating the rebuild process has started
 */
export const rebuildWorkspaceMerchantSuggestions = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    // Schedule the first batch to process immediately
    await ctx.scheduler.runAfter(0, internal.merchants.rebuildSuggestions.processMerchantBatch, {
      workspaceId,
      cursor: null,
      totalProcessed: 0,
      totalUpdated: 0,
    });

    return { started: true };
  },
});

/**
 * Process a single batch of merchants for suggestion rebuilding.
 *
 * This mutation processes MERCHANT_BATCH_SIZE merchants at a time and schedules
 * the next batch if more merchants remain. This prevents OCC errors by keeping
 * the read/write set small for each transaction.
 */
export const processMerchantBatch = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    cursor: v.union(v.string(), v.null()),
    totalProcessed: v.number(),
    totalUpdated: v.number(),
  },
  handler: async (ctx, { workspaceId, cursor, totalProcessed, totalUpdated }) => {
    // Query merchants with pagination
    const merchantsResult = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .paginate({ numItems: MERCHANT_BATCH_SIZE, cursor });

    let batchUpdated = 0;

    // Process each merchant in this batch
    for (const merchant of merchantsResult.page) {
      // Get last 100 transactions for this merchant, ordered by date desc
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_merchantId', (q) => q.eq('workspaceId', workspaceId).eq('merchantId', merchant._id))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .order('desc')
        .take(100);

      if (transactions.length === 0) continue;

      // Build suggestedCategoryIds (up to 3 unique, most recent first)
      const suggestedCategoryIds: Id<'category'>[] = [];
      for (const tx of transactions) {
        const categoryId = tx.movements?.[0]?.categoryId;
        if (categoryId && !suggestedCategoryIds.includes(categoryId)) {
          suggestedCategoryIds.push(categoryId);
          if (suggestedCategoryIds.length >= 3) break;
        }
      }

      // Build suggestedBankAccountId (most frequent, tie-break by most recent)
      const accountCounts = new Map<string, { count: number; lastIndex: number }>();
      transactions.forEach((tx, index) => {
        const existing = accountCounts.get(tx.bankAccountId);
        if (existing) {
          existing.count++;
        } else {
          accountCounts.set(tx.bankAccountId, { count: 1, lastIndex: index });
        }
      });

      let suggestedBankAccountId: Id<'bankAccount'> | undefined;
      let maxCount = 0;
      let minLastIndex = Infinity;
      for (const [accountId, { count, lastIndex }] of accountCounts) {
        if (count > maxCount || (count === maxCount && lastIndex < minLastIndex)) {
          maxCount = count;
          minLastIndex = lastIndex;
          suggestedBankAccountId = accountId as Id<'bankAccount'>;
        }
      }

      // Update merchant with computed suggestions
      await ctx.db.patch(merchant._id, {
        suggestedCategoryIds,
        suggestedBankAccountId,
      });
      batchUpdated++;
    }

    const newTotalProcessed = totalProcessed + merchantsResult.page.length;
    const newTotalUpdated = totalUpdated + batchUpdated;

    // Schedule next batch if more merchants exist
    if (!merchantsResult.isDone) {
      await ctx.scheduler.runAfter(0, internal.merchants.rebuildSuggestions.processMerchantBatch, {
        workspaceId,
        cursor: merchantsResult.continueCursor,
        totalProcessed: newTotalProcessed,
        totalUpdated: newTotalUpdated,
      });
    } else {
      // Log completion for debugging
      console.log(
        `[rebuildMerchantSuggestions] Completed for workspace ${workspaceId}: ${newTotalProcessed} merchants processed, ${newTotalUpdated} updated`
      );
    }

    return {
      processed: merchantsResult.page.length,
      updated: batchUpdated,
      totalProcessed: newTotalProcessed,
      totalUpdated: newTotalUpdated,
      isDone: merchantsResult.isDone,
    };
  },
});
