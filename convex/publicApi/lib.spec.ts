import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';

import {
  ApiError,
  bankAccountToApi,
  categoryToApi,
  formatApiMonth,
  INT64_MAX,
  INT64_MIN,
  isApiErrorData,
  merchantToApi,
  parseApiAmount,
  parseApiDate,
  parseApiMonth,
  parseOptionalString,
  parseRequiredString,
  transactionToApi,
  type ApiErrorName,
} from './lib';

/** Assert a synchronous call throws an ApiError with the expected status/name/detail. */
function expectApiError(fn: () => unknown, status: number, name: ApiErrorName, detail?: string | RegExp): void {
  try {
    fn();
    throw new Error('Expected an ApiError to be thrown');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.data.status).toBe(status);
      expect(error.data.name).toBe(name);
      if (typeof detail === 'string') {
        expect(error.data.detail).toBe(detail);
      } else if (detail instanceof RegExp) {
        expect(error.data.detail).toMatch(detail);
      }
    }
  }
}

const CREATION = 1_704_164_645_000;
const CREATION_ISO = new Date(CREATION).toISOString();

describe('ApiError / isApiErrorData', () => {
  it('is a ConvexError carrying structured data that survives the function boundary', () => {
    const error = new ApiError(404, 'not_found', 'Workspace not found');
    expect(error).toBeInstanceOf(ConvexError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.data).toEqual({
      publicApiError: true,
      status: 404,
      name: 'not_found',
      detail: 'Workspace not found',
    });
  });

  it('recognizes public-API error data and rejects everything else', () => {
    expect(isApiErrorData(new ApiError(400, 'bad_request', 'x').data)).toBe(true);
    expect(isApiErrorData({ publicApiError: true, status: 400 })).toBe(true);

    expect(isApiErrorData({ publicApiError: true, status: '400' })).toBe(false);
    expect(isApiErrorData({ publicApiError: false, status: 400 })).toBe(false);
    expect(isApiErrorData({ status: 400 })).toBe(false);
    expect(isApiErrorData(null)).toBe(false);
    expect(isApiErrorData(undefined)).toBe(false);
    expect(isApiErrorData('bad_request')).toBe(false);
    expect(isApiErrorData([])).toBe(false);
  });
});

describe('parseApiDate', () => {
  it('accepts YYYY-MM-DD strings', () => {
    expect(parseApiDate('2026-07-08', 'since_date')).toBe('2026-07-08');
  });

  it('is format-only and does not calendar-validate (documented behavior)', () => {
    expect(parseApiDate('2026-13-45', 'since_date')).toBe('2026-13-45');
  });

  it('rejects non-matching shapes with a 400', () => {
    for (const bad of ['2026-7-8', '20260708', '2026-07-08T00:00', 'not-a-date']) {
      expectApiError(() => parseApiDate(bad, 'since_date'), 400, 'bad_request', /since_date must be a date string/);
    }
    expectApiError(() => parseApiDate(5, 'since_date'), 400, 'bad_request', /since_date/);
    expectApiError(() => parseApiDate(undefined, 'since_date'), 400, 'bad_request');
  });
});

describe('parseApiMonth / formatApiMonth', () => {
  it('parses external month strings into internal yearMonth numbers', () => {
    expect(parseApiMonth('2026-07', 'month')).toBe(202607);
    expect(parseApiMonth('2026-01', 'month')).toBe(202601);
    expect(parseApiMonth('2026-12', 'month')).toBe(202612);
  });

  it('rejects out-of-range or malformed months', () => {
    for (const bad of ['2026-13', '2026-00', '2026-7', '202607', '2026/07']) {
      expectApiError(() => parseApiMonth(bad, 'month'), 400, 'bad_request', /month must be a month string/);
    }
  });

  it('formats internal yearMonth numbers back into external strings', () => {
    expect(formatApiMonth(202607)).toBe('2026-07');
    expect(formatApiMonth(202612)).toBe('2026-12');
  });

  it('round-trips parse -> format', () => {
    expect(formatApiMonth(parseApiMonth('2026-03', 'month'))).toBe('2026-03');
  });
});

describe('parseApiAmount', () => {
  it('parses decimal strings into bigint minor units', () => {
    expect(parseApiAmount('51.08', 'amount', 2)).toBe(5108n);
    expect(parseApiAmount('-12.34', 'amount', 2)).toBe(-1234n);
    expect(parseApiAmount('100', 'amount', 0)).toBe(100n);
  });

  it('accepts the int64 boundary values', () => {
    expect(parseApiAmount(INT64_MAX.toString(), 'amount', 0)).toBe(INT64_MAX);
    expect(parseApiAmount(INT64_MIN.toString(), 'amount', 0)).toBe(INT64_MIN);
  });

  it('rejects values beyond the int64 range', () => {
    expectApiError(
      () => parseApiAmount((INT64_MAX + 1n).toString(), 'amount', 0),
      400,
      'bad_request',
      'amount is out of range'
    );
    expectApiError(
      () => parseApiAmount((INT64_MIN - 1n).toString(), 'amount', 0),
      400,
      'bad_request',
      'amount is out of range'
    );
  });

  it('rejects non-string inputs', () => {
    expectApiError(() => parseApiAmount(5108, 'amount', 2), 400, 'bad_request', /amount must be a decimal string/);
    expectApiError(() => parseApiAmount(undefined, 'amount', 2), 400, 'bad_request');
  });

  it('surfaces decimal parse failures with the field prefix', () => {
    expectApiError(() => parseApiAmount('abc', 'amount', 2), 400, 'bad_request', 'amount: Invalid decimal amount: abc');
    expectApiError(
      () => parseApiAmount('1.234', 'amount', 2),
      400,
      'bad_request',
      /amount: Amount has more fractional digits/
    );
  });
});

describe('parseOptionalString / parseRequiredString', () => {
  it('returns undefined for missing optional strings and passes through provided ones', () => {
    expect(parseOptionalString(undefined, 'notes')).toBeUndefined();
    expect(parseOptionalString('hello', 'notes')).toBe('hello');
    expect(parseOptionalString('', 'notes')).toBe('');
  });

  it('rejects non-string optional values (including null)', () => {
    expectApiError(() => parseOptionalString(5, 'notes'), 400, 'bad_request', 'notes must be a string');
    expectApiError(() => parseOptionalString(null, 'notes'), 400, 'bad_request', 'notes must be a string');
  });

  it('returns the raw (untrimmed) value for required strings but rejects blanks', () => {
    expect(parseRequiredString('Acme', 'name')).toBe('Acme');
    // Trimming for storage is the caller's responsibility; only emptiness is enforced here.
    expect(parseRequiredString('  Acme  ', 'name')).toBe('  Acme  ');

    expectApiError(() => parseRequiredString(undefined, 'name'), 400, 'bad_request', 'name is required');
    expectApiError(() => parseRequiredString('', 'name'), 400, 'bad_request', 'name is required');
    expectApiError(() => parseRequiredString('   ', 'name'), 400, 'bad_request', 'name is required');
    expectApiError(() => parseRequiredString(5, 'name'), 400, 'bad_request', 'name must be a string');
  });
});

describe('bankAccountToApi', () => {
  it('maps a linked account with balances to the snake_case resource shape', () => {
    const account = {
      _id: 'bankAccount_1',
      _creationTime: CREATION,
      name: 'Checking',
      accountType: 'banking_checking',
      currentBalance: 12345n,
      clearedBalance: 12000n,
      pendingBalance: 345n,
      isClosed: false,
      notes: 'main account',
      bankLinkAccountId: 'bankLinkAccount_1',
      lastReconciledAt: '2026-06-01',
      updatedAt: '2026-07-01T00:00:00.000Z',
    } as unknown as Doc<'bankAccount'>;

    expect(bankAccountToApi(account, true)).toEqual({
      id: 'bankAccount_1',
      name: 'Checking',
      type: 'banking_checking',
      on_budget: true,
      balance: 12345n,
      cleared_balance: 12000n,
      pending_balance: 345n,
      closed: false,
      notes: 'main account',
      linked: true,
      last_reconciled_at: '2026-06-01',
      created_at: CREATION_ISO,
      updated_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('nulls optional fields and reports linked=false when there is no external link', () => {
    const account = {
      _id: 'bankAccount_2',
      _creationTime: CREATION,
      name: 'Brokerage',
      accountType: 'investment_brokerage',
      currentBalance: 0n,
      isClosed: true,
      updatedAt: '2026-07-02T00:00:00.000Z',
    } as unknown as Doc<'bankAccount'>;

    const mapped = bankAccountToApi(account, false);
    expect(mapped).toMatchObject({
      on_budget: false,
      balance: 0n,
      cleared_balance: null,
      pending_balance: null,
      closed: true,
      notes: null,
      linked: false,
      last_reconciled_at: null,
    });
  });

  it('treats a FinanceKit-linked account as linked', () => {
    const account = {
      _id: 'bankAccount_3',
      _creationTime: CREATION,
      name: 'Apple Card',
      accountType: 'credit_credit_card',
      currentBalance: -500n,
      isClosed: false,
      financeKitAccountId: 'financeKitAccount_1',
      updatedAt: '2026-07-03T00:00:00.000Z',
    } as unknown as Doc<'bankAccount'>;

    expect(bankAccountToApi(account, false).linked).toBe(true);
  });
});

describe('merchantToApi', () => {
  it('maps a merchant with a resolved name', () => {
    const merchant = {
      _id: 'merchant_1',
      _creationTime: CREATION,
      updatedAt: '2026-07-01T00:00:00.000Z',
    } as unknown as Doc<'merchant'>;

    expect(merchantToApi(merchant, 'Starbucks')).toEqual({
      id: 'merchant_1',
      name: 'Starbucks',
      created_at: CREATION_ISO,
      updated_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('passes through a null name when unresolved', () => {
    const merchant = { _id: 'merchant_2', _creationTime: CREATION } as unknown as Doc<'merchant'>;
    expect(merchantToApi(merchant, null).name).toBeNull();
  });
});

describe('categoryToApi', () => {
  it('maps explicit flags', () => {
    const category = {
      _id: 'category_1',
      categoryGroupId: 'categoryGroup_1',
      isArchived: true,
      isSystemCategory: true,
      categoryType: 'credit_card',
    } as unknown as Doc<'category'>;

    expect(categoryToApi(category, 'Amex Payment')).toEqual({
      id: 'category_1',
      name: 'Amex Payment',
      group_id: 'categoryGroup_1',
      archived: true,
      system: true,
      category_type: 'credit_card',
    });
  });

  it('defaults archived/system to false and category_type to "custom"', () => {
    const category = {
      _id: 'category_2',
      categoryGroupId: 'categoryGroup_2',
    } as unknown as Doc<'category'>;

    expect(categoryToApi(category, 'Groceries')).toMatchObject({
      archived: false,
      system: false,
      category_type: 'custom',
    });
  });
});

describe('transactionToApi', () => {
  function baseTransaction(overrides: Record<string, unknown>): Doc<'transaction'> {
    return {
      _id: 'transaction_1',
      _creationTime: CREATION,
      date: '2026-07-01',
      totalAmount: -5108n,
      bankAccountId: 'bankAccount_1',
      notes: 'txn note',
      status: 'cleared',
      reviewStatus: 'reviewed',
      type: 'regular',
      isDeleted: false,
      updatedAt: '2026-07-01T00:00:00.000Z',
      movements: [],
      ...overrides,
    } as unknown as Doc<'transaction'>;
  }

  it('maps a single-movement transaction with no splits', () => {
    const transaction = baseTransaction({
      merchantId: 'merchant_1',
      movements: [
        { amount: -5108n, categoryId: 'category_1', categoryName: 'Dining', readyToAssign: false, notes: 'line' },
      ],
    });

    expect(transactionToApi(transaction, { merchantName: 'Starbucks', accountName: 'Checking' })).toEqual({
      id: 'transaction_1',
      date: '2026-07-01',
      amount: -5108n,
      account_id: 'bankAccount_1',
      account_name: 'Checking',
      merchant_id: 'merchant_1',
      merchant_name: 'Starbucks',
      category_id: 'category_1',
      category_name: 'Dining',
      ready_to_assign: false,
      notes: 'txn note',
      status: 'cleared',
      review_status: 'reviewed',
      type: 'regular',
      transfer_account_id: null,
      splits: null,
      deleted: false,
      created_at: CREATION_ISO,
      updated_at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('nulls merchant/category and reflects ready_to_assign for an uncategorized inflow', () => {
    const transaction = baseTransaction({
      totalAmount: 120000n,
      movements: [{ amount: 120000n, readyToAssign: true }],
    });

    expect(transactionToApi(transaction, { merchantName: null, accountName: null })).toMatchObject({
      amount: 120000n,
      merchant_id: null,
      merchant_name: null,
      category_id: null,
      category_name: null,
      ready_to_assign: true,
      splits: null,
    });
  });

  it('emits a splits array for multi-movement transactions', () => {
    const transaction = baseTransaction({
      transferPairBankAccountId: 'bankAccount_2',
      movements: [
        { amount: -3500n, categoryId: 'category_a', categoryName: 'Groceries', readyToAssign: false, notes: 'food' },
        { amount: -1500n, readyToAssign: false },
      ],
    });

    const mapped = transactionToApi(transaction, { merchantName: 'Target', accountName: 'Checking' });

    expect(mapped.category_id).toBeNull();
    expect(mapped.category_name).toBeNull();
    expect(mapped.ready_to_assign).toBe(false);
    expect(mapped.transfer_account_id).toBe('bankAccount_2');
    expect(mapped.splits).toEqual([
      { amount: -3500n, category_id: 'category_a', category_name: 'Groceries', ready_to_assign: false, notes: 'food' },
      { amount: -1500n, category_id: null, category_name: null, ready_to_assign: false, notes: null },
    ]);
  });
});
