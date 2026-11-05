import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

import { buildActivityContext, recordBankConnectionActivity } from './helpers';
import { activityAttributionValidator } from './types';

export const recordAppleWalletConnectionEvent = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    connectionId: v.id('financeKitConnection'),
    type: v.union(v.literal('bank_connection_added'), v.literal('bank_connection_disconnected')),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) {
      return;
    }

    const accounts = await ctx.db
      .query('financeKitAccount')
      .withIndex('by_connectionId_isDeleted', (q) => q.eq('connectionId', connection._id))
      .take(100);

    await recordBankConnectionActivity(ctx, {
      workspaceId: args.workspaceId,
      context: await buildActivityContext(ctx, args.attribution),
      type: args.type,
      connection: {
        id: connection._id,
        provider: 'apple_wallet',
        institutionName: accounts[0]?.institutionName ?? 'Apple Wallet',
        accountNames: accounts.map((account) => account.displayName),
      },
    });
  },
});
