import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { buildActivityContext, recordBankAccountActivity, recordTransactionActivity } from '../activityLogs/helpers';
import { activityAttributionValidator, type ActivityAttribution } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

type CloseBankAccountArgs = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
};

type CloseBankAccountForWorkspaceArgs = CloseBankAccountArgs & {
  attribution: ActivityAttribution;
};

/**
 * Shared close implementation. Assumes `workspaceId` has already been resolved
 * and authorized by the caller.
 *
 * When closing:
 * - Reconciles the account (marks reviewed & cleared transactions as reconciled)
 * - Sets isClosed = true with closedAt timestamp
 * - Removes bankLinkAccountId and financeKitAccountId
 * - Keeps all transactions intact for historical access
 * - Account can be reopened at any time
 */
export async function closeBankAccountForWorkspace(
  ctx: MutationCtx,
  { workspaceId: verifiedWorkspaceId, bankAccountId, attribution }: CloseBankAccountForWorkspaceArgs
): Promise<{ success: true }> {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
    throw new ConvexError('Bank account not found or does not belong to workspace');
  }

  if (bankAccount.isDeleted) {
    throw new ConvexError('Cannot close a deleted bank account');
  }

  if (bankAccount.isClosed) {
    throw new ConvexError('Bank account is already closed');
  }

  const timestamp = new Date().toISOString();
  const context = await buildActivityContext(ctx, attribution);

  // Reconcile the account: mark all reviewed & cleared transactions as reconciled
  const transactionsToReconcile = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
      q.eq('workspaceId', verifiedWorkspaceId).eq('bankAccountId', bankAccountId).eq('isDeleted', false)
    )
    .filter((q) => q.and(q.eq(q.field('reviewStatus'), 'reviewed'), q.eq(q.field('status'), 'cleared')))
    .collect();

  // Mark all transactions as reconciled
  for (const transaction of transactionsToReconcile) {
    await ctx.db.patch(transaction._id, {
      status: 'reconciled',
      updatedAt: timestamp,
    });
    const updatedTransaction = await ctx.db.get(transaction._id);
    if (updatedTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context,
        type: 'transaction_updated',
        before: transaction,
        after: updatedTransaction,
      });
    }
  }

  if (bankAccount.financeKitAccountId) {
    const financeKitAccount = await ctx.db.get(bankAccount.financeKitAccountId);
    if (financeKitAccount) {
      await ctx.db.patch(financeKitAccount._id, {
        bankAccountId: undefined,
        updatedAt: timestamp,
      });
    }
  }

  // Update bank account: set closed, remove links, and set reconciliation timestamp
  await ctx.db.patch(bankAccountId, {
    isClosed: true,
    closedAt: timestamp,
    bankLinkAccountId: undefined,
    financeKitAccountId: undefined,
    lastReconciledAt: timestamp,
    updatedAt: timestamp,
  });

  const closedBankAccount = await ctx.db.get(bankAccountId);
  if (closedBankAccount) {
    await recordBankAccountActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context,
      type: 'bank_account_closed',
      before: bankAccount,
      after: closedBankAccount,
    });
  }

  return { success: true };
}

export async function closeBankAccountHandler(
  ctx: MutationCtx,
  { workspaceId, bankAccountId }: CloseBankAccountArgs
): Promise<{ success: true }> {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
  return closeBankAccountForWorkspace(ctx, {
    workspaceId: verifiedWorkspaceId,
    bankAccountId,
    attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
  });
}

export const closeBankAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: closeBankAccountHandler,
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId (already
 * resolved and authorized by the MCP handler).
 */
export const closeBankAccountForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    attribution: activityAttributionValidator,
  },
  handler: (ctx, args) => closeBankAccountForWorkspace(ctx, args),
});

/**
 * Reopen a closed bank account
 *
 * When reopening:
 * - Sets isClosed = false, clears closedAt
 * - bankLinkAccountId remains undefined (manual reconnection required)
 * - Retains all historical transactions
 */
export const reopenBankAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, { workspaceId, bankAccountId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Bank account not found or does not belong to workspace');
    }

    if (bankAccount.isDeleted) {
      throw new ConvexError('Cannot reopen a deleted bank account');
    }

    if (!bankAccount.isClosed) {
      throw new ConvexError('Bank account is not closed');
    }

    await ctx.db.patch(bankAccountId, {
      isClosed: false,
      closedAt: undefined,
      updatedAt: new Date().toISOString(),
    });

    const reopenedBankAccount = await ctx.db.get(bankAccountId);
    if (reopenedBankAccount) {
      await recordBankAccountActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'bank_account_reopened',
        before: bankAccount,
        after: reopenedBankAccount,
      });
    }

    return { success: true };
  },
});
