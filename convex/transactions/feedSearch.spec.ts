import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import { type TransactionFeedLookups, toTransactionFeedItem } from './feed';
import {
  transactionCategoryActivity,
  transactionMatchesFeedFilters,
  transactionMatchesFeedText,
  transactionSearchTerms,
} from './feedSearch';

const workspaceId = 'workspace' as Id<'workspace'>;
const accountId = 'checking' as Id<'bankAccount'>;
const categoryId = 'groceries' as Id<'category'>;
const merchantId = 'cafe' as Id<'merchant'>;

function fixture(overrides: Partial<Doc<'transaction'>> = {}) {
  const transaction: Doc<'transaction'> = {
    _id: 'transaction' as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    merchantId,
    date: '2020-02-29',
    dateYearMonth: 202002,
    type: 'regular',
    status: 'cleared',
    reviewStatus: 'reviewed',
    isDeleted: false,
    totalAmount: -1250n,
    hasUncategorized: false,
    hasMissingPayee: false,
    notes: 'Birthday lunch',
    searchText: 'stale name intentionally ignored',
    importDetails: {
      provider: 'plaid',
      date: '2020-02-29',
      amount: -1250n,
      merchantName: 'Original Coffee Shop',
      originalStatement: 'POS Terminal 4567',
    },
    movements: [
      {
        categoryId,
        categoryName: 'Old category',
        amount: -1250n,
        readyToAssign: false,
        sortOrder: 0,
        notes: 'Shared with Sam',
      },
    ],
    ...overrides,
  };
  const lookups: TransactionFeedLookups = {
    merchants: new Map([
      [
        merchantId,
        {
          _id: merchantId,
          _creationTime: 1,
          workspaceId,
          name: 'Café Corner',
          updatedAt: '2026-09-06T00:00:00Z',
          isDeleted: false,
        },
      ],
    ]),
    bankAccounts: new Map([
      [
        accountId,
        {
          _id: accountId,
          _creationTime: 1,
          workspaceId,
          name: 'Daily Checking',
          accountType: 'banking_checking',
          currentBalance: 0n,
          isClosed: true,
          isDeleted: false,
        },
      ],
    ]),
    categories: new Map([
      [
        categoryId,
        {
          _id: categoryId,
          _creationTime: 1,
          workspaceId,
          name: 'Dining Out',
          categoryGroupId: 'group' as Id<'categoryGroup'>,
          isDeleted: false,
          sortOrder: 0,
          type: 'expense',
        },
      ],
    ]),
    globalMerchants: new Map(),
    accountLogoUrls: new Map(),
    transferPairAccountIds: new Map(),
  };
  return { transaction, lookups };
}

function matches(text: string, overrides: Partial<Doc<'transaction'>> = {}, decimals = 2) {
  const { transaction, lookups } = fixture(overrides);
  return transactionMatchesFeedText(transaction, lookups, transactionSearchTerms(text), decimals);
}

describe('transaction feed search', () => {
  it('separates repeated category splits, refunds and unrelated movements without losing precision', () => {
    const { transaction } = fixture();
    transaction.movements = [
      { categoryId, amount: -9007199254740993n, readyToAssign: false, sortOrder: 0 },
      { categoryId, amount: -7n, readyToAssign: false, sortOrder: 1 },
      { categoryId, amount: 200n, readyToAssign: false, sortOrder: 2 },
      { categoryId: 'other' as Id<'category'>, amount: -999n, readyToAssign: false, sortOrder: 3 },
    ];
    expect(transactionCategoryActivity(transaction, categoryId)).toEqual({
      amount: '-9007199254740800',
      outflow: '9007199254741000',
      inflow: '200',
    });
  });

  it('counts card purchases and refunds in their spending category', () => {
    const { transaction } = fixture();
    const creditCardCategoryId = 'amex' as Id<'category'>;
    transaction.movements = [
      {
        categoryId,
        amount: -11824n,
        readyToAssign: false,
        sortOrder: 0,
        creditCardTransfer: { creditCardCategoryId, spendingCategoryId: categoryId },
      },
      {
        categoryId,
        amount: 500n,
        readyToAssign: false,
        sortOrder: 1,
        creditCardTransfer: { creditCardCategoryId, spendingCategoryId: categoryId },
      },
    ];
    expect(transactionCategoryActivity(transaction, categoryId)).toEqual({
      amount: '-11324',
      outflow: '11824',
      inflow: '500',
    });
  });

  it('keeps card funding and balance corrections out of spending totals', () => {
    const { transaction } = fixture();
    for (const type of ['starting_balance', 'balance_adjustment'] as const) {
      expect(transactionCategoryActivity({ ...transaction, type }, categoryId)).toEqual({
        amount: '-1250',
        outflow: '0',
        inflow: '0',
      });
    }
    transaction.movements[0].creditCardTransfer = {
      creditCardCategoryId: categoryId,
      spendingCategoryId: 'other' as Id<'category'>,
    };
    expect(transactionCategoryActivity(transaction, categoryId)).toEqual({
      amount: '-1250',
      outflow: '0',
      inflow: '0',
    });
  });

  it.each([
    'café',
    'CAFE',
    'checking',
    'birthday',
    'shared with sam',
    'dining',
    'terminal 4567',
    'original coffee',
    '$12.50',
    '-12.50',
    '1250',
    '2020-02-29',
    'cleared',
    'banking',
  ])('matches %s across live names, notes, statements, amounts and dates', (text) => {
    expect(matches(text)).toBe(true);
  });

  it('matches multiple words across different fields and requires every word', () => {
    expect(matches('cafe checking birthday 12.50')).toBe(true);
    expect(matches('cafe checking unknown')).toBe(false);
    expect(matches('stale name')).toBe(false);
    expect(matches('old category')).toBe(false);
    expect(matches('   ')).toBe(true);
  });

  it('preserves exact minor-unit precision for zero-, two-, and three-decimal currencies', () => {
    expect(matches('90071992547409.93', { totalAmount: -9007199254740993n })).toBe(true);
    expect(matches('90071992547409.92', { totalAmount: -9007199254740993n })).toBe(false);
    expect(matches('12.345', { totalAmount: -12345n }, 3)).toBe(true);
    expect(matches('12345', { totalAmount: -12345n }, 0)).toBe(true);
  });

  it('searches a transfer counterpart and distinguishes transfers from inflows/outflows', () => {
    const { transaction, lookups } = fixture({ type: 'transfer', transferPairBankAccountId: accountId });
    expect(transactionMatchesFeedText(transaction, lookups, ['daily', 'transfer'], 2)).toBe(true);
    expect(transactionMatchesFeedFilters(transaction, { text: '', flow: 'transfer' })).toBe(true);
    expect(transactionMatchesFeedFilters(transaction, { text: '', flow: 'outflow' })).toBe(false);
    expect(transactionMatchesFeedFilters({ ...transaction, totalAmount: 100n }, { text: '', flow: 'inflow' })).toBe(
      false
    );
  });

  it('combines status, category, direction and notes filters', () => {
    const { transaction } = fixture();
    expect(
      transactionMatchesFeedFilters(transaction, {
        text: '',
        categoryId,
        status: 'cleared',
        flow: 'outflow',
        hasNotes: true,
      })
    ).toBe(true);
    expect(transactionMatchesFeedFilters(transaction, { text: '', status: 'pending' })).toBe(false);
    expect(transactionMatchesFeedFilters(transaction, { text: '', flow: 'inflow' })).toBe(false);
    expect(transactionMatchesFeedFilters(transaction, { text: '', categoryId: 'uncategorized' })).toBe(false);
    expect(transactionMatchesFeedFilters(transaction, { text: '', categoryId: 'ready-to-assign' })).toBe(false);
    expect(transactionMatchesFeedFilters(transaction, { text: '', status: 'needs_review' })).toBe(false);
    expect(
      transactionMatchesFeedFilters(
        { ...transaction, reviewStatus: 'needs_review' },
        {
          text: '',
          status: 'needs_review',
          flow: 'outflow',
        }
      )
    ).toBe(true);
  });

  it('finds split allocations and split-only notes, ignoring empty notes', () => {
    const { transaction } = fixture({ notes: '   ' });
    expect(transactionMatchesFeedFilters(transaction, { text: '', hasNotes: true, categoryId })).toBe(true);
    expect(transactionMatchesFeedFilters({ ...transaction, movements: [] }, { text: '', hasNotes: true })).toBe(false);
    expect(
      transactionMatchesFeedFilters(
        { ...transaction, hasUncategorized: true },
        {
          text: '',
          categoryId: 'uncategorized',
        }
      )
    ).toBe(true);
    expect(
      transactionMatchesFeedFilters(
        { ...transaction, movements: [...transaction.movements, { readyToAssign: true, amount: 5n, sortOrder: 1 }] },
        { text: '', categoryId: 'ready-to-assign' }
      )
    ).toBe(true);
  });

  it('returns trimmed, deduplicated transaction and split notes in the compact row', () => {
    const { transaction, lookups } = fixture();
    expect(toTransactionFeedItem(transaction, lookups).notes).toBe('Birthday lunch\nShared with Sam');
    expect(toTransactionFeedItem({ ...transaction, notes: ' Shared with Sam ' }, lookups).notes).toBe(
      'Shared with Sam'
    );
    expect(toTransactionFeedItem({ ...transaction, notes: '  ', movements: [] }, lookups).notes).toBeNull();
  });
});

describe('transfer chip filter', () => {
  it.each(['pending', 'linked_pending_approval', 'rejected', 'approved'] as const)(
    'includes only unresolved suggestions: %s',
    (status) => {
      const { transaction } = fixture({
        reviewStatus: 'needs_review',
        suggestedTransfer: {
          status,
          transferConfidence: 90,
          detectionReason: 'Transfer',
        },
      });
      expect(
        transactionMatchesFeedFilters(transaction, { text: '', flow: 'transfer', includeSuggestedTransfers: true })
      ).toBe(status === 'pending' || status === 'linked_pending_approval');
      expect(transactionMatchesFeedFilters(transaction, { text: '', flow: 'transfer' })).toBe(false);
    }
  );
});
