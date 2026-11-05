import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  getCreditCardCategoryForAccount,
  isCreditCardAccount,
  isOnBudgetAccountType,
  validateMovements,
} from '../helpers';
import type { MovementInput } from '../helpers/creditCardHandling';

export type EmbeddedMovementResult = {
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
 * Build embedded movements with credit card transfer metadata, WITHOUT applying
 * any side effects (no budget updates, no RTA updates, no balance changes).
 *
 * This is the "pure data construction" step, separated from side-effect application.
 */
export async function buildEmbeddedMovements(
  ctx: MutationCtx,
  args: {
    bankAccountId: Id<'bankAccount'>;
    movements: MovementInput[];
    transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';
  }
): Promise<{ embeddedMovements: EmbeddedMovementResult[]; totalAmount: bigint }> {
  const { bankAccountId, movements, transactionType } = args;

  const totalAmount = movements.reduce((sum, m) => sum + m.amount, 0n);
  validateMovements(totalAmount, movements);

  const usesCreditCard = await isCreditCardAccount(ctx, bankAccountId);

  if (usesCreditCard) {
    return buildCreditCardMovements(ctx, bankAccountId, movements, transactionType);
  }

  // Off-budget regular transactions don't need categories — collapse to single uncategorized movement
  if (transactionType === 'regular') {
    const bankAccount = await ctx.db.get(bankAccountId);
    if (bankAccount && !isOnBudgetAccountType(bankAccount.accountType)) {
      const offBudgetTotalAmount = movements.reduce((sum, m) => sum + m.amount, 0n);
      const embeddedMovements: EmbeddedMovementResult[] = [
        {
          categoryId: undefined,
          readyToAssign: false,
          amount: offBudgetTotalAmount,
          notes: movements[0]?.notes,
          sortOrder: 0,
          creditCardTransfer: undefined,
        },
      ];
      return { embeddedMovements, totalAmount: offBudgetTotalAmount };
    }
  }

  // Regular account movements
  const embeddedMovements: EmbeddedMovementResult[] = movements.map((movement, i) => {
    const isSystemType = transactionType === 'starting_balance' || transactionType === 'balance_adjustment';
    const readyToAssign = isSystemType ? true : (movement.readyToAssign ?? false);

    return {
      categoryId: movement.categoryId,
      readyToAssign,
      amount: movement.amount,
      notes: movement.notes,
      sortOrder: i,
      creditCardTransfer: undefined,
    };
  });

  return { embeddedMovements, totalAmount };
}

async function buildCreditCardMovements(
  ctx: MutationCtx,
  bankAccountId: Id<'bankAccount'>,
  movements: MovementInput[],
  transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer'
): Promise<{ embeddedMovements: EmbeddedMovementResult[]; totalAmount: bigint }> {
  const totalAmount = movements.reduce((sum, m) => sum + m.amount, 0n);
  const creditCardCategoryId = await getCreditCardCategoryForAccount(ctx, bankAccountId);

  const embeddedMovements: EmbeddedMovementResult[] = movements.map((movement, i) => {
    const isSystemType = transactionType === 'starting_balance' || transactionType === 'balance_adjustment';
    const readyToAssign = isSystemType ? true : (movement.readyToAssign ?? false);
    let creditCardTransfer: EmbeddedMovementResult['creditCardTransfer'] = undefined;

    if (movement.categoryId && creditCardCategoryId) {
      creditCardTransfer = {
        creditCardCategoryId,
        spendingCategoryId: movement.categoryId,
      };
    }

    return {
      categoryId: movement.categoryId,
      readyToAssign,
      amount: movement.amount,
      notes: movement.notes,
      sortOrder: i,
      creditCardTransfer,
    };
  });

  return { embeddedMovements, totalAmount };
}
