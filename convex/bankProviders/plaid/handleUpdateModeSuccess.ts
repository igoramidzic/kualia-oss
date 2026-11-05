import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, internalQuery } from '../../_generated/server';

/**
 * Internal query to get bank link for verification
 * Bank links are cross-workspace, so we verify ownership by ownerId
 */
export const getBankLinkForVerification = internalQuery({
  args: { bankLinkId: v.id('bankLink'), userId: v.string() },
  handler: async (ctx, { bankLinkId, userId }) => {
    const bankLink = await ctx.db.get(bankLinkId);

    if (!bankLink) {
      throw new ConvexError('Bank link not found');
    }

    if (bankLink.ownerId !== userId) {
      throw new ConvexError('Access denied');
    }

    return {
      itemId: bankLink.itemId,
    };
  },
});

/**
 * Handle successful reconnection of a bank link in Plaid update mode
 * Updates the bank link status back to Healthy and triggers a transaction sync
 */
export const handleUpdateModeSuccess = action({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, { bankLinkId }) => {
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new ConvexError('User not authenticated');
    }

    // Get bank link
    const bankLink = await ctx.runQuery(
      internal.bankProviders.plaid.handleUpdateModeSuccess.getBankLinkForVerification,
      {
        bankLinkId,
        userId: identity.subject,
      }
    );

    if (!bankLink) {
      throw new ConvexError('Bank link not found');
    }

    // Update bank link status to Healthy
    await ctx.runMutation(internal.internal.bankLinks.updateBankLinkStatus, {
      itemId: bankLink.itemId,
      itemStatus: 'Healthy',
      clearReauthorization: true,
    });

    // Trigger transaction sync for this bank link
    await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.plaidTransactionSync.syncTransactions, {
      itemId: bankLink.itemId,
    });

    return { success: true };
  },
});
