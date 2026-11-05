import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

export const upsertGlobalMerchant = internalMutation({
  args: {
    name: v.string(),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, { name, logoUrl }) => {
    const existing = await ctx.db
      .query('globalMerchant')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();

    const timestamp = new Date().toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        logoUrl,
        updatedAt: timestamp,
      });
      return existing._id;
    }

    return await ctx.db.insert('globalMerchant', {
      name,
      logoUrl,
      isVerified: false,
      updatedAt: timestamp,
    });
  },
});
