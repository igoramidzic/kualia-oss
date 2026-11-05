import { describe, expect, it } from 'vitest';

import { getFinanceKitAccountSyncStartDate, getFinanceKitLedgerBalance } from './helpers';

describe('FinanceKit balances and starting balances', () => {
  it('prefers current balance, then booked balance for asset accounts', () => {
    expect(getFinanceKitLedgerBalance({ available: 100n, booked: 200n, current: 300n }, 'asset')).toBe(300n);
    expect(getFinanceKitLedgerBalance({ available: 100n, booked: 200n }, 'asset')).toBe(200n);
    expect(getFinanceKitLedgerBalance({ available: 100n }, 'asset')).toBe(100n);
    expect(getFinanceKitLedgerBalance(undefined, 'asset')).toBe(0n);
  });

  it('does not treat available credit as liability account debt', () => {
    expect(getFinanceKitLedgerBalance({ available: 700_000n, booked: 0n }, 'liability')).toBe(0n);
    expect(getFinanceKitLedgerBalance({ available: 700_000n }, 'liability')).toBe(0n);
    expect(getFinanceKitLedgerBalance({ available: 680_000n, booked: -20_000n }, 'liability')).toBe(-20_000n);
  });

  it('normalizes liability balances as negative even when the client sends a positive credit balance', () => {
    expect(getFinanceKitLedgerBalance({ current: 1_500_000n }, 'liability')).toBe(-1_500_000n);
    expect(getFinanceKitLedgerBalance({ booked: 1_500_000n }, 'liability')).toBe(-1_500_000n);
    expect(getFinanceKitLedgerBalance({ current: -1_500_000n }, 'liability')).toBe(-1_500_000n);
  });

  it('uses fallback only when balance data is missing', () => {
    expect(getFinanceKitLedgerBalance(undefined, 'asset', 12_345n)).toBe(12_345n);
    expect(getFinanceKitLedgerBalance(undefined, 'liability', -12_345n)).toBe(-12_345n);
    expect(getFinanceKitLedgerBalance(undefined, 'liability', 12_345n)).toBe(-12_345n);
    expect(getFinanceKitLedgerBalance({ available: 700_000n }, 'liability', -12_345n)).toBe(0n);
  });

  it('uses account-level sync start dates before legacy connection dates', () => {
    expect(getFinanceKitAccountSyncStartDate({ syncStartDate: '2026-07-01' }, '2026-06-12')).toBe('2026-07-01');
    expect(getFinanceKitAccountSyncStartDate({}, '2026-06-12')).toBe('2026-06-12');
  });
});
