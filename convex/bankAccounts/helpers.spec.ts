import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { calculatePlaidOpeningBalances } from './helpers';

describe('Plaid opening balances', () => {
  const rawId = 'raw_1' as Id<'transactionImportRaw'>;

  it('preserves an unmatched expense entered while the first import is running', () => {
    const balances = calculatePlaidOpeningBalances(
      [
        { status: 'cleared', totalAmount: -200n, transactionImportRawId: rawId },
        { status: 'cleared', totalAmount: -100n },
      ],
      1000n,
      true
    );

    expect(balances).toEqual({
      currentBalance: 900n,
      startingBalance: 1200n,
      pendingBalance: 0n,
      clearedBalance: 900n,
    });
  });

  it('does not count a manual transaction again after it matches a bank import', () => {
    const balances = calculatePlaidOpeningBalances(
      [{ status: 'pending', totalAmount: -100n, linkedRawTransactionId: rawId }],
      1000n,
      true
    );

    expect(balances).toEqual({
      currentBalance: 1000n,
      startingBalance: 1100n,
      pendingBalance: -100n,
      clearedBalance: 1100n,
    });
  });

  it('preserves legacy initial-sync balance arithmetic when no fresh snapshot is supplied', () => {
    const balances = calculatePlaidOpeningBalances(
      [
        { status: 'cleared', totalAmount: -200n, transactionImportRawId: rawId },
        { status: 'cleared', totalAmount: -100n },
      ],
      1000n,
      false
    );

    expect(balances).toEqual({
      currentBalance: 1000n,
      startingBalance: 1300n,
      pendingBalance: 0n,
      clearedBalance: 1000n,
    });
  });
});
