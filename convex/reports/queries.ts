import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
import { dateToYearMonth, getPreviousYearMonth, yearMonthToString } from '../categoryBudgets/calculations';
import { AccountTypeCategory, getAccountTypeCategory, isLiabilityAccountType } from '../lib/accountTypes';
import { requireWorkspaceAccess } from '../lib/auth';
import { getReportSectionAmounts } from './directional';

const getNetWorthReportInternalRef = makeFunctionReference<
  'query',
  { workspaceId: Id<'workspace'>; monthsBack?: number; currentYearMonth: bigint },
  NetWorthReportResult
>('reports/queries:getNetWorthReportInternal');

const getSpendingReportInternalRef = makeFunctionReference<
  'query',
  { workspaceId: Id<'workspace'>; monthsBack?: number; currentYearMonth: bigint; grossDirectional?: boolean },
  SpendingReportResult
>('reports/queries:getSpendingReportInternal');

/**
 * Safely calculate percentage from two bigint values.
 * Returns 0 if the result would be NaN, Infinity, or if total is 0.
 */
function safePercent(value: bigint, total: bigint): number {
  if (total === 0n) return 0;
  const result = (Number(value) / Number(total)) * 100;
  // Use +0 to ensure result is a primitive number, not any special type
  return Number.isFinite(result) ? result + 0 : 0;
}

/**
 * Account balance data for a single month
 */
interface AccountMonthBalance {
  accountId: string;
  accountName: string;
  accountType: string;
  balance: bigint;
}

/**
 * Category balance summary with delta and percentage change
 */
interface CategoryBalance {
  category: string; // "banking", "credit", "investment", "loan"
  balance: bigint;
  delta: bigint | null; // Change from previous month (null if no previous month)
  percentageChange: number | null; // Percentage change from previous month (null if no previous month or division by zero)
}

/**
 * Monthly net worth data point
 */
interface MonthlyNetWorth {
  yearMonth: string; // "YYYY-MM" format
  accounts: AccountMonthBalance[];
  totalAssets: bigint;
  totalLiabilities: bigint;
  netWorth: bigint;
  // New fields for deltas and percentages
  netWorthDelta: bigint | null;
  netWorthPercentageChange: number | null;
  categoryBalances: CategoryBalance[];
}

interface NetWorthReportResult {
  months: MonthlyNetWorth[];
  currentMonth: string;
}

/**
 * Calculate the running balance for an account up to and including a specific month.
 * monthlyBalances stores deltas (balance changes) per month, not running balances.
 * This function sums all deltas from the earliest month up to the target month.
 */
function getRunningBalanceForMonth(
  monthlyBalances: Record<string, bigint> | undefined,
  targetYearMonth: number
): bigint {
  if (!monthlyBalances || Object.keys(monthlyBalances).length === 0) {
    return 0n;
  }

  // Get all months up to and including the target month
  const monthsToSum = Object.keys(monthlyBalances)
    .map((m) => parseInt(m, 10))
    .filter((m) => m <= targetYearMonth)
    .sort((a, b) => a - b); // Sort ascending

  // Sum all deltas up to the target month
  let runningBalance = 0n;
  for (const month of monthsToSum) {
    runningBalance += monthlyBalances[month.toString()];
  }

  return runningBalance;
}

/**
 * Get net worth report with account balance history
 *
 * Returns monthly snapshots of account balances and calculated net worth.
 * Uses cascading logic: if an account has no transactions in a month,
 * the balance from the most recent previous month is carried forward.
 *
 * - totalAssets: sum of positive balances (checking, savings, etc.)
 * - totalLiabilities: sum of negative balances (credit cards)
 * - netWorth: totalAssets + totalLiabilities (liabilities are negative)
 */
export const getNetWorthReportInternal = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    monthsBack: v.optional(v.number()), // No limit by default - returns all historical data
    currentYearMonth: v.int64(), // Client must provide their local current month (YYYYMM format)
  },
  handler: async (
    ctx,
    { workspaceId: verifiedWorkspaceId, monthsBack, currentYearMonth: currentYearMonthBigInt }
  ): Promise<NetWorthReportResult> => {
    // Get all non-deleted bank accounts (monthlyBalances is embedded on bankAccount)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Use the client-provided current month (convert from bigint to number)
    const currentYearMonth = Number(currentYearMonthBigInt);

    // Find the earliest month that has any data across all accounts
    let earliestMonthWithData: number | null = null;
    for (const account of bankAccounts) {
      if (account.monthlyBalances) {
        for (const monthStr of Object.keys(account.monthlyBalances)) {
          const monthNum = parseInt(monthStr, 10);
          if (earliestMonthWithData === null || monthNum < earliestMonthWithData) {
            earliestMonthWithData = monthNum;
          }
        }
      }
    }

    // If no data exists, return empty report
    if (earliestMonthWithData === null) {
      return {
        months: [],
        currentMonth: yearMonthToString(currentYearMonth),
      };
    }

    // Generate list of months from earliest data to current month
    // If monthsBack is provided, limit to that many months; otherwise include all
    const monthsToInclude: number[] = [];
    let month = currentYearMonth;
    let i = 0;
    while (month >= earliestMonthWithData) {
      if (monthsBack !== undefined && i >= monthsBack) {
        break;
      }
      monthsToInclude.unshift(month); // Add to front to keep chronological order
      month = getPreviousYearMonth(month);
      i++;
    }

    // Build the report for each month
    const months: MonthlyNetWorth[] = [];

    for (let i = 0; i < monthsToInclude.length; i++) {
      const yearMonth = monthsToInclude[i];
      const displayYearMonth = yearMonthToString(yearMonth); // "2025-12" format for display

      const accountBalances: AccountMonthBalance[] = [];
      let totalAssets = 0n;
      let totalLiabilities = 0n;

      // Track balances by category for this month
      const categoryBalancesMap: Record<string, bigint> = {
        [AccountTypeCategory.BANKING]: 0n,
        [AccountTypeCategory.CREDIT]: 0n,
        [AccountTypeCategory.INVESTMENT]: 0n,
        [AccountTypeCategory.LOAN]: 0n,
      };

      for (const account of bankAccounts) {
        // Calculate running balance for this account up to this month (sum of all deltas)
        const balance = getRunningBalanceForMonth(account.monthlyBalances, yearMonth);

        accountBalances.push({
          accountId: account._id,
          accountName: account.name,
          accountType: account.accountType,
          balance,
        });

        // Track balance by category
        const category = getAccountTypeCategory(account.accountType);
        if (category) {
          categoryBalancesMap[category] += balance;
        }

        // Credit and loan accounts are liabilities (typically negative balances)
        // Banking and investment accounts are assets (typically positive balances)
        if (isLiabilityAccountType(account.accountType)) {
          // Credit/loan balance is stored as negative (debt)
          // totalLiabilities is the sum of these negative values
          totalLiabilities += balance;
        } else {
          totalAssets += balance;
        }
      }

      const netWorth = totalAssets + totalLiabilities;

      // Calculate deltas and percentages from previous month
      let netWorthDelta: bigint | null = null;
      let netWorthPercentageChange: number | null = null;
      const categoryBalances: CategoryBalance[] = [];

      // Get previous month data if available
      const previousMonth = i > 0 ? months[i - 1] : null;

      if (previousMonth) {
        // Ensure we're working with bigint values (in case of type coercion during array storage)
        const previousNetWorth = BigInt(previousMonth.netWorth);
        netWorthDelta = netWorth - previousNetWorth;
        // Calculate percentage using the delta we just computed to ensure consistency
        if (previousNetWorth !== 0n) {
          netWorthPercentageChange = (Number(netWorthDelta) / Math.abs(Number(previousNetWorth))) * 100;
        }
      }

      // Build category balances with deltas
      const categories = Object.values(AccountTypeCategory);
      for (const category of categories) {
        const currentCategoryBalance = categoryBalancesMap[category];
        let delta: bigint | null = null;
        let percentageChange: number | null = null;

        if (previousMonth) {
          const previousCategoryBalance = previousMonth.categoryBalances.find((cb) => cb.category === category);
          if (previousCategoryBalance) {
            // Ensure we're working with bigint values (in case of type coercion during array storage)
            const previousBalance = BigInt(previousCategoryBalance.balance);
            delta = currentCategoryBalance - previousBalance;
            // Calculate percentage using the delta we just computed to ensure consistency
            if (previousBalance !== 0n) {
              percentageChange = (Number(delta) / Math.abs(Number(previousBalance))) * 100;
            }
          }
        }

        categoryBalances.push({
          category,
          balance: currentCategoryBalance,
          delta,
          percentageChange,
        });
      }

      months.push({
        yearMonth: displayYearMonth,
        accounts: accountBalances,
        totalAssets,
        totalLiabilities,
        netWorth,
        netWorthDelta,
        netWorthPercentageChange,
        categoryBalances,
      });
    }

    return {
      months,
      currentMonth: yearMonthToString(currentYearMonth),
    };
  },
});

export const getNetWorthReport = query({
  args: {
    workspaceId: v.id('workspace'),
    monthsBack: v.optional(v.number()), // No limit by default - returns all historical data
    currentYearMonth: v.int64(), // Client must provide their local current month (YYYYMM format)
  },
  handler: async (ctx, { workspaceId, monthsBack, currentYearMonth }): Promise<NetWorthReportResult> => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    return await ctx.runQuery(getNetWorthReportInternalRef, {
      workspaceId: verifiedWorkspaceId,
      monthsBack,
      currentYearMonth,
    });
  },
});

/**
 * Category spending data for a single month
 */
interface CategorySpendingData {
  categoryId: string;
  categoryName: string;
  inflowAmount: bigint;
  outflowAmount: bigint;
  netActivity: bigint; // inflowAmount - outflowAmount
  actualPercent: number; // Percentage of total within section (0-100)
  relativePercent: number; // Percentage relative to max in section (0-100)
}

/**
 * Category group spending data for a single month (aggregated from categories)
 */
interface GroupSpendingData {
  groupId: string;
  groupName: string;
  inflowAmount: bigint;
  outflowAmount: bigint;
  netActivity: bigint;
  actualPercent: number; // Percentage of total within section (0-100)
  relativePercent: number; // Percentage relative to max in section (0-100)
  categories: CategorySpendingData[];
}

/**
 * Merchant spending data for a single month
 */
interface MerchantSpendingData {
  merchantId: string;
  merchantName: string;
  totalAmount: bigint;
  transactionCount: bigint;
  actualPercent: number; // Percentage of total within section (0-100)
  relativePercent: number; // Percentage relative to max in section (0-100)
}

/**
 * Section containing outflow items. Updated clients receive gross amounts;
 * released clients retain the legacy net-classified contract.
 */
interface SpendingSection<T> {
  items: T[];
  total: bigint; // Sum of absolute values of spending amounts
}

/**
 * Section containing inflow items. Updated clients receive gross amounts;
 * released clients retain the legacy net-classified contract.
 */
interface IncomeSection<T> {
  items: T[];
  total: bigint; // Sum of absolute values of income amounts
}

/**
 * Monthly spending report data point
 */
interface MonthlySpending {
  yearMonth: string; // "YYYY-MM" format
  // Monthly income amount (from workspace.monthlyIncome)
  monthlyIncome: bigint;
  // Section totals (for chart display)
  totalSpending: bigint; // Sum of category spending
  totalIncome: bigint; // Sum of category income + monthly income
  // Category activity split into outflow and inflow sections
  categorySpending: SpendingSection<CategorySpendingData>;
  categoryIncome: IncomeSection<CategorySpendingData>;
  // Legacy totals for backwards compatibility
  totalCategoryInflow: bigint;
  totalCategoryOutflow: bigint;
  totalCategoryNetActivity: bigint;
  // Spending by group - split into spending and income
  groupSpending: SpendingSection<GroupSpendingData>;
  groupIncome: IncomeSection<GroupSpendingData>;
  // Merchant activity split into outflow (negative totalAmount) and inflow (positive totalAmount)
  merchantSpending: SpendingSection<MerchantSpendingData>;
  merchantIncome: IncomeSection<MerchantSpendingData>;
  // Legacy fields for backwards compatibility
  categories: CategorySpendingData[];
  groups: GroupSpendingData[];
  merchants: MerchantSpendingData[];
  totalMerchantSpending: bigint;
}

interface SpendingReportResult {
  months: MonthlySpending[];
  currentMonth: string;
}

/**
 * Get spending report with breakdown by category, group, and merchant
 *
 * Returns monthly snapshots of spending data:
 * - categories: Individual category spending (inflow/outflow)
 * - groups: Category group spending (aggregated from categories in each group)
 * - merchants: Merchant spending totals
 */
export const getSpendingReportInternal = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    monthsBack: v.optional(v.number()), // No limit by default - returns all historical data
    currentYearMonth: v.int64(), // Client must provide their local current month (YYYYMM format)
    grossDirectional: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { workspaceId: verifiedWorkspaceId, monthsBack, currentYearMonth: currentYearMonthBigInt, grossDirectional = false }
  ): Promise<SpendingReportResult> => {
    // Use the client-provided current month (convert from bigint to number)
    const currentYearMonth = Number(currentYearMonthBigInt);

    // Fetch all required data in parallel
    // Note: categorySpending is now stored directly on category table (no separate categorySpending table)
    const [
      workspace,
      categories,
      categoryGroups,
      merchants,
      globalMerchants,
      uncategorizedTransactions,
      missingPayeeTransactions,
    ] = await Promise.all([
      ctx.db.get(verifiedWorkspaceId),
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('categoryGroup')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('merchant')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      // Fetch global merchants for name resolution
      ctx.db.query('globalMerchant').collect(),
      // Fetch transactions with uncategorized movements (for "Uncategorized" category entry)
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
        )
        .collect(),
      // Fetch transactions with missing payee (for "Unknown Payee" merchant entry)
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
        )
        .collect(),
    ]);

    // Build monthlyIncomeActivity map (for reporting with inflow/outflow separation)
    const monthlyIncomeActivityMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();
    if (workspace?.monthlyIncomeActivity) {
      for (const [yearMonthStr, activity] of Object.entries(workspace.monthlyIncomeActivity)) {
        monthlyIncomeActivityMap.set(parseInt(yearMonthStr, 10), activity);
      }
    }

    // Build lookup maps
    const categoryMap = new Map(categories.map((c) => [c._id, c]));
    const groupMap = new Map(categoryGroups.map((g) => [g._id, g]));
    const globalMerchantMap = new Map(globalMerchants.map((gm) => [gm._id, gm]));

    // Build spending map: categoryId -> yearMonth -> { inflowAmount, outflowAmount }
    // monthlySpending is now stored directly on category (no separate categorySpending table)
    const categorySpendingMap = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();

    for (const category of categories) {
      const monthlyMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();
      if (category.monthlySpending) {
        for (const [yearMonthStr, spending] of Object.entries(category.monthlySpending)) {
          monthlyMap.set(parseInt(yearMonthStr, 10), spending);
        }
      }
      if (monthlyMap.size > 0) {
        categorySpendingMap.set(category._id, monthlyMap);
      }
    }

    // Build merchant stats map with gross directional values. Fall back to the
    // legacy net-only stats while the online backfill is still running.
    const merchantStatsMap = new Map<
      string,
      Map<
        number,
        {
          totalAmount: bigint;
          transactionCount: bigint;
          inflowAmount: bigint;
          outflowAmount: bigint;
          inflowCount: bigint;
          outflowCount: bigint;
        }
      >
    >();

    for (const merchant of merchants) {
      const monthlyMap = new Map<
        number,
        {
          totalAmount: bigint;
          transactionCount: bigint;
          inflowAmount: bigint;
          outflowAmount: bigint;
          inflowCount: bigint;
          outflowCount: bigint;
        }
      >();
      const yearMonths = new Set([
        ...Object.keys(merchant.monthlyStats ?? {}),
        ...Object.keys(merchant.monthlyDirectionalStats ?? {}),
      ]);

      for (const yearMonthStr of yearMonths) {
        const stats = merchant.monthlyStats?.[yearMonthStr] ?? { totalAmount: 0n, transactionCount: 0n };
        const directionalStats = merchant.monthlyDirectionalStats?.[yearMonthStr] ?? {
          inflowAmount: stats.totalAmount > 0n ? stats.totalAmount : 0n,
          outflowAmount: stats.totalAmount < 0n ? -stats.totalAmount : 0n,
          inflowCount: stats.totalAmount > 0n ? stats.transactionCount : 0n,
          outflowCount: stats.totalAmount < 0n ? stats.transactionCount : 0n,
        };
        monthlyMap.set(parseInt(yearMonthStr, 10), {
          ...stats,
          ...directionalStats,
        });
      }

      if (monthlyMap.size > 0) {
        merchantStatsMap.set(merchant._id, monthlyMap);
      }
    }

    // Build uncategorized spending map: yearMonth -> { inflowAmount, outflowAmount }
    // Only include the uncategorized portion of each transaction (movements without categoryId)
    const uncategorizedMonthlyMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();

    for (const transaction of uncategorizedTransactions) {
      const yearMonth = dateToYearMonth(transaction.date);
      // Sum only uncategorized movements (movements where categoryId is undefined and not readyToAssign)
      for (const movement of transaction.movements) {
        if (!movement.categoryId && !movement.readyToAssign) {
          const existing = uncategorizedMonthlyMap.get(yearMonth) ?? { inflowAmount: 0n, outflowAmount: 0n };
          if (movement.amount > 0n) {
            existing.inflowAmount += movement.amount;
          } else {
            existing.outflowAmount += -movement.amount; // Store as positive
          }
          uncategorizedMonthlyMap.set(yearMonth, existing);
        }
      }
    }

    // Build missing payee (unknown merchant) spending map: yearMonth -> { inflowAmount, outflowAmount, inflowCount, outflowCount }
    // Track inflow and outflow separately (matching the pattern used for uncategorized transactions)
    const missingPayeeMonthlyMap = new Map<
      number,
      { inflowAmount: bigint; outflowAmount: bigint; inflowCount: bigint; outflowCount: bigint }
    >();

    for (const transaction of missingPayeeTransactions) {
      const yearMonth = dateToYearMonth(transaction.date);
      const existing = missingPayeeMonthlyMap.get(yearMonth) ?? {
        inflowAmount: 0n,
        outflowAmount: 0n,
        inflowCount: 0n,
        outflowCount: 0n,
      };
      if (transaction.totalAmount > 0n) {
        existing.inflowAmount += transaction.totalAmount;
        existing.inflowCount += 1n;
      } else {
        existing.outflowAmount += -transaction.totalAmount; // Store as positive
        existing.outflowCount += 1n;
      }
      missingPayeeMonthlyMap.set(yearMonth, existing);
    }

    // Find earliest month with any data
    let earliestMonthWithData: number | null = null;

    for (const monthlyMap of categorySpendingMap.values()) {
      for (const yearMonth of monthlyMap.keys()) {
        if (earliestMonthWithData === null || yearMonth < earliestMonthWithData) {
          earliestMonthWithData = yearMonth;
        }
      }
    }

    for (const monthlyMap of merchantStatsMap.values()) {
      for (const yearMonth of monthlyMap.keys()) {
        if (earliestMonthWithData === null || yearMonth < earliestMonthWithData) {
          earliestMonthWithData = yearMonth;
        }
      }
    }

    // Also check monthlyIncomeActivity for earliest month
    for (const yearMonth of monthlyIncomeActivityMap.keys()) {
      if (earliestMonthWithData === null || yearMonth < earliestMonthWithData) {
        earliestMonthWithData = yearMonth;
      }
    }

    // Also check uncategorized transactions for earliest month
    for (const yearMonth of uncategorizedMonthlyMap.keys()) {
      if (earliestMonthWithData === null || yearMonth < earliestMonthWithData) {
        earliestMonthWithData = yearMonth;
      }
    }

    // Also check missing payee transactions for earliest month
    for (const yearMonth of missingPayeeMonthlyMap.keys()) {
      if (earliestMonthWithData === null || yearMonth < earliestMonthWithData) {
        earliestMonthWithData = yearMonth;
      }
    }

    // If no data exists, return empty report
    if (earliestMonthWithData === null) {
      return {
        months: [],
        currentMonth: yearMonthToString(currentYearMonth),
      };
    }

    // Generate list of months from earliest data to current month
    // If monthsBack is provided, limit to that many months; otherwise include all
    const monthsToInclude: number[] = [];
    let month = currentYearMonth;
    let i = 0;
    while (month >= earliestMonthWithData) {
      if (monthsBack !== undefined && i >= monthsBack) {
        break;
      }
      monthsToInclude.unshift(month);
      month = getPreviousYearMonth(month);
      i++;
    }

    // Build the report for each month
    const months: MonthlySpending[] = [];

    for (const yearMonth of monthsToInclude) {
      const displayYearMonth = yearMonthToString(yearMonth);

      // === CATEGORIES: Collect raw data and split by netActivity ===
      interface RawCategoryData {
        categoryId: string;
        categoryName: string;
        inflowAmount: bigint;
        outflowAmount: bigint;
        netActivity: bigint;
      }
      const rawCategoriesData: RawCategoryData[] = [];
      let totalCategoryInflow = 0n;
      let totalCategoryOutflow = 0n;

      for (const category of categories) {
        const spending = categorySpendingMap.get(category._id)?.get(yearMonth);
        const inflowAmount = spending?.inflowAmount ?? 0n;
        const outflowAmount = spending?.outflowAmount ?? 0n;
        const netActivity = inflowAmount - outflowAmount;

        if (inflowAmount !== 0n || outflowAmount !== 0n) {
          rawCategoriesData.push({
            categoryId: category._id,
            categoryName: category.name,
            inflowAmount,
            outflowAmount,
            netActivity,
          });
          totalCategoryInflow += inflowAmount;
          totalCategoryOutflow += outflowAmount;
        }
      }

      // Add "Uncategorized" entry for transactions with uncategorized movements
      const uncategorizedSpending = uncategorizedMonthlyMap.get(yearMonth);
      if (
        uncategorizedSpending &&
        (uncategorizedSpending.inflowAmount > 0n || uncategorizedSpending.outflowAmount > 0n)
      ) {
        rawCategoriesData.push({
          categoryId: 'system:uncategorized',
          categoryName: 'Uncategorized',
          inflowAmount: uncategorizedSpending.inflowAmount,
          outflowAmount: uncategorizedSpending.outflowAmount,
          netActivity: uncategorizedSpending.inflowAmount - uncategorizedSpending.outflowAmount,
        });
        totalCategoryInflow += uncategorizedSpending.inflowAmount;
        totalCategoryOutflow += uncategorizedSpending.outflowAmount;
      }

      // Existing clients omit grossDirectional and retain the net-based
      // one-section contract. Updated clients explicitly opt into gross values.
      const categoryOutflowValue = (category: RawCategoryData) =>
        getReportSectionAmounts(category.inflowAmount, category.outflowAmount, grossDirectional).outflow;
      const categoryInflowValue = (category: RawCategoryData) =>
        getReportSectionAmounts(category.inflowAmount, category.outflowAmount, grossDirectional).inflow;
      const categoryOutflowRaw = rawCategoriesData.filter((category) => categoryOutflowValue(category) > 0n);
      const categoryInflowRaw = rawCategoriesData.filter((category) => categoryInflowValue(category) > 0n);

      const totalCategoryOutflowAmount = categoryOutflowRaw.reduce(
        (sum, category) => sum + categoryOutflowValue(category),
        0n
      );
      const maxCategoryOutflowAmount = categoryOutflowRaw.reduce((max, category) => {
        const value = categoryOutflowValue(category);
        return value > max ? value : max;
      }, 0n);

      const totalCategoryInflowAmount = categoryInflowRaw.reduce(
        (sum, category) => sum + categoryInflowValue(category),
        0n
      );
      const maxCategoryInflowAmount = categoryInflowRaw.reduce((max, category) => {
        const value = categoryInflowValue(category);
        return value > max ? value : max;
      }, 0n);

      // Get monthly income activity for this month (inflow and outflow from RTA)
      const incomeActivity = monthlyIncomeActivityMap.get(yearMonth) ?? { inflowAmount: 0n, outflowAmount: 0n };
      const incomeInflowAmount = incomeActivity.inflowAmount;
      const incomeOutflowAmount = incomeActivity.outflowAmount;

      const incomeNetActivity = incomeInflowAmount - incomeOutflowAmount;
      const incomeDisplayAmounts = getReportSectionAmounts(incomeInflowAmount, incomeOutflowAmount, grossDirectional);
      const incomeOutflowDisplayAmount = incomeDisplayAmounts.outflow;
      const incomeInflowDisplayAmount = incomeDisplayAmounts.inflow;

      const totalOutflowFinal = totalCategoryOutflowAmount + incomeOutflowDisplayAmount;
      const totalInflowWithMonthly = totalCategoryInflowAmount + incomeInflowDisplayAmount;

      const maxOutflowFinal =
        incomeOutflowDisplayAmount > maxCategoryOutflowAmount ? incomeOutflowDisplayAmount : maxCategoryOutflowAmount;
      const maxInflowWithMonthly =
        incomeInflowDisplayAmount > maxCategoryInflowAmount ? incomeInflowDisplayAmount : maxCategoryInflowAmount;

      const categoryOutflowItems: CategorySpendingData[] = categoryOutflowRaw.map((raw) => ({
        categoryId: raw.categoryId,
        categoryName: raw.categoryName,
        inflowAmount: raw.inflowAmount,
        outflowAmount: raw.outflowAmount,
        netActivity: raw.netActivity,
        actualPercent: safePercent(categoryOutflowValue(raw), totalOutflowFinal),
        relativePercent: safePercent(categoryOutflowValue(raw), maxOutflowFinal),
      }));

      if (incomeOutflowDisplayAmount > 0n) {
        categoryOutflowItems.push({
          categoryId: 'system:income',
          categoryName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: safePercent(incomeOutflowDisplayAmount, totalOutflowFinal),
          relativePercent: safePercent(incomeOutflowDisplayAmount, maxOutflowFinal),
        });
      }

      const categoryInflowItems: CategorySpendingData[] = categoryInflowRaw.map((raw) => ({
        categoryId: raw.categoryId,
        categoryName: raw.categoryName,
        inflowAmount: raw.inflowAmount,
        outflowAmount: raw.outflowAmount,
        netActivity: raw.netActivity,
        actualPercent: safePercent(categoryInflowValue(raw), totalInflowWithMonthly),
        relativePercent: safePercent(categoryInflowValue(raw), maxInflowWithMonthly),
      }));

      if (incomeInflowDisplayAmount > 0n) {
        categoryInflowItems.push({
          categoryId: 'system:income',
          categoryName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: safePercent(incomeInflowDisplayAmount, totalInflowWithMonthly),
          relativePercent: safePercent(incomeInflowDisplayAmount, maxInflowWithMonthly),
        });
      }

      // Legacy combined categories (for backwards compatibility)
      const categoriesData: CategorySpendingData[] = rawCategoriesData.map((raw) => {
        const absNetActivity = raw.netActivity < 0n ? -raw.netActivity : raw.netActivity;
        return {
          categoryId: raw.categoryId,
          categoryName: raw.categoryName,
          inflowAmount: raw.inflowAmount,
          outflowAmount: raw.outflowAmount,
          netActivity: raw.netActivity,
          actualPercent: safePercent(raw.outflowAmount, totalCategoryOutflow),
          relativePercent: safePercent(raw.outflowAmount, totalCategoryOutflow),
        };
      });

      // === GROUPS: Aggregate categories by group, then split by netActivity ===
      interface RawGroupData {
        groupId: string;
        groupName: string;
        inflowAmount: bigint;
        outflowAmount: bigint;
        netActivity: bigint;
        categories: RawCategoryData[];
      }
      const groupAccumulator = new Map<
        string,
        { inflowAmount: bigint; outflowAmount: bigint; categories: RawCategoryData[] }
      >();

      for (const group of categoryGroups) {
        groupAccumulator.set(group._id, {
          inflowAmount: 0n,
          outflowAmount: 0n,
          categories: [],
        });
      }

      for (const category of categories) {
        const spending = categorySpendingMap.get(category._id)?.get(yearMonth);
        const inflowAmount = spending?.inflowAmount ?? 0n;
        const outflowAmount = spending?.outflowAmount ?? 0n;
        const netActivity = inflowAmount - outflowAmount;

        const groupAccum = groupAccumulator.get(category.categoryGroupId);
        if (groupAccum) {
          groupAccum.inflowAmount += inflowAmount;
          groupAccum.outflowAmount += outflowAmount;
          if (inflowAmount !== 0n || outflowAmount !== 0n) {
            groupAccum.categories.push({
              categoryId: category._id,
              categoryName: category.name,
              inflowAmount,
              outflowAmount,
              netActivity,
            });
          }
        }
      }

      // Convert to raw group data with netActivity
      const rawGroupsData: RawGroupData[] = [];
      for (const [groupId, accum] of groupAccumulator.entries()) {
        if (accum.inflowAmount !== 0n || accum.outflowAmount !== 0n) {
          const group = groupMap.get(groupId as Id<'categoryGroup'>);
          if (group) {
            rawGroupsData.push({
              groupId,
              groupName: group.name,
              inflowAmount: accum.inflowAmount,
              outflowAmount: accum.outflowAmount,
              netActivity: accum.inflowAmount - accum.outflowAmount,
              categories: accum.categories,
            });
          }
        }
      }

      // Add "Uncategorized" group for transactions with uncategorized movements
      if (
        uncategorizedSpending &&
        (uncategorizedSpending.inflowAmount > 0n || uncategorizedSpending.outflowAmount > 0n)
      ) {
        rawGroupsData.push({
          groupId: 'system:uncategorized-group',
          groupName: 'Uncategorized',
          inflowAmount: uncategorizedSpending.inflowAmount,
          outflowAmount: uncategorizedSpending.outflowAmount,
          netActivity: uncategorizedSpending.inflowAmount - uncategorizedSpending.outflowAmount,
          categories: [
            {
              categoryId: 'system:uncategorized',
              categoryName: 'Uncategorized',
              inflowAmount: uncategorizedSpending.inflowAmount,
              outflowAmount: uncategorizedSpending.outflowAmount,
              netActivity: uncategorizedSpending.inflowAmount - uncategorizedSpending.outflowAmount,
            },
          ],
        });
      }

      const groupOutflowValue = (group: RawGroupData) =>
        getReportSectionAmounts(group.inflowAmount, group.outflowAmount, grossDirectional).outflow;
      const groupInflowValue = (group: RawGroupData) =>
        getReportSectionAmounts(group.inflowAmount, group.outflowAmount, grossDirectional).inflow;
      const groupOutflowRaw = rawGroupsData.filter((group) => groupOutflowValue(group) > 0n);
      const groupInflowRaw = rawGroupsData.filter((group) => groupInflowValue(group) > 0n);

      const totalGroupOutflowAmount = groupOutflowRaw.reduce((sum, group) => sum + groupOutflowValue(group), 0n);
      const maxGroupOutflowAmount = groupOutflowRaw.reduce((max, group) => {
        const value = groupOutflowValue(group);
        return value > max ? value : max;
      }, 0n);

      const totalGroupInflowAmount = groupInflowRaw.reduce((sum, group) => sum + groupInflowValue(group), 0n);
      const maxGroupInflowAmount = groupInflowRaw.reduce((max, group) => {
        const value = groupInflowValue(group);
        return value > max ? value : max;
      }, 0n);

      const buildGroupCategoryItems = (
        rawCategories: RawCategoryData[],
        isOutflow: boolean
      ): CategorySpendingData[] => {
        const filteredCats = isOutflow
          ? rawCategories.filter((category) => categoryOutflowValue(category) > 0n)
          : rawCategories.filter((category) => categoryInflowValue(category) > 0n);

        const sectionTotal = filteredCats.reduce(
          (sum, category) => sum + (isOutflow ? categoryOutflowValue(category) : categoryInflowValue(category)),
          0n
        );
        const sectionMax = filteredCats.reduce((max, c) => {
          const value = isOutflow ? categoryOutflowValue(c) : categoryInflowValue(c);
          return value > max ? value : max;
        }, 0n);

        return filteredCats.map((cat) => {
          const displayAmount = isOutflow ? categoryOutflowValue(cat) : categoryInflowValue(cat);
          return {
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            inflowAmount: cat.inflowAmount,
            outflowAmount: cat.outflowAmount,
            netActivity: cat.netActivity,
            actualPercent: safePercent(displayAmount, sectionTotal),
            relativePercent: safePercent(displayAmount, sectionMax),
          };
        });
      };

      const groupOutflowItems: GroupSpendingData[] = groupOutflowRaw.map((raw) => {
        return {
          groupId: raw.groupId,
          groupName: raw.groupName,
          inflowAmount: raw.inflowAmount,
          outflowAmount: raw.outflowAmount,
          netActivity: raw.netActivity,
          actualPercent: safePercent(groupOutflowValue(raw), totalGroupOutflowAmount),
          relativePercent: safePercent(groupOutflowValue(raw), maxGroupOutflowAmount),
          categories: buildGroupCategoryItems(raw.categories, true),
        };
      });

      const totalGroupOutflowWithIncome = totalGroupOutflowAmount + incomeOutflowDisplayAmount;
      const maxGroupOutflowWithIncome =
        incomeOutflowDisplayAmount > maxGroupOutflowAmount ? incomeOutflowDisplayAmount : maxGroupOutflowAmount;

      // Recalculate percentages for existing groups to include income in total
      for (const group of groupOutflowItems) {
        group.actualPercent = safePercent(groupOutflowValue(group), totalGroupOutflowWithIncome);
        group.relativePercent = safePercent(groupOutflowValue(group), maxGroupOutflowWithIncome);
      }

      if (incomeOutflowDisplayAmount > 0n) {
        // Create the "Income" category item for the Income group (outflow)
        const incomeOutflowCategoryItem: CategorySpendingData = {
          categoryId: 'system:income',
          categoryName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: 100, // Only category in this group
          relativePercent: 100,
        };

        // Add Income group to outflow groups
        groupOutflowItems.push({
          groupId: 'system:income-group',
          groupName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: safePercent(incomeOutflowDisplayAmount, totalGroupOutflowWithIncome),
          relativePercent: safePercent(incomeOutflowDisplayAmount, maxGroupOutflowWithIncome),
          categories: [incomeOutflowCategoryItem],
        });
      }

      const groupInflowItems: GroupSpendingData[] = groupInflowRaw.map((raw) => ({
        groupId: raw.groupId,
        groupName: raw.groupName,
        inflowAmount: raw.inflowAmount,
        outflowAmount: raw.outflowAmount,
        netActivity: raw.netActivity,
        actualPercent: safePercent(groupInflowValue(raw), totalGroupInflowAmount),
        relativePercent: safePercent(groupInflowValue(raw), maxGroupInflowAmount),
        categories: buildGroupCategoryItems(raw.categories, false),
      }));

      const totalGroupInflowWithIncome = totalGroupInflowAmount + incomeInflowDisplayAmount;
      const maxGroupInflowWithIncome =
        incomeInflowDisplayAmount > maxGroupInflowAmount ? incomeInflowDisplayAmount : maxGroupInflowAmount;

      // Recalculate percentages for existing groups to include income in total
      for (const group of groupInflowItems) {
        group.actualPercent = safePercent(groupInflowValue(group), totalGroupInflowWithIncome);
        group.relativePercent = safePercent(groupInflowValue(group), maxGroupInflowWithIncome);
      }

      if (incomeInflowDisplayAmount > 0n) {
        // Create the "Income" category item for the Income group
        const incomeCategoryItem: CategorySpendingData = {
          categoryId: 'system:income',
          categoryName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: 100, // Only category in this group
          relativePercent: 100,
        };

        // Add Income group to inflow groups
        groupInflowItems.push({
          groupId: 'system:income-group',
          groupName: 'Ready to Assign',
          inflowAmount: incomeInflowAmount,
          outflowAmount: incomeOutflowAmount,
          netActivity: incomeNetActivity,
          actualPercent: safePercent(incomeInflowDisplayAmount, totalGroupInflowWithIncome),
          relativePercent: safePercent(incomeInflowDisplayAmount, maxGroupInflowWithIncome),
          categories: [incomeCategoryItem],
        });
      }

      // Legacy combined groups (for backwards compatibility)
      const groupsData: GroupSpendingData[] = rawGroupsData.map((raw) => {
        const maxGroupCategoryOutflow = raw.categories.reduce(
          (max, cat) => (cat.outflowAmount > max ? cat.outflowAmount : max),
          0n
        );
        return {
          groupId: raw.groupId,
          groupName: raw.groupName,
          inflowAmount: raw.inflowAmount,
          outflowAmount: raw.outflowAmount,
          netActivity: raw.netActivity,
          actualPercent: safePercent(raw.outflowAmount, totalCategoryOutflow),
          relativePercent: safePercent(raw.outflowAmount, totalCategoryOutflow),
          categories: raw.categories.map((cat) => ({
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            inflowAmount: cat.inflowAmount,
            outflowAmount: cat.outflowAmount,
            netActivity: cat.netActivity,
            actualPercent: safePercent(cat.outflowAmount, raw.outflowAmount),
            relativePercent: safePercent(cat.outflowAmount, maxGroupCategoryOutflow),
          })),
        };
      });

      // === MERCHANTS: Collect raw data and split by inflow/outflow ===
      interface RawMerchantData {
        merchantId: string;
        merchantName: string;
        inflowAmount: bigint;
        outflowAmount: bigint;
        inflowCount: bigint;
        outflowCount: bigint;
      }
      const rawMerchantsData: RawMerchantData[] = [];
      let totalMerchantSpending = 0n;

      for (const merchant of merchants) {
        const stats = merchantStatsMap.get(merchant._id)?.get(yearMonth);
        if (stats && (stats.inflowAmount !== 0n || stats.outflowAmount !== 0n)) {
          // Resolve merchant name: use override if set, otherwise use global merchant name
          let merchantName = merchant.name;
          if (!merchantName && merchant.globalMerchantId) {
            const globalMerchant = globalMerchantMap.get(merchant.globalMerchantId);
            merchantName = globalMerchant?.name;
          }

          rawMerchantsData.push({
            merchantId: merchant._id,
            merchantName: merchantName ?? 'Unknown',
            inflowAmount: stats.inflowAmount,
            outflowAmount: stats.outflowAmount,
            inflowCount: stats.inflowCount,
            outflowCount: stats.outflowCount,
          });
          totalMerchantSpending += stats.totalAmount;
        }
      }

      // Add "Unknown Merchant" entry for transactions missing a merchant
      const missingPayeeStats = missingPayeeMonthlyMap.get(yearMonth);
      if (missingPayeeStats && (missingPayeeStats.inflowAmount > 0n || missingPayeeStats.outflowAmount > 0n)) {
        rawMerchantsData.push({
          merchantId: 'system:unknown-merchant',
          merchantName: 'Unknown Merchant',
          inflowAmount: missingPayeeStats.inflowAmount,
          outflowAmount: missingPayeeStats.outflowAmount,
          inflowCount: missingPayeeStats.inflowCount,
          outflowCount: missingPayeeStats.outflowCount,
        });
        totalMerchantSpending += missingPayeeStats.inflowAmount - missingPayeeStats.outflowAmount;
      }

      const merchantOutflowValue = (merchant: RawMerchantData) => {
        return getReportSectionAmounts(merchant.inflowAmount, merchant.outflowAmount, grossDirectional).outflow;
      };
      const merchantInflowValue = (merchant: RawMerchantData) => {
        return getReportSectionAmounts(merchant.inflowAmount, merchant.outflowAmount, grossDirectional).inflow;
      };
      const merchantSpendingRaw = rawMerchantsData.filter((merchant) => merchantOutflowValue(merchant) > 0n);
      const merchantIncomeRaw = rawMerchantsData.filter((merchant) => merchantInflowValue(merchant) > 0n);

      const totalMerchantOutflow = merchantSpendingRaw.reduce(
        (sum, merchant) => sum + merchantOutflowValue(merchant),
        0n
      );
      const totalMerchantInflow = merchantIncomeRaw.reduce((sum, merchant) => sum + merchantInflowValue(merchant), 0n);
      const maxMerchantOutflowAmount = merchantSpendingRaw.reduce((max, merchant) => {
        const value = merchantOutflowValue(merchant);
        return value > max ? value : max;
      }, 0n);
      const maxMerchantInflowAmount = merchantIncomeRaw.reduce((max, merchant) => {
        const value = merchantInflowValue(merchant);
        return value > max ? value : max;
      }, 0n);

      const merchantSpendingItems: MerchantSpendingData[] = merchantSpendingRaw.map((raw) => ({
        merchantId: raw.merchantId,
        merchantName: raw.merchantName,
        totalAmount: -merchantOutflowValue(raw),
        transactionCount: grossDirectional ? raw.outflowCount : raw.inflowCount + raw.outflowCount,
        actualPercent: safePercent(merchantOutflowValue(raw), totalMerchantOutflow),
        relativePercent: safePercent(merchantOutflowValue(raw), maxMerchantOutflowAmount),
      }));

      const merchantIncomeItems: MerchantSpendingData[] = merchantIncomeRaw.map((raw) => ({
        merchantId: raw.merchantId,
        merchantName: raw.merchantName,
        totalAmount: merchantInflowValue(raw),
        transactionCount: grossDirectional ? raw.inflowCount : raw.inflowCount + raw.outflowCount,
        actualPercent: safePercent(merchantInflowValue(raw), totalMerchantInflow),
        relativePercent: safePercent(merchantInflowValue(raw), maxMerchantInflowAmount),
      }));

      // Legacy combined merchants (for backwards compatibility)
      const maxMerchantAmount = rawMerchantsData.reduce((max, m) => {
        const netAmount = m.inflowAmount - m.outflowAmount;
        return netAmount > max ? netAmount : max;
      }, 0n);
      const merchantsData: MerchantSpendingData[] = rawMerchantsData.map((raw) => {
        const netAmount = raw.inflowAmount - raw.outflowAmount;
        return {
          merchantId: raw.merchantId,
          merchantName: raw.merchantName,
          totalAmount: netAmount,
          transactionCount: raw.inflowCount + raw.outflowCount,
          actualPercent: safePercent(netAmount, totalMerchantSpending),
          relativePercent: safePercent(netAmount, maxMerchantAmount),
        };
      });

      months.push({
        yearMonth: displayYearMonth,
        // Monthly income for this month (net: inflow - outflow, for backwards compatibility)
        monthlyIncome: incomeInflowAmount - incomeOutflowAmount,
        // Totals for chart display
        totalSpending: totalOutflowFinal,
        totalIncome: totalInflowWithMonthly,
        // Split sections (renamed: categorySpending -> outflow, categoryIncome -> inflow)
        categorySpending: { items: categoryOutflowItems, total: totalOutflowFinal },
        categoryIncome: { items: categoryInflowItems, total: totalInflowWithMonthly },
        groupSpending: { items: groupOutflowItems, total: totalGroupOutflowWithIncome },
        groupIncome: { items: groupInflowItems, total: totalGroupInflowWithIncome },
        merchantSpending: { items: merchantSpendingItems, total: totalMerchantOutflow },
        merchantIncome: { items: merchantIncomeItems, total: totalMerchantInflow },
        // Legacy fields for backwards compatibility
        categories: categoriesData,
        totalCategoryInflow,
        totalCategoryOutflow,
        totalCategoryNetActivity: totalCategoryInflow - totalCategoryOutflow,
        groups: groupsData,
        merchants: merchantsData,
        totalMerchantSpending,
      });
    }

    return {
      months,
      currentMonth: yearMonthToString(currentYearMonth),
    };
  },
});

export const getSpendingReport = query({
  args: {
    workspaceId: v.id('workspace'),
    monthsBack: v.optional(v.number()), // No limit by default - returns all historical data
    currentYearMonth: v.int64(), // Client must provide their local current month (YYYYMM format)
    grossDirectional: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { workspaceId, monthsBack, currentYearMonth, grossDirectional }
  ): Promise<SpendingReportResult> => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    return await ctx.runQuery(getSpendingReportInternalRef, {
      workspaceId: verifiedWorkspaceId,
      monthsBack,
      currentYearMonth,
      grossDirectional,
    });
  },
});
