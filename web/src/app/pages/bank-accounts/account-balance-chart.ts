import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../../convex/_generated/api';
import type { BankAccountWithRelations } from '../../services/bank-account.service';

export type AccountsNetWorthReport = FunctionReturnType<typeof api.reports.getNetWorthReport>;
export type NetWorthRange = '1M' | '3M' | '1Y' | 'All';
export interface BalancePoint {
  month: string;
  balance: bigint;
}

export function selectBalanceRange(points: BalancePoint[], range: NetWorthRange): BalancePoint[] {
  const count = { '1M': 2, '3M': 4, '1Y': 13, All: points.length }[range];
  return points.slice(-count);
}

export function buildNetWorthPoints(
  report: AccountsNetWorthReport | undefined,
  accounts: BankAccountWithRelations[],
  currentMonth: string
): BalancePoint[] {
  const accountIds = new Set<string>(accounts.map((account) => account._id));
  const history = (report?.months ?? [])
    .filter((month) => month.yearMonth < currentMonth)
    .map((month) => ({
      month: month.yearMonth,
      balance: month.accounts.reduce(
        (sum, account) => sum + (accountIds.has(account.accountId) ? account.balance : 0n),
        0n
      ),
    }));
  return [
    ...history,
    { month: currentMonth, balance: accounts.reduce((sum, account) => sum + account.currentBalance, 0n) },
  ];
}
