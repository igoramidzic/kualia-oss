import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { mutation } from '../../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../../activityLogs/helpers';
import { requireWorkspaceAccess } from '../../lib/auth';

import { buildTransactionComputedFields } from '../helpers';
import { buildSnapshotFromTransaction } from '../reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../reconciliation/reconcile';
import { convertFromTransferInternal } from '../transfer';

// ==============================================================
// INTERNAL HELPER FUNCTION
// ==============================================================

/**
 * Internal helper: Convert any transaction to a system type (starting_balance or balance_adjustment)
 */
async function convertToSystemTypeInternal(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    transactionId: Id<'transaction'>;
  },
  targetType: 'starting_balance' | 'balance_adjustment'
): Promise<{ success: boolean }> {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

  // Get the transaction
  const transaction = await ctx.db.get(args.transactionId);
  if (!transaction || transaction.isDeleted) {
    throw new ConvexError('Transaction not found');
  }

  // Verify workspace access
  if (transaction.workspaceId !== verifiedWorkspaceId) {
    throw new ConvexError('Access denied to workspace');
  }

  // Early return if already the target type
  if (transaction.type === targetType) {
    return { success: true };
  }

  let result: { success: boolean };
  // If this is a transfer, first convert from transfer (which deletes the paired transaction)
  if (transaction.type === 'transfer') {
    await convertFromTransferInternal(ctx, { transactionId: args.transactionId });
    // Re-fetch the transaction after conversion
    const updatedTransaction = await ctx.db.get(args.transactionId);
    if (!updatedTransaction) {
      throw new ConvexError('Transaction not found after transfer conversion');
    }
    // Continue with the updated transaction (now a regular transaction)
    result = await convertNonTransferToSystemType(ctx, updatedTransaction, verifiedWorkspaceId, targetType);
  } else {
    // Handle non-transfer transactions
    result = await convertNonTransferToSystemType(ctx, transaction, verifiedWorkspaceId, targetType);
  }

  const convertedTransaction = await ctx.db.get(args.transactionId);
  if (convertedTransaction) {
    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_updated',
      before: transaction,
      after: convertedTransaction,
    });
  }

  return result;
}

/**
 * Helper to convert a non-transfer transaction to a system type
 */
async function convertNonTransferToSystemType(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  _workspaceId: Id<'workspace'>,
  targetType: 'starting_balance' | 'balance_adjustment'
): Promise<{ success: boolean }> {
  // Build "before" snapshot before any mutations
  const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

  // Get current movements from embedded array
  const movements = transaction.movements ?? [];

  // Calculate transaction amount (use totalAmount if available)
  const transactionAmount = transaction.totalAmount ?? movements.reduce((sum, m) => sum + m.amount, 0n);

  const now = new Date().toISOString();

  // Build single uncategorized movement with the total amount
  const newMovementsInput = [
    {
      categoryId: undefined,
      readyToAssign: true,
      amount: transactionAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  // Build computed fields for the converted transaction
  const computedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: transaction.bankAccountId,
    transactionType: targetType,
    movements: newMovementsInput,
    notes: transaction.notes,
  });

  // Patch the transaction with the new type (clear merchantId - system types don't have merchants)
  await ctx.db.patch(transaction._id, {
    type: targetType,
    merchantId: undefined,
    transferPairId: undefined,
    transferPairBankAccountId: undefined,
    movements: computedFields.movements,
    searchText: computedFields.searchText,
    totalAmount: computedFields.totalAmount,
    hasUncategorized: computedFields.hasUncategorized,
    hasMissingPayee: computedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Re-read the transaction from DB for accurate "after" snapshot
  const updatedTransaction = await ctx.db.get(transaction._id);
  if (!updatedTransaction) {
    throw new ConvexError('Failed to read back converted transaction');
  }

  // Build "after" snapshot and reconcile side effects
  const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
  await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);

  return { success: true };
}

// ==============================================================
// PUBLIC MUTATIONS
// ==============================================================

/**
 * Convert any transaction to a starting balance transaction
 */
export const convertToStartingBalance = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    return convertToSystemTypeInternal(ctx, args, 'starting_balance');
  },
});

/**
 * Convert any transaction to a balance adjustment transaction
 */
export const convertToBalanceAdjustment = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    return convertToSystemTypeInternal(ctx, args, 'balance_adjustment');
  },
});
