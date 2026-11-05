import { getIdentity } from '../lib/identity';
import { v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import { generateToken, shouldRecordWidgetTokenUse } from './helpers';

/**
 * Create or refresh a widget token for the current user and workspace.
 * Called by the iOS app after login to enable widget data fetching.
 * New clients can reuse an active credential; legacy callers retain token rotation.
 */
export const createOrRefreshWidgetToken = mutation({
  args: {
    workspaceId: v.id('workspace'),
    reuseExisting: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { workspaceId, reuseExisting }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const clerkId = user.subject;

    const activeTokens = () =>
      ctx.db
        .query('widgetToken')
        .withIndex('by_clerkId_isRevoked_workspaceId', (q) =>
          q.eq('clerkId', clerkId).eq('isRevoked', false).eq('workspaceId', verifiedWorkspaceId)
        );

    if (reuseExisting) {
      const existing = await activeTokens().first();
      if (existing) return existing.token;
    }

    // Historical revoked credentials must not be read and rewritten at every launch.
    for await (const existing of activeTokens()) {
      await ctx.db.patch(existing._id, { isRevoked: true });
    }

    // Generate and store a new token
    const token = generateToken();
    await ctx.db.insert('widgetToken', {
      workspaceId: verifiedWorkspaceId,
      clerkId,
      token,
      createdAt: new Date().toISOString(),
      isRevoked: false,
    });

    return token;
  },
});

/**
 * Revoke all widget tokens for the current user.
 * Called on sign out to invalidate widget access.
 */
export const revokeAllWidgetTokens = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await getIdentity(ctx);
    if (!identity) return null;

    const tokens = ctx.db
      .query('widgetToken')
      .withIndex('by_clerkId_isRevoked_workspaceId', (q) => q.eq('clerkId', identity.subject).eq('isRevoked', false));

    for await (const token of tokens) {
      await ctx.db.patch(token._id, { isRevoked: true });
    }
    return null;
  },
});

/**
 * Update lastUsedAt timestamp on a widget token.
 * Internal only — called by HTTP handlers after successful validation.
 */
export const updateWidgetTokenLastUsed = internalMutation({
  args: {
    tokenId: v.id('widgetToken'),
  },
  returns: v.null(),
  handler: async (ctx, { tokenId }) => {
    const token = await ctx.db.get(tokenId);
    const now = Date.now();
    // Widget timelines may refresh together. Only the first hourly use writes.
    if (!token || token.isRevoked || !shouldRecordWidgetTokenUse(token.lastUsedAt, now)) return null;
    await ctx.db.patch(tokenId, {
      lastUsedAt: new Date(now).toISOString(),
    });
    return null;
  },
});
