import { describe, expect, it } from 'vitest';

import { calculateMonthlyDirectionalStats } from './backfillMerchantDirectionalStats';

describe('calculateMonthlyDirectionalStats', () => {
  it('reconstructs gross monthly stats and excludes off-budget accounts', () => {
    const accountTypes = new Map([
      ['checking', 'banking_checking'],
      ['brokerage', 'investment_brokerage'],
    ]);

    expect(
      calculateMonthlyDirectionalStats(
        [
          { bankAccountId: 'checking', date: '2026-07-01', totalAmount: 800n },
          { bankAccountId: 'checking', date: '2026-07-02', totalAmount: -1_000n },
          { bankAccountId: 'brokerage', date: '2026-07-03', totalAmount: 50_000n },
        ],
        accountTypes
      )
    ).toEqual({
      '202607': {
        inflowAmount: 800n,
        outflowAmount: 1_000n,
        inflowCount: 1n,
        outflowCount: 1n,
      },
    });
  });
});
