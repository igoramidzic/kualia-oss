import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { accountType } from '../schema';

/**
 * Create a bank link account record
 * Bank link accounts are tied to a bankLink and don't have their own workspaceId/ownerId
 * (ownership is derived from the parent bankLink)
 */
export const createBankLinkAccount = internalMutation({
  args: {
    accountNumberMask: v.optional(v.string()),
    accountType: accountType,
    availableBalance: v.optional(v.number()),
    bankLinkId: v.id('bankLink'),
    initialBalance: v.optional(v.number()),
    name: v.string(),
    officialName: v.optional(v.string()),
    plaidAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('bankLinkAccount', {
      accountNumberMask: args.accountNumberMask,
      accountType: args.accountType,
      availableBalance: args.availableBalance,
      bankLinkId: args.bankLinkId,
      initialBalance: args.initialBalance,
      name: args.name,
      officialName: args.officialName,
      plaidAccountId: args.plaidAccountId,
      updatedAt: new Date().toISOString(),
    });
  },
});
