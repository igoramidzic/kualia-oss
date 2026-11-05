import { internalMutation } from '../_generated/server';

/**
 * Expire old pending transfer matches.
 *
 * Called daily by cron job to mark pending matches as expired
 * if they have passed their expiresAt date without finding a counterpart.
 */
export const expireOldPendingMatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date().toISOString();

    // Find all pending matches that are awaiting counterpart and have expired
    const expiredMatches = await ctx.db
      .query('pendingTransferMatch')
      .filter((q) =>
        q.and(
          q.eq(q.field('status'), 'awaiting_counterpart'),
          q.lt(q.field('expiresAt'), now),
          q.eq(q.field('isDeleted'), false)
        )
      )
      .collect();

    let expiredCount = 0;

    // Mark each as expired
    for (const match of expiredMatches) {
      await ctx.db.patch(match._id, {
        status: 'expired',
        updatedAt: now,
      });

      // Also clear the suggestedTransfer on the source transaction
      const transaction = await ctx.db.get(match.sourceTransactionId);
      if (transaction && transaction.suggestedTransfer?.status === 'pending') {
        await ctx.db.patch(match.sourceTransactionId, {
          suggestedTransfer: {
            ...transaction.suggestedTransfer,
            status: 'rejected', // Clear the suggestion since it expired
          },
          updatedAt: now,
        });
      }

      expiredCount++;
    }

    return { expiredCount };
  },
});

/**
 * Clean up old expired/rejected pending matches.
 *
 * Soft deletes pending matches that have been expired or rejected for more than 90 days.
 * This prevents the table from growing indefinitely.
 */
export const cleanupOldPendingMatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Find old expired/rejected matches that haven't been deleted
    const oldMatches = await ctx.db
      .query('pendingTransferMatch')
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field('status'), 'expired'), q.eq(q.field('status'), 'user_rejected')),
          q.lt(q.field('updatedAt'), ninetyDaysAgo),
          q.eq(q.field('isDeleted'), false)
        )
      )
      .collect();

    let deletedCount = 0;
    const timestamp = now.toISOString();

    for (const match of oldMatches) {
      await ctx.db.patch(match._id, {
        isDeleted: true,
        updatedAt: timestamp,
      });
      deletedCount++;
    }

    if (deletedCount > 0) {
      console.log(`Soft deleted ${deletedCount} old pending transfer matches`);
    }

    return { deletedCount };
  },
});
