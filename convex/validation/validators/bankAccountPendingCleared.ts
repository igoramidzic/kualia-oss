import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, internalMutation, internalQuery } from '../../_generated/server';

const PAGE_SIZE = 500;

/**
 * Fetch all non-deleted bank accounts for a workspace.
 */
export const getBankAccountsForWorkspace = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    return accounts.map((a) => ({ _id: a._id, name: a.name }));
  },
});

/**
 * Paginate through transactions for a bank account and return partial sums.
 * Each call gets its own 16MB read budget when invoked from an action.
 */
export const sumTransactionPage = internalQuery({
  args: {
    bankAccountId: v.id('bankAccount'),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { bankAccountId, cursor }) => {
    const result = await ctx.db
      .query('transaction')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .paginate({ numItems: PAGE_SIZE, cursor });

    let pendingSum = 0n;
    let clearedSum = 0n;

    for (const tx of result.page) {
      const txAmount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
      if (tx.status === 'pending') {
        pendingSum += txAmount;
      } else {
        clearedSum += txAmount;
      }
    }

    return {
      pendingSum,
      clearedSum,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Compare calculated vs stored balances and patch the bank account if needed.
 */
export const applyFix = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    calculatedPending: v.int64(),
    calculatedCleared: v.int64(),
  },
  handler: async (ctx, { bankAccountId, calculatedPending, calculatedCleared }) => {
    const account = await ctx.db.get(bankAccountId);
    if (!account || account.isDeleted) return { fixed: false };

    const storedPending = account.pendingBalance ?? 0n;
    const storedCleared = account.clearedBalance ?? 0n;

    if (calculatedPending !== storedPending || calculatedCleared !== storedCleared) {
      await ctx.db.patch(account._id, {
        pendingBalance: calculatedPending,
        clearedBalance: calculatedCleared,
      });
      return { fixed: true };
    }
    return { fixed: false };
  },
});

/**
 * Fix a single bank account by paginating through all its transactions
 * and accumulating pending/cleared totals, then applying the fix.
 */
export const fixSingleAccount = internalAction({
  args: { bankAccountId: v.id('bankAccount') },
  handler: async (ctx, { bankAccountId }): Promise<{ fixed: boolean }> => {
    let totalPending = 0n;
    let totalCleared = 0n;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const page: { pendingSum: bigint; clearedSum: bigint; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.validation.validators.bankAccountPendingCleared.sumTransactionPage, {
          bankAccountId,
          cursor,
        });
      totalPending += page.pendingSum;
      totalCleared += page.clearedSum;
      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    const result = await ctx.runMutation(internal.validation.validators.bankAccountPendingCleared.applyFix, {
      bankAccountId,
      calculatedPending: totalPending,
      calculatedCleared: totalCleared,
    });

    return result;
  },
});

/**
 * Fix bank account pending/cleared balance discrepancies for a workspace.
 * Orchestrates per-account fixes using paginated reads to avoid 16MB limits.
 */
export const fix = internalAction({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<{ fixed: number; errors: string[] }> => {
    const accounts = await ctx.runQuery(
      internal.validation.validators.bankAccountPendingCleared.getBankAccountsForWorkspace,
      { workspaceId }
    );

    let fixed = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const result = await ctx.runAction(internal.validation.validators.bankAccountPendingCleared.fixSingleAccount, {
          bankAccountId: account._id,
        });
        if (result.fixed) fixed++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix pending/cleared for account ${account.name}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
