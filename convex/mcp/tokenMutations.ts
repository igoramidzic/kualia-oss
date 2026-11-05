import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { APP_READ_SCOPE, BUDGETS_WRITE_SCOPE } from './tools';

const TOKEN_SCOPE_VALIDATOR = v.array(v.union(v.literal(APP_READ_SCOPE), v.literal(BUDGETS_WRITE_SCOPE)));

export const createMcpToken = internalMutation({
  args: {
    label: v.string(),
    scopes: v.optional(TOKEN_SCOPE_VALIDATOR),
    expiresAt: v.optional(v.string()),
  },
  handler: async () => {
    throw new ConvexError('Personal MCP tokens are disabled. Use OAuth authentication.');
  },
});

export const revokeMcpToken = internalMutation({
  args: {
    tokenId: v.id('mcpToken'),
  },
  handler: async () => {
    throw new ConvexError('Personal MCP tokens are disabled. Use OAuth authentication.');
  },
});

export const touchMcpTokenLastUsed = internalMutation({
  args: {
    tokenId: v.id('mcpToken'),
  },
  handler: async (ctx, { tokenId }) => {
    const token = await ctx.db.get(tokenId);
    if (!token || token.revokedAt) {
      return;
    }

    await ctx.db.patch(tokenId, {
      lastUsedAt: new Date().toISOString(),
    });
  },
});
