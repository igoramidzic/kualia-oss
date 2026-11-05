import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

import { buildTransactionComputedFields, getCreditCardCategoryForAccount, isCreditCardAccount } from '../helpers';
import { buildSnapshotFromTransaction } from '../reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../reconciliation/reconcile';

/**
 * Apply a category change to a transaction, handling credit card metadata and spending updates.
 *
 * For credit card accounts: sets `creditCardTransfer` metadata on the movement.
 * Uses reconcileTransactionSideEffects to handle all spending updates (regular and CC).
 * Always rebuilds computed fields (searchText, hasUncategorized, etc.).
 */
export async function applyCategoryChangeToTransaction(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    transactionId: Id<'transaction'>;
    transaction: Doc<'transaction'>;
    newCategoryId: Id<'category'>;
    movementIndex?: number;
  }
): Promise<void> {
  const { transactionId, transaction, newCategoryId, movementIndex = 0 } = args;

  // Snapshot before mutation
  const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

  const usesCreditCard = await isCreditCardAccount(ctx, transaction.bankAccountId);
  const creditCardCategoryId = usesCreditCard
    ? await getCreditCardCategoryForAccount(ctx, transaction.bankAccountId)
    : null;

  const movements = transaction.movements ?? [];
  const updatedMovementsInput = movements.map((m, index) => {
    const baseMovement = {
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign,
      amount: m.amount,
      notes: m.notes,
      sortOrder: m.sortOrder,
      creditCardTransfer: m.creditCardTransfer,
    };

    if (index !== movementIndex) {
      return baseMovement;
    }

    return {
      ...baseMovement,
      categoryId: newCategoryId,
      creditCardTransfer:
        usesCreditCard && creditCardCategoryId
          ? { creditCardCategoryId, spendingCategoryId: newCategoryId }
          : undefined,
    };
  });

  const computedFields = await buildTransactionComputedFields(ctx, {
    merchantId: transaction.merchantId,
    bankAccountId: transaction.bankAccountId,
    transactionType: transaction.type,
    movements: updatedMovementsInput,
    notes: transaction.notes,
  });

  await ctx.db.patch(transactionId, {
    movements: computedFields.movements,
    searchText: computedFields.searchText,
    hasUncategorized: computedFields.hasUncategorized,
    hasMissingPayee: computedFields.hasMissingPayee,
    updatedAt: new Date().toISOString(),
  });

  // Snapshot after mutation and reconcile all side effects
  const updatedTransaction = await ctx.db.get(transactionId);
  if (updatedTransaction) {
    const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
    await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);
  }
}
