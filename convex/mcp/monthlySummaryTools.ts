import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { dateToYearMonth, yearMonthToString } from '../categoryBudgets/calculations';

import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

/**
 * Category types whose `monthlySpending` reflects real user expenses (not credit-card or
 * loan transfer mechanics, and not income-side categories). When summing "spending" the
 * AI should care about, only these types contribute.
 *
 * Categories created before `categoryType` was added carry no value — those are treated
 * as expense categories too (`undefined` falls into the expense bucket).
 */
const EXPENSE_CATEGORY_TYPES = new Set<string>(['custom']);

/** Returns true when the given category should count toward "real spending" totals. */
function isExpenseCategory(categoryType: string | undefined): boolean {
  if (categoryType === undefined) return true;
  return EXPENSE_CATEGORY_TYPES.has(categoryType);
}

type MonthEntry = {
  yearMonth: number;
  yearMonthString: string;
  income: bigint;
  spending: bigint;
  savings: bigint;
  /** Savings rate as a percent rounded to one decimal. 0 when income is 0. */
  savingsRate: number;
  byGroup: Array<{ groupId: string; groupName: string; spending: bigint }>;
  byCategory: Array<{ categoryId: string; categoryName: string; groupName: string; spending: bigint }>;
};

export type MonthlySummaryToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  months: MonthEntry[];
  totals: {
    income: bigint;
    spending: bigint;
    savings: bigint;
    savingsRate: number;
  };
};

function safeSavingsRate(income: bigint, savings: bigint): number {
  if (income <= 0n) return 0;
  // Compute with one extra decimal of precision then round to one.
  const tenths = Number((savings * 1000n) / income);
  return Math.round(tenths) / 10;
}

/**
 * Inputs the pure computation needs. Factored out so unit tests can supply plain objects
 * without standing up a Convex test database.
 */
export interface MonthlySummaryInputs {
  workspaceId: Id<'workspace'>;
  currency: string;
  yearMonths: number[];
  categories: Array<{
    _id: string;
    name: string;
    categoryGroupId: string;
    categoryType?: string;
    isDeleted: boolean;
    monthlySpending?: Record<string, { inflowAmount: bigint; outflowAmount: bigint }>;
  }>;
  groups: Array<{ _id: string; name: string; isDeleted: boolean }>;
  /** Per-yearMonth uncategorized outflow already aggregated, stored as a positive bigint. */
  uncategorizedOutflowByMonth: Map<number, bigint>;
  monthlyIncomeActivity: Record<string, { inflowAmount: bigint; outflowAmount: bigint }>;
}

export function computeMonthlySummary(inputs: MonthlySummaryInputs): MonthlySummaryToolPayload {
  const amountMetadata = resolveMcpAmountMetadata(inputs.currency);

  const groupNameById = new Map<string, string>();
  for (const group of inputs.groups) {
    if (!group.isDeleted) groupNameById.set(group._id, group.name);
  }

  const months: MonthEntry[] = [];
  let totalIncome = 0n;
  let totalSpending = 0n;

  for (const ym of inputs.yearMonths) {
    const ymKey = ym.toString();

    // Income: gross RTA inflow for the month. Outflows from RTA aren't user spending —
    // they're transfers off the RTA bucket (rare) and are intentionally not subtracted.
    const income = inputs.monthlyIncomeActivity[ymKey]?.inflowAmount ?? 0n;

    const byCategory: MonthEntry['byCategory'] = [];
    const byGroupAccum = new Map<string, { groupName: string; spending: bigint }>();
    let monthSpending = 0n;

    for (const category of inputs.categories) {
      if (category.isDeleted) continue;
      if (!isExpenseCategory(category.categoryType)) continue;
      const outflow = category.monthlySpending?.[ymKey]?.outflowAmount ?? 0n;
      if (outflow === 0n) continue;

      const groupName = groupNameById.get(category.categoryGroupId) ?? 'Unknown';
      byCategory.push({
        categoryId: category._id,
        categoryName: category.name,
        groupName,
        spending: outflow,
      });
      monthSpending += outflow;

      const groupAccum = byGroupAccum.get(category.categoryGroupId) ?? { groupName, spending: 0n };
      groupAccum.spending += outflow;
      byGroupAccum.set(category.categoryGroupId, groupAccum);
    }

    // Roll uncategorized outflow into both the per-category and per-group breakdowns under
    // a synthetic id so the totals add up to `monthSpending` without an unexplained delta.
    const uncategorizedOutflow = inputs.uncategorizedOutflowByMonth.get(ym) ?? 0n;
    if (uncategorizedOutflow > 0n) {
      byCategory.push({
        categoryId: 'system:uncategorized',
        categoryName: 'Uncategorized',
        groupName: 'Uncategorized',
        spending: uncategorizedOutflow,
      });
      const groupAccum = byGroupAccum.get('system:uncategorized-group') ?? {
        groupName: 'Uncategorized',
        spending: 0n,
      };
      groupAccum.spending += uncategorizedOutflow;
      byGroupAccum.set('system:uncategorized-group', groupAccum);
      monthSpending += uncategorizedOutflow;
    }

    const byGroup = Array.from(byGroupAccum.entries())
      .map(([groupId, { groupName, spending }]) => ({ groupId, groupName, spending }))
      .sort((a, b) => (b.spending > a.spending ? 1 : b.spending < a.spending ? -1 : 0));

    byCategory.sort((a, b) => (b.spending > a.spending ? 1 : b.spending < a.spending ? -1 : 0));

    const savings = income - monthSpending;
    months.push({
      yearMonth: ym,
      yearMonthString: yearMonthToString(ym),
      income,
      spending: monthSpending,
      savings,
      savingsRate: safeSavingsRate(income, savings),
      byGroup,
      byCategory,
    });

    totalIncome += income;
    totalSpending += monthSpending;
  }

  const totalSavings = totalIncome - totalSpending;

  return {
    workspaceId: inputs.workspaceId,
    currency: inputs.currency,
    ...amountMetadata,
    months,
    totals: {
      income: totalIncome,
      spending: totalSpending,
      savings: totalSavings,
      savingsRate: safeSavingsRate(totalIncome, totalSavings),
    },
  };
}

export async function getMonthlySummary(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  yearMonths: number[]
): Promise<MonthlySummaryToolPayload> {
  const [groups, categories, uncategorizedTransactions] = await Promise.all([
    ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    // Uncategorized outflow lives on transactions (movements without a categoryId), not on
    // any single category row, so we read it directly the same way the spending report does.
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
        q.eq('workspaceId', workspace._id).eq('hasUncategorized', true).eq('isDeleted', false)
      )
      .collect(),
  ]);

  const uncategorizedOutflowByMonth = new Map<number, bigint>();
  for (const transaction of uncategorizedTransactions) {
    const ym = dateToYearMonth(transaction.date);
    let outflow = 0n;
    for (const movement of transaction.movements) {
      if (!movement.categoryId && !movement.readyToAssign && movement.amount < 0n) {
        outflow += -movement.amount;
      }
    }
    if (outflow > 0n) {
      uncategorizedOutflowByMonth.set(ym, (uncategorizedOutflowByMonth.get(ym) ?? 0n) + outflow);
    }
  }

  return computeMonthlySummary({
    workspaceId: workspace._id,
    currency: workspace.currency ?? 'USD',
    yearMonths,
    categories,
    groups,
    uncategorizedOutflowByMonth,
    monthlyIncomeActivity: workspace.monthlyIncomeActivity ?? {},
  });
}
