import { describe, expect, it } from 'vitest';
import { Merchant } from '../../services/merchant.service';
import { merchantRequiresDeleteTarget } from './merchant';

function merchantWithCounts(transactionCount: number, activeRecurringTransactionCount: number): Merchant {
  return {
    transactionCount,
    activeRecurringTransactionCount,
  } as unknown as Merchant;
}

describe('merchantRequiresDeleteTarget', () => {
  it('returns false when the merchant has no active references', () => {
    expect(merchantRequiresDeleteTarget(merchantWithCounts(0, 0))).toBe(false);
  });

  it('returns true when the merchant has transactions', () => {
    expect(merchantRequiresDeleteTarget(merchantWithCounts(1, 0))).toBe(true);
  });

  it('returns true when the merchant has recurring templates', () => {
    expect(merchantRequiresDeleteTarget(merchantWithCounts(0, 1))).toBe(true);
  });
});
