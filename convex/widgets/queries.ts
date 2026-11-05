import { ConvexError, type Infer, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { calculateBudgetCarryoverChain } from '../categoryBudgets/calculations';
import { dateToYearMonth, getCurrentDateForTimezone } from '../lib/dates';
import { getWorkspaceAccessForClerkId } from '../workspaces/access';

export async function getAuthorizedWidgetTokenByToken(
  ctx: QueryCtx,
  token: string
): Promise<Doc<'widgetToken'> | null> {
  const widgetToken = await ctx.db
    .query('widgetToken')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();

  if (!widgetToken || widgetToken.isRevoked) {
    return null;
  }

  const access = await getWorkspaceAccessForClerkId(ctx, widgetToken.workspaceId, widgetToken.clerkId);
  if (!access || access.workspace.isArchived === true) {
    return null;
  }

  return widgetToken;
}

/**
 * Look up a widget token by its token string.
 * Internal only — called by HTTP handlers via validateWidgetToken helper.
 */
export const getWidgetTokenByToken = internalQuery({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    return await getAuthorizedWidgetTokenByToken(ctx, token);
  },
});

const budgetPulseValidator = v.object({
  workspaceName: v.string(),
  currencyCode: v.string(),
  month: v.string(),
  today: v.string(),
  daysRemaining: v.number(),
  totalAvailable: v.number(),
  totalAssigned: v.number(),
  totalActivity: v.number(),
  overspentCount: v.number(),
  overspentAmount: v.number(),
});

export type WidgetBudgetPulse = Infer<typeof budgetPulseValidator>;
const BUDGET_PULSE_CATEGORY_LIMIT = 1_000;

/**
 * A current-month view of active regular envelopes. Amounts use integer currency minor
 * units, like the existing widget endpoints. Card payment reserves are excluded so a
 * card purchase does not count both its envelope and its payment reserve as available.
 */
export function buildWidgetBudgetPulse(
  workspace: Doc<'workspace'>,
  today: string,
  categories: Doc<'category'>[],
  budgets: Doc<'categoryBudget'>[]
): WidgetBudgetPulse {
  const currentYearMonth = dateToYearMonth(today);
  const assignments = new Map(
    budgets.filter((budget) => budget.workspaceId === workspace._id).map((budget) => [budget.categoryId, budget])
  );
  let totalAvailable = 0n;
  let totalAssigned = 0n;
  let totalActivity = 0n;
  let overspentAmount = 0n;
  let overspentCount = 0;

  for (const category of categories) {
    if (
      category.workspaceId !== workspace._id ||
      category.isDeleted ||
      category.isArchived === true ||
      (category.categoryType !== undefined && category.categoryType !== 'custom')
    ) {
      continue;
    }

    const assigned = assignments.get(category._id)?.monthlyAssignedAmounts ?? {};
    const spending = category.monthlySpending ?? {};
    // Empty months do not change the carryover. Include every historical month with
    // data, rather than truncating long-lived savings envelopes to a lookback window.
    const months = [...new Set([...Object.keys(assigned), ...Object.keys(spending), String(currentYearMonth)])]
      .filter((month) => /^\d{4}(0[1-9]|1[0-2])$/.test(month) && Number(month) <= currentYearMonth)
      .map(Number)
      .sort((a, b) => a - b);
    const calculated = calculateBudgetCarryoverChain(
      months.map((yearMonth) => ({
        yearMonth,
        assignedAmount: assigned[String(yearMonth)] ?? 0n,
        inflowAmount: spending[String(yearMonth)]?.inflowAmount ?? 0n,
        outflowAmount: spending[String(yearMonth)]?.outflowAmount ?? 0n,
      }))
    );
    const current = calculated[calculated.length - 1];
    totalAvailable += current.available;
    totalAssigned += current.assignedAmount;
    totalActivity += current.spentAmount;
    if (current.available < 0n) {
      overspentCount++;
      overspentAmount -= current.available;
    }
  }

  const [year, month, day] = today.split('-').map(Number);
  return {
    workspaceName: workspace.name,
    currencyCode: (workspace.currency ?? 'USD').toUpperCase(),
    month: today.slice(0, 7),
    today,
    daysRemaining: new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1,
    totalAvailable: Number(totalAvailable),
    totalAssigned: Number(totalAssigned),
    totalActivity: Number(totalActivity),
    overspentCount,
    overspentAmount: Number(overspentAmount),
  };
}

/** Authorize and read in one transaction; the HTTP action supplies its current time. */
export const getBudgetPulseForWidget = internalQuery({
  args: { token: v.string(), now: v.number() },
  returns: v.union(v.null(), budgetPulseValidator),
  handler: async (ctx, { token, now }): Promise<WidgetBudgetPulse | null> => {
    const authorizedToken = await getAuthorizedWidgetTokenByToken(ctx, token);
    if (!authorizedToken) return null;

    const workspace = await ctx.db.get(authorizedToken.workspaceId);
    if (!workspace) return null;
    const [categories, budgets] = await Promise.all([
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
        .take(BUDGET_PULSE_CATEGORY_LIMIT + 1),
      ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
        .take(BUDGET_PULSE_CATEGORY_LIMIT + 1),
    ]);
    // Never present truncated financial totals as a complete budget snapshot.
    if (categories.length > BUDGET_PULSE_CATEGORY_LIMIT || budgets.length > BUDGET_PULSE_CATEGORY_LIMIT) {
      throw new ConvexError('This workspace is too large for a Budget Pulse widget. Open Kualia to view its budget.');
    }
    return buildWidgetBudgetPulse(
      workspace,
      getCurrentDateForTimezone(workspace.timezone, new Date(now)),
      categories,
      budgets
    );
  },
});
