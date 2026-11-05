import type { GenericMutationCtx } from 'convex/server';
import type { DataModel, Id } from '../_generated/dataModel';

type MutationCtxType = GenericMutationCtx<DataModel>;

export async function getOrCreateGlobalMerchant(
  ctx: MutationCtxType,
  name: string,
  fallbackLogoUrl?: string
): Promise<Id<'globalMerchant'>> {
  const existing = await ctx.db
    .query('globalMerchant')
    .withIndex('by_name', (q) => q.eq('name', name))
    .first();

  const timestamp = new Date().toISOString();

  if (existing) {
    await ctx.db.patch(existing._id, {
      logoUrl: fallbackLogoUrl,
      updatedAt: timestamp,
    });
    return existing._id;
  }

  return await ctx.db.insert('globalMerchant', {
    name,
    logoUrl: fallbackLogoUrl,
    isVerified: false,
    updatedAt: timestamp,
  });
}
