import { ConvexError, v } from 'convex/values';

import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Doc, Id } from '../_generated/dataModel';
import { type QueryCtx, query } from '../_generated/server';
import { getCategoryIconName } from '../categories/helpers';
import {
  calculateTargetForMonth,
  countRecurringWeeklyOccurrencesInMonth,
  targetDueDateForMonth,
} from '../categoryTargets/helpers.js';
import { extractTarget, hasTarget, type ValidCategoryTarget } from '../categoryTargets/types';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';
import {
  type CreditCardMonthInput,
  calculateAvailableMonthRange,
  calculateBudgetCarryoverChain,
  calculateCategoryActivityDisplay,
  calculateCreditCardActivityDisplay,
  calculateCreditCardCarryoverChain,
  getNextYearMonth,
  type MonthBudgetInput,
  yearMonthToString,
} from './calculations';
import { calculateMultiMonthInterval, calculateOverfundedByAmount, getCalculatedBudgetForMonth } from './helpers';
import type {
  BudgetDataAllMonths,
  BudgetMonthData,
  BudgetMonthSummary,
  BudgetTotals,
  CategoryBudgetData,
  CategoryBudgetWithCategory,
  CategoryGroupWithBudgets,
  CategoryGroupWithCategories,
  CategorySummary,
} from './types';

/**
 * Get the budget structure (category groups and categories) without budget data.
 * One compact subscription supplies every group and category across month navigation.
 * Omitted workspace IDs follow the authenticated user's active workspace.
 */
export const listBudgetStructure = query({
  args: {
    workspaceId: v.optional(v.id('workspace')),
  },
  returns: v.object({
    workspace: v.union(
      v.object({
        id: v.id('workspace'),
        name: v.string(),
        currencyCode: v.string(),
        minorUnit: v.number(),
        timezoneIdentifier: v.union(v.string(), v.null()),
      }),
      v.null()
    ),
    categoryGroups: v.array(
      v.object({
        categoryGroup: v.object({
          _id: v.id('categoryGroup'),
          _creationTime: v.number(),
          name: v.string(),
          type: v.union(v.literal('expense'), v.literal('credit_card')),
          sortOrder: v.number(),
          updatedAt: v.optional(v.string()),
        }),
        categories: v.array(
          v.object({
            _id: v.id('category'),
            _creationTime: v.number(),
            name: v.string(),
            iconName: v.optional(v.string()),
            type: v.optional(v.union(v.literal('expense'), v.literal('credit_card'))),
            updatedAt: v.optional(v.string()),
          })
        ),
      })
    ),
  }),
  handler: async (ctx, { workspaceId }) => {
    let resolvedWorkspaceId = workspaceId;
    if (!resolvedWorkspaceId) {
      const { userProfile } = await requireUserProfile(ctx);
      resolvedWorkspaceId = userProfile.activeWorkspaceId;
    }
    if (!resolvedWorkspaceId) {
      return { workspace: null, categoryGroups: [] };
    }

    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, resolvedWorkspaceId);
    // The budget page intentionally needs all groups/categories, a small workspace-scoped dataset.
    const [workspace, allGroups, categories] = await Promise.all([
      ctx.db.get(verifiedWorkspaceId),
      ctx.db
        .query('categoryGroup')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('isArchived'), true)))
        .collect(),
    ]);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    // Create a map of categories by group ID
    const categoriesByGroupId = new Map<Id<'categoryGroup'>, typeof categories>();

    for (const category of categories) {
      const groupCategories = categoriesByGroupId.get(category.categoryGroupId) ?? [];
      groupCategories.push(category);
      categoriesByGroupId.set(category.categoryGroupId, groupCategories);
    }

    // Build category groups with categories
    const categoryGroupsWithCategories: CategoryGroupWithCategories[] = [];

    // Process each category group
    for (const group of allGroups) {
      const groupCategories = await Promise.all(
        (categoriesByGroupId.get(group._id) ?? []).map(async (category) => {
          if (group.type !== 'credit_card' || !category.bankAccountId) return category;
          const account = await ctx.db.get(category.bankAccountId);
          if (!account || account.workspaceId !== verifiedWorkspaceId || account.isDeleted) return category;
          return { ...category, name: account.name };
        })
      );

      // Skip empty credit card groups
      if (group.type === 'credit_card' && groupCategories.length === 0) {
        continue;
      }

      // Sort categories by sortOrder, then by name
      const sortedGroupCategories = groupCategories.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });

      // Convert to CategorySummary
      const categorySummaries: CategorySummary[] = sortedGroupCategories.map((category) => ({
        _id: category._id,
        _creationTime: category._creationTime,
        name: category.name,
        iconName: getCategoryIconName(category, group.type),
        type: group.type, // Type comes from categoryGroup, not deprecated category.type
        updatedAt: category.updatedAt,
      }));

      categoryGroupsWithCategories.push({
        categoryGroup: {
          _id: group._id,
          _creationTime: group._creationTime,
          name: group.name,
          type: group.type,
          sortOrder: group.sortOrder,
          updatedAt: group.updatedAt,
        },
        categories: categorySummaries,
      });
    }

    // Sort groups by sortOrder, then by name
    categoryGroupsWithCategories.sort((a, b) => {
      // First sort by sortOrder
      if (a.categoryGroup.sortOrder !== b.categoryGroup.sortOrder) {
        return a.categoryGroup.sortOrder - b.categoryGroup.sortOrder;
      }
      // Then by name
      return a.categoryGroup.name.localeCompare(b.categoryGroup.name);
    });

    const currencyCode = (workspace.currency ?? 'USD').toUpperCase();
    return {
      workspace: {
        id: workspace._id,
        name: workspace.name,
        currencyCode,
        minorUnit: getCurrencyDecimals(currencyCode),
        timezoneIdentifier: workspace.timezone ?? null,
      },
      categoryGroups: categoryGroupsWithCategories,
    };
  },
});

/**
 * Shared carryover stage for budget pages and current-month attention.
 * Navigation stops at the current month and never builds target or display data.
 */
async function loadBudgetCarryoverData(
  ctx: QueryCtx,
  verifiedWorkspaceId: Id<'workspace'>,
  effectiveCurrentYearMonth: number,
  throughCurrentMonth = false
) {
  // ===== OPTIMIZATION: Fetch all independent data upfront in parallel =====
  // Category budgets and category spending histories are independent reads.
  const [allCategoryBudgetsForWorkspace, categories] = await Promise.all([
    // Fetch all categoryBudgets for this workspace
    ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect(),
    // Get all categories once (reused for all months) - categories now contain monthlySpending, creditMonthlySpending, and transactionCount
    ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect(),
  ]);

  // Find earliest and latest budgets with non-zero assignment in memory
  // Extract from monthlyAssignedAmounts maps
  let earliestYearMonth: number | null = null;
  let latestYearMonth: number | null = null;

  for (const budget of allCategoryBudgetsForWorkspace) {
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
    for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
      if (amount !== 0n) {
        const yearMonth = parseInt(yearMonthStr, 10);
        if (earliestYearMonth === null || yearMonth < earliestYearMonth) {
          earliestYearMonth = yearMonth;
        }
        if (latestYearMonth === null || yearMonth > latestYearMonth) {
          latestYearMonth = yearMonth;
        }
      }
    }
  }
  // ===== END OPTIMIZATION =====

  // Determine the range of months to calculate
  const availableRange = calculateAvailableMonthRange(effectiveCurrentYearMonth, earliestYearMonth, latestYearMonth);
  const minYearMonth = availableRange.minYearMonth;
  const maxYearMonth = throughCurrentMonth ? effectiveCurrentYearMonth : availableRange.maxYearMonth;

  // ===== OPTIMIZATION: Batch fetch all data upfront =====
  // Instead of querying for each category/month combination (N+1 pattern),
  // fetch all data for the entire range in a few queries and create lookup maps

  // Create lookup maps for O(1) access
  // Map structure: categoryId -> yearMonth -> assignedAmount
  // Only include months within our calculated range to reduce memory usage
  const budgetMap = new Map<string, Map<number, bigint>>();
  for (const budget of allCategoryBudgetsForWorkspace) {
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
    const categoryBudgetMap = new Map<number, bigint>();
    for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
      const yearMonth = parseInt(yearMonthStr, 10);
      // Only include data within our range
      if (yearMonth >= minYearMonth && yearMonth <= maxYearMonth) {
        categoryBudgetMap.set(yearMonth, amount);
      }
    }
    if (categoryBudgetMap.size > 0) {
      budgetMap.set(budget.categoryId, categoryBudgetMap);
    }
  }

  // Build snooze lookup map: categoryId -> Set of snoozed yearMonths
  const snoozeMap = new Map<string, Set<number>>();
  for (const budget of allCategoryBudgetsForWorkspace) {
    const snoozedMonths = budget.snoozedTargetMonths ?? {};
    const snoozedSet = new Set<number>();
    for (const yearMonthStr of Object.keys(snoozedMonths)) {
      snoozedSet.add(parseInt(yearMonthStr, 10));
    }
    if (snoozedSet.size > 0) {
      snoozeMap.set(budget.categoryId, snoozedSet);
    }
  }

  // Build spending map from categories (monthlySpending is now stored directly on category)
  // Only include months within our calculated range to reduce memory usage
  // Note: monthlySpending keys are in YYYYMM format (e.g., "202401")
  const spendingMap = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();
  for (const category of categories) {
    const categorySpendingMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();
    const monthlySpending = category.monthlySpending ?? {};
    for (const [yearMonthStr, spending] of Object.entries(monthlySpending)) {
      const yearMonth = parseInt(yearMonthStr, 10);
      // Only include data within our range
      if (yearMonth >= minYearMonth && yearMonth <= maxYearMonth) {
        categorySpendingMap.set(yearMonth, spending);
      }
    }
    if (categorySpendingMap.size > 0) {
      spendingMap.set(category._id, categorySpendingMap);
    }
  }

  // Build credit spending map from categories (creditMonthlySpending is now stored directly on category)
  // Only include months within our calculated range to reduce memory usage
  // Note: creditMonthlySpending keys are in YYYYMM format (e.g., "202401")
  const creditSpendingMap = new Map<
    string,
    Map<number, { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }>
  >();
  for (const category of categories) {
    // Only process credit card categories
    if (category.categoryType !== 'credit_card') continue;

    const categoryCreditSpendingMap = new Map<
      number,
      { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }
    >();
    const creditMonthlySpending = category.creditMonthlySpending ?? {};
    for (const [yearMonthStr, spending] of Object.entries(creditMonthlySpending)) {
      const yearMonth = parseInt(yearMonthStr, 10);
      // Only include data within our range
      if (yearMonth >= minYearMonth && yearMonth <= maxYearMonth) {
        categoryCreditSpendingMap.set(yearMonth, spending);
      }
    }
    if (categoryCreditSpendingMap.size > 0) {
      creditSpendingMap.set(category._id, categoryCreditSpendingMap);
    }
  }

  // Build transaction count map from categories (transactionCount is now stored directly on category)
  const transactionCountMap = new Map<string, bigint>();
  for (const category of categories) {
    transactionCountMap.set(category._id, category.transactionCount ?? 0n);
  }

  // Find earliest month with data for each category
  // This allows us to only calculate from actual data start, not arbitrary 24 months
  const categoryEarliestMonth = new Map<string, number>();
  for (const category of categories) {
    let earliestMonth: number | null = null;

    // Check budget data
    const categoryBudgets = budgetMap.get(category._id);
    if (categoryBudgets) {
      for (const yearMonth of categoryBudgets.keys()) {
        if (earliestMonth === null || yearMonth < earliestMonth) {
          earliestMonth = yearMonth;
        }
      }
    }

    // Check spending data
    if (category.categoryType === 'credit_card') {
      const categoryCreditSpending = creditSpendingMap.get(category._id);
      if (categoryCreditSpending) {
        for (const yearMonth of categoryCreditSpending.keys()) {
          if (earliestMonth === null || yearMonth < earliestMonth) {
            earliestMonth = yearMonth;
          }
        }
      }
    } else {
      const categorySpending = spendingMap.get(category._id);
      if (categorySpending) {
        for (const yearMonth of categorySpending.keys()) {
          if (earliestMonth === null || yearMonth < earliestMonth) {
            earliestMonth = yearMonth;
          }
        }
      }
    }

    // If no data found, start from first display month
    categoryEarliestMonth.set(category._id, earliestMonth ?? minYearMonth);
  }
  // ===== END OPTIMIZATION =====

  // Helper function to calculate budget for a category using pre-fetched data
  // Now returns a Map of all results from startYearMonth to maxYearMonth
  const calculateBudgetForCategory = (
    category: Doc<'category'>,
    startYearMonth: number
  ): Map<
    number,
    {
      assignedAmount: bigint;
      spentAmount: bigint;
      carryover: bigint;
      available: bigint;
      priorBalance?: bigint;
      currentBalance?: bigint;
      activityThisMonth?: bigint;
      budgetActivity?: bigint;
    }
  > => {
    const isCreditCard = category.categoryType === 'credit_card';
    const categoryBudgets = budgetMap.get(category._id);

    if (isCreditCard) {
      // Credit card calculation
      const categoryCreditSpending = creditSpendingMap.get(category._id);

      // Build input array for calculation
      const monthInputs: CreditCardMonthInput[] = [];
      let currentMonth = startYearMonth;

      // Calculate initial balances from any data before the start range
      const initialBudgetBalance = 0n;
      const initialDisplayBalance = 0n;

      while (currentMonth <= maxYearMonth) {
        const assignedAmount = categoryBudgets?.get(currentMonth) ?? 0n;
        const spending = categoryCreditSpending?.get(currentMonth);

        monthInputs.push({
          yearMonth: currentMonth,
          assignedAmount,
          priorBalance: spending?.priorBalance ?? 0n,
          spendingAmount: spending?.spendingAmount ?? 0n,
          paymentsAmount: spending?.paymentsAmount ?? 0n,
          refundedSpending: spending?.refundedSpending ?? 0n,
        });

        currentMonth = getNextYearMonth(currentMonth);
      }

      // Calculate carryover chain
      const results = calculateCreditCardCarryoverChain(monthInputs, initialBudgetBalance, initialDisplayBalance);

      // Convert array to map keyed by yearMonth
      const resultsMap = new Map<number, (typeof results)[0]>();
      for (const result of results) {
        resultsMap.set(result.yearMonth, result);
      }
      return resultsMap;
    } else {
      // Regular category calculation
      const categorySpending = spendingMap.get(category._id);

      // Build input array for calculation
      const monthInputs: MonthBudgetInput[] = [];
      let currentMonth = startYearMonth;

      while (currentMonth <= maxYearMonth) {
        const assignedAmount = categoryBudgets?.get(currentMonth) ?? 0n;
        const spending = categorySpending?.get(currentMonth);

        monthInputs.push({
          yearMonth: currentMonth,
          assignedAmount,
          inflowAmount: spending?.inflowAmount ?? 0n,
          outflowAmount: spending?.outflowAmount ?? 0n,
        });

        currentMonth = getNextYearMonth(currentMonth);
      }

      // Calculate carryover chain
      const results = calculateBudgetCarryoverChain(monthInputs);

      // Convert array to map keyed by yearMonth
      const resultsMap = new Map<number, (typeof results)[0]>();
      for (const result of results) {
        resultsMap.set(result.yearMonth, result);
      }
      return resultsMap;
    }
  };

  // ===== OPTIMIZATION: Pre-calculate all months for all categories =====
  // Instead of recalculating from earliest month for EACH display month,
  // calculate ONCE per category from its earliest data month to maxYearMonth
  const categoryResults = new Map<
    string,
    Map<
      number,
      {
        assignedAmount: bigint;
        spentAmount: bigint;
        carryover: bigint;
        available: bigint;
        priorBalance?: bigint;
        currentBalance?: bigint;
        activityThisMonth?: bigint;
        budgetActivity?: bigint;
      }
    >
  >();

  for (const category of categories) {
    const startMonth = categoryEarliestMonth.get(category._id)!;
    const results = calculateBudgetForCategory(category, startMonth);
    categoryResults.set(category._id, results);
  }
  // ===== END OPTIMIZATION =====

  return {
    categories,
    categoryResults,
    minYearMonth,
    maxYearMonth,
    snoozeMap,
    spendingMap,
    creditSpendingMap,
    transactionCountMap,
  };
}

/** Current-month attention uses identical carryover math without targets or historical UI payloads. */
export async function countOverspentCategoriesForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  currentYearMonth: number
): Promise<number> {
  const { categories, categoryResults } = await loadBudgetCarryoverData(ctx, workspaceId, currentYearMonth, true);
  let count = 0;
  for (const category of categories) {
    // Archived categories still count, matching the full budget month's summary.
    if ((categoryResults.get(category._id)?.get(currentYearMonth)?.available ?? 0n) < 0n) {
      count += 1;
    }
  }
  return count;
}

/** Shared full budget dataset for the budget page and MCP tools. */
export async function listBudgetDataByMonthForWorkspace(
  ctx: QueryCtx,
  verifiedWorkspaceId: Id<'workspace'>,
  effectiveCurrentYearMonth: number
): Promise<BudgetDataAllMonths> {
  const [carryoverData, workspace] = await Promise.all([
    loadBudgetCarryoverData(ctx, verifiedWorkspaceId, effectiveCurrentYearMonth),
    ctx.db.get(verifiedWorkspaceId),
  ]);
  const {
    categories,
    categoryResults,
    minYearMonth,
    maxYearMonth,
    snoozeMap,
    spendingMap,
    creditSpendingMap,
    transactionCountMap,
  } = carryoverData;
  const readyToAssign = workspace?.readyToAssign ?? 0n;

  // ===== FURTHER OPTIMIZATION: Flip loops to process all months per category =====
  // Instead of: for each month -> for each category (M × C iterations)
  // Do: for each category -> for each month (C iterations with sequential month processing)
  // This allows target calculations to stay sequential per category and reduces overhead

  // Map to store all category data for all months
  // Structure: categoryId -> yearMonth -> CategoryBudgetData
  const allCategoryMonthData = new Map<string, Map<number, CategoryBudgetData>>();

  // Process each category once across all display months
  for (const category of categories) {
    const categoryMonthData = new Map<number, CategoryBudgetData>();

    // Track previous month's target data for this category only
    let previousMonthTargetData:
      | {
          assignedAmount: bigint;
          targetAmount: bigint;
          balance: bigint;
        }
      | undefined;

    let currentMonth = minYearMonth;
    while (currentMonth <= maxYearMonth) {
      const yearMonth = currentMonth;
      // Extract pre-calculated result for this category and month
      const categoryResultsMap = categoryResults.get(category._id)!;
      const calculatedResult = categoryResultsMap.get(yearMonth);

      // If no calculated result, use default zeros but STILL calculate target below
      // This fixes the bug where categories with targets but no budget data
      // would show $0 underfunded instead of the correct target amount
      const calculated = calculatedResult ?? {
        assignedAmount: 0n,
        spentAmount: 0n,
        carryover: 0n,
        available: 0n,
        priorBalance: 0n,
        currentBalance: 0n,
        activityThisMonth: 0n,
        budgetActivity: 0n,
      };

      const isCreditCardCategory = category.categoryType === 'credit_card';

      // Initialize target with placeholder - will be calculated and set later
      const budgetData: CategoryBudgetData = {
        assignedAmount: calculated.assignedAmount,
        totalSpent: calculated.spentAmount,
        carryoverFromPrevious: calculated.carryover,
        available: calculated.available,
        target: {
          assignmentNeeded: 0n,
          remainingToAssign: 0n,
          overfundedByAmount: 0n,
          underfundedAmount: 0n,
          fundedRatio: 0,
          spentRatio: 0,
        },
        transactionCount: transactionCountMap.get(category._id) ?? 0n,
      };

      if (isCreditCardCategory) {
        // Credit card category - get spending from lookup map
        const creditSpending = creditSpendingMap.get(category._id)?.get(yearMonth);

        const spendingAmount = creditSpending?.spendingAmount ?? 0n;
        const paymentsAmount = creditSpending?.paymentsAmount ?? 0n;

        // Calculate activity display values
        const activityDisplay = calculateCreditCardActivityDisplay(spendingAmount, paymentsAmount);

        budgetData.priorBalance = calculated.priorBalance;
        budgetData.currentBalance = calculated.currentBalance;
        budgetData.spendingAmount = spendingAmount;
        budgetData.paymentsAmount = paymentsAmount;
        budgetData.fundedSpending = activityDisplay.fundedSpending;
        budgetData.paymentsAndReturns = activityDisplay.paymentsAndReturns;
        budgetData.totalActivity = activityDisplay.totalActivity;
        budgetData.activityThisMonth = calculated.activityThisMonth;
        // Use same "activity" field as regular categories for consistency
        budgetData.activity = calculated.activityThisMonth;
      } else {
        // Regular category - get spending from lookup map
        const spending = spendingMap.get(category._id)?.get(yearMonth);

        const inflowAmount = spending?.inflowAmount ?? 0n;
        const outflowAmount = spending?.outflowAmount ?? 0n;

        // Calculate activity display values
        const activity = calculateCategoryActivityDisplay(inflowAmount, outflowAmount);

        budgetData.inflowAmount = inflowAmount;
        budgetData.outflowAmount = outflowAmount;
        budgetData.activity = activity.activity;
      }

      // Extract target from category (targets are now stored on category, not separate table)
      // Ignore targets for archived categories - they should not show as underfunded,
      // but will still show as overspent if available is negative (handled by Scenario 3)
      const categoryHasTarget = category.isArchived === true ? false : hasTarget(category);

      // Check if target is snoozed for this month
      const isSnoozedForMonth = snoozeMap.get(category._id)?.has(yearMonth) ?? false;

      // Check if target is active for this month
      let isTargetActive = false;

      if (categoryHasTarget) {
        // All target types are always considered active
        // The calculation logic in calculateTargetForMonth handles:
        // - Spreading savings across months until due date
        // - Finding next occurrence for recurring targets past their first due date
        // - Determining appropriate monthly amounts based on current balance
        isTargetActive = true;
      }

      // Calculate unified target info (always present for every category)
      // This consolidates: explicit targets, overspending coverage, or neither
      let targetAmount: bigint | undefined;
      let assignmentNeeded: bigint = 0n;
      let targetCalculationRemainingToAssign: bigint = 0n;
      const isFutureMonth = yearMonth > effectiveCurrentYearMonth;

      // Extract target using helper function (always returns an object)
      const targetData = extractTarget(category);
      const shouldUseTarget =
        !isSnoozedForMonth &&
        categoryHasTarget &&
        isTargetActive &&
        targetData.targetType !== undefined &&
        targetData.amount !== undefined;

      // Type narrow to ValidCategoryTarget if valid, otherwise use as-is for overfunded calculation
      const target = shouldUseTarget ? (targetData as ValidCategoryTarget) : targetData;

      if (shouldUseTarget && targetData.targetType && targetData.amount !== undefined) {
        // Scenario 1: Category has an active target
        // target is now narrowed to ValidCategoryTarget within this block

        // For maintain_balance targets: calculate projected balances for chaining across months
        //
        // Example: Target $60, contribution $50/month, currently November with $0
        // - November (current): balance=$0, target=$50
        //   → store balance=$0 for December to use as previousMonthData
        //   → calculateTargetForMonth uses prevCarryover=$0, shows need $50
        //
        // - December (future): receives previousMonthData.balance=$0 (Nov's starting)
        //   → calculateFutureMonthAssignment: projected = $0 + $50 = $50
        //   → shortfall = $60 - $50 = $10, shows need $10 ✓
        //   → store balance=$50 for January to use as previousMonthData
        //
        // - January (future): receives previousMonthData.balance=$50 (Dec's starting)
        //   → calculateFutureMonthAssignment: projected = $50 + $10 = $60
        //   → target met! shows need $0 ✓
        //
        // For maintain_balance: correctly calculate the balance to store
        // - Current month: store actual starting balance
        // - Future months: project starting balance from previous month's projection
        let balanceToStoreForNextMonth: bigint;

        if (target.targetType === 'maintain_balance') {
          const targetBalance = target.targetBalance ?? target.amount ?? 0n;

          if (yearMonth > effectiveCurrentYearMonth && previousMonthTargetData) {
            // FUTURE month: project balance, cap at target to prevent overfunding propagation
            const projectedBalance = previousMonthTargetData.balance + previousMonthTargetData.targetAmount;
            balanceToStoreForNextMonth = projectedBalance > targetBalance ? targetBalance : projectedBalance;
          } else {
            // CURRENT month: Use effective balance (available + spending) capped at target
            // - Adding spending back prevents mid-month spending from affecting future projections
            // - Capping at target prevents overfunding from propagating
            const spentAbs = calculated.spentAmount < 0n ? calculated.spentAmount * -1n : 0n;
            const effectiveBalance = calculated.available + spentAbs;
            balanceToStoreForNextMonth = effectiveBalance > targetBalance ? targetBalance : effectiveBalance;
          }
        } else if (
          target.targetType === 'recurring_rollover' &&
          target.frequency === 'monthly' &&
          (target.frequencyInterval ?? 1) === 1
        ) {
          // For monthly recurring_rollover (interval=1):
          // Assume money will be spent, so future months start fresh.
          // Store 0 from current month onward.
          balanceToStoreForNextMonth = yearMonth >= effectiveCurrentYearMonth ? 0n : calculated.carryover;
        } else {
          // For other target types, use actual carryover
          balanceToStoreForNextMonth = calculated.carryover;
        }

        const targetCalculation = calculateTargetForMonth({
          target: target as ValidCategoryTarget,
          yearMonth,
          currentYearMonth: effectiveCurrentYearMonth,
          previousMonthCarryover: calculated.carryover,
          currentBalance: calculated.available,
          assignedAmount: calculated.assignedAmount,
          totalSpent: calculated.spentAmount,
          previousMonthData: previousMonthTargetData,
        });

        // The target calculation already includes adjustments for overspending
        // (depending on target type - simple recurring adds it, rollover considers it, etc.)
        assignmentNeeded = targetCalculation.monthlyAssignment;
        targetCalculationRemainingToAssign = targetCalculation.remainingToAssign;

        // For weekly recurring_rollover targets, targetAmount should be the total for the month
        // (per-occurrence amount × number of occurrences), not just the per-occurrence amount
        if (
          target.targetType === 'recurring_rollover' &&
          target.frequency === 'weekly' &&
          target.dayOfWeek !== undefined &&
          target.amount !== undefined
        ) {
          const occurrences = countRecurringWeeklyOccurrencesInMonth(
            yearMonth,
            target.dayOfWeek,
            target.frequencyInterval ?? 1,
            target.firstDueDate
          );
          targetAmount = target.amount * BigInt(occurrences);
        } else {
          targetAmount =
            target.targetType === 'maintain_balance' ? (target.targetBalance ?? target.amount) : target.amount;
        }

        // Store this month's data for next iteration (locally for this category)
        previousMonthTargetData = {
          assignedAmount: calculated.assignedAmount,
          targetAmount:
            target.targetType === 'maintain_balance' && yearMonth <= effectiveCurrentYearMonth
              ? targetCalculationRemainingToAssign
              : assignmentNeeded,
          balance: balanceToStoreForNextMonth,
        };
      } else if (!isSnoozedForMonth && categoryHasTarget && targetData.amount !== undefined) {
        // Scenario 2: Category has a target but it's not "active" for this month
        // (e.g., viewing a past month before firstDueDate was set)
        // Still return targetAmount so the app can show historical progress
        // Use assignmentNeeded = targetAmount for past months to show what the target was
        const isPastMonth = yearMonth < effectiveCurrentYearMonth;

        // For past months, calculate what the target would have been
        if (isPastMonth) {
          // Calculate the base target amount for this month
          if (
            targetData.targetType === 'recurring_rollover' &&
            targetData.frequency === 'weekly' &&
            targetData.dayOfWeek !== undefined
          ) {
            const occurrences = countRecurringWeeklyOccurrencesInMonth(
              yearMonth,
              targetData.dayOfWeek,
              targetData.frequencyInterval ?? 1,
              targetData.firstDueDate
            );
            targetAmount = targetData.amount * BigInt(occurrences);
            assignmentNeeded = targetAmount;
          } else if (targetData.targetType === 'maintain_balance') {
            targetAmount = targetData.targetBalance ?? targetData.amount;
            assignmentNeeded = targetData.monthlyContribution ?? 0n;
          } else {
            // For recurring targets, calculate the monthly amount based on frequency
            let monthsInInterval = 1;
            if (targetData.frequency === 'monthly') {
              monthsInInterval = targetData.frequencyInterval ?? 1;
            } else if (targetData.frequency === 'yearly') {
              monthsInInterval = (targetData.frequencyInterval ?? 1) * 12;
            }
            targetAmount = targetData.amount;
            assignmentNeeded = targetData.amount / BigInt(monthsInInterval);
          }
        } else {
          // For current/future months where target isn't active yet, just show the target amount
          assignmentNeeded = 0n;
          if (
            targetData.targetType === 'recurring_rollover' &&
            targetData.frequency === 'weekly' &&
            targetData.dayOfWeek !== undefined
          ) {
            const occurrences = countRecurringWeeklyOccurrencesInMonth(
              yearMonth,
              targetData.dayOfWeek,
              targetData.frequencyInterval ?? 1,
              targetData.firstDueDate
            );
            targetAmount = targetData.amount * BigInt(occurrences);
          } else {
            targetAmount =
              targetData.targetType === 'maintain_balance'
                ? (targetData.targetBalance ?? targetData.amount)
                : targetData.amount;
          }
        }
      } else if (calculated.available < 0n) {
        // Scenario 3: No target, but available balance is negative (overspent)
        // Only consider underfunded if the AVAILABLE balance is negative, not just carryover
        // This means if a category has no target and negative assigned but positive available,
        // it's not considered underfunded
        assignmentNeeded = calculated.available * -1n;
        targetAmount = undefined;
      } else {
        // Scenario 4: No target and no overspending - nothing needed
        assignmentNeeded = 0n;
        targetAmount = undefined;
      }

      // Calculate remaining to assign (never negative)
      // Only calculate if there's an actual need (target or overspending)
      // If assignmentNeeded is 0, remainingToAssign is 0 regardless of assigned amount
      // This prevents categories with no target and negative assigned (but positive available)
      // from incorrectly showing as underfunded
      let remainingToAssign: bigint;

      // For maintain_balance: use effective balance (available + spending) to prevent
      // mid-month changes when spending. Example: Had $10k target, $10k available,
      // spent $2k (now $8k available) → effective balance is still $10k, no underfunding.
      const spentAbs = calculated.spentAmount < 0n ? calculated.spentAmount * -1n : 0n;
      const effectiveBalance = calculated.available + spentAbs;

      if (target.targetType === 'maintain_balance' && targetAmount !== undefined) {
        // Use targetCalculationRemainingToAssign for BOTH current and future months
        // This correctly accounts for what's already been assigned against the monthly contribution cap
        // Example: $10k target, $500/mo cap, $9k carryover, $250 assigned → remaining = $250
        remainingToAssign = targetCalculationRemainingToAssign;
      } else {
        remainingToAssign =
          assignmentNeeded > 0n && assignmentNeeded > calculated.assignedAmount
            ? assignmentNeeded - calculated.assignedAmount
            : 0n;
      }

      // Calculate overfunded amount
      // For future months, we don't consider carryover when calculating overfunding
      const overfundedByAmount = calculateOverfundedByAmount(
        target,
        targetAmount,
        calculated.assignedAmount,
        assignmentNeeded,
        calculated.available,
        isFutureMonth,
        calculated.spentAmount
      );

      // Calculate underfunded amount
      // For categories with targets: use remainingToAssign
      // For categories without targets: only overspent amount (negative available)
      const hasActiveTargetAmount = targetAmount !== undefined && targetAmount > 0n;
      const overspentAmount = calculated.available < 0n ? calculated.available * -1n : 0n;
      let underfundedAmount: bigint;

      // Handle future month underfunding for target types that need special calculation
      if (target.targetType === 'maintain_balance' && hasActiveTargetAmount) {
        // For maintain_balance: use targetCalculationRemainingToAssign for BOTH current and future months
        // This correctly accounts for what's already been assigned against the monthly contribution cap
        // Example: $10k target, $500/mo cap, $9k carryover, $250 assigned → underfunded = $250
        underfundedAmount = targetCalculationRemainingToAssign;
      } else if (isFutureMonth && target.targetType === 'recurring_rollover' && hasActiveTargetAmount) {
        // For FUTURE months recurring_rollover: use the target calculation's remainingToAssign
        underfundedAmount = targetCalculationRemainingToAssign;
      } else {
        // All other cases (including recurring_rollover current month)
        underfundedAmount = hasActiveTargetAmount
          ? remainingToAssign > overspentAmount
            ? remainingToAssign
            : overspentAmount
          : overspentAmount;
      }

      // Calculate multi-month interval tracking (for progress bar display)
      let currentMonthInInterval: number | undefined;
      let totalMonthsInInterval: number | undefined;
      let cumulativeAssigned: bigint | undefined;
      let cumulativeTargetNeeded: bigint | undefined;

      if (
        categoryHasTarget &&
        targetData.targetType &&
        (targetData.targetType === 'recurring' || targetData.targetType === 'recurring_rollover') &&
        targetData.firstDueDate
      ) {
        // Calculate interval in months based on frequency
        let intervalMonths: number | undefined;
        if (targetData.frequency === 'monthly' && targetData.frequencyInterval && targetData.frequencyInterval > 1) {
          intervalMonths = targetData.frequencyInterval;
        } else if (targetData.frequency === 'yearly') {
          intervalMonths = (targetData.frequencyInterval ?? 1) * 12;
        }

        if (intervalMonths && intervalMonths > 1) {
          // Build assigned amounts map from pre-calculated results
          const categoryResultsMap = categoryResults.get(category._id);
          const assignedAmountsByMonth = new Map<number, bigint>();
          if (categoryResultsMap) {
            for (const [month, result] of categoryResultsMap.entries()) {
              assignedAmountsByMonth.set(month, result.assignedAmount);
            }
          }

          const monthlyTarget = assignmentNeeded > 0n ? assignmentNeeded : 0n;
          const intervalResult = calculateMultiMonthInterval(
            yearMonth,
            targetData.firstDueDate,
            intervalMonths,
            assignedAmountsByMonth,
            monthlyTarget
          );

          if (intervalResult) {
            currentMonthInInterval = intervalResult.currentMonthInInterval;
            totalMonthsInInterval = intervalResult.totalMonthsInInterval;
            cumulativeAssigned = intervalResult.cumulativeAssigned;
            cumulativeTargetNeeded = intervalResult.cumulativeTargetNeeded;
          }
        }
      }

      // Calculate funded ratio for progress bar display
      let fundedRatio = 0;
      if (target.targetType === 'maintain_balance' && targetAmount !== undefined && targetAmount > 0n) {
        // For maintain_balance: use effective balance vs target
        // This shows 1.0 when at/above target, partial when below
        fundedRatio = Math.min(Number(effectiveBalance) / Number(targetAmount), 1.0);
      } else if (target.targetType === 'recurring_rollover' && targetAmount !== undefined && targetAmount > 0n) {
        if (isFutureMonth && assignmentNeeded > 0n) {
          // Future months: show progress based on explicit assignment, not carryover
          fundedRatio = Math.min(Number(calculated.assignedAmount) / Number(assignmentNeeded), 1.0);
        } else {
          // Current/past months: use effective balance (available + spending)
          fundedRatio = Math.min(Number(effectiveBalance) / Number(targetAmount), 1.0);
        }
      } else if (
        totalMonthsInInterval !== undefined &&
        totalMonthsInInterval > 1 &&
        cumulativeTargetNeeded !== undefined &&
        cumulativeTargetNeeded > 0n
      ) {
        // For multi-month targets: show progress toward cumulative target needed so far
        const totalAssigned = cumulativeAssigned ?? calculated.assignedAmount;
        fundedRatio = Math.min(Number(totalAssigned) / Number(cumulativeTargetNeeded), 1.0);
      } else if (assignmentNeeded > 0n) {
        // For single-month targets with a need: assigned / targetNeeded
        fundedRatio = Math.min(Number(calculated.assignedAmount) / Number(assignmentNeeded), 1.0);
      } else if (targetAmount === undefined || targetAmount === 0n) {
        // No target: show bar only if there's money in the envelope (assigned or carried over)
        const hasMoneyInEnvelope = calculated.assignedAmount > 0n || calculated.carryover > 0n;
        fundedRatio = hasMoneyInEnvelope ? 1.0 : 0;
      } else if (remainingToAssign === 0n) {
        // Target already met (targetNeeded = 0, remainingToAssign = 0): fully funded via carryover
        fundedRatio = 1.0;
      } else if (calculated.assignedAmount > 0n) {
        // Has assignment but no target need
        fundedRatio = 1.0;
      }

      // Calculate spent ratio (how much of the funded bar is filled with spending).
      // Base = assigned + min(carryover, 0): subtracts a negative carryover so spending
      // that's covered by this month's assignment-to-cover-prior-overspend doesn't
      // leave a phantom "available" sliver. Positive carryover is excluded so the
      // progress is measured against this month's assignment, matching fundedRatio's intent.
      const spent = isCreditCardCategory ? (budgetData.fundedSpending ?? 0n) : (budgetData.outflowAmount ?? 0n);
      const negativeCarryover = calculated.carryover < 0n ? calculated.carryover : 0n;
      const adjustedAssigned = calculated.assignedAmount + negativeCarryover;
      let spentRatioBase: bigint;
      if (adjustedAssigned > 0n) {
        spentRatioBase = adjustedAssigned;
      } else if (targetAmount !== undefined && targetAmount > 0n) {
        spentRatioBase = targetAmount;
      } else {
        spentRatioBase = 0n;
      }
      const spentRatio = spentRatioBase > 0n && spent > 0n ? Math.min(Number(spent) / Number(spentRatioBase), 1.0) : 0;

      // Always set target object for every category
      budgetData.target = {
        dueDate:
          isTargetActive && !isSnoozedForMonth ? targetDueDateForMonth(extractTarget(category), yearMonth) : undefined,
        targetAmount,
        assignmentNeeded,
        remainingToAssign,
        overfundedByAmount,
        underfundedAmount,
        fundedRatio,
        spentRatio,
        isSnoozed: isSnoozedForMonth || undefined,
        currentMonthInInterval,
        totalMonthsInInterval,
        cumulativeAssigned,
        cumulativeTargetNeeded,
      };

      // Store this month's data for this category
      categoryMonthData.set(yearMonth, budgetData);

      // Move to next month
      currentMonth = getNextYearMonth(currentMonth);
    }

    // Store all months data for this category
    allCategoryMonthData.set(category._id, categoryMonthData);
  }

  // ===== Reorganize data into months array =====
  // Now that we have all category data for all months, reorganize by month
  const months: BudgetMonthData[] = [];
  let currentDisplayMonth = minYearMonth;

  while (currentDisplayMonth <= maxYearMonth) {
    const budgetDataMap: Record<string, CategoryBudgetData> = {};

    // Summary accumulators
    let totalTargetAmount = 0n;
    let totalFunded = 0n;
    let totalRemainingToFund = 0n;
    let totalOverspent = 0n;
    let overspentCategoryCount = 0;
    let extraFunding = 0n;
    const coverOverspending = 0n;

    for (const category of categories) {
      const categoryData = allCategoryMonthData.get(category._id);
      const monthData = categoryData?.get(currentDisplayMonth);

      if (monthData) {
        // Always include in budget data map (so archived categories still show in UI)
        budgetDataMap[category._id] = monthData;

        // Track overspent category count (includes archived categories)
        if (monthData.available < 0n) {
          overspentCategoryCount++;
        }

        // Skip archived categories from summary calculations
        // They should still appear in the budget list but not affect the totals
        if (category.isArchived === true) {
          continue;
        }

        // Check if this category is snoozed for this month
        const isCategorySnoozed = monthData.target.isSnoozed === true;

        // Track overspending amount (negative available balance) - always counted, even when snoozed
        if (monthData.available < 0n) {
          totalOverspent += monthData.available * -1n;
        }

        // Skip snoozed categories from target metrics (but overspending above is still counted)
        if (isCategorySnoozed) {
          continue;
        }

        // Calculate summary metrics
        // Use assignmentNeeded (monthly requirement) instead of targetAmount (total target balance)
        // This correctly shows what's needed THIS MONTH, not the total of all savings goals
        const hasActiveTarget = monthData.target.targetAmount !== undefined;
        const hasMonthlyNeed = monthData.target.assignmentNeeded > 0n;
        // Check if the category has ANY target defined (even if not active for this month)
        const categoryHasTargetDefined = hasTarget(category);

        if (hasMonthlyNeed && (hasActiveTarget || categoryHasTargetDefined)) {
          // Category has a monthly requirement AND has a target - count towards target progress
          // Categories without targets but with overspending have hasMonthlyNeed=true (set to overspending amount)
          // but should NOT count towards target progress percentage
          const monthlyNeed = monthData.target.assignmentNeeded;
          totalTargetAmount += monthlyNeed;
          // Funded amount is monthly need minus what's still remaining to assign
          // If remainingToAssign is 0, the monthly need is fully funded
          totalFunded += monthlyNeed - monthData.target.remainingToAssign;
          totalRemainingToFund += monthData.target.remainingToAssign;
        } else if (hasActiveTarget && monthData.target.overfundedByAmount > 0n && monthData.available > 0n) {
          // Category has a target, is overfunded, and has positive available balance
          // This means: target met + overspending covered + still has extra money left over
          // The extra amount is the lesser of overfundedByAmount and available (can't have more extra than available)
          const extraAmount =
            monthData.target.overfundedByAmount < monthData.available
              ? monthData.target.overfundedByAmount
              : monthData.available;
          extraFunding += extraAmount;
        }
      }
    }

    // Calculate percentage funded (0 if no targets)
    // Use floor to round down - user should see 99% until fully funded, not 100% when ~$30 off
    const percentageFunded =
      totalTargetAmount > 0n ? Math.floor(Number((totalFunded * 100n) / totalTargetAmount)) : 100;

    const summary: BudgetMonthSummary = {
      percentageFunded,
      totalTargetAmount,
      totalFunded,
      totalRemainingToFund,
      totalOverspent,
      overspentCategoryCount,
      extraFunding,
      coverOverspending,
    };

    months.push({
      yearMonth: currentDisplayMonth,
      yearMonthString: yearMonthToString(currentDisplayMonth),
      budgetData: budgetDataMap,
      summary,
    });

    currentDisplayMonth = getNextYearMonth(currentDisplayMonth);
  }
  // ===== END OPTIMIZATION =====

  return {
    months,
    availableRange: {
      minYearMonth,
      maxYearMonth,
    },
    readyToAssign,
  };
}

/**
 * Get budget data for a specific month, returned as a map keyed by categoryId.
 * This is a lightweight query that only fetches budget amounts.
 * Group totals should be calculated on the frontend by summing category amounts.
 */
export const listBudgetDataByMonth = query({
  args: {
    workspaceId: v.id('workspace'),
    currentYearMonth: v.int64(), // Client must provide their local current month (YYYYMM format)
  },
  handler: async (ctx, { workspaceId, currentYearMonth }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return listBudgetDataByMonthForWorkspace(ctx, verifiedWorkspaceId, Number(currentYearMonth));
  },
});
/**
 * Get all category budgets for a specific month
 * Returns a hierarchical structure organized by category groups with aggregated totals.
 * Includes both real budgets (stored in DB) and virtual budgets (computed on-the-fly)
 * for categories that don't have explicit budgets for this month.
 */
export const listCategoryBudgetsByMonth = query({
  args: {
    workspaceId: v.id('workspace'),
    yearMonth: v.number(),
  },
  handler: async (ctx, { workspaceId, yearMonth }) => {
    // Validate yearMonth format (YYYYMM)
    // Extract month (last 2 digits)
    const month = yearMonth % 100;
    if (month < 1 || month > 12) {
      throw new ConvexError(`Invalid month in yearMonth: ${yearMonth}. Month must be between 01 and 12.`);
    }

    // Extract year (first 4 digits)
    const year = Math.floor(yearMonth / 100);
    if (year < 1000 || year > 9999) {
      throw new ConvexError(`Invalid year in yearMonth: ${yearMonth}. Year must be a 4-digit number.`);
    }

    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get workspace-specific category groups
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Create a map of groups by ID for type lookup
    const groupsById = new Map(allGroups.map((g) => [g._id, g]));

    // Create a map of categories by group ID
    const categoriesByGroupId = new Map<Id<'categoryGroup'>, typeof categories>();

    for (const category of categories) {
      const groupCategories = categoriesByGroupId.get(category.categoryGroupId) || [];
      groupCategories.push(category);
      categoriesByGroupId.set(category.categoryGroupId, groupCategories);
    }

    // Helper function to create budget using calculated values
    const createBudget = async (category: Doc<'category'>): Promise<CategoryBudgetWithCategory> => {
      const group = groupsById.get(category.categoryGroupId);
      const categorySummary: CategorySummary = {
        _id: category._id,
        _creationTime: category._creationTime,
        name: category.name,
        iconName: getCategoryIconName(category, group?.type),
        type: group?.type, // Type comes from categoryGroup, not deprecated category.type
        updatedAt: category.updatedAt,
      };

      // Use the new calculated budget approach
      const calculated = await getCalculatedBudgetForMonth(ctx, verifiedWorkspaceId, category._id, yearMonth);

      const isCreditCardCategory = category.categoryType === 'credit_card';

      // Initialize result with base fields
      const result: CategoryBudgetWithCategory = {
        categoryId: category._id,
        workspaceId: verifiedWorkspaceId,
        yearMonth,
        assignedAmount: calculated.assignedAmount,
        totalSpent: calculated.spentAmount,
        carryoverFromPrevious: calculated.carryover,
        available: calculated.available,
        category: categorySummary,
      };

      if (isCreditCardCategory) {
        // Credit card category - read creditMonthlySpending directly from category (no longer a separate table)
        // Note: creditMonthlySpending keys are in YYYYMM format (e.g., "202401")
        const yearMonthStr = yearMonth.toString();
        const monthSpending = category.creditMonthlySpending?.[yearMonthStr] ?? null;
        const spendingAmount = monthSpending?.spendingAmount ?? 0n;
        const paymentsAmount = monthSpending?.paymentsAmount ?? 0n;

        // Calculate activity display values
        const activity = calculateCreditCardActivityDisplay(spendingAmount, paymentsAmount);

        result.priorBalance = calculated.priorBalance;
        result.currentBalance = calculated.currentBalance;
        result.spendingAmount = spendingAmount;
        result.paymentsAmount = paymentsAmount;
        result.fundedSpending = activity.fundedSpending;
        result.paymentsAndReturns = activity.paymentsAndReturns;
        result.totalActivity = activity.totalActivity;
        result.activityThisMonth = calculated.activityThisMonth; // Backward compatibility
      } else {
        // Regular category - read monthlySpending directly from category (no longer a separate table)
        // Read specific month from monthlySpending map
        // Note: monthlySpending keys are in YYYYMM format (e.g., "202401")
        const yearMonthStr = yearMonth.toString();
        const monthSpending = category.monthlySpending?.[yearMonthStr] ?? null;
        const inflowAmount = monthSpending?.inflowAmount ?? 0n;
        const outflowAmount = monthSpending?.outflowAmount ?? 0n;

        // Calculate activity display values
        const activity = calculateCategoryActivityDisplay(inflowAmount, outflowAmount);

        result.inflowAmount = inflowAmount;
        result.outflowAmount = outflowAmount;
        result.activity = activity.activity;
      }

      return result;
    };

    // Helper function to calculate totals from budgets
    const calculateTotals = (budgets: CategoryBudgetWithCategory[]): BudgetTotals => {
      return budgets.reduce(
        (acc, budget) => ({
          assignedAmount: acc.assignedAmount + budget.assignedAmount,
          totalSpent: acc.totalSpent + budget.totalSpent,
          carryoverFromPrevious: acc.carryoverFromPrevious + budget.carryoverFromPrevious,
          available: acc.available + budget.available,
        }),
        {
          assignedAmount: 0n,
          totalSpent: 0n,
          carryoverFromPrevious: 0n,
          available: 0n,
        }
      );
    };

    // Build category groups with budgets
    const categoryGroupsWithBudgets: CategoryGroupWithBudgets[] = [];

    // Process each category group
    for (const group of allGroups) {
      const groupCategories = categoriesByGroupId.get(group._id) || [];
      if (groupCategories.length === 0) {
        // Skip empty groups
        continue;
      }

      // Create budgets for all categories in this group
      // Sort categories by sortOrder, then by name
      const sortedGroupCategories = groupCategories.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });

      const groupBudgets: CategoryBudgetWithCategory[] = [];
      for (const category of sortedGroupCategories) {
        const budget = await createBudget(category);
        groupBudgets.push(budget);
      }

      // Calculate totals for this group
      const groupTotals = calculateTotals(groupBudgets);

      categoryGroupsWithBudgets.push({
        categoryGroup: {
          _id: group._id,
          _creationTime: group._creationTime,
          name: group.name,
          type: group.type,
          sortOrder: group.sortOrder,
          updatedAt: group.updatedAt,
        },
        totals: groupTotals,
        categoryBudgets: groupBudgets,
      });
    }

    // Sort groups by sortOrder, then by name
    categoryGroupsWithBudgets.sort((a, b) => {
      // First sort by sortOrder
      if (a.categoryGroup.sortOrder !== b.categoryGroup.sortOrder) {
        return a.categoryGroup.sortOrder - b.categoryGroup.sortOrder;
      }
      // Then by name
      return a.categoryGroup.name.localeCompare(b.categoryGroup.name);
    });

    // Calculate top-level totals across all groups
    const topLevelTotals = calculateTotals(categoryGroupsWithBudgets.flatMap((g) => g.categoryBudgets));

    return {
      yearMonth,
      yearMonthString: yearMonthToString(yearMonth),
      totals: topLevelTotals,
      categoryBudgetGroups: categoryGroupsWithBudgets,
    };
  },
});

/**
 * Get all category budgets for a specific category
 * Returns an array of budget objects extracted from the monthlyAssignedAmounts map
 */
export const listCategoryBudgetsByCategory = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryId', categoryId)
      )
      .first();

    if (!budget) {
      return [];
    }

    // Extract months from map and convert to array format
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
    const budgets = Object.entries(monthlyAmounts).map(([yearMonthStr, assignedAmount]) => ({
      _id: budget._id,
      _creationTime: budget._creationTime,
      categoryId: budget.categoryId,
      workspaceId: budget.workspaceId,
      yearMonth: parseInt(yearMonthStr, 10),
      assignedAmount,
      updatedAt: budget.updatedAt,
    }));

    // Sort by yearMonth (ascending)
    return budgets.sort((a, b) => a.yearMonth - b.yearMonth);
  },
});

/**
 * Get all category budgets for a category from a specific month forward
 * CRITICAL for cascading updates when transactions are added in the past
 * Returns an array of budget objects extracted from the monthlyAssignedAmounts map
 */
export const listCategoryBudgetsFromMonth = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    fromYearMonth: v.number(),
  },
  handler: async (ctx, { workspaceId, categoryId, fromYearMonth }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get the budget row for this category
    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryId', categoryId)
      )
      .first();

    if (!budget) {
      return [];
    }

    // Extract months from map, filter by fromYearMonth, and convert to array format
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
    const budgetsFromMonth = Object.entries(monthlyAmounts)
      .filter(([yearMonthStr]) => parseInt(yearMonthStr, 10) >= fromYearMonth)
      .map(([yearMonthStr, assignedAmount]) => ({
        _id: budget._id,
        _creationTime: budget._creationTime,
        categoryId: budget.categoryId,
        workspaceId: budget.workspaceId,
        yearMonth: parseInt(yearMonthStr, 10),
        assignedAmount,
        updatedAt: budget.updatedAt,
      }));

    // Sort by yearMonth (ascending)
    return budgetsFromMonth.sort((a, b) => a.yearMonth - b.yearMonth);
  },
});

/**
 * DEV UTILITY: Get category budgets for a workspace and month
 * This is a convenience function for testing and debugging.
 *
 * Usage in Convex Dashboard:
 * 1. Go to Functions tab
 * 2. Find "categoryBudgets" -> "devGetCategoryBudgetsByMonth"
 * 3. Click "Run Function"
 * 4. Provide workspaceId and yearMonth (e.g., 202401 for January 2024)
 * 5. Click "Run"
 *
 * Returns all category budgets (both real and virtual) for the specified month.
 */
export const devGetCategoryBudgetsByMonth = query({
  args: {
    workspaceId: v.id('workspace'),
    yearMonth: v.number(),
  },
  handler: async (ctx, { workspaceId, yearMonth }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get workspace-specific category groups
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Create a map of groups by ID for type lookup
    const groupsById = new Map(allGroups.map((g) => [g._id, g]));

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all budgets for this workspace (for dev stats)
    const allBudgets = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    // Count existing budgets for this month (extract from maps)
    const existingBudgets = allBudgets.filter((budget) => {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      return yearMonth.toString() in monthlyAmounts;
    });

    // Build result array with both real and virtual budgets
    const budgets: CategoryBudgetWithCategory[] = [];

    for (const category of categories) {
      const group = groupsById.get(category.categoryGroupId);
      const categorySummary: CategorySummary = {
        _id: category._id,
        _creationTime: category._creationTime,
        name: category.name,
        iconName: getCategoryIconName(category, group?.type),
        type: group?.type, // Type comes from categoryGroup, not deprecated category.type
        updatedAt: category.updatedAt,
      };

      // Use the new calculated budget approach
      const calculated = await getCalculatedBudgetForMonth(ctx, verifiedWorkspaceId, category._id, yearMonth);

      budgets.push({
        categoryId: category._id,
        workspaceId: verifiedWorkspaceId,
        yearMonth,
        assignedAmount: calculated.assignedAmount,
        totalSpent: calculated.spentAmount,
        carryoverFromPrevious: calculated.carryover,
        available: calculated.available,
        category: categorySummary,
      });
    }

    return {
      workspaceId,
      yearMonth,
      yearMonthString: yearMonthToString(yearMonth),
      budgets,
      count: budgets.length,
      realBudgets: existingBudgets.length,
      virtualBudgets: budgets.length - existingBudgets.length,
    };
  },
});
