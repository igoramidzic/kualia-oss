import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import { calculateCreditSpending, findCreditSpendingIssues, rebuildCreditMonthlySpending } from './creditSpending';

const workspaceId = 'workspace' as Id<'workspace'>;
const creditAccountId = 'credit-account' as Id<'bankAccount'>;
const bankingAccountId = 'banking-account' as Id<'bankAccount'>;
const investmentAccountId = 'investment-account' as Id<'bankAccount'>;
const creditCategoryId = 'credit-category' as Id<'category'>;
const spendingCategoryId = 'spending-category' as Id<'category'>;

function bankAccount(id: Id<'bankAccount'>, accountType: Doc<'bankAccount'>['accountType']): Doc<'bankAccount'> {
  return {
    _id: id,
    _creationTime: 1,
    workspaceId,
    name: id,
    accountType,
    currentBalance: 0n,
    isClosed: false,
    isDeleted: false,
  };
}

function creditCategory(creditMonthlySpending: Doc<'category'>['creditMonthlySpending'] = {}): Doc<'category'> {
  return {
    _id: creditCategoryId,
    _creationTime: 1,
    workspaceId,
    name: 'Credit Card',
    categoryGroupId: 'credit-group' as Id<'categoryGroup'>,
    categoryType: 'credit_card',
    bankAccountId: creditAccountId,
    creditMonthlySpending,
    sortOrder: 0,
    isDeleted: false,
  };
}

function transfer(
  accountId: Id<'bankAccount'>,
  pairedAccountId: Id<'bankAccount'>,
  amount: bigint,
  categoryId?: Id<'category'>
): Doc<'transaction'> {
  return {
    _id: `${accountId}-${amount}` as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    transferPairBankAccountId: pairedAccountId,
    type: 'transfer',
    date: '2026-07-09',
    dateYearMonth: 202607,
    status: 'cleared',
    reviewStatus: 'reviewed',
    isDeleted: false,
    movements: [{ amount, categoryId, readyToAssign: false, sortOrder: 0 }],
    searchText: '',
    totalAmount: amount,
    hasUncategorized: false,
    hasMissingPayee: false,
  };
}

describe('credit spending validation', () => {
  it('counts a categorized credit-card transfer to an off-budget account as spending', () => {
    const categories = [creditCategory()];
    const accounts = [
      bankAccount(creditAccountId, 'credit_credit_card'),
      bankAccount(investmentAccountId, 'investment_other'),
    ];
    const transactions = [transfer(creditAccountId, investmentAccountId, -225465n, spendingCategoryId)];

    const calculated = calculateCreditSpending(transactions, categories, accounts);

    expect(calculated.get(creditCategoryId)?.get(202607)).toEqual({
      spendingAmount: 225465n,
      paymentsAmount: 0n,
      refundedSpending: 0n,
    });
    expect(findCreditSpendingIssues(categories, calculated)).toMatchObject([
      {
        type: 'credit_spending_mismatch',
        categoryId: creditCategoryId,
        yearMonth: 202607,
        field: 'spendingAmount',
        stored: 0n,
        expected: 225465n,
      },
    ]);
  });

  it('does not count an ordinary on-budget credit-card transfer as spending', () => {
    const categories = [creditCategory()];
    const accounts = [
      bankAccount(creditAccountId, 'credit_credit_card'),
      bankAccount(bankingAccountId, 'banking_checking'),
    ];
    const transactions = [transfer(creditAccountId, bankingAccountId, -225465n, spendingCategoryId)];

    expect(calculateCreditSpending(transactions, categories, accounts).get(creditCategoryId)).toBeUndefined();
  });

  it('tracks a transfer into the credit card as a payment', () => {
    const categories = [creditCategory()];
    const accounts = [
      bankAccount(creditAccountId, 'credit_credit_card'),
      bankAccount(bankingAccountId, 'banking_checking'),
    ];
    const transactions = [transfer(creditAccountId, bankingAccountId, 225465n)];

    expect(calculateCreditSpending(transactions, categories, accounts).get(creditCategoryId)?.get(202607)).toEqual({
      spendingAmount: 0n,
      paymentsAmount: 225465n,
      refundedSpending: 0n,
    });
  });

  it('preserves prior balance while rebuilding calculated activity', () => {
    const current = {
      '202607': {
        priorBalance: 50000n,
        spendingAmount: 0n,
        paymentsAmount: 0n,
        refundedSpending: 0n,
      },
    };
    const calculated = new Map([
      [202607, { spendingAmount: 225465n, paymentsAmount: 100000n, refundedSpending: 5000n }],
    ]);

    expect(rebuildCreditMonthlySpending(current, calculated)).toEqual({
      '202607': {
        priorBalance: 50000n,
        spendingAmount: 225465n,
        paymentsAmount: 100000n,
        refundedSpending: 5000n,
      },
    });
  });
});
