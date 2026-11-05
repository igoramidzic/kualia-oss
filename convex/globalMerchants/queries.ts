import { v } from 'convex/values';

import { query } from '../_generated/server';
import { appendLogoDevToken } from '../lib/logoUtils';

export const getGlobalMerchantByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const merchant = await ctx.db
      .query('globalMerchant')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();

    if (!merchant) return null;

    return {
      ...merchant,
      logoUrl: appendLogoDevToken(merchant.logoUrl),
    };
  },
});

export const getGlobalMerchantById = query({
  args: {
    id: v.id('globalMerchant'),
  },
  handler: async (ctx, { id }) => {
    const merchant = await ctx.db.get(id);
    if (!merchant) return null;

    return {
      ...merchant,
      logoUrl: appendLogoDevToken(merchant.logoUrl),
    };
  },
});

export const listGlobalMerchants = query({
  args: {},
  handler: async (ctx) => {
    const merchants = await ctx.db.query('globalMerchant').collect();

    return merchants.map((merchant) => ({
      ...merchant,
      logoUrl: appendLogoDevToken(merchant.logoUrl),
    }));
  },
});
