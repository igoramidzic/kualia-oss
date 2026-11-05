import { internalMutation } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';

/**
 * Migration: Backfill dateYearMonth field on existing transactions
 *
 * This migration sets the dateYearMonth field (YYYYMM format) on all transactions
 * that don't have it set. The dateYearMonth is derived from the transaction's date field.
 *
 * Run this migration multiple times until hasMore returns false.
 * Each run processes up to 1000 transactions.
 */
export const backfillTransactionDateYearMonth = internalMutation({
  handler: async (ctx) => {
    // Fetch transactions without dateYearMonth (limit to 1000 per batch)
    const transactions = await ctx.db
      .query('transaction')
      .filter((q) => q.eq(q.field('dateYearMonth'), undefined))
      .take(1000);

    console.log(`Found ${transactions.length} transactions to backfill`);

    if (transactions.length === 0) {
      console.log('No transactions to backfill. Migration complete.');
      return {
        success: true,
        migratedCount: 0,
        hasMore: false,
      };
    }

    let migratedCount = 0;

    for (const transaction of transactions) {
      const dateYearMonth = dateToYearMonth(transaction.date);
      await ctx.db.patch(transaction._id, { dateYearMonth });
      migratedCount++;
    }

    const hasMore = transactions.length === 1000;

    console.log(`Backfilled ${migratedCount} transactions. Has more: ${hasMore}`);

    return {
      success: true,
      migratedCount,
      hasMore,
    };
  },
});
