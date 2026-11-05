import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { buildSearchText, resolveMerchantName } from '../transactions/helpers';

/**
 * Migration: Rebuild searchText on transactions that have notes
 *
 * Recalculates searchText to include the notes field. Only updates
 * transactions that have a notes value set. Self-schedules batches
 * until all transactions are processed.
 *
 * Trigger once:
 *   npx convex run migrations/rebuildTransactionSearchText:rebuildTransactionSearchText
 */
export const rebuildTransactionSearchText = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 500;

    const paginationResult = await ctx.db
      .query('transaction')
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    const transactions = paginationResult.page.filter((t) => t.notes);

    console.log(`Processing batch: ${paginationResult.page.length} fetched, ${transactions.length} with notes`);

    let updatedCount = 0;

    for (const transaction of transactions) {
      const merchantName = await resolveMerchantName(ctx, transaction.merchantId, transaction.importDetails);

      const categoryNames = (transaction.movements ?? []).map((m) => m.categoryName).filter((n): n is string => !!n);

      const totalAmount =
        transaction.totalAmount ?? (transaction.movements ?? []).reduce((sum, m) => sum + m.amount, 0n);

      const searchText = buildSearchText(merchantName, categoryNames, totalAmount, transaction.type, transaction.notes);

      if (searchText !== transaction.searchText) {
        await ctx.db.patch(transaction._id, { searchText });
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} transactions in this batch.`);

    if (!paginationResult.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.rebuildTransactionSearchText.rebuildTransactionSearchText, {
        cursor: paginationResult.continueCursor,
      });
    } else {
      console.log('Migration complete. All transactions processed.');
    }
  },
});
