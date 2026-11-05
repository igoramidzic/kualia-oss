import { describe, expect, it } from 'vitest';
import type { BankAccountWithRelations } from '../../services/bank-account.service';
import { type AccountsNetWorthReport, buildNetWorthPoints, selectBalanceRange } from './account-balance-chart';

function account(firstBalanceYearMonth: string | null, currentBalance = 300n): BankAccountWithRelations {
  return { _id: 'checking', firstBalanceYearMonth, currentBalance } as unknown as BankAccountWithRelations;
}

function report(months: [string, bigint][]): AccountsNetWorthReport {
  return {
    currentMonth: '2026-10',
    months: months.map(([yearMonth, balance]) => ({
      yearMonth,
      accounts: [{ accountId: 'checking', accountName: 'Checking', accountType: 'banking_checking', balance }],
      totalAssets: balance,
      totalLiabilities: 0n,
      netWorth: balance,
      netWorthDelta: null,
      netWorthPercentageChange: null,
      categoryBalances: [],
    })),
  };
}

describe('account balance chart history', () => {
  it('ends at live balances, replacing the current snapshot and excluding future data', () => {
    const historyWithFuture = report([
      ['2026-09', 200n],
      ['2026-10', 999n],
      ['2026-11', 9999n],
    ]);

    expect(buildNetWorthPoints(historyWithFuture, [account('2026-09')], '2026-10')).toEqual([
      { month: '2026-09', balance: 200n },
      { month: '2026-10', balance: 300n },
    ]);
  });

  it('does not invent history for accounts without data', () => {
    expect(buildNetWorthPoints(undefined, [account(null)], '2026-10')).toEqual([{ month: '2026-10', balance: 300n }]);
  });

  it('recalculates historical and current totals using only the filtered account IDs', () => {
    const mixedHistory = report([['2026-09', 200n]]);
    mixedHistory.months[0].accounts.push({
      accountId: 'investment',
      accountType: 'investment_brokerage',
      accountName: 'Brokerage',
      balance: 9000n,
    });
    mixedHistory.months[0].netWorth = 9200n;

    expect(buildNetWorthPoints(mixedHistory, [account('2026-09')], '2026-10')).toEqual([
      { month: '2026-09', balance: 200n },
      { month: '2026-10', balance: 300n },
    ]);
  });

  it('preserves flat, zero, and negative balances for the chart library', () => {
    for (const balance of [0n, -500n, 500n]) {
      const points = buildNetWorthPoints(
        report([
          ['2026-08', balance],
          ['2026-09', balance],
        ]),
        [account('2026-08', balance)],
        '2026-10'
      );
      expect(points.map((point) => point.balance)).toEqual([balance, balance, balance]);
    }
  });

  it('selects one, three, twelve months or all history with the baseline', () => {
    const points = Array.from({ length: 24 }, (_, index) => ({ month: String(index), balance: BigInt(index) }));

    expect(selectBalanceRange(points, '1M')).toEqual(points.slice(-2));
    expect(selectBalanceRange(points, '3M')).toEqual(points.slice(-4));
    expect(selectBalanceRange(points, '1Y')).toEqual(points.slice(-13));
    expect(selectBalanceRange(points, 'All')).toEqual(points);
  });
});
