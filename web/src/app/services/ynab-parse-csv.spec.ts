import { describe, expect, it } from 'vitest';

import {
  extractMerchantNames,
  filterFutureTransactions,
  getSystemTransactionTypeFromYnabPayee,
  groupSplitTransactions,
  parseCurrencyToBaseUnits,
  parseRegisterCSV,
  parseYnabDate,
} from 'convex/ynab/parseCSV';
import type { YnabRegisterRow } from 'convex/ynab/types';

function createRegisterRow(date: string, payee = 'Coffee Shop'): YnabRegisterRow {
  return {
    account: 'Checking',
    flag: '',
    date,
    payee,
    categoryGroupCategory: 'Everyday: Coffee',
    categoryGroup: 'Everyday',
    category: 'Coffee',
    memo: '',
    outflow: '$5.00',
    inflow: '$0.00',
    cleared: 'Cleared',
  };
}

describe('YNAB CSV date parsing', () => {
  it('parses ISO dates exported as YYYY-MM-DD', () => {
    expect(parseYnabDate('2025-12-31', 'YYYY-MM-DD')).toBe('2025-12-31');
  });

  it('keeps YYYY-MM-DD dates on grouped transactions', () => {
    const transactions = groupSplitTransactions([createRegisterRow('2025-12-31')]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.date).toBe('2025-12-31');
  });

  it('parses year-first dot dates exported as YYYY.MM.DD', () => {
    const transactions = groupSplitTransactions([createRegisterRow('2026.06.25')]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.date).toBe('2026-06-25');
  });

  it('skips empty comma-only register rows', () => {
    const rows = parseRegisterCSV(
      [
        'Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared',
        'Checking,,2026.06.25,Coffee Shop,Everyday: Coffee,Everyday,Coffee,,$5.00,$0.00,Cleared',
        ',,,,,,,,,,',
      ].join('\n')
    );

    expect(rows).toHaveLength(1);
    expect(groupSplitTransactions(rows)[0]?.date).toBe('2026-06-25');
  });

  it('reports csv row context when a register row is missing a date', () => {
    expect(() =>
      parseRegisterCSV(
        [
          'Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared',
          'Checking,,2026.06.25,Coffee Shop,Everyday: Coffee,Everyday,Coffee,,$5.00,$0.00,Cleared',
          'Checking,,,Coffee Shop,Everyday: Coffee,Everyday,Coffee,,$5.00,$0.00,Cleared',
        ].join('\n')
      )
    ).toThrowError(
      'register.csv row 3 is missing a date (account: Checking, payee: Coffee Shop). Fix this row or remove it, then try importing again.'
    );
  });

  it('reports grouped row context when a register row is missing a date', () => {
    expect(() => groupSplitTransactions([createRegisterRow('')])).toThrowError(
      'YNAB register row 1 is missing a date (account: Checking, payee: Coffee Shop). Fix this row or remove it, then try importing again.'
    );
  });

  it('rejects two-digit years to prevent 1900s imports', () => {
    expect(() => parseYnabDate('12/31/33', 'MM/DD/YYYY')).toThrowError('Expected a 4-digit year');
  });

  it('skips transactions that are after the provided current date', () => {
    const transactions = groupSplitTransactions([createRegisterRow('2025-12-31'), createRegisterRow('2026-01-01')]);
    const filtered = filterFutureTransactions(transactions, '2025-12-31');

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.date).toBe('2025-12-31');
  });

  it('parses day-first hyphen dates (DD-MM-YYYY)', () => {
    const transactions = groupSplitTransactions([createRegisterRow('13-02-2026')]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.date).toBe('2026-02-13');
  });

  it('parses month-first hyphen dates (MM-DD-YYYY)', () => {
    const transactions = groupSplitTransactions([createRegisterRow('02-13-2026')]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.date).toBe('2026-02-13');
  });

  it('handles mixed day-first separators in one file', () => {
    const transactions = groupSplitTransactions([createRegisterRow('13.02.2026'), createRegisterRow('14-02-2026')]);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.date).toBe('2026-02-14');
    expect(transactions[1]?.date).toBe('2026-02-13');
  });

  it('maps YNAB system payees to Kualia system transaction types', () => {
    expect(getSystemTransactionTypeFromYnabPayee('Starting Balance')).toBe('starting_balance');
    expect(getSystemTransactionTypeFromYnabPayee('Reconciliation Balance Adjustment')).toBe('balance_adjustment');
    expect(getSystemTransactionTypeFromYnabPayee('  starting balance  ')).toBe('starting_balance');
    expect(getSystemTransactionTypeFromYnabPayee('Coffee Shop')).toBeNull();
  });

  it('parses year-first slash dates (YYYY/MM/DD)', () => {
    const transactions = groupSplitTransactions([createRegisterRow('2026/08/25')]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.date).toBe('2026-08-25');
  });

  it('parses localized YNAB amounts using the selected currency minor unit', () => {
    expect(parseCurrencyToBaseUnits('$1.234,00', 'USD')).toBe(123400);
    expect(parseCurrencyToBaseUnits('$1.234,00', 'JPY')).toBe(1234);
  });

  it('stores zero-decimal transaction amounts without cents scaling', () => {
    const transactions = groupSplitTransactions(
      [
        {
          ...createRegisterRow('2026.06.25'),
          outflow: '$1.234,00',
          inflow: '$0,00',
        },
      ],
      'JPY'
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.totalAmount).toBe(-1234);
    expect(transactions[0]?.movements[0]?.amount).toBe(-1234);
  });

  it('does not create merchants for system payees or transfers', () => {
    const transactions = groupSplitTransactions([
      createRegisterRow('2025-12-31', 'Coffee Shop'),
      createRegisterRow('2025-12-30', 'Starting Balance'),
      createRegisterRow('2025-12-29', 'Reconciliation Balance Adjustment'),
      createRegisterRow('2025-12-28', 'Transfer : Savings'),
    ]);

    expect(extractMerchantNames(transactions)).toEqual(['Coffee Shop']);
  });
});
