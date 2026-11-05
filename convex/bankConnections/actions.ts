import { ConvexError, v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { requireWorkspaceAccessAction } from '../lib/auth';
import { bankConnectionRefValidator } from './types';

export const disconnectConnection = action({
  args: {
    workspaceId: v.id('workspace'),
    connection: bankConnectionRefValidator,
  },
  handler: async (ctx, args): Promise<{ disconnectedAccountCount: number | null }> => {
    await requireWorkspaceAccessAction(ctx, args.workspaceId);

    if (args.connection.provider === 'plaid') {
      const result = await ctx.runAction(api.bankLinks.deleteBankLinkAction, {
        bankLinkId: args.connection.connectionId,
      });

      if (!result.success) {
        throw new ConvexError('Failed to disconnect bank connection');
      }

      return { disconnectedAccountCount: null };
    }

    return await ctx.runMutation(api.bankConnections.disconnectAppleWalletConnection, {
      workspaceId: args.workspaceId,
      connection: args.connection,
    });
  },
});
