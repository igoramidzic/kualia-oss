import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { action } from '../../_generated/server';
import { plaidClient } from './plaidClient';

/**
 * Disconnect a Plaid item by calling Plaid's itemRemove API
 * This removes the item from Plaid's systems and stops any ongoing charges
 * Bank links are cross-workspace, so we verify ownership by ownerId
 */
export const disconnectPlaidItem = action({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx: ActionCtx, { bankLinkId }): Promise<{ success: boolean }> => {
    // Get user identity
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('User not authenticated');
    }
    const userId = identity.subject;

    // Fetch the bank link record using internal query
    const bankLink = await ctx.runQuery(internal.internal.bankLinks.getBankLink, {
      bankLinkId,
    });

    if (!bankLink) {
      console.error('[Plaid Disconnect] Bank link not found', bankLinkId, userId);
      throw new ConvexError('Bank link not found');
    }

    // Verify ownership by ownerId
    if (bankLink.ownerId !== userId) {
      console.error('[Plaid Disconnect] Access denied - owner mismatch', bankLinkId, bankLink.ownerId, userId);
      throw new ConvexError('Access denied');
    }

    // Only disconnect if provider is Plaid
    if (bankLink.provider !== 'plaid') {
      console.error('[Plaid Disconnect] Invalid provider', bankLinkId, bankLink.provider, userId);
      throw new ConvexError('Can only disconnect Plaid bank links using this method');
    }

    try {
      // Call Plaid's itemRemove API to disconnect
      await plaidClient.itemRemove({
        access_token: bankLink.accessToken,
      });

      // Soft-delete the bank link and all associated records
      await ctx.runMutation(internal.internal.bankLinks.softDeleteBankLink, {
        bankLinkId,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error('[Plaid Disconnect] Error calling Plaid itemRemove API', {
        bankLinkId,
        itemId: bankLink.itemId,
        globalInstitutionId: bankLink.globalInstitutionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      if (error instanceof Error) {
        throw new ConvexError(`Failed to disconnect from Plaid: ${error.message}`);
      }

      throw new ConvexError('Failed to disconnect from Plaid');
    }
  },
});
