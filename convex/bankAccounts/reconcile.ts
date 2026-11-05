import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { type ActivityAttribution, activityAttributionValidator } from '../activityLogs/types';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { buildTransactionComputedFields } from '../transactions/helpers';
import { buildEmbeddedMovements } from '../transactions/reconciliation/buildMovements';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

type ReconcileBankAccountParams = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  reportedBalance?: bigint;
  includePending?: boolean;
  allowBalanceAdjustment?: boolean;
  expectedBalance?: bigint;
  reconciliationDate: string;
  attribution: ActivityAttribution;
};

type ReconcileBankAccountResult = {
  success: true;
  reconciledTransactionCount: number;
  reportedBalance: bigint;
  clearedBalanceBefore: bigint;
  balanceAdjustmentAmount: bigint;
  adjustmentCreated: boolean;
  balanceAdjustmentTransactionId: Id<'transaction'> | null;
  reconciledAt: string;
};

export async function reconcileBankAccountForWorkspace(
  ctx: MutationCtx,
  {
    workspaceId,
    bankAccountId,
    reportedBalance,
    reconciliationDate,
    attribution,
    includePending = false,
    allowBalanceAdjustment = true,
    expectedBalance,
  }: ReconcileBankAccountParams
): Promise<ReconcileBankAccountResult> {
  const activityContext = await buildActivityContext(ctx, attribution);
  // Validate bank account exists and belongs to workspace
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount || bankAccount.isDeleted) {
    throw new ConvexError('Bank account not found');
  }

  if (bankAccount.workspaceId !== workspaceId) {
    throw new ConvexError('Access denied to workspace');
  }
  if (bankAccount.isClosed) {
    throw new ConvexError('Reopen this account before reconciling it.');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(reconciliationDate) ||
    !Number.isFinite(Date.parse(reconciliationDate)) ||
    new Date(reconciliationDate).toISOString().slice(0, 10) !== reconciliationDate
  ) {
    throw new ConvexError('Enter a valid reconciliation date.');
  }

  const clearedBalance = bankAccount.clearedBalance ?? bankAccount.currentBalance - (bankAccount.pendingBalance ?? 0n);
  const comparisonBalance = includePending ? bankAccount.currentBalance : clearedBalance;
  if (expectedBalance !== undefined && expectedBalance !== comparisonBalance) {
    throw new ConvexError('The account balance changed. Review the updated difference and try again.');
  }
  const isConfirmingBalance = reportedBalance === undefined;
  const balanceDifference = isConfirmingBalance ? 0n : reportedBalance - comparisonBalance;
  if (!allowBalanceAdjustment && (isConfirmingBalance || balanceDifference !== 0n)) {
    throw new ConvexError('The balances must match before reconciling without an adjustment.');
  }
  if (
    [balanceDifference, bankAccount.currentBalance + balanceDifference, clearedBalance + balanceDifference].some(
      (amount) => amount < -(1n << 63n) || amount > (1n << 63n) - 1n
    )
  ) {
    throw new ConvexError('The balance adjustment is too large.');
  }

  // Create balance adjustment transaction if needed (Flow 2 only)
  let adjustmentCreated = false;
  let balanceAdjustmentTransactionId: Id<'transaction'> | null = null;
  if (!isConfirmingBalance && balanceDifference !== 0n) {
    // Older accounts may predate cleared/pending tracking. Seed the derived
    // cleared balance before the shared transaction pipeline applies its delta.
    if (bankAccount.clearedBalance === undefined) {
      await ctx.db.patch(bankAccountId, { clearedBalance });
    }
    // Create balance adjustment transaction with a single movement to Ready to Assign
    // Build movements (pure data, no side effects)
    const { embeddedMovements } = await buildEmbeddedMovements(ctx, {
      bankAccountId,
      movements: [
        {
          amount: balanceDifference,
          readyToAssign: true,
          notes: 'Reconciliation adjustment',
        },
      ],
      transactionType: 'balance_adjustment',
    });

    // Build computed fields
    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId,
      transactionType: 'balance_adjustment',
      movements: embeddedMovements,
    });

    // Create transaction
    const newTransactionId = await ctx.db.insert('transaction', {
      bankAccountId,
      date: reconciliationDate,
      merchantId: undefined,
      notes: undefined,
      status: 'cleared',
      type: 'balance_adjustment',
      isDeleted: false,
      source: 'manual',
      reviewStatus: 'reviewed',
      updatedAt: new Date().toISOString(),
      workspaceId,
      dateYearMonth: dateToYearMonth(reconciliationDate),
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
    });

    // Reconcile all side effects (balance, RTA, etc.)
    const newTransaction = await ctx.db.get(newTransactionId);
    if (newTransaction) {
      const afterSnapshot = await buildSnapshotFromTransaction(ctx, newTransaction);
      await reconcileTransactionSideEffects(ctx, null, afterSnapshot);
      await recordTransactionActivity(ctx, {
        workspaceId,
        context: activityContext,
        type: 'transaction_created',
        after: newTransaction,
      });
    }
    adjustmentCreated = true;
    balanceAdjustmentTransactionId = newTransactionId;
  }

  // Query all transactions to mark as reconciled
  // Criteria: reviewStatus === 'reviewed' AND status === 'cleared' AND NOT isDeleted
  const transactionsToReconcile = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
      q.eq('workspaceId', workspaceId).eq('bankAccountId', bankAccountId).eq('isDeleted', false)
    )
    .filter((q) => q.and(q.eq(q.field('reviewStatus'), 'reviewed'), q.eq(q.field('status'), 'cleared')))
    .collect();

  // Mark all transactions as reconciled (bulk update)
  const timestamp = new Date().toISOString();
  for (const transaction of transactionsToReconcile) {
    await ctx.db.patch(transaction._id, {
      status: 'reconciled',
      updatedAt: timestamp,
    });
    const updatedTransaction = await ctx.db.get(transaction._id);
    if (updatedTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId,
        context: activityContext,
        type: 'transaction_updated',
        before: transaction,
        after: updatedTransaction,
      });
    }
  }

  // Update bank account reconciliation timestamp
  await ctx.db.patch(bankAccountId, {
    lastReconciledAt: timestamp,
    updatedAt: timestamp,
  });

  // Return result summary
  return {
    success: true,
    reconciledTransactionCount: transactionsToReconcile.length,
    reportedBalance: reportedBalance ?? comparisonBalance,
    clearedBalanceBefore: clearedBalance,
    balanceAdjustmentAmount: balanceDifference,
    adjustmentCreated,
    balanceAdjustmentTransactionId,
    reconciledAt: timestamp,
  };
}

const reconcileResultValidator = v.object({
  success: v.literal(true),
  reconciledTransactionCount: v.number(),
  reportedBalance: v.int64(),
  clearedBalanceBefore: v.int64(),
  balanceAdjustmentAmount: v.int64(),
  adjustmentCreated: v.boolean(),
  balanceAdjustmentTransactionId: v.union(v.id('transaction'), v.null()),
  reconciledAt: v.string(),
});

export async function reconcileBankAccountHandler(
  ctx: MutationCtx,
  { workspaceId, ...args }: Omit<ReconcileBankAccountParams, 'attribution'>
): Promise<ReconcileBankAccountResult> {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
  return await reconcileBankAccountForWorkspace(ctx, {
    workspaceId: verifiedWorkspaceId,
    ...args,
    attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
  });
}

// Pending amounts may be compared, but pending transactions never become reconciled.
// Optional flags preserve the existing web/MCP adjustment behavior.
export const reconcileBankAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    reportedBalance: v.optional(v.int64()), // undefined = Flow 1 (confirm), value = Flow 2 (adjust)
    includePending: v.optional(v.boolean()),
    allowBalanceAdjustment: v.optional(v.boolean()),
    expectedBalance: v.optional(v.int64()),
    reconciliationDate: v.string(), // ISO date string (YYYY-MM-DD) for balance adjustment
  },
  returns: reconcileResultValidator,
  handler: reconcileBankAccountHandler,
});

export const reconcileBankAccountForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    reportedBalance: v.int64(),
    reconciliationDate: v.string(),
    attribution: activityAttributionValidator,
  },
  returns: reconcileResultValidator,
  handler: async (ctx, args) => {
    return await reconcileBankAccountForWorkspace(ctx, args);
  },
});
