import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';

import { action } from '../../_generated/server';
import { getSafePlaidErrorDetails, plaidClient } from './plaidClient';

/**
 * Exchange a public token for an access token
 * This is called after the user successfully links their bank account
 * @deprecated Use linkNewPlaidItem instead for complete bank link creation
 */
export const exchangePublicToken = action({
  args: {
    publicToken: v.string(),
    institutionId: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    accounts: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        subtype: v.string(),
        mask: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Get the current user identity from Clerk
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new ConvexError('User not authenticated');
    }

    try {
      // Exchange public token for access token
      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: args.publicToken,
      });

      const itemId = exchangeResponse.data.item_id;

      // Here you would typically:
      // 1. Store the access token securely (encrypted)
      // 2. Create bank link and bank account records in your database
      // 3. Initiate initial transaction sync

      // For now, we'll return success
      return {
        success: true,
        itemId,
        accounts: args.accounts,
      };
    } catch (error: unknown) {
      console.error('Error exchanging public token:', getSafePlaidErrorDetails(error));

      throw new ConvexError('Failed to exchange public token');
    }
  },
});
