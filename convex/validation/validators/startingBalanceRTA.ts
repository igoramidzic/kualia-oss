import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import type { StartingBalanceRTAIssue } from '../types';

/**
 * Validate that starting balance transactions for banking accounts have readyToAssign: true
 * This ensures that starting balances are properly counted toward RTA
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<StartingBalanceRTAIssue[]> => {
    const issues: StartingBalanceRTAIssue[] = [];

    // Get all bank accounts
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Filter to only banking accounts (checking, savings, cash)
    const bankingAccounts = bankAccounts.filter(
      (a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('banking_')
    );

    // Get all transactions
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const account of bankingAccounts) {
      // Find starting_balance transaction for this account
      const startingBalanceTx = allTransactions.find(
        (t) => t.bankAccountId.toString() === account._id.toString() && t.type === 'starting_balance'
      );

      if (!startingBalanceTx) continue;

      // Check if movements need to be fixed
      const movements = startingBalanceTx.movements ?? [];
      let hasMissingRTA = false;
      let missingAmount = 0n;

      for (const movement of movements) {
        if (movement.readyToAssign !== true) {
          hasMissingRTA = true;
          missingAmount += movement.amount;
        }
      }

      if (hasMissingRTA) {
        issues.push({
          type: 'starting_balance_rta_missing',
          severity: 'error',
          description: `Starting balance for ${account.name} not marked as readyToAssign`,
          accountId: account._id,
          accountName: account.name,
          transactionId: startingBalanceTx._id,
          missingAmount,
        });
      }
    }

    return issues;
  },
});

/**
 * Fix starting balance transactions by setting readyToAssign: true on movements
 * This does NOT update workspace RTA - that should be done by the readyToAssign.fix
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    try {
      // Get all bank accounts
      const bankAccounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .collect();

      // Filter to only banking accounts (checking, savings, cash)
      const bankingAccounts = bankAccounts.filter(
        (a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('banking_')
      );

      // Get all transactions
      const allTransactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      for (const account of bankingAccounts) {
        // Find starting_balance transaction for this account
        const startingBalanceTx = allTransactions.find(
          (t) => t.bankAccountId.toString() === account._id.toString() && t.type === 'starting_balance'
        );

        if (!startingBalanceTx) continue;

        // Check if movements need to be fixed
        const movements = startingBalanceTx.movements ?? [];
        let needsFix = false;

        for (const movement of movements) {
          if (movement.readyToAssign !== true) {
            needsFix = true;
            break;
          }
        }

        if (needsFix) {
          // Update the transaction movements to have readyToAssign: true
          const updatedMovements = movements.map((m) => ({
            ...m,
            readyToAssign: true,
          }));

          await ctx.db.patch(startingBalanceTx._id, {
            movements: updatedMovements,
            updatedAt: new Date().toISOString(),
          });

          fixed++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to fix starting balance RTA: ${message}`);
    }

    return { fixed, errors };
  },
});
