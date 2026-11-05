import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { getOrCreateMerchantByName } from '../merchants/helpers';
import { buildTransactionComputedFields } from '../transactions/helpers';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

/** Keep the user's entry and materialize the rejected bank import as a separate transaction. */
export const unlinkTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted) throw new ConvexError('Transaction not found');
    if (transaction.workspaceId !== workspaceId) throw new ConvexError('Access denied');
    if (!transaction.linkedRawTransactionId || transaction.type !== 'regular') {
      throw new ConvexError('Transaction has no linked import to unlink');
    }
    const rawTransactionId = transaction.linkedRawTransactionId;
    const raw = await ctx.db.get(rawTransactionId);
    if (!raw || raw.workspaceId !== workspaceId) throw new ConvexError('Raw transaction not found');
    const timestamp = new Date().toISOString();
    const context = await buildActivityContext(ctx, { clerkId: user.subject, source: { type: 'kualia_ui' } });
    const computedManual = await buildTransactionComputedFields(ctx, {
      merchantId: transaction.merchantId,
      bankAccountId: transaction.bankAccountId,
      transactionType: transaction.type,
      movements: transaction.movements,
      notes: transaction.notes,
    });
    await ctx.db.patch(transaction._id, {
      ...computedManual,
      linkedRawTransactionId: undefined,
      linkedAt: undefined,
      linkConfidence: undefined,
      linkReason: undefined,
      importDetails: undefined,
      transactionImportRawId: undefined,
      originalApprovedAmount: undefined,
      reviewStatus: 'reviewed',
      rejectedLinkIds: [...new Set([...(transaction.rejectedLinkIds ?? []), rawTransactionId])],
      updatedAt: timestamp,
    });
    const unlinked = await ctx.db.get(transaction._id);
    if (unlinked) {
      await recordTransactionActivity(ctx, {
        workspaceId,
        context,
        type: 'transaction_updated',
        before: transaction,
        after: unlinked,
      });
    }

    // Use the latest bank data, including pending-to-posted changes since the match.
    const importDetails = {
      provider: 'plaid' as const,
      originalStatement: raw.originalStatement,
      merchantName: raw.merchantName,
      date: raw.date,
      postedDate: raw.postedDate,
      amount: raw.amount,
      authorizedDate: raw.authorizedDate,
    };
    // Resolve the bank's merchant independently of the rejected manual entry.
    const merchantName = raw.merchantName ?? raw.originalStatement;
    const merchantId = merchantName?.trim()
      ? await getOrCreateMerchantByName(ctx, workspaceId, merchantName, raw.logoUrl)
      : undefined;
    const computed = await buildTransactionComputedFields(ctx, {
      merchantId,
      bankAccountId: transaction.bankAccountId,
      importDetails,
      transactionType: 'regular',
      movements: [{ readyToAssign: false, amount: raw.amount, sortOrder: 0 }],
    });
    const importedId = await ctx.db.insert('transaction', {
      ...computed,
      merchantId,
      bankAccountId: transaction.bankAccountId,
      date: raw.date,
      dateYearMonth: dateToYearMonth(raw.date),
      status: raw.pending ? 'pending' : 'cleared',
      importDetails,
      type: 'regular',
      source: 'automatic_import',
      reviewStatus: 'needs_review',
      transactionImportRawId: rawTransactionId,
      isDeleted: false,
      workspaceId,
      updatedAt: timestamp,
    });
    const imported = await ctx.db.get(importedId);
    if (imported) {
      await reconcileTransactionSideEffects(ctx, null, await buildSnapshotFromTransaction(ctx, imported));
      await recordTransactionActivity(ctx, { workspaceId, context, type: 'transaction_created', after: imported });
    }
    return { success: true };
  },
});
