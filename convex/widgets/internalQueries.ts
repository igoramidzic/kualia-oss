import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getPreviousYearMonth, yearMonthToString } from '../categoryBudgets/calculations';
import { listBudgetDataByMonthForWorkspace } from '../categoryBudgets/queries';
import { getAccountTypeCategory, isLiabilityAccountType } from '../lib/accountTypes';
import { addMonthsToYearMonth, dateToYearMonth } from '../lib/dates';
import { listPlannedTransactionsDataCore } from '../scheduledTransactions/plannedData';

/**
 * Internal query to get available amounts for multiple categories for the widget.
 * Fetches budget data once and looks up each category, returning results in order.
 */
export const getCategoriesAvailableForWidget = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    currentYearMonth: v.int64(),
  },
  handler: async (ctx, { workspaceId, categoryIds, currentYearMonth }) => {
    const yearMonth = Number(currentYearMonth);

    // Fetch all categories in parallel
    const categories = await Promise.all(categoryIds.map((id) => ctx.db.get(id)));

    // Get budget data once for the workspace
    const budgetData = await listBudgetDataByMonthForWorkspace(ctx, workspaceId, yearMonth);
    const monthData = budgetData.months.find((m) => m.yearMonth === yearMonth);

    return categoryIds.map((categoryId, index) => {
      const category = categories[index];
      if (!category || category.isDeleted || category.workspaceId !== workspaceId) {
        return null;
      }

      if (!monthData) {
        return {
          categoryName: category.name,
          available: 0,
          assigned: 0,
          activity: 0,
          hasUnmetTarget: false,
        };
      }

      const catBudget = monthData.budgetData[categoryId];
      if (!catBudget) {
        return {
          categoryName: category.name,
          available: 0,
          assigned: 0,
          activity: 0,
          hasUnmetTarget: false,
        };
      }

      const hasUnmetTarget =
        catBudget.target?.remainingToAssign !== undefined &&
        Number(catBudget.target.remainingToAssign) > 0 &&
        Number(catBudget.available) >= 0;

      return {
        categoryName: category.name,
        available: Number(catBudget.available),
        assigned: Number(catBudget.assignedAmount),
        activity: Number(catBudget.activity ?? catBudget.totalSpent),
        hasUnmetTarget,
      };
    });
  },
});

/**
 * Internal query to get the top N categories by available amount for the widget.
 * Used when the user hasn't selected specific categories.
 */
export const getTopCategoriesAvailableForWidget = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    currentYearMonth: v.int64(),
    limit: v.number(),
  },
  handler: async (ctx, { workspaceId, currentYearMonth, limit }) => {
    const yearMonth = Number(currentYearMonth);

    // Get budget data for the workspace
    const budgetData = await listBudgetDataByMonthForWorkspace(ctx, workspaceId, yearMonth);
    const monthData = budgetData.months.find((m) => m.yearMonth === yearMonth);

    if (!monthData) {
      return [];
    }

    // Get all non-deleted categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isDeleted'), false),
          q.neq(q.field('isArchived'), true),
          q.eq(q.field('categoryType'), 'custom')
        )
      )
      .collect();

    // Fetch category groups to sort by group order
    const groupIds = [...new Set(categories.map((c) => c.categoryGroupId))];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupSortOrderMap = new Map(
      groups.filter((g): g is NonNullable<typeof g> => g !== null).map((g) => [g._id, g.sortOrder])
    );

    // Sort categories by group sortOrder, then by category sortOrder within group
    const sortedCategories = [...categories].sort((a, b) => {
      const groupOrderA = groupSortOrderMap.get(a.categoryGroupId) ?? Infinity;
      const groupOrderB = groupSortOrderMap.get(b.categoryGroupId) ?? Infinity;
      if (groupOrderA !== groupOrderB) return groupOrderA - groupOrderB;
      return a.sortOrder - b.sortOrder;
    });

    // Build results with budget data
    const results = sortedCategories.slice(0, limit).map((category) => {
      const catBudget = monthData.budgetData[category._id];
      if (!catBudget) {
        return {
          categoryName: category.name,
          available: 0,
          assigned: 0,
          activity: 0,
          hasUnmetTarget: false,
        };
      }

      const hasUnmetTarget =
        catBudget.target?.remainingToAssign !== undefined &&
        Number(catBudget.target.remainingToAssign) > 0 &&
        Number(catBudget.available) >= 0;

      return {
        categoryName: category.name,
        available: Number(catBudget.available),
        assigned: Number(catBudget.assignedAmount),
        activity: Number(catBudget.activity ?? catBudget.totalSpent),
        hasUnmetTarget,
      };
    });

    return results;
  },
});

/**
 * Internal query to get upcoming/overdue planned transactions for a workspace.
 * Reuses listPlannedTransactionsDataCore (same logic as the Planned tab) and trims the
 * response down to what the widget needs. The recurringTransactionId field name is kept
 * for widget-binary compatibility; it carries the scheduledTransaction id.
 */
export const getUpcomingRecurringForWidget = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    today: v.string(),
    expensesOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, today, expensesOnly = false }) => {
    const currentYearMonth = dateToYearMonth(today);

    // Look ahead 3 months so the widget always has upcoming transactions to show,
    // even when all current-month entries are already paid/skipped.
    const monthsForward = 3;
    const data = await listPlannedTransactionsDataCore(ctx, workspaceId, today, monthsForward);

    // Collect overdue and upcoming entries across months until we have enough (max 6).
    // Transfers are excluded: the widget surfaces upcoming bills/income.
    const relevantEntries: (typeof data.plannedByMonth)[number] = [];
    for (let i = 0; i <= monthsForward; i++) {
      const ym = addMonthsToYearMonth(currentYearMonth, i);
      const monthEntries = data.plannedByMonth[ym] ?? [];
      for (const entry of monthEntries) {
        if (
          !entry.isTransfer &&
          (!expensesOnly || entry.coverage.expectedAmount < 0n) &&
          (entry.coverage.status === 'overdue' || entry.coverage.status === 'upcoming')
        ) {
          relevantEntries.push(entry);
        }
      }
      if (relevantEntries.length >= 6) break;
    }

    // Build a map of scheduledTransactionId -> base data for merchant lookup
    const baseMap = new Map(data.allPlannedTransactions.map((base) => [base._id, base]));

    // Fetch merchants for name lookup
    const merchantIds = new Set(
      data.allPlannedTransactions.map((base) => base.merchantId).filter((id): id is Id<'merchant'> => id !== undefined)
    );
    const merchants = await Promise.all([...merchantIds].map((id) => ctx.db.get(id)));
    const merchantMap = new Map(merchants.filter((m): m is NonNullable<typeof m> => m !== null).map((m) => [m._id, m]));

    // Fetch global merchants for name fallback
    const globalMerchantIds = new Set(
      [...merchantMap.values()]
        .map((m) => m.globalMerchantId)
        .filter((id): id is Id<'globalMerchant'> => id !== undefined)
    );
    const globalMerchants = await Promise.all([...globalMerchantIds].map((id) => ctx.db.get(id)));
    const globalMerchantMap = new Map(
      globalMerchants.filter((gm): gm is NonNullable<typeof gm> => gm !== null).map((gm) => [gm._id, gm])
    );

    // Helper to resolve merchant name
    function getMerchantName(merchantId: Id<'merchant'> | undefined): string {
      if (!merchantId) return 'Unknown';
      const merchant = merchantMap.get(merchantId);
      if (!merchant) return 'Unknown';
      if (merchant.globalMerchantId) {
        const globalMerchant = globalMerchantMap.get(merchant.globalMerchantId);
        return globalMerchant?.name ?? merchant.name ?? 'Unknown';
      }
      return merchant.name ?? 'Unknown';
    }

    // Trim to widget format
    const entries = relevantEntries.map((entry) => {
      const base = baseMap.get(entry.scheduledTransactionId);
      const expectedAbs = Number(
        entry.coverage.expectedAmount < 0n ? -entry.coverage.expectedAmount : entry.coverage.expectedAmount
      );

      return {
        recurringTransactionId: entry.scheduledTransactionId,
        merchantName: getMerchantName(base?.merchantId),
        amount: expectedAbs,
        isIncome: entry.coverage.expectedAmount > 0n,
        dueDate: entry.occurrenceDate,
        isOverdue: entry.coverage.status === 'overdue',
      };
    });

    // Sort: overdue first, then by due date ascending
    entries.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    return entries.slice(0, 6);
  },
});

/**
 * Internal query to get bank account balances for the widget.
 * Returns accounts grouped by type category with balances.
 * If accountIds are provided, only those accounts are returned.
 * Otherwise returns all non-deleted, non-closed accounts in workspace order.
 */
export const getAccountBalancesForWidget = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    accountIds: v.optional(v.array(v.id('bankAccount'))),
  },
  handler: async (ctx, { workspaceId, accountIds }) => {
    let accounts;

    if (accountIds && accountIds.length > 0) {
      // Fetch specific accounts
      const fetched = await Promise.all(accountIds.map((id) => ctx.db.get(id)));
      accounts = fetched.filter(
        (a): a is NonNullable<typeof a> => a !== null && !a.isDeleted && a.workspaceId === workspaceId
      );
    } else {
      // Fetch all non-deleted accounts for this workspace
      accounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('isClosed'), true)))
        .collect();
    }

    // Get workspace for ordering config
    const workspace = await ctx.db.get(workspaceId);

    // Apply workspace ordering if available and not filtering by specific IDs
    if (!accountIds && workspace?.bankAccountOrdering) {
      const { groupOrder, accountOrderByGroup } = workspace.bankAccountOrdering;
      const accountMap = new Map(accounts.map((a) => [a._id, a]));
      const ordered: typeof accounts = [];

      for (const groupKey of groupOrder) {
        const ids = accountOrderByGroup[groupKey] ?? [];
        for (const id of ids) {
          if (accountMap.has(id)) {
            ordered.push(accountMap.get(id)!);
            accountMap.delete(id);
          }
        }
      }
      // Append remaining
      ordered.push(...accountMap.values());
      accounts = ordered;
    }

    // Build grouped result using shared account type utilities
    const groupMap: Record<
      string,
      Array<{ accountId: string; name: string; accountType: string; balance: number }>
    > = {};
    let totalAssets = 0n;
    let totalLiabilities = 0n;

    for (const account of accounts) {
      const category = getAccountTypeCategory(account.accountType) ?? 'banking';
      if (!groupMap[category]) {
        groupMap[category] = [];
      }
      groupMap[category].push({
        accountId: account._id,
        name: account.name,
        accountType: account.accountType,
        balance: Number(account.currentBalance),
      });

      if (isLiabilityAccountType(account.accountType)) {
        totalLiabilities += account.currentBalance;
      } else {
        totalAssets += account.currentBalance;
      }
    }

    // Build groups array in display order
    const displayOrder = ['banking', 'credit', 'investment', 'loan'];
    const groups = displayOrder
      .filter((cat) => groupMap[cat] && groupMap[cat].length > 0)
      .map((cat) => ({
        category: cat,
        accounts: groupMap[cat],
        subtotal: groupMap[cat].reduce((sum, a) => sum + a.balance, 0),
      }));

    return {
      groups,
      totalAssets: Number(totalAssets),
      totalLiabilities: Number(totalLiabilities),
      netWorth: Number(totalAssets + totalLiabilities),
    };
  },
});

/**
 * Internal query to get net worth history for the widget chart.
 * Returns monthly net worth data points for the last N months.
 * Note: includes all non-deleted accounts (including closed) for historical accuracy.
 */
export const getNetWorthHistoryForWidget = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    currentYearMonth: v.int64(),
    monthsBack: v.number(), // e.g. 6 or 12
  },
  handler: async (ctx, { workspaceId, currentYearMonth: currentYearMonthBigInt, monthsBack }) => {
    const currentYearMonth = Number(currentYearMonthBigInt);

    // Get all non-deleted bank accounts (including closed, for historical net worth accuracy)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Find earliest month with data
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

    if (earliestMonthWithData === null) {
      return { months: [], currentNetWorth: 0 };
    }

    // Generate list of months
    const monthsToInclude: number[] = [];
    let month = currentYearMonth;
    let i = 0;
    while (month >= earliestMonthWithData && i < monthsBack) {
      monthsToInclude.unshift(month);
      month = getPreviousYearMonth(month);
      i++;
    }

    // Helper: calculate running balance for an account up to a month
    function getRunningBalance(monthlyBalances: Record<string, bigint> | undefined, targetYearMonth: number): bigint {
      if (!monthlyBalances || Object.keys(monthlyBalances).length === 0) return 0n;
      const months = Object.keys(monthlyBalances)
        .map((m) => parseInt(m, 10))
        .filter((m) => m <= targetYearMonth)
        .sort((a, b) => a - b);
      let balance = 0n;
      for (const m of months) {
        balance += monthlyBalances[m.toString()];
      }
      return balance;
    }

    // Build monthly data points
    const months = monthsToInclude.map((ym) => {
      let totalAssets = 0n;
      let totalLiabilities = 0n;

      for (const account of bankAccounts) {
        const balance = getRunningBalance(account.monthlyBalances, ym);
        if (isLiabilityAccountType(account.accountType)) {
          totalLiabilities += balance;
        } else {
          totalAssets += balance;
        }
      }

      return {
        yearMonth: yearMonthToString(ym),
        netWorth: Number(totalAssets + totalLiabilities),
        totalAssets: Number(totalAssets),
        totalLiabilities: Number(totalLiabilities),
      };
    });

    // Current net worth from actual current balances (more accurate than historical snapshots)
    const currentNetWorth = bankAccounts.reduce((sum, account) => sum + account.currentBalance, 0n);

    return {
      months,
      currentNetWorth: Number(currentNetWorth),
    };
  },
});
