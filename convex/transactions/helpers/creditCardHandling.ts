import { ConvexError } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

import { getCreditCardCategoryForAccount, isCreditCardAccount, isRefundMovement } from '../helpers';

/**
 * Movement input type for credit card processing
 */
export type MovementInput = {
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  amount: bigint;
  notes?: string;
};

/**
 * Embedded movement with credit card transfer metadata
 */
export type EmbeddedMovementInput = {
  categoryId?: Id<'category'>;
  readyToAssign: boolean;
  amount: bigint;
  notes?: string;
  sortOrder: number;
  creditCardTransfer?: {
    creditCardCategoryId: Id<'category'>;
    spendingCategoryId: Id<'category'>;
  };
};

/**
 * Process movements for a credit card transaction
 * Handles credit card budget transfers and refund detection
 *
 * @param ctx - Mutation context
 * @param args - Processing arguments
 * @returns Embedded movements with credit card transfer metadata
 */
export async function processCreditCardMovements(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    bankAccountId: Id<'bankAccount'>;
    movements: MovementInput[];
    transactionDate: string;
  }
): Promise<EmbeddedMovementInput[]> {
  const { workspaceId, bankAccountId, movements, transactionDate } = args;

  // Check if this is a credit card account
  const usesCreditCard = await isCreditCardAccount(ctx, bankAccountId);
  if (!usesCreditCard) {
    throw new ConvexError('This function should only be called for credit card accounts');
  }

  // Get the credit card category for this account
  const creditCardCategoryId = await getCreditCardCategoryForAccount(ctx, bankAccountId);
  if (!creditCardCategoryId) {
    throw new ConvexError('Credit card category not found for account');
  }

  const embeddedMovementsInput: EmbeddedMovementInput[] = [];

  for (let i = 0; i < movements.length; i++) {
    const movement = movements[i];
    const readyToAssign = movement.readyToAssign ?? false;
    let creditCardTransfer:
      | {
          creditCardCategoryId: Id<'category'>;
          spendingCategoryId: Id<'category'>;
        }
      | undefined = undefined;

    // Handle credit card transfer for this movement
    if (movement.categoryId) {
      // Create creditCardTransfer object for refund detection
      const tempCreditCardTransfer = {
        creditCardCategoryId,
        spendingCategoryId: movement.categoryId,
      };

      // Detect if this is a refund transaction
      // Note: This code path is for non-transfer transactions
      const isRefund = isRefundMovement(
        {
          amount: movement.amount,
          readyToAssign,
          creditCardTransfer: tempCreditCardTransfer,
        },
        false // Not a transfer transaction
      );

      // Move money between categories (credit card budget transfer)
      await ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
        workspaceId,
        fromCategoryId: movement.categoryId,
        toCategoryId: creditCardCategoryId,
        amount: movement.amount,
        transactionDate,
        isRefund, // Pass refund flag
      });

      creditCardTransfer = tempCreditCardTransfer;
    }

    embeddedMovementsInput.push({
      categoryId: movement.categoryId,
      readyToAssign,
      amount: movement.amount,
      notes: movement.notes,
      sortOrder: i,
      creditCardTransfer,
    });
  }

  return embeddedMovementsInput;
}
