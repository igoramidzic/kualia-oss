import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordMerchantActivity } from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';
import { entityIconColorId, visualIdentityMode, type EntityIconColorId } from '../lib/entityIdentity';

/**
 * Shared body for creating a merchant. Workspace access must already have been
 * verified by the caller. Used by the in-app mutation and the public REST API.
 */
export async function createMerchantImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    name,
    logoUrl,
    visualIdentityMode,
    iconName,
    iconColorId,
    activityContext,
  }: {
    workspaceId: Id<'workspace'>;
    name: string;
    logoUrl?: string;
    visualIdentityMode?: 'logo' | 'icon';
    iconName?: string;
    iconColorId?: EntityIconColorId;
    activityContext?: ActivityContext;
  }
): Promise<Id<'merchant'>> {
  // Check for existing merchant with same name (case-insensitive)
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName.length === 0) {
    throw new ConvexError('Merchant name cannot be empty');
  }

  const existingMerchants = await ctx.db
    .query('merchant')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const duplicate = existingMerchants.find((m) => m.name?.toLowerCase() === normalizedName);

  if (duplicate) {
    throw new ConvexError('A merchant with this name already exists');
  }

  const merchantId = await ctx.db.insert('merchant', {
    name: name.trim(),
    logoUrl,
    visualIdentityMode,
    iconName,
    iconColorId,
    workspaceId,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  });

  if (activityContext) {
    const merchant = await ctx.db.get(merchantId);
    if (merchant) {
      await recordMerchantActivity(ctx, {
        workspaceId,
        context: activityContext,
        type: 'merchant_created',
        after: merchant,
      });
    }
  }

  return merchantId;
}

/**
 * Create a new merchant
 */
export const createMerchant = mutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    visualIdentityMode: v.optional(visualIdentityMode),
    iconName: v.optional(v.string()),
    iconColorId: v.optional(entityIconColorId),
  },
  handler: async (ctx, { workspaceId, ...rest }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    return createMerchantImpl(ctx, { workspaceId: verifiedWorkspaceId, activityContext, ...rest });
  },
});
