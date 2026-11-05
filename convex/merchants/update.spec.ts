import { describe, expect, it } from 'vitest';

import { applyMerchantTransactionStats, shouldUpdateMerchantDirectionalStats } from './update';

describe('applyMerchantTransactionStats', () => {
  it('keeps net stats while retaining gross inflow and outflow', () => {
    const afterInflow = applyMerchantTransactionStats(
      { totalAmount: 0n, transactionCount: 0n },
      { inflowAmount: 0n, outflowAmount: 0n, inflowCount: 0n, outflowCount: 0n },
      800n,
      1n
    );
    const afterOutflow = applyMerchantTransactionStats(afterInflow.stats, afterInflow.directionalStats, -1_000n, 1n);

    expect(afterOutflow).toEqual({
      stats: { totalAmount: -200n, transactionCount: 2n },
      directionalStats: {
        inflowAmount: 800n,
        outflowAmount: 1_000n,
        inflowCount: 1n,
        outflowCount: 1n,
      },
    });
  });

  it('reverses the matching direction when a transaction changes', () => {
    expect(
      applyMerchantTransactionStats(
        { totalAmount: -200n, transactionCount: 2n },
        { inflowAmount: 800n, outflowAmount: 1_000n, inflowCount: 1n, outflowCount: 1n },
        800n,
        -1n
      )
    ).toEqual({
      stats: { totalAmount: -1_000n, transactionCount: 1n },
      directionalStats: {
        inflowAmount: 0n,
        outflowAmount: 1_000n,
        inflowCount: 0n,
        outflowCount: 1n,
      },
    });
  });

  it('waits for the backfill instead of creating partial history for legacy merchants', () => {
    expect(
      shouldUpdateMerchantDirectionalStats({ '202607': { totalAmount: -200n, transactionCount: 2n } }, undefined)
    ).toBe(false);
    expect(shouldUpdateMerchantDirectionalStats({}, undefined)).toBe(true);
    expect(shouldUpdateMerchantDirectionalStats({}, {})).toBe(true);
  });
});
