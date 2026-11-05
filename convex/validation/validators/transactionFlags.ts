import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import {
  computeHasMissingPayee,
  computeHasUncategorized,
  isCrossBudgetTransfer,
  isOnBudgetAccountType,
} from '../../transactions/helpers';
import type { TransactionFlagIssue } from '../types';

/**
 * Validate that transaction hasUncategorized and hasMissingPayee flags are correct
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<TransactionFlagIssue[]> => {
    const issues: TransactionFlagIssue[] = [];

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build a map of bank account types for cross-budget detection
    const bankAccountIds = new Set<string>();
    for (const tx of transactions) {
      bankAccountIds.add(tx.bankAccountId);
      if (tx.transferPairBankAccountId) {
        bankAccountIds.add(tx.transferPairBankAccountId);
      }
    }
    const bankAccountMap = new Map<string, string>();
    for (const id of bankAccountIds) {
      const account = await ctx.db.get(id as Id<'bankAccount'>);
      if (account && 'accountType' in account && typeof account.accountType === 'string') {
        bankAccountMap.set(id, account.accountType);
      }
    }

    for (const transaction of transactions) {
      const movements = transaction.movements ?? [];

      // Determine cross-budget on-budget side for transfers
      let isCrossBudgetOnBudgetSide: boolean | undefined;
      if (transaction.type === 'transfer' && transaction.transferPairBankAccountId) {
        const accountType = bankAccountMap.get(transaction.bankAccountId);
        const pairAccountType = bankAccountMap.get(transaction.transferPairBankAccountId);
        if (accountType && pairAccountType && isCrossBudgetTransfer(accountType, pairAccountType)) {
          isCrossBudgetOnBudgetSide = isOnBudgetAccountType(accountType);
        }
      }

      // Determine if account is off-budget
      const accountType = bankAccountMap.get(transaction.bankAccountId);
      const isOffBudgetAccount = accountType ? !isOnBudgetAccountType(accountType) : false;

      // Check hasUncategorized
      const expectedHasUncategorized = computeHasUncategorized(
        movements,
        transaction.type,
        isCrossBudgetOnBudgetSide,
        isOffBudgetAccount
      );
      const storedHasUncategorized = transaction.hasUncategorized ?? false;

      if (storedHasUncategorized !== expectedHasUncategorized) {
        issues.push({
          type: 'transaction_flag_incorrect',
          severity: 'error',
          description: `Transaction has incorrect hasUncategorized flag`,
          transactionId: transaction._id,
          flag: 'hasUncategorized',
          stored: storedHasUncategorized,
          expected: expectedHasUncategorized,
        });
      }

      // Check hasMissingPayee
      const expectedHasMissingPayee = computeHasMissingPayee(transaction.merchantId, transaction.type);
      const storedHasMissingPayee = transaction.hasMissingPayee ?? false;

      if (storedHasMissingPayee !== expectedHasMissingPayee) {
        issues.push({
          type: 'transaction_flag_incorrect',
          severity: 'error',
          description: `Transaction has incorrect hasMissingPayee flag`,
          transactionId: transaction._id,
          flag: 'hasMissingPayee',
          stored: storedHasMissingPayee,
          expected: expectedHasMissingPayee,
        });
      }
    }

    return issues;
  },
});

/**
 * Fix transaction flag discrepancies by recalculating flags
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build a map of bank account types for cross-budget detection
    const bankAccountIds = new Set<string>();
    for (const tx of transactions) {
      bankAccountIds.add(tx.bankAccountId);
      if (tx.transferPairBankAccountId) {
        bankAccountIds.add(tx.transferPairBankAccountId);
      }
    }
    const bankAccountMap = new Map<string, string>();
    for (const id of bankAccountIds) {
      const account = await ctx.db.get(id as Id<'bankAccount'>);
      if (account && 'accountType' in account && typeof account.accountType === 'string') {
        bankAccountMap.set(id, account.accountType);
      }
    }

    for (const transaction of transactions) {
      try {
        const movements = transaction.movements ?? [];

        // Determine cross-budget on-budget side for transfers
        let isCrossBudgetOnBudgetSide: boolean | undefined;
        if (transaction.type === 'transfer' && transaction.transferPairBankAccountId) {
          const accountType = bankAccountMap.get(transaction.bankAccountId);
          const pairAccountType = bankAccountMap.get(transaction.transferPairBankAccountId);
          if (accountType && pairAccountType && isCrossBudgetTransfer(accountType, pairAccountType)) {
            isCrossBudgetOnBudgetSide = isOnBudgetAccountType(accountType);
          }
        }

        // Determine if account is off-budget
        const txAccountType = bankAccountMap.get(transaction.bankAccountId);
        const isOffBudgetAccount = txAccountType ? !isOnBudgetAccountType(txAccountType) : false;

        const expectedHasUncategorized = computeHasUncategorized(
          movements,
          transaction.type,
          isCrossBudgetOnBudgetSide,
          isOffBudgetAccount
        );
        const expectedHasMissingPayee = computeHasMissingPayee(transaction.merchantId, transaction.type);

        const storedHasUncategorized = transaction.hasUncategorized ?? false;
        const storedHasMissingPayee = transaction.hasMissingPayee ?? false;

        // Only patch if there's a difference
        if (storedHasUncategorized !== expectedHasUncategorized || storedHasMissingPayee !== expectedHasMissingPayee) {
          await ctx.db.patch(transaction._id, {
            hasUncategorized: expectedHasUncategorized,
            hasMissingPayee: expectedHasMissingPayee,
          });
          fixed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix transaction ${transaction._id}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
