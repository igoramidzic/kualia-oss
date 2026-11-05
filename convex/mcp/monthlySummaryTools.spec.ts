import { describe, expect, it } from 'vitest';
import type { Id } from '../_generated/dataModel';
import { computeMonthlySummary, type MonthlySummaryInputs } from './monthlySummaryTools';

const WS = 'ws_1' as unknown as Id<'workspace'>;

/**
 * Build a minimal `MonthlySummaryInputs` with sensible defaults so each test only spells out
 * the fields it cares about. Matches the runtime shape the Convex DB would hand back.
 */
function makeInputs(overrides: Partial<MonthlySummaryInputs> = {}): MonthlySummaryInputs {
  return {
    workspaceId: WS,
    currency: 'USD',
    yearMonths: [202604],
    categories: [],
    groups: [],
    uncategorizedOutflowByMonth: new Map(),
    monthlyIncomeActivity: {},
    ...overrides,
  };
}

describe('computeMonthlySummary', () => {
  it('sums gross outflow on expense categories and excludes credit-card / loan / income types', () => {
    const result = computeMonthlySummary(
      makeInputs({
        groups: [{ _id: 'g_essentials', name: 'Essentials', isDeleted: false }],
        categories: [
          // Real expense — should count.
          {
            _id: 'c_groceries',
            name: 'Groceries',
            categoryGroupId: 'g_essentials',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 50000n } },
          },
          // Credit card account — must NOT count even when it has outflow (a payment).
          {
            _id: 'c_visa',
            name: 'Visa',
            categoryGroupId: 'g_essentials',
            categoryType: 'credit_card',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 200000n } },
          },
          // Credit card payment envelope — also must NOT count.
          {
            _id: 'c_visa_pmt',
            name: 'Visa Payment',
            categoryGroupId: 'g_essentials',
            categoryType: 'credit_card_payment',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 200000n } },
          },
          // Income-side category — must NOT count.
          {
            _id: 'c_revenue',
            name: 'Revenue',
            categoryGroupId: 'g_essentials',
            categoryType: 'revenue',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 100000n } },
          },
          // Soft-deleted expense — must NOT count.
          {
            _id: 'c_deleted',
            name: 'Old',
            categoryGroupId: 'g_essentials',
            categoryType: 'custom',
            isDeleted: true,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 99999n } },
          },
        ],
        monthlyIncomeActivity: { '202604': { inflowAmount: 200000n, outflowAmount: 0n } },
      })
    );

    expect(result.months).toHaveLength(1);
    const [m] = result.months;
    expect(m.spending).toBe(50000n);
    expect(m.income).toBe(200000n);
    expect(m.savings).toBe(150000n);
    expect(m.savingsRate).toBe(75);
    expect(m.byCategory.map((c) => c.categoryId)).toEqual(['c_groceries']);
  });

  it('treats undefined categoryType as an expense (back-compat with pre-categoryType rows)', () => {
    const result = computeMonthlySummary(
      makeInputs({
        groups: [{ _id: 'g_misc', name: 'Misc', isDeleted: false }],
        categories: [
          {
            _id: 'c_legacy',
            name: 'Legacy',
            categoryGroupId: 'g_misc',
            categoryType: undefined,
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 30000n } },
          },
        ],
      })
    );
    expect(result.months[0].spending).toBe(30000n);
  });

  it('rolls uncategorized outflow into both the per-category list and the spending total', () => {
    const result = computeMonthlySummary(
      makeInputs({
        uncategorizedOutflowByMonth: new Map([[202604, 7500n]]),
      })
    );
    const [m] = result.months;
    expect(m.spending).toBe(7500n);
    expect(m.byCategory).toEqual([
      {
        categoryId: 'system:uncategorized',
        categoryName: 'Uncategorized',
        groupName: 'Uncategorized',
        spending: 7500n,
      },
    ]);
    expect(m.byGroup).toEqual([{ groupId: 'system:uncategorized-group', groupName: 'Uncategorized', spending: 7500n }]);
  });

  it('aggregates per-group spending and sorts categories and groups descending', () => {
    const result = computeMonthlySummary(
      makeInputs({
        groups: [
          { _id: 'g_food', name: 'Food', isDeleted: false },
          { _id: 'g_fun', name: 'Fun', isDeleted: false },
        ],
        categories: [
          {
            _id: 'c_groceries',
            name: 'Groceries',
            categoryGroupId: 'g_food',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 30000n } },
          },
          {
            _id: 'c_restaurants',
            name: 'Restaurants',
            categoryGroupId: 'g_food',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 80000n } },
          },
          {
            _id: 'c_movies',
            name: 'Movies',
            categoryGroupId: 'g_fun',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 20000n } },
          },
        ],
      })
    );
    const [m] = result.months;
    expect(m.byCategory.map((c) => c.categoryName)).toEqual(['Restaurants', 'Groceries', 'Movies']);
    expect(m.byGroup.map((g) => g.groupName)).toEqual(['Food', 'Fun']);
    expect(m.byGroup[0].spending).toBe(110000n);
    expect(m.byGroup[1].spending).toBe(20000n);
  });

  it('returns zero savings rate when income is zero, even if there was spending', () => {
    const result = computeMonthlySummary(
      makeInputs({
        categories: [
          {
            _id: 'c_x',
            name: 'X',
            categoryGroupId: 'g_x',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: { '202604': { inflowAmount: 0n, outflowAmount: 5000n } },
          },
        ],
        groups: [{ _id: 'g_x', name: 'G', isDeleted: false }],
      })
    );
    expect(result.months[0].income).toBe(0n);
    expect(result.months[0].savings).toBe(-5000n);
    expect(result.months[0].savingsRate).toBe(0);
  });

  it('aggregates totals across the requested months', () => {
    const result = computeMonthlySummary(
      makeInputs({
        yearMonths: [202603, 202604],
        groups: [{ _id: 'g', name: 'G', isDeleted: false }],
        categories: [
          {
            _id: 'c',
            name: 'C',
            categoryGroupId: 'g',
            categoryType: 'custom',
            isDeleted: false,
            monthlySpending: {
              '202603': { inflowAmount: 0n, outflowAmount: 10000n },
              '202604': { inflowAmount: 0n, outflowAmount: 20000n },
            },
          },
        ],
        monthlyIncomeActivity: {
          '202603': { inflowAmount: 50000n, outflowAmount: 0n },
          '202604': { inflowAmount: 60000n, outflowAmount: 0n },
        },
      })
    );
    expect(result.totals.income).toBe(110000n);
    expect(result.totals.spending).toBe(30000n);
    expect(result.totals.savings).toBe(80000n);
    // 80000 / 110000 = 0.7272... → 72.7%
    expect(result.totals.savingsRate).toBe(72.7);
  });
});
