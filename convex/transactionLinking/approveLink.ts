import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { getOrCreateMerchantByName } from '../merchants/helpers';
import { scaleMovementsProportionally } from '../transactionImport/updateLinkedTransactions';
import { buildTransactionComputedFields } from '../transactions/helpers';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

/** Confirm a bank match, applying the user's choices through normal ledger reconciliation. */
export const approveTransactionLink = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
    resolutions: v.optional(
      v.object({
        useImportAmount: v.optional(v.boolean()),
        useImportDate: v.optional(v.boolean()),
        useImportMerchant: v.optional(v.boolean()),
      })
    ),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted) throw new ConvexError('Transaction not found');
    if (transaction.workspaceId !== workspaceId) throw new ConvexError('Access denied');
    if (!transaction.linkedRawTransactionId || transaction.type !== 'regular') {
      throw new ConvexError('Transaction has no linked import to approve');
    }
    const raw = await ctx.db.get(transaction.linkedRawTransactionId);
    if (!raw || raw.workspaceId !== workspaceId) throw new ConvexError('Raw transaction not found');

    const before = await buildSnapshotFromTransaction(ctx, transaction);
    const importDetails = {
      provider: 'plaid' as const,
      originalStatement: raw.originalStatement,
      merchantName: raw.merchantName,
      date: raw.date,
      postedDate: raw.postedDate,
      amount: raw.amount,
      authorizedDate: raw.authorizedDate,
    };
    const date = args.resolutions?.useImportDate ? raw.date : transaction.date;
    const movements = args.resolutions?.useImportAmount
      ? scaleMovementsProportionally(transaction.movements, transaction.totalAmount, raw.amount)
      : transaction.movements;
    const merchantName = raw.merchantName ?? raw.originalStatement;
    const merchantId =
      args.resolutions?.useImportMerchant && merchantName?.trim()
        ? await getOrCreateMerchantByName(ctx, workspaceId, merchantName, raw.logoUrl)
        : transaction.merchantId;
    const computed = await buildTransactionComputedFields(ctx, {
      merchantId,
      bankAccountId: transaction.bankAccountId,
      importDetails,
      transactionType: transaction.type,
      movements,
      notes: transaction.notes,
    });
    await ctx.db.patch(transaction._id, {
      ...computed,
      merchantId,
      importDetails,
      date,
      dateYearMonth: dateToYearMonth(date),
      status: transaction.status === 'reconciled' ? 'reconciled' : raw.pending ? 'pending' : 'cleared',
      reviewStatus: 'reviewed',
      originalApprovedAmount: undefined,
      updatedAt: new Date().toISOString(),
    });
    const updated = await ctx.db.get(transaction._id);
    if (updated) {
      await reconcileTransactionSideEffects(ctx, before, await buildSnapshotFromTransaction(ctx, updated));
      await recordTransactionActivity(ctx, {
        workspaceId,
        context: await buildActivityContext(ctx, { clerkId: user.subject, source: { type: 'kualia_ui' } }),
        type: 'transaction_updated',
        before: transaction,
        after: updated,
      });
    }
    return { success: true };
  },
});
