import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { isCrossBudgetTransfer } from '../../transactions/helpers';
import type { CreditSpendingIssue } from '../types';

type CreditSpendingTotals = {
  spendingAmount: bigint;
  paymentsAmount: bigint;
  refundedSpending: bigint;
};

export type CalculatedCreditSpending = Map<Id<'category'>, Map<number, CreditSpendingTotals>>;
type CreditMonthlySpending = NonNullable<Doc<'category'>['creditMonthlySpending']>;

const emptyCreditSpending = (): CreditSpendingTotals => ({
  spendingAmount: 0n,
  paymentsAmount: 0n,
  refundedSpending: 0n,
});

function getOrCreateMonth(
  calculatedSpending: CalculatedCreditSpending,
  categoryId: Id<'category'>,
  yearMonth: number
): CreditSpendingTotals {
  let categorySpending = calculatedSpending.get(categoryId);
  if (!categorySpending) {
    categorySpending = new Map();
    calculatedSpending.set(categoryId, categorySpending);
  }

  let monthSpending = categorySpending.get(yearMonth);
  if (!monthSpending) {
    monthSpending = emptyCreditSpending();
    categorySpending.set(yearMonth, monthSpending);
  }

  return monthSpending;
}

/**
 * Recalculate credit-card activity from persisted transactions.
 *
 * Categorized transfers from an on-budget credit card to an off-budget account
 * are spending, even though transfer movements intentionally omit
 * `creditCardTransfer` metadata. Keep this calculation shared by both validators
 * and the repair mutation so they cannot disagree about that boundary case.
 */
export function calculateCreditSpending(
  transactions: Doc<'transaction'>[],
  categories: Doc<'category'>[],
  bankAccounts: Doc<'bankAccount'>[]
): CalculatedCreditSpending {
  const calculatedSpending: CalculatedCreditSpending = new Map();
  const creditCardCategories = categories.filter((category) => category.categoryType === 'credit_card');
  const categoriesById = new Map(creditCardCategories.map((category) => [category._id, category]));
  const categoriesByAccountId = new Map(
    creditCardCategories.flatMap((category) =>
      category.bankAccountId ? [[category.bankAccountId, category] as const] : []
    )
  );
  const bankAccountsById = new Map(bankAccounts.map((account) => [account._id, account]));

  for (const transaction of transactions) {
    if (
      transaction.type === 'transfer' ||
      transaction.type === 'starting_balance' ||
      transaction.type === 'balance_adjustment'
    ) {
      continue;
    }

    const yearMonth = dateToYearMonth(transaction.date);
    for (const movement of transaction.movements) {
      const creditCardCategoryId = movement.creditCardTransfer?.creditCardCategoryId;
      if (!creditCardCategoryId) continue;

      const creditCardCategory = categoriesById.get(creditCardCategoryId);
      if (!creditCardCategory || creditCardCategory.bankAccountId !== transaction.bankAccountId) continue;

      const spending = getOrCreateMonth(calculatedSpending, creditCardCategoryId, yearMonth);
      if (movement.amount > 0n && !movement.readyToAssign) {
        spending.refundedSpending += movement.amount;
      } else {
        spending.spendingAmount += -movement.amount;
      }
    }
  }

  const transferTransactions = transactions.filter((transaction) => transaction.type === 'transfer');

  for (const transaction of transferTransactions) {
    const bankAccount = bankAccountsById.get(transaction.bankAccountId);
    const creditCardCategory = categoriesByAccountId.get(transaction.bankAccountId);
    if (!bankAccount || !creditCardCategory) continue;

    const yearMonth = dateToYearMonth(transaction.date);
    const pairedAccount = transaction.transferPairBankAccountId
      ? bankAccountsById.get(transaction.transferPairBankAccountId)
      : undefined;

    if (
      bankAccount.accountType.startsWith('credit_') &&
      pairedAccount &&
      isCrossBudgetTransfer(bankAccount.accountType, pairedAccount.accountType)
    ) {
      for (const movement of transaction.movements) {
        if (!movement.categoryId) continue;

        // Transfers are never refunds. This mirrors reconciliation, which records
        // a negative categorized CC transfer as positive spending.
        const spending = getOrCreateMonth(calculatedSpending, creditCardCategory._id, yearMonth);
        spending.spendingAmount += -movement.amount;
      }
    }

    if (
      (bankAccount.accountType.startsWith('credit_') || bankAccount.accountType.startsWith('loan_')) &&
      transaction.totalAmount > 0n
    ) {
      const spending = getOrCreateMonth(calculatedSpending, creditCardCategory._id, yearMonth);
      spending.paymentsAmount += transaction.totalAmount;
    }
  }

  return calculatedSpending;
}

export function rebuildCreditMonthlySpending(
  currentSpending: CreditMonthlySpending,
  calculatedSpending: Map<number, CreditSpendingTotals> | undefined
): CreditMonthlySpending {
  const rebuiltSpending: CreditMonthlySpending = {};
  const yearMonths = new Set([
    ...Object.keys(currentSpending).map((yearMonth) => parseInt(yearMonth, 10)),
    ...(calculatedSpending?.keys() ?? []),
  ]);

  for (const yearMonth of yearMonths) {
    const current = currentSpending[yearMonth.toString()];
    const calculated = calculatedSpending?.get(yearMonth) ?? emptyCreditSpending();
    rebuiltSpending[yearMonth.toString()] = {
      priorBalance: current?.priorBalance ?? 0n,
      spendingAmount: calculated.spendingAmount,
      paymentsAmount: calculated.paymentsAmount,
      refundedSpending: calculated.refundedSpending,
    };
  }

  return rebuiltSpending;
}

function creditMonthlySpendingMatches(
  currentSpending: CreditMonthlySpending,
  rebuiltSpending: CreditMonthlySpending
): boolean {
  const currentMonths = Object.keys(currentSpending);
  const rebuiltMonths = Object.keys(rebuiltSpending);
  if (currentMonths.length !== rebuiltMonths.length) return false;

  return currentMonths.every((yearMonth) => {
    const current = currentSpending[yearMonth];
    const rebuilt = rebuiltSpending[yearMonth];
    return (
      rebuilt !== undefined &&
      current.priorBalance === rebuilt.priorBalance &&
      current.spendingAmount === rebuilt.spendingAmount &&
      current.paymentsAmount === rebuilt.paymentsAmount &&
      (current.refundedSpending ?? 0n) === rebuilt.refundedSpending
    );
  });
}

/**
 * Format cents as dollars for readable output
 */
function formatCents(cents: bigint): string {
  const dollars = Number(cents) / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Format yearMonth (YYYYMM) as readable date
 */
function formatYearMonth(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

export function findCreditSpendingIssues(
  categories: Doc<'category'>[],
  calculatedSpending: CalculatedCreditSpending
): CreditSpendingIssue[] {
  const issues: CreditSpendingIssue[] = [];

  for (const category of categories) {
    if (category.categoryType !== 'credit_card' || !category.bankAccountId) continue;

    const storedSpending = category.creditMonthlySpending ?? {};
    const categorySpending = calculatedSpending.get(category._id);
    const yearMonths = new Set([
      ...Object.keys(storedSpending).map((yearMonth) => parseInt(yearMonth, 10)),
      ...(categorySpending?.keys() ?? []),
    ]);

    for (const yearMonth of yearMonths) {
      const stored = storedSpending[yearMonth.toString()] ?? {
        spendingAmount: 0n,
        paymentsAmount: 0n,
        refundedSpending: 0n,
      };
      const expected = categorySpending?.get(yearMonth) ?? emptyCreditSpending();
      const comparisons: Array<{
        field: 'spendingAmount' | 'paymentsAmount' | 'refundedSpending';
        label: string;
        stored: bigint;
        expected: bigint;
      }> = [
        {
          field: 'spendingAmount',
          label: 'Spending',
          stored: stored.spendingAmount,
          expected: expected.spendingAmount,
        },
        {
          field: 'paymentsAmount',
          label: 'Payments',
          stored: stored.paymentsAmount,
          expected: expected.paymentsAmount,
        },
        {
          field: 'refundedSpending',
          label: 'Refunds',
          stored: stored.refundedSpending ?? 0n,
          expected: expected.refundedSpending,
        },
      ];

      for (const comparison of comparisons) {
        if (comparison.stored === comparison.expected) continue;

        const diff = comparison.stored - comparison.expected;
        issues.push({
          type: 'credit_spending_mismatch',
          severity: 'error',
          description: `"${category.name}" ${formatYearMonth(yearMonth)}: ${comparison.label} mismatch. Stored: ${formatCents(comparison.stored)}, Expected: ${formatCents(comparison.expected)} (diff: ${formatCents(diff)})`,
          categoryId: category._id,
          categoryName: category.name,
          bankAccountId: category.bankAccountId,
          yearMonth,
          field: comparison.field,
          stored: comparison.stored,
          expected: comparison.expected,
        });
      }
    }
  }

  return issues;
}

/**
 * Validate that category.creditMonthlySpending matches calculated values from transactions
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<CreditSpendingIssue[]> => {
    const [transactions, categories, bankAccounts] = await Promise.all([
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect(),
    ]);

    return findCreditSpendingIssues(categories, calculateCreditSpending(transactions, categories, bankAccounts));
  },
});

/**
 * Fix credit category spending discrepancies by recalculating from transactions
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    const [transactions, categories, bankAccounts] = await Promise.all([
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect(),
    ]);
    const calculatedSpending = calculateCreditSpending(transactions, categories, bankAccounts);

    for (const category of categories) {
      if (category.categoryType !== 'credit_card') continue;

      try {
        const currentSpending = category.creditMonthlySpending ?? {};
        const rebuiltSpending = rebuildCreditMonthlySpending(currentSpending, calculatedSpending.get(category._id));

        if (!creditMonthlySpendingMatches(currentSpending, rebuiltSpending)) {
          await ctx.db.patch(category._id, {
            creditMonthlySpending: rebuiltSpending,
            updatedAt: new Date().toISOString(),
          });
          fixed++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix credit category ${category.name}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
