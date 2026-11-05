import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { buildSystemActivityContextForWorkspace, recordTransactionActivity } from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import {
  buildTransactionComputedFields,
  getCreditCardCategoryForAccount,
  isCreditCardAccount,
} from '../transactions/helpers';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

type PlaidBalanceTransaction = {
  status: string;
  totalAmount?: bigint;
  movements?: ReadonlyArray<{ amount: bigint }>;
  transactionImportRawId?: Id<'transactionImportRaw'>;
  linkedRawTransactionId?: Id<'transactionImportRaw'>;
};

export function calculatePlaidOpeningBalances(
  transactions: ReadonlyArray<PlaidBalanceTransaction>,
  bankBalance: bigint,
  preserveUnmatchedLocal: boolean
) {
  let pendingTotal = 0n;
  let clearedTotal = 0n;
  let unmatchedLocalTotal = 0n;
  for (const transaction of transactions) {
    const amount =
      transaction.totalAmount ?? transaction.movements?.reduce((sum, movement) => sum + movement.amount, 0n) ?? 0n;
    if (transaction.status === 'pending') pendingTotal += amount;
    else clearedTotal += amount;
    if (transaction.transactionImportRawId === undefined && transaction.linkedRawTransactionId === undefined) {
      unmatchedLocalTotal += amount;
    }
  }
  const currentBalance = bankBalance + (preserveUnmatchedLocal ? unmatchedLocalTotal : 0n);
  const startingBalance = currentBalance - pendingTotal - clearedTotal;
  return {
    currentBalance,
    startingBalance,
    pendingBalance: pendingTotal,
    clearedBalance: startingBalance + clearedTotal,
  };
}

/**
 * Helper function to update account balance history for net worth tracking
 * Updates the monthlyBalances map directly on the bankAccount for a specific month
 * Stores the delta (balance change) for the month, not the running balance
 * The reports query calculates running balances from these deltas
 *
 * @param amountDelta - The amount being added to the balance (positive or negative)
 */
export async function updateAccountBalanceHistory(
  ctx: MutationCtx,
  bankAccountId: Id<'bankAccount'>,
  _workspaceId: Id<'workspace'>, // Kept for API compatibility, not used
  transactionDate: string, // ISO date (YYYY-MM-DD)
  amountDelta: bigint // The delta being applied to the balance
) {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount) return;

  const yearMonth = dateToYearMonth(transactionDate).toString();

  // Update monthlyBalances map - add delta to existing month value
  const monthlyBalances = { ...(bankAccount.monthlyBalances ?? {}) };
  const currentMonthDelta = monthlyBalances[yearMonth] ?? 0n;
  monthlyBalances[yearMonth] = currentMonthDelta + amountDelta;

  await ctx.db.patch(bankAccountId, { monthlyBalances });
}

/**
 * Helper function to update bank account balance
 * Updates the currentBalance field on a bank account by applying a delta
 * Also updates pendingBalance or clearedBalance based on transaction status
 * Optionally updates balance history for net worth tracking when transactionDate is provided
 *
 * @param status - Transaction status: 'pending' updates pendingBalance, 'cleared'/'reconciled' updates clearedBalance
 */
export async function updateBankAccountBalance(
  ctx: MutationCtx,
  bankAccountId: Id<'bankAccount'>,
  amountDelta: bigint,
  transactionDate?: string, // Optional: ISO date (YYYY-MM-DD) for balance history tracking
  status?: 'pending' | 'cleared' | 'reconciled' // Optional: transaction status for pending/cleared tracking
) {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount) {
    throw new ConvexError('Bank account not found');
  }

  const newBalance = bankAccount.currentBalance + amountDelta;

  // Build the patch object
  const patch: {
    currentBalance: bigint;
    pendingBalance?: bigint;
    clearedBalance?: bigint;
    updatedAt: string;
  } = {
    currentBalance: newBalance,
    updatedAt: new Date().toISOString(),
  };

  // Update pending or cleared balance based on status
  if (status === 'pending') {
    const currentPending = bankAccount.pendingBalance ?? 0n;
    patch.pendingBalance = currentPending + amountDelta;
  } else if (status === 'cleared' || status === 'reconciled') {
    const currentCleared = bankAccount.clearedBalance ?? 0n;
    patch.clearedBalance = currentCleared + amountDelta;
  }

  await ctx.db.patch(bankAccountId, patch);

  // Update balance history if transaction date is provided
  if (transactionDate) {
    await updateAccountBalanceHistory(ctx, bankAccountId, bankAccount.workspaceId, transactionDate, amountDelta);
  }
}

/**
 * Helper function to update bank account balance when transaction status changes
 * Moves amount from pending to cleared (or vice versa) without changing currentBalance
 *
 * @param amount - The transaction amount (positive value)
 * @param oldStatus - The previous transaction status
 * @param newStatus - The new transaction status
 */
export async function updateBankAccountBalanceForStatusChange(
  ctx: MutationCtx,
  bankAccountId: Id<'bankAccount'>,
  amount: bigint,
  oldStatus: 'pending' | 'cleared' | 'reconciled',
  newStatus: 'pending' | 'cleared' | 'reconciled'
) {
  // If status didn't change in a meaningful way for balance tracking, skip
  const oldIsPending = oldStatus === 'pending';
  const newIsPending = newStatus === 'pending';

  if (oldIsPending === newIsPending) {
    // Both are pending, or both are cleared/reconciled - no redistribution needed
    return;
  }

  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount) {
    throw new ConvexError('Bank account not found');
  }

  const currentPending = bankAccount.pendingBalance ?? 0n;
  const currentCleared = bankAccount.clearedBalance ?? 0n;

  if (oldIsPending && !newIsPending) {
    // Moving from pending to cleared: subtract from pending, add to cleared
    await ctx.db.patch(bankAccountId, {
      pendingBalance: currentPending - amount,
      clearedBalance: currentCleared + amount,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Moving from cleared to pending: subtract from cleared, add to pending
    await ctx.db.patch(bankAccountId, {
      pendingBalance: currentPending + amount,
      clearedBalance: currentCleared - amount,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Helper function to create or update a starting balance transaction
 * This is used both for manual account creation and Plaid-linked accounts
 *
 * For credit card accounts:
 * - Movement is categorized to the credit card category (not uncategorized)
 * - Updates category.creditMonthlySpending with priorBalance
 * - Does NOT affect RTA (credit card balances are debt, not available money)
 */
export async function createOrUpdateStartingBalanceTransaction(
  ctx: MutationCtx,
  args: {
    bankAccountId: Id<'bankAccount'>;
    workspaceId: Id<'workspace'>;
    amount: bigint;
    date: string; // ISO date string (YYYY-MM-DD)
    source?: 'manual' | 'automatic_import';
    activityContext?: ActivityContext;
  }
) {
  const { bankAccountId, workspaceId, amount, date, source = 'manual' } = args;

  // Check if this is a credit card or loan account
  const isCreditCard = await isCreditCardAccount(ctx, bankAccountId);
  const creditCardCategoryId = isCreditCard ? await getCreditCardCategoryForAccount(ctx, bankAccountId) : undefined;

  // Check if starting balance transaction already exists
  const existingStartingBalance = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
      q.eq('workspaceId', workspaceId).eq('bankAccountId', bankAccountId).eq('isDeleted', false)
    )
    .filter((q) => q.eq(q.field('type'), 'starting_balance'))
    .first();

  const timestamp = new Date().toISOString();
  const yearMonth = dateToYearMonth(date);

  if (existingStartingBalance) {
    // Get old amount for balance delta calculation
    const existingMovement = existingStartingBalance.movements?.[0];
    const oldAmount = existingMovement?.amount ?? 0n;
    const amountDelta = amount - oldAmount;

    // Snapshot before mutation
    const beforeSnapshot = await buildSnapshotFromTransaction(ctx, existingStartingBalance);

    const newReadyToAssign = !isCreditCard;

    // Build updated movements array
    const updatedMovements = [
      {
        categoryId: isCreditCard ? (creditCardCategoryId ?? undefined) : undefined,
        readyToAssign: newReadyToAssign,
        amount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    // Build computed fields for the transaction
    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId,
      transactionType: 'starting_balance',
      movements: updatedMovements,
    });

    // Update existing starting balance transaction with embedded movements
    await ctx.db.patch(existingStartingBalance._id, {
      date,
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
      updatedAt: timestamp,
    });

    // Snapshot after mutation and reconcile (RTA + CC prior balance)
    const updatedTransaction = await ctx.db.get(existingStartingBalance._id);
    if (updatedTransaction) {
      const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
      await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot, {
        skipBankAccountBalance: true,
      });
      if (args.activityContext && (amountDelta !== 0n || existingStartingBalance.date !== date)) {
        await recordTransactionActivity(ctx, {
          workspaceId,
          context: args.activityContext,
          type: 'transaction_updated',
          before: existingStartingBalance,
          after: updatedTransaction,
        });
      }
    }

    // Update balance history for net worth tracking (for both credit cards and regular accounts)
    if (amountDelta !== 0n) {
      await updateAccountBalanceHistory(ctx, bankAccountId, workspaceId, date, amountDelta);
    }

    // Update clearedBalance on the bank account (starting balance is always 'cleared')
    if (amountDelta !== 0n) {
      const bankAccount = await ctx.db.get(bankAccountId);
      if (bankAccount) {
        await ctx.db.patch(bankAccountId, {
          clearedBalance: (bankAccount.clearedBalance ?? 0n) + amountDelta,
          updatedAt: timestamp,
        });
      }
    }
  } else {
    // Build movements for the new starting balance transaction
    const newReadyToAssign = !isCreditCard;
    const movementsInput = [
      {
        categoryId: isCreditCard ? (creditCardCategoryId ?? undefined) : undefined,
        readyToAssign: newReadyToAssign,
        amount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    // Build computed fields for the transaction
    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId,
      transactionType: 'starting_balance',
      movements: movementsInput,
    });

    // Insert new starting balance transaction with embedded movements
    const newTransactionId = await ctx.db.insert('transaction', {
      bankAccountId,
      date,
      type: 'starting_balance',
      source,
      isDeleted: false,
      status: 'cleared',
      reviewStatus: 'reviewed',
      workspaceId,
      dateYearMonth: dateToYearMonth(date),
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
      updatedAt: timestamp,
    });

    // Reconcile side effects (RTA for regular accounts, CC prior balance for credit cards)
    const newTransaction = await ctx.db.get(newTransactionId);
    if (newTransaction) {
      const afterSnapshot = await buildSnapshotFromTransaction(ctx, newTransaction);
      await reconcileTransactionSideEffects(ctx, null, afterSnapshot, { skipBankAccountBalance: true });
      if (args.activityContext) {
        await recordTransactionActivity(ctx, {
          workspaceId,
          context: args.activityContext,
          type: 'transaction_created',
          after: newTransaction,
        });
      }
    }

    // Update balance history for net worth tracking (for both credit cards and regular accounts)
    if (amount !== 0n) {
      await updateAccountBalanceHistory(ctx, bankAccountId, workspaceId, date, amount);
    }

    // Initialize pendingBalance and set clearedBalance (starting balance is always 'cleared')
    const bankAccount = await ctx.db.get(bankAccountId);
    if (bankAccount) {
      await ctx.db.patch(bankAccountId, {
        pendingBalance: bankAccount.pendingBalance ?? 0n,
        clearedBalance: (bankAccount.clearedBalance ?? 0n) + amount,
        updatedAt: timestamp,
      });
    }
  }
}

/**
 * Internal mutation to update bank account balance (for use by other internal mutations)
 */
export const updateBalance = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    amountDelta: v.int64(),
    transactionDate: v.optional(v.string()),
  },
  handler: async (ctx, { bankAccountId, amountDelta, transactionDate }) => {
    await updateBankAccountBalance(ctx, bankAccountId, amountDelta, transactionDate);
  },
});

/**
 * Calculate and insert starting balance transactions for all bank accounts linked to a bank link
 * This is called after the first transaction import (when nextCursor was null)
 */
export const calculateAndInsertStartingBalances = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
    workspaceId: v.id('workspace'),
    initialBalanceDate: v.optional(v.string()), // ISO date string (YYYY-MM-DD) - passed from caller
    bankAccountId: v.optional(v.id('bankAccount')),
    currentBalance: v.optional(v.int64()),
  },
  returns: v.null(),
  handler: async (ctx, { bankLinkId, workspaceId, initialBalanceDate, bankAccountId, currentBalance }) => {
    const activityContext = await buildSystemActivityContextForWorkspace(ctx, workspaceId, 'bank_import');
    // Get the bank link to check for stored initialBalanceDate
    const bankLink = await ctx.db.get(bankLinkId);
    if (!bankLink) {
      throw new ConvexError('Bank link not found');
    }

    // Use provided initialBalanceDate, or fall back to bankLink.initialBalanceDate, or calculate from transactions
    const storedInitialBalanceDate = initialBalanceDate ?? bankLink.initialBalanceDate;

    // Get all bank link accounts for this bank link
    const bankLinkAccounts = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLinkId))
      .collect();

    for (const bankLinkAccount of bankLinkAccounts) {
      // Find the corresponding bank account
      const bankAccount = bankAccountId
        ? await ctx.db.get(bankAccountId)
        : await ctx.db
            .query('bankAccount')
            .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', bankLinkAccount._id))
            .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.eq(q.field('workspaceId'), workspaceId)))
            .first();

      if (
        !bankAccount ||
        bankAccount.isDeleted ||
        bankAccount.bankLinkAccountId !== bankLinkAccount._id ||
        bankAccount.workspaceId !== workspaceId ||
        (bankAccountId === undefined && bankAccount.plaidInitialSync !== undefined)
      ) {
        continue;
      }

      // Get all transactions for this bank account (exclude starting_balance type and deleted)
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
          q.eq('workspaceId', workspaceId).eq('bankAccountId', bankAccount._id).eq('isDeleted', false)
        )
        .filter((q) => q.neq(q.field('type'), 'starting_balance'))
        .collect();

      const balances = calculatePlaidOpeningBalances(
        transactions,
        currentBalance ?? bankAccount.currentBalance,
        currentBalance !== undefined
      );

      // Determine the date for the starting balance transaction
      let startingBalanceDate: string;
      if (storedInitialBalanceDate) {
        startingBalanceDate = storedInitialBalanceDate;
      } else if (transactions.length === 0) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startingBalanceDate = yesterday.toISOString().split('T')[0];
      } else {
        const earliestDate = transactions.reduce((earliest, t) => {
          return t.date < earliest ? t.date : earliest;
        }, transactions[0].date);

        const earliestDateObj = new Date(earliestDate);
        earliestDateObj.setDate(earliestDateObj.getDate() - 1);
        startingBalanceDate = earliestDateObj.toISOString().split('T')[0];
      }

      await createOrUpdateStartingBalanceTransaction(ctx, {
        bankAccountId: bankAccount._id,
        workspaceId,
        amount: balances.startingBalance,
        date: startingBalanceDate,
        source: 'automatic_import',
        activityContext,
      });

      // Starting balance is cleared; initialize both fields
      await ctx.db.patch(bankAccount._id, {
        ...(currentBalance !== undefined ? { currentBalance: balances.currentBalance } : {}),
        pendingBalance: balances.pendingBalance,
        clearedBalance: balances.clearedBalance,
        updatedAt: new Date().toISOString(),
      });
    }
    return null;
  },
});

/**
 * Sync bank account balances from bank link accounts
 * This is called after subsequent transaction syncs
 *
 * DEPRECATED: bankLinkAccount.currentBalance is deprecated.
 * Bank account balances should be calculated from transactions only.
 * This function is kept for backward compatibility but should not be used.
 */
export const syncBalancesFromBankLinkAccounts = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async () => {
    // DEPRECATED: This function should not be called
    // Bank account balances are now managed through transactions only
    console.warn('syncBalancesFromBankLinkAccounts is deprecated and should not be called');
    return;
  },
});

/**
 * Get the account type category from an account type
 * Categorizes account types into Banking, Credit, Investment, or Loan
 */
export function getAccountTypeCategory(accountType: string): 'Banking' | 'Credit' | 'Investment' | 'Loan' {
  if (accountType.startsWith('banking_')) return 'Banking';
  if (accountType.startsWith('credit_')) return 'Credit';
  if (accountType.startsWith('investment_')) return 'Investment';
  if (accountType.startsWith('loan_')) return 'Loan';
  return 'Banking'; // default fallback
}

/**
 * Apply saved ordering from workspace configuration to bank accounts
 * Returns accounts in the order specified by workspace.bankAccountOrdering
 * Accounts not in the saved order are appended at the end, sorted by updatedAt
 */
export function applySavedOrdering<T extends { _id: Id<'bankAccount'>; updatedAt?: string }>(
  accounts: T[],
  ordering: { groupOrder: string[]; accountOrderByGroup: Record<string, Id<'bankAccount'>[]> }
): T[] {
  const accountMap = new Map(accounts.map((acc) => [acc._id, acc]));
  const orderedAccounts: T[] = [];

  // Add accounts in saved order
  for (const groupKey of ordering.groupOrder) {
    const accountIds = ordering.accountOrderByGroup[groupKey] ?? [];
    for (const id of accountIds) {
      if (accountMap.has(id)) {
        orderedAccounts.push(accountMap.get(id)!);
        accountMap.delete(id);
      }
    }
  }

  // Add remaining accounts (newly created, not yet ordered) sorted by updatedAt
  const remainingAccounts = Array.from(accountMap.values()).sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
  });

  orderedAccounts.push(...remainingAccounts);
  return orderedAccounts;
}
