import { ConvexError, v } from 'convex/values';

import { mutation } from '../../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../../activityLogs/helpers';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../../lib/auth';

import { buildTransactionComputedFields } from '../helpers';
import { buildEmbeddedMovements } from '../reconciliation/buildMovements';
import { buildSnapshotFromTransaction } from '../reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../reconciliation/reconcile';

/**
 * Create a balance adjustment transaction for manual balance corrections
 */
export const createBalanceAdjustmentTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    date: v.string(),
    movements: v.array(
      v.object({
        amount: v.int64(),
        categoryId: v.optional(v.id('category')),
        readyToAssign: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      })
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify workspace access
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Validate bank account exists and belongs to workspace
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.isDeleted) {
      throw new ConvexError('Bank account not found');
    }

    if (bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Build movements (NO side effects - just constructs movement data)
    const { embeddedMovements } = await buildEmbeddedMovements(ctx, {
      bankAccountId: args.bankAccountId,
      movements: args.movements,
      transactionType: 'balance_adjustment',
    });

    // Build computed fields (movements with category names, searchText, totalAmount, hasUncategorized)
    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: args.bankAccountId,
      transactionType: 'balance_adjustment',
      movements: embeddedMovements,
      notes: args.notes,
    });

    // Create the transaction
    const transactionId = await ctx.db.insert('transaction', {
      bankAccountId: args.bankAccountId,
      date: args.date,
      merchantId: undefined,
      notes: args.notes,
      status: 'cleared',
      type: 'balance_adjustment',
      isDeleted: false,
      source: 'manual',
      reviewStatus: 'reviewed',
      updatedAt: new Date().toISOString(),
      workspaceId: verifiedWorkspaceId,
      dateYearMonth: dateToYearMonth(args.date),
      // Embedded movements and computed fields
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
    });

    // Read back the inserted transaction and reconcile all side effects
    const transaction = await ctx.db.get(transactionId);
    if (!transaction) {
      throw new ConvexError('Failed to read back inserted transaction');
    }
    const afterSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
    await reconcileTransactionSideEffects(ctx, null, afterSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_created',
      after: transaction,
    });

    return transactionId;
  },
});
