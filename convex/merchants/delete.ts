import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordMerchantActivity } from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';
import {
  getActiveMerchantScheduledTransactions,
  getActiveMerchantTransactions,
  moveMerchantReferencesAndMergeStats,
} from './helpers';

const MERCHANT_DELETE_REQUIRES_TARGET_MESSAGE =
  'Merchant has transactions or planned transactions. Please choose another merchant to move them to before deleting.';

export async function deleteMerchantImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    merchantId,
    targetMerchantId,
    activityContext,
  }: {
    workspaceId: Id<'workspace'>;
    merchantId: Id<'merchant'>;
    targetMerchantId?: Id<'merchant'>;
    activityContext?: ActivityContext;
  }
): Promise<{
  success: true;
  movedTransactionCount: number;
  updatedRecurringTransactionCount: number;
}> {
  const merchant = await ctx.db.get(merchantId);
  if (!merchant || merchant.workspaceId !== workspaceId || merchant.isDeleted) {
    throw new ConvexError('Merchant not found');
  }

  if (targetMerchantId && merchantId === targetMerchantId) {
    throw new ConvexError('Cannot delete a merchant into itself');
  }

  const transactions = await getActiveMerchantTransactions(ctx, workspaceId, merchantId);
  const scheduledTransactions = await getActiveMerchantScheduledTransactions(ctx, workspaceId, merchantId);
  const hasReferences = transactions.length > 0 || scheduledTransactions.length > 0;

  if (hasReferences && !targetMerchantId) {
    throw new ConvexError(MERCHANT_DELETE_REQUIRES_TARGET_MESSAGE);
  }

  const now = new Date().toISOString();
  let movedTransactionCount = 0;
  let updatedRecurringTransactionCount = 0;
  let targetMerchant: Doc<'merchant'> | undefined;

  if (targetMerchantId) {
    targetMerchant = (await ctx.db.get(targetMerchantId)) ?? undefined;
    if (!targetMerchant || targetMerchant.workspaceId !== workspaceId || targetMerchant.isDeleted) {
      throw new ConvexError('Target merchant not found');
    }

    const result = await moveMerchantReferencesAndMergeStats(ctx, {
      workspaceId,
      sourceMerchant: merchant,
      targetMerchant,
      transactions,
      scheduledTransactions,
      now,
    });
    movedTransactionCount = result.movedTransactionCount;
    updatedRecurringTransactionCount = result.updatedRecurringTransactionCount;
  }

  await ctx.db.patch(merchantId, {
    isDeleted: true,
    deletedAt: now,
    updatedAt: now,
  });

  if (activityContext) {
    const deletedMerchant = await ctx.db.get(merchantId);
    if (deletedMerchant) {
      await recordMerchantActivity(ctx, {
        workspaceId,
        context: activityContext,
        type: 'merchant_deleted',
        before: merchant,
        after: deletedMerchant,
        mergeTarget: targetMerchant,
        movedTransactionCount,
        updatedRecurringTransactionCount,
      });
    }
  }

  return {
    success: true,
    movedTransactionCount,
    updatedRecurringTransactionCount,
  };
}

/**
 * Delete a merchant.
 * If the merchant has active transactions or planned transaction templates,
 * a target merchant is required and references are moved before soft deletion.
 */
export const deleteMerchant = mutation({
  args: {
    workspaceId: v.id('workspace'),
    merchantId: v.id('merchant'),
    targetMerchantId: v.optional(v.id('merchant')),
  },
  handler: async (ctx, { workspaceId, merchantId, targetMerchantId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });
    return await deleteMerchantImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      merchantId,
      targetMerchantId,
      activityContext,
    });
  },
});
