import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import type { MonthlyIncomeActivityIssue } from '../types';

/**
 * Validate that workspace.monthlyIncomeActivity matches calculated values from RTA movements
 * Only includes real income/expenses (excludes starting_balance and balance_adjustment)
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<MonthlyIncomeActivityIssue[]> => {
    const issues: MonthlyIncomeActivityIssue[] = [];

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      return issues;
    }

    // Calculate expected monthlyIncomeActivity from transactions
    const expectedActivity = new Map<string, { inflowAmount: bigint; outflowAmount: bigint }>();

    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const transaction of allTransactions) {
      // Skip starting_balance and balance_adjustment (not real income)
      if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
        continue;
      }

      const bankAccount = await ctx.db.get(transaction.bankAccountId);
      if (!bankAccount) continue;

      // Skip credit card, loan, and investment accounts (only banking accounts affect income tracking)
      const isExcludedFromRTA =
        bankAccount.accountType?.startsWith('credit_') ||
        bankAccount.accountType?.startsWith('loan_') ||
        bankAccount.accountType?.startsWith('investment_');
      if (isExcludedFromRTA) continue;

      const yearMonthStr = transaction.dateYearMonth?.toString() ?? '';
      if (!yearMonthStr) continue;

      for (const movement of transaction.movements ?? []) {
        if (!movement.readyToAssign) continue;

        if (!expectedActivity.has(yearMonthStr)) {
          expectedActivity.set(yearMonthStr, { inflowAmount: 0n, outflowAmount: 0n });
        }

        const activity = expectedActivity.get(yearMonthStr)!;

        if (movement.amount > 0) {
          activity.inflowAmount += movement.amount;
        } else if (movement.amount < 0) {
          // Store outflows as positive values
          activity.outflowAmount += -movement.amount;
        }
      }
    }

    // Compare with stored monthlyIncomeActivity
    const storedActivity = workspace.monthlyIncomeActivity ?? {};

    // Check stored entries
    for (const [yearMonthStr, stored] of Object.entries(storedActivity)) {
      const expected = expectedActivity.get(yearMonthStr);
      const expectedInflow = expected?.inflowAmount ?? 0n;
      const expectedOutflow = expected?.outflowAmount ?? 0n;

      if (stored.inflowAmount !== expectedInflow) {
        issues.push({
          type: 'monthly_income_activity_mismatch',
          severity: 'error',
          description: `Monthly income activity mismatch for ${yearMonthStr} - inflowAmount`,
          yearMonth: yearMonthStr,
          field: 'inflowAmount',
          stored: stored.inflowAmount,
          expected: expectedInflow,
        });
      }

      if (stored.outflowAmount !== expectedOutflow) {
        issues.push({
          type: 'monthly_income_activity_mismatch',
          severity: 'error',
          description: `Monthly income activity mismatch for ${yearMonthStr} - outflowAmount`,
          yearMonth: yearMonthStr,
          field: 'outflowAmount',
          stored: stored.outflowAmount,
          expected: expectedOutflow,
        });
      }

      expectedActivity.delete(yearMonthStr);
    }

    // Check for missing entries (expected but not stored)
    for (const [yearMonthStr, expected] of expectedActivity.entries()) {
      if (expected.inflowAmount !== 0n) {
        issues.push({
          type: 'monthly_income_activity_mismatch',
          severity: 'error',
          description: `Missing monthly income activity for ${yearMonthStr} - inflowAmount`,
          yearMonth: yearMonthStr,
          field: 'inflowAmount',
          stored: 0n,
          expected: expected.inflowAmount,
        });
      }

      if (expected.outflowAmount !== 0n) {
        issues.push({
          type: 'monthly_income_activity_mismatch',
          severity: 'error',
          description: `Missing monthly income activity for ${yearMonthStr} - outflowAmount`,
          yearMonth: yearMonthStr,
          field: 'outflowAmount',
          stored: 0n,
          expected: expected.outflowAmount,
        });
      }
    }

    return issues;
  },
});

/**
 * Fix monthly income activity discrepancies by recalculating from transactions
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    try {
      const workspace = await ctx.db.get(workspaceId);
      if (!workspace) {
        errors.push('Workspace not found');
        return { fixed, errors };
      }

      // Calculate correct monthlyIncomeActivity
      const calculatedActivity = new Map<string, { inflowAmount: bigint; outflowAmount: bigint }>();

      const allTransactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      for (const transaction of allTransactions) {
        if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
          continue;
        }

        const bankAccount = await ctx.db.get(transaction.bankAccountId);
        if (!bankAccount) continue;

        // Skip credit card, loan, and investment accounts (only banking accounts affect income tracking)
        const isExcludedFromRTA =
          bankAccount.accountType?.startsWith('credit_') ||
          bankAccount.accountType?.startsWith('loan_') ||
          bankAccount.accountType?.startsWith('investment_');
        if (isExcludedFromRTA) continue;

        const yearMonthStr = transaction.dateYearMonth?.toString() ?? '';
        if (!yearMonthStr) continue;

        for (const movement of transaction.movements ?? []) {
          if (!movement.readyToAssign) continue;

          if (!calculatedActivity.has(yearMonthStr)) {
            calculatedActivity.set(yearMonthStr, { inflowAmount: 0n, outflowAmount: 0n });
          }

          const activity = calculatedActivity.get(yearMonthStr)!;

          if (movement.amount > 0) {
            activity.inflowAmount += movement.amount;
          } else if (movement.amount < 0) {
            activity.outflowAmount += -movement.amount;
          }
        }
      }

      // Convert to record format
      const newMonthlyIncomeActivity: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};
      for (const [yearMonth, activity] of calculatedActivity.entries()) {
        newMonthlyIncomeActivity[yearMonth] = activity;
      }

      // Check if anything actually changed
      const currentActivity = workspace.monthlyIncomeActivity ?? {};
      const serialize = (obj: Record<string, { inflowAmount: bigint; outflowAmount: bigint }>) =>
        JSON.stringify(
          Object.entries(obj)
            .map(([k, v]) => [k, { inflowAmount: String(v.inflowAmount), outflowAmount: String(v.outflowAmount) }])
            .sort()
        );

      if (serialize(currentActivity) !== serialize(newMonthlyIncomeActivity)) {
        await ctx.db.patch(workspaceId, {
          monthlyIncomeActivity: newMonthlyIncomeActivity,
        });
        fixed = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to fix monthly income activity: ${message}`);
    }

    return { fixed, errors };
  },
});
