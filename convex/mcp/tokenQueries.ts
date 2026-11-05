import { ConvexError, v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const listMcpTokens = internalQuery({
  args: {},
  handler: async () => {
    throw new ConvexError('Personal MCP tokens are disabled. Use OAuth authentication.');
  },
});

export const authenticateMcpToken = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, { tokenHash }) => {
    const token = await ctx.db
      .query('mcpToken')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first();

    if (!token || token.revokedAt) {
      return null;
    }

    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    const userProfile = await ctx.db
      .query('userProfile')
      .filter((q) => q.eq(q.field('clerkId'), token.clerkId))
      .first();

    if (!userProfile) {
      return null;
    }

    return {
      tokenId: token._id,
      clerkId: token.clerkId,
      scopes: token.scopes,
      activeWorkspaceId: userProfile.activeWorkspaceId,
    };
  },
});
