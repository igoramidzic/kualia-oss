import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { isLiabilityAccountType } from '../../lib/accountTypes';
import type { BankAccountBalanceIssue } from '../types';

/**
 * Validate that bank account currentBalance matches sum of transactions
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<BankAccountBalanceIssue[]> => {
    const issues: BankAccountBalanceIssue[] = [];

    // Get all non-deleted bank accounts for this workspace
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    for (const account of bankAccounts) {
      // Sum all transactions for this account
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', account._id))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      // Calculate balance from transactions
      let calculatedBalance = 0n;
      for (const tx of transactions) {
        const txAmount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
        calculatedBalance += txAmount;
      }

      const storedBalance = account.currentBalance ?? 0n;

      if (calculatedBalance !== storedBalance) {
        issues.push({
          type: 'bank_account_balance_mismatch',
          severity: 'error',
          description: `Bank account "${account.name}" balance mismatch: stored ${storedBalance}, expected ${calculatedBalance}`,
          bankAccountId: account._id,
          accountName: account.name,
          stored: storedBalance,
          expected: calculatedBalance,
          transactionCount: transactions.length,
        });
      }
    }

    return issues;
  },
});

/**
 * Fix current balances and monthly balance changes from transactions.
 * History is rebuilt even when a previous repair already corrected currentBalance.
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  returns: v.object({ fixed: v.number(), errors: v.array(v.string()) }),
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    for (const account of bankAccounts) {
      // Skip liability accounts (credit cards, loans) - they use different balance semantics
      // and recalculating from transactions can incorrectly flip the sign
      if (account.accountType && isLiabilityAccountType(account.accountType)) {
        continue;
      }

      try {
        const transactions = await ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
            q.eq('workspaceId', workspaceId).eq('bankAccountId', account._id).eq('isDeleted', false)
          );

        let calculatedBalance = 0n;
        const monthlyBalances: Record<string, bigint> = {};
        for await (const tx of transactions) {
          const txAmount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
          calculatedBalance += txAmount;
          const month = dateToYearMonth(tx.date).toString();
          monthlyBalances[month] = (monthlyBalances[month] ?? 0n) + txAmount;
        }

        const storedBalance = account.currentBalance ?? 0n;
        const storedHistory = account.monthlyBalances ?? {};
        const months = new Set([...Object.keys(storedHistory), ...Object.keys(monthlyBalances)]);
        const historyChanged = [...months].some(
          (month) => (storedHistory[month] ?? 0n) !== (monthlyBalances[month] ?? 0n)
        );

        if (calculatedBalance !== storedBalance || historyChanged) {
          await ctx.db.patch(account._id, {
            currentBalance: calculatedBalance,
            monthlyBalances,
            updatedAt: new Date().toISOString(),
          });
          fixed++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix bank account ${account.name}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
