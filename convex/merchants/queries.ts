import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { resolveMerchant, resolveMerchantChoices } from './helpers';
import { merchantChoiceValidator } from './types';

/** Compact reactive pages for the transaction editor's complete merchant picker. */
export const listMerchantChoices = query({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(merchantChoiceValidator),
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const result = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await resolveMerchantChoices(
        ctx,
        result.page.filter((merchant) => !merchant.isDeleted)
      ),
    };
  },
});

/**
 * Get all merchants for a workspace (with global merchant resolution)
 * Stats (transactionCount, totalSpent) are always included
 */
export const listMerchants = query({
  args: {
    workspaceId: v.id('workspace'),
    includeDeleted: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()), // Merchant ID for pagination cursor
  },
  handler: async (ctx, { workspaceId, includeDeleted = false, limit, cursor }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    let merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    // Filter deleted
    merchants = merchants.filter((m) => (includeDeleted ? true : m.isDeleted === false));

    // Apply cursor-based pagination if cursor is provided
    if (cursor) {
      const cursorIndex = merchants.findIndex((m) => m._id === cursor);
      if (cursorIndex >= 0) {
        merchants = merchants.slice(cursorIndex + 1);
      }
    }

    // Apply limit if provided
    const hasMore = limit !== undefined && merchants.length > limit;
    const merchantsToReturn = limit !== undefined ? merchants.slice(0, limit) : merchants;

    // Resolve with global merchants (stats are stored directly on the merchant)
    const resolvedMerchants = await Promise.all(merchantsToReturn.map((merchant) => resolveMerchant(ctx, merchant)));

    // Backward compatibility: return array if no pagination params, object if pagination is used
    if (limit === undefined && cursor === undefined) {
      return resolvedMerchants;
    }

    return {
      merchants: resolvedMerchants,
      hasMore,
      nextCursor: hasMore && resolvedMerchants.length > 0 ? resolvedMerchants[resolvedMerchants.length - 1]._id : null,
    };
  },
});

/**
 * Get a specific merchant by ID (with global merchant resolution)
 * Stats (transactionCount, totalSpent) are always included
 */
export const getMerchant = query({
  args: {
    workspaceId: v.id('workspace'),
    merchantId: v.id('merchant'),
  },
  handler: async (ctx, { workspaceId, merchantId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const merchant = await ctx.db.get(merchantId);
    if (!merchant || merchant.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Merchant not found or does not belong to workspace');
    }

    return await resolveMerchant(ctx, merchant);
  },
});

/**
 * Get a merchant by the last 8 characters of its ID
 * Stats (transactionCount, totalSpent) are stored directly on the merchant
 */
export const getMerchantByShortId = query({
  args: {
    workspaceId: v.id('workspace'),
    shortId: v.string(),
  },
  handler: async (ctx, { workspaceId, shortId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get all merchants for this workspace
    const merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Find merchant matching the short ID
    const merchant = merchants.find((m) => m._id.slice(-8) === shortId);

    if (!merchant) {
      return null;
    }

    return await resolveMerchant(ctx, merchant);
  },
});
