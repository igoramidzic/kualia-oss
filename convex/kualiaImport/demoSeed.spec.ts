import { describe, expect, it } from 'vitest';
import { buildDemoBudget } from '../../scripts/seed-data.mjs';
import { prepareImport } from './prepare';

describe('local demo seed data', () => {
  const { files, summary } = buildDemoBudget({ today: '2026-03-10' });
  const prepared = prepareImport(files, 'USD');

  it('passes the Kualia import validation used by pnpm seed', () => {
    expect(prepared.accounts.size).toBe(3);
    expect(prepared.categories.size).toBe(summary.categoryCount);
    expect(prepared.transactions).toHaveLength(summary.transactionCount);
    expect(prepared.readyToAssign).toBe(summary.readyToAssign);
  });

  it('keeps account balances, credit card linkage, splits and transfers intact', () => {
    for (const account of summary.accounts) {
      const imported = prepared.accounts.get(account.id);
      expect(imported?.currentBalance).toBe(account.balance);
      expect((imported?.clearedBalance ?? 0n) + (imported?.pendingBalance ?? 0n)).toBe(account.balance);
    }
    expect(prepared.creditCategories.get('demo-acct-card')).toBe('demo-cat-card');
    expect(prepared.groups.get('demo-group-credit')).toMatchObject({ type: 'credit_card', isSystemGroup: true });
    expect(prepared.transactions.filter((t) => t.movements.length > 1)).toHaveLength(summary.splitCount);
    expect(prepared.transactions.filter((t) => t.transferKey)).toHaveLength(summary.transferCount * 2);
  });

  it('records targets and monthly assignments for every month', () => {
    const rent = prepared.categories.get('demo-cat-rent');
    expect(rent).toMatchObject({ enableTarget: true, target_type: 'recurring', target_amount: 165000n });
    expect(Object.keys(rent?.assignments ?? {})).toEqual(summary.months);
    expect(prepared.categories.get('demo-cat-emergency')).toMatchObject({
      target_type: 'maintain_balance',
      target_monthlyContribution: 50000n,
    });
    expect(Object.keys(prepared.monthlyIncomeActivity)).toEqual(summary.months);
  });
});
