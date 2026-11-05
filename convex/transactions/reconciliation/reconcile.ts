import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import { updateBankAccountBalance, updateBankAccountBalanceForStatusChange } from '../../bankAccounts/helpers';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { updateCreditCategorySpending } from '../../categoryBudgets/helpers';
import { reconcileScheduledOccurrence } from '../../scheduledTransactions/occurrences';
import { updateRTAForMovementCreate, updateRTAForMovementDelete } from '../../transactionMovement/helpers';
import { isRefundMovement } from '../helpers';
import type { ReconcileOptions, TransactionSnapshot } from './types';

/**
 * Central reconciliation function for all transaction side effects.
 *
 * Usage:
 * - Create: reconcile(ctx, null, afterSnapshot)
 * - Delete: reconcile(ctx, beforeSnapshot, null)
 * - Update: reconcile(ctx, beforeSnapshot, afterSnapshot)
 *
 * Uses "reverse old + apply new" semantics: reverses all side effects from
 * the "before" snapshot, then applies all side effects from the "after" snapshot.
 * This naturally handles all edge cases (month changes, account type changes,
 * CC-to-regular conversions) without explicit branching.
 */
export async function reconcileTransactionSideEffects(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null,
  options?: ReconcileOptions
): Promise<void> {
  if (!before && !after) return;

  if (!options?.skipBankAccountBalance) {
    await reconcileBankAccountBalance(ctx, before, after);
  }
  await reconcileCategorySpending(ctx, before, after);
  await reconcileRTA(ctx, before, after);
  await reconcileMerchantStats(ctx, before, after);
  await reconcileCreditCardPayments(ctx, before, after);
  await reconcileCreditCardPriorBalance(ctx, before, after);
  await reconcileScheduledOccurrence(ctx, before, after);
}

// Sub-function 1: Bank Account Balance
async function reconcileBankAccountBalance(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  // Early return: nothing changed
  if (
    before &&
    after &&
    before.bankAccountId === after.bankAccountId &&
    before.totalAmount === after.totalAmount &&
    before.status === after.status &&
    before.date === after.date
  ) {
    return;
  }

  // Status-only change: use specialized function that redistributes
  // between pending/cleared without touching currentBalance
  if (
    before &&
    after &&
    before.bankAccountId === after.bankAccountId &&
    before.totalAmount === after.totalAmount &&
    before.date === after.date &&
    before.status !== after.status
  ) {
    await updateBankAccountBalanceForStatusChange(
      ctx,
      before.bankAccountId,
      before.totalAmount,
      before.status,
      after.status
    );
    return;
  }

  // General case: reverse old + apply new
  if (before) {
    await updateBankAccountBalance(ctx, before.bankAccountId, -before.totalAmount, before.date, before.status);
  }
  if (after) {
    await updateBankAccountBalance(ctx, after.bankAccountId, after.totalAmount, after.date, after.status);
  }
}

// Sub-function 2: Category Spending
async function reconcileCategorySpending(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  if (before) {
    const isStartingBalanceOnCC = before.type === 'starting_balance' && before.isCreditCardAccount;
    if (!isStartingBalanceOnCC) {
      await reverseCategorySpendingForMovements(ctx, before);
    }
  }

  if (after) {
    const isStartingBalanceOnCC = after.type === 'starting_balance' && after.isCreditCardAccount;
    if (!isStartingBalanceOnCC) {
      await applyCategorySpendingForMovements(ctx, after);
    }
  }
}

async function reverseCategorySpendingForMovements(ctx: MutationCtx, snapshot: TransactionSnapshot): Promise<void> {
  for (const movement of snapshot.movements) {
    if (movement.creditCardTransfer) {
      const isRefund = isRefundMovement(movement, snapshot.type === 'transfer');
      await ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
        workspaceId: snapshot.workspaceId,
        fromCategoryId: movement.creditCardTransfer.creditCardCategoryId,
        toCategoryId: movement.creditCardTransfer.spendingCategoryId,
        amount: movement.amount,
        transactionDate: snapshot.date,
        isRefund,
      });
    } else if (movement.categoryId && snapshot.isCreditCardAccount && snapshot.creditCardCategoryId) {
      // CC account with categoryId but no creditCardTransfer metadata (legacy data from import)
      const isRefund = isRefundMovement(movement, snapshot.type === 'transfer');
      await ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
        workspaceId: snapshot.workspaceId,
        fromCategoryId: snapshot.creditCardCategoryId,
        toCategoryId: movement.categoryId,
        amount: movement.amount,
        transactionDate: snapshot.date,
        isRefund,
      });
    } else if (movement.categoryId) {
      await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
        workspaceId: snapshot.workspaceId,
        categoryId: movement.categoryId,
        transactionDate: snapshot.date,
        amountDelta: -movement.amount,
        transactionCountDelta: -1n,
      });
    }
  }
}

async function applyCategorySpendingForMovements(ctx: MutationCtx, snapshot: TransactionSnapshot): Promise<void> {
  for (const movement of snapshot.movements) {
    if (movement.creditCardTransfer) {
      const isRefund = isRefundMovement(movement, snapshot.type === 'transfer');
      await ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
        workspaceId: snapshot.workspaceId,
        fromCategoryId: movement.creditCardTransfer.spendingCategoryId,
        toCategoryId: movement.creditCardTransfer.creditCardCategoryId,
        amount: movement.amount,
        transactionDate: snapshot.date,
        isRefund,
      });
    } else if (movement.categoryId && !snapshot.isCreditCardAccount) {
      await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
        workspaceId: snapshot.workspaceId,
        categoryId: movement.categoryId,
        transactionDate: snapshot.date,
        amountDelta: movement.amount,
        transactionCountDelta: 1n,
      });
    } else if (movement.categoryId && snapshot.isCreditCardAccount && snapshot.creditCardCategoryId) {
      // CC account with categoryId but no creditCardTransfer metadata (legacy data from import)
      const isRefund = isRefundMovement(movement, snapshot.type === 'transfer');
      await ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
        workspaceId: snapshot.workspaceId,
        fromCategoryId: movement.categoryId,
        toCategoryId: snapshot.creditCardCategoryId,
        amount: movement.amount,
        transactionDate: snapshot.date,
        isRefund,
      });
    }
  }
}

// Sub-function 3: Ready To Assign (RTA)
async function reconcileRTA(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  if (before && !before.isExcludedFromRTA) {
    for (const movement of before.movements) {
      await updateRTAForMovementDelete(
        ctx,
        before.workspaceId,
        before.date,
        movement.amount,
        movement.readyToAssign,
        before.type
      );
    }
  }

  if (after && !after.isExcludedFromRTA) {
    for (const movement of after.movements) {
      await updateRTAForMovementCreate(
        ctx,
        after.workspaceId,
        after.date,
        movement.amount,
        movement.readyToAssign,
        after.type
      );
    }
  }
}

// Sub-function 4: Merchant Stats
async function reconcileMerchantStats(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  // Off-budget accounts (loans, investments) don't count as merchant spending.
  // Credit cards are excluded from RTA but ARE on-budget.
  const isBeforeOffBudget = before ? before.isExcludedFromRTA && !before.isCreditCardAccount : false;
  const isAfterOffBudget = after ? after.isExcludedFromRTA && !after.isCreditCardAccount : false;

  const effectiveBefore = isBeforeOffBudget ? null : before;
  const effectiveAfter = isAfterOffBudget ? null : after;

  if (
    effectiveBefore &&
    effectiveAfter &&
    effectiveBefore.merchantId === effectiveAfter.merchantId &&
    effectiveBefore.totalAmount === effectiveAfter.totalAmount &&
    effectiveBefore.date === effectiveAfter.date
  ) {
    return;
  }

  if (effectiveBefore?.merchantId) {
    await ctx.runMutation(internal.merchants.update.updateMerchantStatsForTransaction, {
      merchantId: effectiveBefore.merchantId,
      transactionDate: effectiveBefore.date,
      transactionCountDelta: -1n,
      transactionAmount: effectiveBefore.totalAmount,
    });
  }

  if (effectiveAfter?.merchantId) {
    await ctx.runMutation(internal.merchants.update.updateMerchantStatsForTransaction, {
      merchantId: effectiveAfter.merchantId,
      transactionDate: effectiveAfter.date,
      transactionCountDelta: 1n,
      transactionAmount: effectiveAfter.totalAmount,
    });
  }
}

// Sub-function 5: Credit Card Payments (transfer-specific)
async function reconcileCreditCardPayments(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  if (
    before &&
    before.type === 'transfer' &&
    before.isCreditCardAccount &&
    before.totalAmount > 0n &&
    before.creditCardCategoryId
  ) {
    const yearMonth = dateToYearMonth(before.date);
    await updateCreditCategorySpending(
      ctx,
      before.workspaceId,
      before.creditCardCategoryId,
      before.bankAccountId,
      yearMonth,
      -before.totalAmount,
      true // isPayment
    );
  }

  if (
    after &&
    after.type === 'transfer' &&
    after.isCreditCardAccount &&
    after.totalAmount > 0n &&
    after.creditCardCategoryId
  ) {
    const yearMonth = dateToYearMonth(after.date);
    await updateCreditCategorySpending(
      ctx,
      after.workspaceId,
      after.creditCardCategoryId,
      after.bankAccountId,
      yearMonth,
      after.totalAmount,
      true // isPayment
    );
  }
}

// Sub-function 6: Credit Card Prior Balance (starting_balance on CC)
async function reconcileCreditCardPriorBalance(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  if (before && before.type === 'starting_balance' && before.isCreditCardAccount && before.creditCardCategoryId) {
    const yearMonth = dateToYearMonth(before.date);
    const category = await ctx.db.get(before.creditCardCategoryId);
    if (category) {
      const yearMonthStr = yearMonth.toString();
      const creditMonthlySpending = { ...(category.creditMonthlySpending ?? {}) };
      const monthData = creditMonthlySpending[yearMonthStr];
      if (monthData && monthData.priorBalance !== 0n) {
        creditMonthlySpending[yearMonthStr] = {
          ...monthData,
          priorBalance: 0n,
        };
        await ctx.db.patch(before.creditCardCategoryId, {
          creditMonthlySpending,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  if (after && after.type === 'starting_balance' && after.isCreditCardAccount && after.creditCardCategoryId) {
    const yearMonth = dateToYearMonth(after.date);
    const category = await ctx.db.get(after.creditCardCategoryId);
    if (category) {
      const yearMonthStr = yearMonth.toString();
      const creditMonthlySpending = { ...(category.creditMonthlySpending ?? {}) };
      const currentMonthData = creditMonthlySpending[yearMonthStr] ?? {
        priorBalance: 0n,
        spendingAmount: 0n,
        paymentsAmount: 0n,
        refundedSpending: 0n,
      };
      creditMonthlySpending[yearMonthStr] = {
        ...currentMonthData,
        priorBalance: after.totalAmount,
      };
      await ctx.db.patch(after.creditCardCategoryId, {
        creditMonthlySpending,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
