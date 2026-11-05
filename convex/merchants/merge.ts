import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { buildActivityContext, recordMerchantActivity } from '../activityLogs/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { moveMerchantReferencesAndMergeStats } from './helpers';

/**
 * Merge one merchant into another
 * - Updates all transactions from source to target merchant
 * - Merges monthly spending stats
 * - Soft deletes source merchant
 */
export const mergeMerchants = mutation({
  args: {
    workspaceId: v.id('workspace'),
    sourceMerchantId: v.id('merchant'),
    targetMerchantId: v.id('merchant'),
  },
  handler: async (ctx, { workspaceId, sourceMerchantId, targetMerchantId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    // Validate source merchant
    const sourceMerchant = await ctx.db.get(sourceMerchantId);
    if (!sourceMerchant || sourceMerchant.workspaceId !== verifiedWorkspaceId || sourceMerchant.isDeleted) {
      throw new ConvexError('Source merchant not found');
    }

    // Validate target merchant
    const targetMerchant = await ctx.db.get(targetMerchantId);
    if (!targetMerchant || targetMerchant.workspaceId !== verifiedWorkspaceId || targetMerchant.isDeleted) {
      throw new ConvexError('Target merchant not found');
    }

    // Prevent merging merchant into itself
    if (sourceMerchantId === targetMerchantId) {
      throw new ConvexError('Cannot merge a merchant into itself');
    }

    const now = new Date().toISOString();

    const result = await moveMerchantReferencesAndMergeStats(ctx, {
      workspaceId: verifiedWorkspaceId,
      sourceMerchant,
      targetMerchant,
      now,
    });

    // Soft delete source merchant
    await ctx.db.patch(sourceMerchantId, {
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    });

    const mergedMerchant = await ctx.db.get(sourceMerchantId);
    if (mergedMerchant) {
      await recordMerchantActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'merchant_merged',
        before: sourceMerchant,
        after: mergedMerchant,
        mergeTarget: targetMerchant,
        movedTransactionCount: result.movedTransactionCount,
        updatedRecurringTransactionCount: result.updatedRecurringTransactionCount,
      });
    }

    return {
      mergedTransactionCount: result.movedTransactionCount,
      updatedRecurringTransactions: result.updatedRecurringTransactionCount,
    };
  },
});
