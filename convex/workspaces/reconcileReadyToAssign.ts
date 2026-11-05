import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Helper to convert ISO date string to yearMonth string for map keys
 */
function dateToYearMonthStr(isoDate: string): string {
  return dateToYearMonth(isoDate).toString();
}

/**
 * Internal mutation to reconcile workspace readyToAssign and monthlyIncomeActivity
 * Calculates expected values from scratch and compares with current values
 *
 * - readyToAssign: Cumulative value = total income - total assigned
 * - monthlyIncomeActivity: Per-month income tracking with inflow/outflow separation for reports
 */
export const reconcileWorkspaceReadyToAssign = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    fix: v.optional(v.boolean()), // If true, update to correct values
  },
  handler: async (ctx, { workspaceId, fix = false }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    // Get all non-deleted transactions for this workspace
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all bank accounts for this workspace to check account types (exclude deleted accounts)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    const bankAccountMap = new Map(bankAccounts.map((a) => [a._id.toString(), a]));

    // Sum up ready to assign movements from embedded movements
    // Also track monthly income activity for reporting (inflow/outflow separately)
    // Only banking accounts (checking, savings, cash) contribute to RTA
    const expectedMonthlyIncomeActivity: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};
    let totalIncome = 0n;

    for (const transaction of allTransactions) {
      // Get the bank account for this transaction
      const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
      if (!bankAccount) continue;

      // Skip credit card, loan, and investment accounts - only banking accounts affect RTA
      const isExcludedFromRTA =
        bankAccount.accountType.startsWith('credit_') ||
        bankAccount.accountType.startsWith('loan_') ||
        bankAccount.accountType.startsWith('investment_');
      if (isExcludedFromRTA) continue;

      // Use embedded movements and group by transaction date month
      const yearMonthStr = dateToYearMonthStr(transaction.date);
      for (const movement of transaction.movements ?? []) {
        if (movement.readyToAssign === true) {
          totalIncome += movement.amount;

          // For monthly income activity (used in reports), exclude starting_balance and balance_adjustment
          // These are not real income/expenses - they're just balance corrections
          if (transaction.type !== 'starting_balance' && transaction.type !== 'balance_adjustment') {
            // Initialize the month entry if it doesn't exist
            if (!expectedMonthlyIncomeActivity[yearMonthStr]) {
              expectedMonthlyIncomeActivity[yearMonthStr] = { inflowAmount: 0n, outflowAmount: 0n };
            }

            // Track inflow (positive) and outflow (negative, stored as positive) separately
            if (movement.amount > 0n) {
              expectedMonthlyIncomeActivity[yearMonthStr].inflowAmount += movement.amount;
            } else if (movement.amount < 0n) {
              expectedMonthlyIncomeActivity[yearMonthStr].outflowAmount += -movement.amount;
            }
          }
        }
      }
    }

    // Get all category budgets and sum their assigned amounts
    const allBudgets = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    let totalAssigned = 0n;
    for (const budget of allBudgets) {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      for (const amount of Object.values(monthlyAmounts)) {
        totalAssigned += amount;
      }
    }

    // Expected RTA = total income - total assigned (cumulative)
    const expectedRTA = totalIncome - totalAssigned;

    // Current values from workspace
    const currentRTA = workspace.readyToAssign ?? 0n;

    // Calculate drift
    const drift = currentRTA - expectedRTA;

    // If fix is true and there's drift, update the workspace
    if (fix && drift !== 0n) {
      await ctx.db.patch(workspaceId, {
        readyToAssign: expectedRTA,
        monthlyIncomeActivity: expectedMonthlyIncomeActivity,
      });
    }

    return {
      workspaceId,
      currentRTA,
      expectedRTA,
      drift,
      totalIncome,
      totalAssigned,
      fixed: fix && drift !== 0n,
    };
  },
});

/**
 * Public mutation to reconcile workspace readyToAssign and monthlyIncomeActivity (with auth)
 * Can be called manually to check or fix drift
 */
export const reconcileReadyToAssign = mutation({
  args: {
    workspaceId: v.id('workspace'),
    fix: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, fix = false }) => {
    // Verify user has access to this workspace
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const workspace = await ctx.db.get(verifiedWorkspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    // Get all non-deleted transactions for this workspace
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all bank accounts for this workspace to check account types (exclude deleted accounts)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    const bankAccountMap = new Map(bankAccounts.map((a) => [a._id.toString(), a]));

    // Sum up ready to assign movements from embedded movements
    // Also track monthly income activity for reporting (inflow/outflow separately)
    // Only banking accounts (checking, savings, cash) contribute to RTA
    const expectedMonthlyIncomeActivity: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};
    let totalIncome = 0n;

    for (const transaction of allTransactions) {
      // Get the bank account for this transaction
      const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
      if (!bankAccount) continue;

      // Skip credit card, loan, and investment accounts - only banking accounts affect RTA
      const isExcludedFromRTA =
        bankAccount.accountType.startsWith('credit_') ||
        bankAccount.accountType.startsWith('loan_') ||
        bankAccount.accountType.startsWith('investment_');
      if (isExcludedFromRTA) continue;

      // Use embedded movements and group by transaction date month
      const yearMonthStr = dateToYearMonthStr(transaction.date);
      for (const movement of transaction.movements ?? []) {
        if (movement.readyToAssign === true) {
          totalIncome += movement.amount;

          // For monthly income activity (used in reports), exclude starting_balance and balance_adjustment
          // These are not real income/expenses - they're just balance corrections
          if (transaction.type !== 'starting_balance' && transaction.type !== 'balance_adjustment') {
            // Initialize the month entry if it doesn't exist
            if (!expectedMonthlyIncomeActivity[yearMonthStr]) {
              expectedMonthlyIncomeActivity[yearMonthStr] = { inflowAmount: 0n, outflowAmount: 0n };
            }

            // Track inflow (positive) and outflow (negative, stored as positive) separately
            if (movement.amount > 0n) {
              expectedMonthlyIncomeActivity[yearMonthStr].inflowAmount += movement.amount;
            } else if (movement.amount < 0n) {
              expectedMonthlyIncomeActivity[yearMonthStr].outflowAmount += -movement.amount;
            }
          }
        }
      }
    }

    // Get all category budgets and sum their assigned amounts
    const allBudgets = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    let totalAssigned = 0n;
    for (const budget of allBudgets) {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      for (const amount of Object.values(monthlyAmounts)) {
        totalAssigned += amount;
      }
    }

    // Expected RTA = total income - total assigned (cumulative)
    const expectedRTA = totalIncome - totalAssigned;

    // Current values from workspace
    const currentRTA = workspace.readyToAssign ?? 0n;

    // Calculate drift
    const drift = currentRTA - expectedRTA;

    // If fix is true and there's drift, update the workspace
    if (fix && drift !== 0n) {
      await ctx.db.patch(verifiedWorkspaceId, {
        readyToAssign: expectedRTA,
        monthlyIncomeActivity: expectedMonthlyIncomeActivity,
      });
    }

    return {
      workspaceId: verifiedWorkspaceId,
      currentRTA,
      expectedRTA,
      drift,
      totalIncome,
      totalAssigned,
      fixed: fix && drift !== 0n,
    };
  },
});
