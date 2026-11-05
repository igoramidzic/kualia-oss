import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext, recordBankAccountActivity, recordCategoryActivity } from '../activityLogs/helpers';
import { type ActivityAttribution, activityAttributionValidator } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

type DeleteBankAccountForWorkspaceArgs = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  attribution: ActivityAttribution;
};

/**
 * Shared soft-delete implementation. Assumes `workspaceId` has already been
 * resolved and authorized by the caller. Refuses to delete an account that
 * still has non-deleted transactions.
 */
export async function deleteBankAccountForWorkspace(
  ctx: MutationCtx,
  { workspaceId: verifiedWorkspaceId, bankAccountId, attribution }: DeleteBankAccountForWorkspaceArgs
): Promise<{ success: true }> {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId || bankAccount.isDeleted) {
    throw new ConvexError('Bank account not found or does not belong to workspace');
  }

  // Check if there are any non-deleted transactions for this account
  const hasTransactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
    .filter((q) => q.and(q.eq(q.field('bankAccountId'), bankAccountId), q.eq(q.field('isDeleted'), false)))
    .first();

  if (hasTransactions) {
    throw new ConvexError('Cannot delete bank account with existing transactions');
  }
  const context = await buildActivityContext(ctx, attribution);
  const timestamp = new Date().toISOString();

  // Find and delete the linked credit card category if it exists
  const creditCardCategory = await ctx.db
    .query('category')
    .withIndex('by_bankAccountId_isDeleted_deletedAt', (q) =>
      q.eq('bankAccountId', bankAccountId).eq('isDeleted', false)
    )
    .first();

  if (creditCardCategory) {
    await ctx.db.patch(creditCardCategory._id, {
      isDeleted: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
    });
    const deletedCategory = await ctx.db.get(creditCardCategory._id);
    if (deletedCategory) {
      await recordCategoryActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context,
        type: 'category_deleted',
        before: creditCardCategory,
        after: deletedCategory,
      });
    }
  }

  await ctx.db.patch(bankAccountId, {
    isDeleted: true,
    deletedAt: timestamp,
    updatedAt: timestamp,
  });

  const deletedBankAccount = await ctx.db.get(bankAccountId);
  if (deletedBankAccount) {
    await recordBankAccountActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context,
      type: 'bank_account_deleted',
      before: bankAccount,
      after: deletedBankAccount,
    });
  }

  return { success: true };
}

/**
 * Delete a bank account (soft delete)
 */
export const deleteBankAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, { workspaceId, bankAccountId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return deleteBankAccountForWorkspace(ctx, {
      workspaceId: verifiedWorkspaceId,
      bankAccountId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId (already
 * resolved and authorized by the MCP handler).
 */
export const deleteBankAccountForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    attribution: activityAttributionValidator,
  },
  handler: (ctx, args) => deleteBankAccountForWorkspace(ctx, args),
});

/**
 * Restore an archived bank account
 */
export async function restoreBankAccountHandler(
  ctx: MutationCtx,
  { workspaceId, bankAccountId }: { workspaceId: Id<'workspace'>; bankAccountId: Id<'bankAccount'> }
): Promise<{ success: true }> {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
    throw new ConvexError('Bank account not found or does not belong to workspace');
  }
  if (!bankAccount.isDeleted) return { success: true };

  const context = await buildActivityContext(ctx, {
    clerkId: user.subject,
    source: { type: 'kualia_ui' },
  });
  const timestamp = new Date().toISOString();
  // Only restore the category removed by this same deletion, not older archived categories.
  if (bankAccount.deletedAt) {
    const category = await ctx.db
      .query('category')
      .withIndex('by_bankAccountId_isDeleted_deletedAt', (q) =>
        q.eq('bankAccountId', bankAccountId).eq('isDeleted', true).eq('deletedAt', bankAccount.deletedAt)
      )
      .first();
    if (category) {
      const categoryWorkspace = category.workspaceId ?? (await ctx.db.get(category.categoryGroupId))?.workspaceId;
      if (categoryWorkspace !== verifiedWorkspaceId) {
        throw new ConvexError('Category does not belong to workspace');
      }
      await ctx.db.patch(category._id, { isDeleted: false, deletedAt: undefined, updatedAt: timestamp });
      const restoredCategory = await ctx.db.get(category._id);
      if (restoredCategory) {
        await recordCategoryActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context,
          type: 'category_restored',
          before: category,
          after: restoredCategory,
        });
      }
    }
  }
  await ctx.db.patch(bankAccountId, { isDeleted: false, deletedAt: undefined, updatedAt: timestamp });
  const restoredBankAccount = await ctx.db.get(bankAccountId);
  if (restoredBankAccount) {
    await recordBankAccountActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context,
      type: 'bank_account_restored',
      before: bankAccount,
      after: restoredBankAccount,
    });
  }
  return { success: true };
}

export const restoreBankAccount = mutation({
  args: { workspaceId: v.id('workspace'), bankAccountId: v.id('bankAccount') },
  returns: v.object({ success: v.literal(true) }),
  handler: restoreBankAccountHandler,
});

/**
 * Permanently delete a bank account
 */
export const permanentlyDeleteBankAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, { workspaceId, bankAccountId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Bank account not found or does not belong to workspace');
    }

    await ctx.db.delete(bankAccountId);

    return { success: true };
  },
});
