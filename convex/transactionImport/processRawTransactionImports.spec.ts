import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { calculatePlaidOpeningBalances } from '../bankAccounts/helpers';
import { resolveTransferImportDisposition } from '../transferDetection/processTransferDetection';

import {
  buildImportedMovementData,
  recordRegularImportTransferVeto,
  shouldSkipPlaidImportBalance,
} from './processRawTransactionImports';

describe('Plaid import balance compatibility', () => {
  it('keeps the legacy item first-sync flag authoritative for unmarked accounts', () => {
    expect(shouldSkipPlaidImportBalance({}, true)).toBe(true);
    expect(shouldSkipPlaidImportBalance({}, false)).toBe(false);
    expect(shouldSkipPlaidImportBalance({}, undefined)).toBe(false);
  });

  it('only suppresses a new account balance until its own initial replay finishes', () => {
    const marker = {
      bankLinkAccountId: 'connection_account_1' as Id<'bankLinkAccount'>,
      startDate: '2026-09-06',
      status: 'pending' as const,
      preserveBalance: true,
      generation: 'generation_1',
    };
    expect(shouldSkipPlaidImportBalance({ plaidInitialSync: marker }, false)).toBe(true);
    expect(shouldSkipPlaidImportBalance({ plaidInitialSync: { ...marker, preserveBalance: false } }, true)).toBe(false);
    expect(shouldSkipPlaidImportBalance({ plaidInitialSync: { ...marker, status: 'complete' } }, true)).toBe(false);
  });
});

const funMoneyId = 'category_fun_money' as Id<'category'>;
const creditCardCategoryId = 'category_credit_card' as Id<'category'>;

describe('buildImportedMovementData', () => {
  const bankingProperties = {
    isCreditCardAccount: false,
    isExcludedFromRTA: false,
    creditCardCategoryId: null,
  };

  it('keeps the $110 checking snapshot and includes its imported $500 inflow in RTA', () => {
    const movements = buildImportedMovementData({
      amount: 50000n,
      categoryId: undefined,
      bankAccountProperties: bankingProperties,
    });
    const balances = calculatePlaidOpeningBalances(
      [{ status: 'cleared', totalAmount: 50000n, transactionImportRawId: 'raw_inflow' as Id<'transactionImportRaw'> }],
      11000n,
      true
    );

    expect(balances.startingBalance).toBe(-39000n);
    expect(balances.currentBalance).toBe(11000n);
    expect(movements[0]).toMatchObject({ amount: 50000n, readyToAssign: true, categoryId: undefined });
    const readyToAssign =
      balances.startingBalance +
      21000n +
      movements.reduce((total, movement) => total + (movement.readyToAssign ? movement.amount : 0n), 0n);
    expect(readyToAssign).toBe(32000n);
  });

  it.each([-50000n, 0n])('leaves a non-positive amount (%s) uncategorized', (amount) => {
    expect(
      buildImportedMovementData({ amount, categoryId: undefined, bankAccountProperties: bankingProperties })[0]
        ?.readyToAssign
    ).toBe(false);
  });

  it('preserves a rule or category suggestion for an inflow', () => {
    expect(
      buildImportedMovementData({ amount: 50000n, categoryId: funMoneyId, bankAccountProperties: bankingProperties })[0]
    ).toMatchObject({ categoryId: funMoneyId, readyToAssign: false });
  });

  it('does not call a detected transfer income', () => {
    expect(
      buildImportedMovementData({
        amount: 50000n,
        categoryId: undefined,
        isTransferDetected: true,
        bankAccountProperties: bankingProperties,
      })[0]?.readyToAssign
    ).toBe(false);
  });

  it.each([true, false])(
    'does not default an RTA-excluded account to income (credit card: %s)',
    (isCreditCardAccount) => {
      expect(
        buildImportedMovementData({
          amount: 50000n,
          categoryId: undefined,
          bankAccountProperties: { isCreditCardAccount, isExcludedFromRTA: true, creditCardCategoryId: null },
        })[0]?.readyToAssign
      ).toBe(false);
    }
  );

  it('does not guess that an unknown account contributes to RTA', () => {
    expect(
      buildImportedMovementData({ amount: 50000n, categoryId: undefined, bankAccountProperties: undefined })[0]
        ?.readyToAssign
    ).toBe(false);
  });

  it('preserves an explicit uncategorized selection', () => {
    expect(
      buildImportedMovementData({
        amount: 50000n,
        categoryId: undefined,
        readyToAssign: false,
        bankAccountProperties: bankingProperties,
      })[0]?.readyToAssign
    ).toBe(false);
  });

  it('builds credit card transfer metadata from the suggested category', () => {
    const movements = buildImportedMovementData({
      amount: -625n,
      categoryId: funMoneyId,
      readyToAssign: false,
      bankAccountProperties: {
        isCreditCardAccount: true,
        isExcludedFromRTA: true,
        creditCardCategoryId,
      },
    });

    expect(movements[0]?.categoryId).toBe(funMoneyId);
    expect(movements[0]?.creditCardTransfer).toEqual({
      creditCardCategoryId,
      spendingCategoryId: funMoneyId,
    });
  });

  it('does not create credit card transfer metadata without a spending category', () => {
    const movements = buildImportedMovementData({
      amount: 625n,
      categoryId: undefined,
      readyToAssign: true,
      bankAccountProperties: {
        isCreditCardAccount: true,
        isExcludedFromRTA: true,
        creditCardCategoryId,
      },
    });

    expect(movements[0]?.categoryId).toBeUndefined();
    expect(movements[0]?.readyToAssign).toBe(true);
    expect(movements[0]?.creditCardTransfer).toBeUndefined();
  });
});

describe('transfer suggestion precedence during import', () => {
  it('preserves normal import handling when a planned transaction matches first', () => {
    const disposition = resolveTransferImportDisposition(
      {
        rawTransactionId: 'raw_paycheck' as Id<'transactionImportRaw'>,
        isLikelyTransfer: true,
        transferConfidence: 90,
        detectionReason: 'Exact opposite-side match',
        matchType: 'existing_match',
      },
      true
    );

    expect(disposition.shouldSuggestTransfer).toBe(false);
    expect(disposition.shouldCreatePendingMatch).toBe(false);
    expect(disposition.shouldConfirmPendingMatch).toBe(false);
  });

  it('vetoes both halves of a same-batch pair when either half matches a plan', () => {
    const vetoedRawTransactionIds = new Set<string>();

    recordRegularImportTransferVeto(
      vetoedRawTransactionIds,
      'raw_paycheck' as Id<'transactionImportRaw'>,
      'raw_counterpart' as Id<'transactionImportRaw'>
    );

    expect(vetoedRawTransactionIds).toEqual(new Set(['raw_paycheck', 'raw_counterpart']));
  });
});
