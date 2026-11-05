import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import {
  buildActivityContextForClerkId,
  buildSystemActivityContextForWorkspace,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { buildSearchText, resolveMerchantName } from '../transactions/helpers';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

type EmbeddedMovement = Doc<'transaction'>['movements'][number];

/**
 * Scale movements proportionally when total amount changes (for split transactions)
 * Last movement gets the remainder to ensure exact sum
 */
export function scaleMovementsProportionally(
  movements: EmbeddedMovement[],
  oldTotal: bigint,
  newTotal: bigint
): EmbeddedMovement[] {
  if (movements.length === 0) {
    return [{ amount: newTotal, readyToAssign: false, sortOrder: 0 }];
  }
  if (oldTotal === 0n) {
    // Edge case: distribute evenly if original was zero
    const perMovement = newTotal / BigInt(movements.length);
    const remainder = newTotal - perMovement * BigInt(movements.length);
    return movements.map((m, i) => ({
      ...m,
      amount: i === movements.length - 1 ? perMovement + remainder : perMovement,
    }));
  }

  const scaled: EmbeddedMovement[] = [];
  let runningTotal = 0n;

  for (let i = 0; i < movements.length; i++) {
    const movement = movements[i];
    if (i === movements.length - 1) {
      // Last movement gets remainder to ensure exact sum
      scaled.push({ ...movement, amount: newTotal - runningTotal });
    } else {
      const newMovementAmount = (movement.amount * newTotal) / oldTotal;
      scaled.push({ ...movement, amount: newMovementAmount });
      runningTotal += newMovementAmount;
    }
  }
  return scaled;
}

/**
 * Internal mutation to update linked transactions when Plaid sends modified data
 *
 * Update rules based on reviewStatus:
 * - needs_review: Update ALL changed properties (date, status, amount, importDetails)
 * - reviewed: ONLY update status (pending→cleared) to preserve user-approved data
 * - reconciled: Do not change status (user has verified against bank statement)
 */
export const updateLinkedTransactionsFromRawImports = internalMutation({
  args: {
    rawImportIds: v.array(v.id('transactionImportRaw')),
  },
  returns: v.object({ updatedCount: v.number(), skippedCount: v.number() }),
  handler: async (ctx, { rawImportIds }) => {
    console.log(`\n========== updateLinkedTransactionsFromRawImports START ==========`);
    console.log(`Processing ${rawImportIds.length} raw import(s)`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    let updatedCount = 0;
    let skippedCount = 0;
    const activityContexts = new Map<string, ActivityContext>();

    for (const rawImportId of rawImportIds) {
      const rawImport = await ctx.db.get(rawImportId);
      if (!rawImport) {
        console.log(`Raw import ${rawImportId} not found, skipping`);
        skippedCount++;
        continue;
      }

      // Only process already-inserted imports
      if (rawImport.importStatus !== 'inserted') {
        console.log(`Raw import ${rawImportId} status is ${rawImport.importStatus}, skipping`);
        skippedCount++;
        continue;
      }

      // Find linked transaction using the index
      const transaction = await ctx.db
        .query('transaction')
        .withIndex('by_transactionImportRawId', (q) => q.eq('transactionImportRawId', rawImportId))
        .first();

      if (!transaction) {
        console.log(`No linked transaction found for raw import ${rawImportId}, skipping`);
        skippedCount++;
        continue;
      }

      // Skip deleted transactions
      if (transaction.isDeleted) {
        console.log(`Transaction ${transaction._id} is deleted, skipping`);
        skippedCount++;
        continue;
      }

      // Skip non-regular transactions (transfers, starting_balance, balance_adjustment)
      if (transaction.type !== 'regular') {
        console.log(`Transaction ${transaction._id} type is ${transaction.type}, skipping`);
        skippedCount++;
        continue;
      }

      // Skip entries without a bank import or a matched manual/planned entry.
      if (transaction.source !== 'automatic_import' && !transaction.linkedRawTransactionId) {
        console.log(`Transaction ${transaction._id} source is ${transaction.source}, skipping`);
        skippedCount++;
        continue;
      }

      if (transaction.workspaceId !== rawImport.workspaceId) {
        skippedCount++;
        continue;
      }

      const bankLinkAccount = await ctx.db
        .query('bankLinkAccount')
        .withIndex('by_plaidAccountId', (q) => q.eq('plaidAccountId', rawImport.plaidAccountId))
        .first();
      const bankLink = bankLinkAccount ? await ctx.db.get(bankLinkAccount.bankLinkId) : null;
      const contextKey = bankLink?.ownerId ?? `workspace:${transaction.workspaceId}`;
      let activityContext = activityContexts.get(contextKey);
      if (!activityContext) {
        activityContext = bankLink?.ownerId
          ? await buildActivityContextForClerkId(ctx, bankLink.ownerId, {
              type: 'system',
              process: 'bank_import',
            })
          : await buildSystemActivityContextForWorkspace(ctx, transaction.workspaceId, 'bank_import');
        activityContexts.set(contextKey, activityContext);
      }

      const updated = await applyUpdatesToTransaction(ctx, rawImport, transaction, activityContext);
      if (updated) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(`\n[RESULT] Updated: ${updatedCount}, Skipped: ${skippedCount}`);
    console.log(`========== updateLinkedTransactionsFromRawImports END ==========\n`);

    return { updatedCount, skippedCount };
  },
});

/**
 * Apply updates from raw import to transaction based on reviewStatus
 */
async function applyUpdatesToTransaction(
  ctx: MutationCtx,
  rawImport: Doc<'transactionImportRaw'>,
  transaction: Doc<'transaction'>,
  activityContext: ActivityContext
): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const isReviewed = transaction.reviewStatus === 'reviewed';
  const newStatus = rawImport.pending ? 'pending' : 'cleared';

  // Snapshot before any mutation
  const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

  // Build the patch object
  const patch: Partial<Doc<'transaction'>> & { updatedAt: string } = {
    updatedAt: timestamp,
  };

  let hasChanges = false;

  // A manual/planned match keeps the user's entry until they resolve differences.
  // Still refresh the bank snapshot so approval/unlink uses current posted data.
  if (transaction.linkedRawTransactionId) {
    patch.importDetails = {
      provider: 'plaid',
      originalStatement: rawImport.originalStatement,
      merchantName: rawImport.merchantName,
      date: rawImport.date,
      postedDate: rawImport.postedDate,
      amount: rawImport.amount,
      authorizedDate: rawImport.authorizedDate,
    };
    if (transaction.importDetails?.amount !== rawImport.amount) {
      patch.reviewStatus = 'needs_review';
    }
    if (transaction.status !== 'reconciled') patch.status = newStatus;
    await ctx.db.patch(transaction._id, patch);
    const updated = await ctx.db.get(transaction._id);
    if (updated) {
      await reconcileTransactionSideEffects(ctx, beforeSnapshot, await buildSnapshotFromTransaction(ctx, updated));
      await recordTransactionActivity(ctx, {
        workspaceId: transaction.workspaceId,
        context: activityContext,
        type: 'transaction_updated',
        before: transaction,
        after: updated,
      });
    }
    return true;
  }

  // ALWAYS update status (pending→cleared) unless reconciled
  if (transaction.status !== 'reconciled' && transaction.status !== newStatus) {
    patch.status = newStatus;
    hasChanges = true;
    console.log(`  Transaction ${transaction._id}: status ${transaction.status} → ${newStatus}`);
  }

  // Amount change detection
  const oldAmount = transaction.totalAmount ?? 0n;
  const newAmount = rawImport.amount;
  const amountChanged = oldAmount !== newAmount;

  // When a user-approved transaction clears with a different amount (e.g., tip added),
  // flip it back to needs_review so the user can approve the change
  if (isReviewed && amountChanged && transaction.status !== 'reconciled') {
    console.log(`  Transaction ${transaction._id}: amount changed on reviewed transaction ${oldAmount} → ${newAmount}`);

    // 1. Store original approved amount (only if not already set - preserves first original)
    if (transaction.originalApprovedAmount === undefined) {
      patch.originalApprovedAmount = oldAmount;
    }

    // 2. Update totalAmount
    patch.totalAmount = newAmount;

    // 3. Update movement amounts
    if (transaction.movements.length === 1) {
      const movement = transaction.movements[0];
      patch.movements = [{ ...movement, amount: newAmount }];
    } else {
      // Split transactions: scale each movement proportionally
      patch.movements = scaleMovementsProportionally(transaction.movements, oldAmount, newAmount);
    }

    // 4. Set reviewStatus back to needs_review
    patch.reviewStatus = 'needs_review';

    // 5. Update importDetails snapshot
    patch.importDetails = {
      provider: 'plaid' as const,
      originalStatement: rawImport.originalStatement,
      merchantName: rawImport.merchantName,
      date: rawImport.date,
      postedDate: rawImport.postedDate,
      amount: rawImport.amount,
      authorizedDate: rawImport.authorizedDate,
    };

    // 6. Rebuild searchText with new amount
    const merchantName = await resolveMerchantName(ctx, transaction.merchantId, transaction.importDetails);
    const categoryNames = (patch.movements ?? transaction.movements)
      .map((m) => m.categoryName)
      .filter((n): n is string => !!n);
    patch.searchText = buildSearchText(merchantName, categoryNames, newAmount, transaction.type, transaction.notes);

    hasChanges = true;
  }

  // For needs_review: update all changed properties
  if (!isReviewed) {
    // Date change
    if (rawImport.date !== transaction.date) {
      patch.date = rawImport.date;
      hasChanges = true;
      console.log(`  Transaction ${transaction._id}: date ${transaction.date} → ${rawImport.date}`);
    }

    // Amount change
    if (amountChanged) {
      // Skip amount updates for split transactions (multiple movements)
      if (transaction.movements.length > 1) {
        console.log(
          `  Transaction ${transaction._id}: skipping amount update (split transaction with ${transaction.movements.length} movements)`
        );
      } else {
        // Update movement amount (single movement for imported transactions)
        const movement = transaction.movements[0];
        if (movement) {
          patch.movements = [
            {
              ...movement,
              amount: newAmount,
            },
          ];
          patch.totalAmount = newAmount;

          // Rebuild searchText with new amount
          const merchantName = await resolveMerchantName(ctx, transaction.merchantId, transaction.importDetails);
          const categoryNames = movement.categoryName ? [movement.categoryName] : [];
          patch.searchText = buildSearchText(
            merchantName,
            categoryNames,
            newAmount,
            transaction.type,
            transaction.notes
          );

          hasChanges = true;
          console.log(`  Transaction ${transaction._id}: amount ${oldAmount} → ${newAmount}`);
        }
      }
    }

    // Update importDetails snapshot with fresh Plaid data
    patch.importDetails = {
      provider: 'plaid' as const,
      originalStatement: rawImport.originalStatement,
      merchantName: rawImport.merchantName,
      date: rawImport.date,
      postedDate: rawImport.postedDate,
      amount: rawImport.amount,
      authorizedDate: rawImport.authorizedDate,
    };
    hasChanges = true;
  }

  // Only patch if there are actual changes
  if (hasChanges) {
    await ctx.db.patch(transaction._id, patch);

    // Reconcile all side effects (balance, category spending, RTA, etc.)
    const updatedTransaction = await ctx.db.get(transaction._id);
    if (updatedTransaction) {
      const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
      await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);
      await recordTransactionActivity(ctx, {
        workspaceId: transaction.workspaceId,
        context: activityContext,
        type: 'transaction_updated',
        before: transaction,
        after: updatedTransaction,
      });
    }

    return true;
  }

  console.log(`  Transaction ${transaction._id}: no changes detected`);
  return false;
}
