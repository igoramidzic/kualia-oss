import { describe, expect, it } from 'vitest';

import { transactionMatchesReportFlow } from './reportFilters';

describe('transactionMatchesReportFlow', () => {
  it('matches category and Ready to Assign movement direction', () => {
    const transaction = {
      totalAmount: 850n,
      movements: [
        { categoryId: 'rent', amount: 850n },
        { readyToAssign: true, amount: -25n },
      ],
    };

    expect(
      transactionMatchesReportFlow(transaction, 'inflow', {
        categoryId: 'rent',
        isIncome: false,
        isUncategorized: false,
      })
    ).toBe(true);
    expect(
      transactionMatchesReportFlow(transaction, 'outflow', {
        categoryId: 'rent',
        isIncome: false,
        isUncategorized: false,
      })
    ).toBe(false);
    expect(
      transactionMatchesReportFlow(transaction, 'outflow', {
        isIncome: true,
        isUncategorized: false,
      })
    ).toBe(true);
  });

  it('uses the transaction total for merchant direction', () => {
    const omarInflow = { totalAmount: 800n, movements: [{ readyToAssign: true, amount: 800n }] };
    const omarOutflow = { totalAmount: -1_000n, movements: [{ categoryId: 'rent', amount: -1_000n }] };
    const filter = {
      merchantId: 'omar',
      isIncome: false,
      isUncategorized: false,
    };

    expect(transactionMatchesReportFlow(omarInflow, 'inflow', filter)).toBe(true);
    expect(transactionMatchesReportFlow(omarInflow, 'outflow', filter)).toBe(false);
    expect(transactionMatchesReportFlow(omarOutflow, 'outflow', filter)).toBe(true);
  });

  it('does not filter released clients that omit flow', () => {
    expect(
      transactionMatchesReportFlow({ totalAmount: -1_000n }, undefined, {
        merchantId: 'omar',
        isIncome: false,
        isUncategorized: false,
      })
    ).toBe(true);
  });
});
