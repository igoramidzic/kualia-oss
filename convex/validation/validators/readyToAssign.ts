import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import type { RTAIssue } from '../types';

/**
 * Validate that workspace.readyToAssign matches calculated value
 * Formula: readyToAssign = netUncategorized - budgetAssignments
 * Where: netUncategorized = sum of all readyToAssign movements (inflows + outflows)
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<RTAIssue[]> => {
    const issues: RTAIssue[] = [];

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      return issues;
    }

    let uncategorizedInflows = 0n;
    let uncategorizedOutflows = 0n;

    // Get all transactions for this workspace
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all non-deleted bank accounts to check account types
    const allBankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();
    const bankAccountMap = new Map(allBankAccounts.map((a) => [a._id.toString(), a]));

    // Process embedded movements that are ready-to-assign
    // Only banking accounts (checking, savings, cash) contribute to RTA
    // Exclude credit cards, loans, and investment accounts
    for (const transaction of allTransactions) {
      const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
      if (!bankAccount) continue;

      // Skip credit card, loan, and investment accounts entirely
      const isExcludedFromRTA =
        bankAccount.accountType?.startsWith('credit_') ||
        bankAccount.accountType?.startsWith('loan_') ||
        bankAccount.accountType?.startsWith('investment_');
      if (isExcludedFromRTA) continue;

      for (const movement of transaction.movements ?? []) {
        if (!movement.readyToAssign) continue;

        if (movement.amount > 0) {
          uncategorizedInflows += movement.amount;
        } else if (movement.amount < 0) {
          uncategorizedOutflows += movement.amount;
        }
      }
    }

    const netUncategorized = uncategorizedInflows + uncategorizedOutflows;

    // Get all budget assignments
    const budgetAssignments = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    const totalBudgetAssignments = budgetAssignments.reduce((sum, budget) => {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      const categoryTotal = Object.values(monthlyAmounts).reduce((catSum, amount) => catSum + amount, 0n);
      return sum + categoryTotal;
    }, 0n);

    // Calculate expected RTA
    const expectedRTA = netUncategorized - totalBudgetAssignments;
    const storedRTA = workspace.readyToAssign ?? 0n;

    if (expectedRTA !== storedRTA) {
      issues.push({
        type: 'ready_to_assign_mismatch',
        severity: 'error',
        description: `Workspace RTA mismatch: stored ${storedRTA}, expected ${expectedRTA}`,
        stored: storedRTA,
        expected: expectedRTA,
        breakdown: {
          uncategorizedInflows,
          uncategorizedOutflows,
          budgetAssignments: totalBudgetAssignments,
          netUncategorized,
        },
      });
    }

    return issues;
  },
});

/**
 * Fix ready-to-assign discrepancy by recalculating from transactions
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

      let uncategorizedInflows = 0n;
      let uncategorizedOutflows = 0n;

      const allTransactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      // Get all bank accounts to check account types (exclude deleted accounts)
      const allBankAccounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect();
      const bankAccountMap = new Map(allBankAccounts.map((a) => [a._id.toString(), a]));

      for (const transaction of allTransactions) {
        const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
        if (!bankAccount) continue;

        // Skip credit card, loan, and investment accounts entirely
        const isExcludedFromRTA =
          bankAccount.accountType?.startsWith('credit_') ||
          bankAccount.accountType?.startsWith('loan_') ||
          bankAccount.accountType?.startsWith('investment_');
        if (isExcludedFromRTA) continue;

        for (const movement of transaction.movements ?? []) {
          if (!movement.readyToAssign) continue;

          if (movement.amount > 0) {
            uncategorizedInflows += movement.amount;
          } else if (movement.amount < 0) {
            uncategorizedOutflows += movement.amount;
          }
        }
      }

      const netUncategorized = uncategorizedInflows + uncategorizedOutflows;

      const budgetAssignments = await ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .collect();

      const totalBudgetAssignments = budgetAssignments.reduce((sum, budget) => {
        const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
        const categoryTotal = Object.values(monthlyAmounts).reduce((catSum, amount) => catSum + amount, 0n);
        return sum + categoryTotal;
      }, 0n);

      const expectedRTA = netUncategorized - totalBudgetAssignments;
      const currentRTA = workspace.readyToAssign ?? 0n;

      // Only patch if different
      if (currentRTA !== expectedRTA) {
        await ctx.db.patch(workspaceId, {
          readyToAssign: expectedRTA,
        });
        fixed = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to fix RTA: ${message}`);
    }

    return { fixed, errors };
  },
});
