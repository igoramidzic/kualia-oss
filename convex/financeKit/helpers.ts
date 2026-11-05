import type { FinanceKitAccountKind, FinanceKitBalanceSnapshot } from './types';

export function getFinanceKitLedgerBalance(
  balances: FinanceKitBalanceSnapshot | undefined,
  accountKind: FinanceKitAccountKind,
  fallback = 0n
): bigint {
  if (balances?.current !== undefined) {
    return accountKind === 'liability' ? -absBigInt(balances.current) : balances.current;
  }

  if (balances?.booked !== undefined) {
    return accountKind === 'liability' ? -absBigInt(balances.booked) : balances.booked;
  }

  if (accountKind === 'liability') {
    return balances?.available === undefined ? -absBigInt(fallback) : 0n;
  }

  return balances?.available ?? fallback;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function getFinanceKitAccountSyncStartDate(
  account: { syncStartDate?: string },
  connectionSyncStartDate: string
): string {
  return account.syncStartDate ?? connectionSyncStartDate;
}
