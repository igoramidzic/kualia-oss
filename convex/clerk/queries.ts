import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

/**
 * Internal query to get user by Clerk ID
 */
export const getUserByClerkId = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }) => {
    const profile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
      .first();
    return profile?.isDeleted === true ? null : profile;
  },
});

/**
 * Internal query to get user by userProfile ID
 */
export const getUserById = internalQuery({
  args: {
    userId: v.id('userProfile'),
  },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db.get(userId);
    return profile?.isDeleted === true ? null : profile;
  },
});
