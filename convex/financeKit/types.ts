export type FinanceKitAccountKind = 'asset' | 'liability';

export type FinanceKitBalanceSnapshot = {
  available?: bigint;
  booked?: bigint;
  current?: bigint;
  asOfDate?: string;
};
