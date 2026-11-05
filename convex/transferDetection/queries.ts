import { v } from 'convex/values';

import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Transfer Detection Queries
 *
 * Queries for retrieving transactions with pending transfer suggestions.
 */

/**
 * Get all transactions with pending transfer suggestions.
 * Returns transactions where suggestedTransfer.status is 'pending' or 'linked_pending_approval'.
 */
export const getPendingTransferSuggestions = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Get all non-deleted transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Filter to only those with pending transfer suggestions
    const pendingTransfers = transactions.filter((txn) => {
      if (txn.isDeleted) return false;
      if (!txn.suggestedTransfer) return false;
      return txn.suggestedTransfer.status === 'pending' || txn.suggestedTransfer.status === 'linked_pending_approval';
    });

    // Sort by date descending (most recent first)
    pendingTransfers.sort((a, b) => b.date.localeCompare(a.date));

    // Enrich with bank account info
    const enrichedTransactions = await Promise.all(
      pendingTransfers.map(async (txn) => {
        const bankAccount = await ctx.db.get(txn.bankAccountId);
        const suggestedAccount = txn.suggestedTransfer?.suggestedCounterpartAccountId
          ? await ctx.db.get(txn.suggestedTransfer.suggestedCounterpartAccountId)
          : null;
        const matchedTransaction = txn.suggestedTransfer?.matchedTransactionId
          ? await ctx.db.get(txn.suggestedTransfer.matchedTransactionId)
          : null;

        return {
          ...txn,
          bankAccount: bankAccount
            ? {
                _id: bankAccount._id,
                name: bankAccount.name,
                accountType: bankAccount.accountType,
              }
            : null,
          suggestedCounterpartAccount: suggestedAccount
            ? {
                _id: suggestedAccount._id,
                name: suggestedAccount.name,
                accountType: suggestedAccount.accountType,
              }
            : null,
          matchedTransaction: matchedTransaction
            ? {
                _id: matchedTransaction._id,
                bankAccountId: matchedTransaction.bankAccountId,
                date: matchedTransaction.date,
                totalAmount: matchedTransaction.totalAmount,
              }
            : null,
        };
      })
    );

    return enrichedTransactions;
  },
});

/**
 * Get count of pending transfer suggestions.
 * Useful for showing a badge in the UI.
 */
export const getPendingTransferCount = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Get all non-deleted transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Count those with pending transfer suggestions
    const count = transactions.filter((txn) => {
      if (txn.isDeleted) return false;
      if (!txn.suggestedTransfer) return false;
      return txn.suggestedTransfer.status === 'pending' || txn.suggestedTransfer.status === 'linked_pending_approval';
    }).length;

    return count;
  },
});

/**
 * Get a single transaction with its transfer suggestion details.
 * Useful for the transfer approval UI.
 */
export const getTransferSuggestionDetails = query({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
      return null;
    }

    if (!transaction.suggestedTransfer) {
      return null;
    }

    // Get related data
    const bankAccount = await ctx.db.get(transaction.bankAccountId);

    const suggestedAccount = transaction.suggestedTransfer.suggestedCounterpartAccountId
      ? await ctx.db.get(transaction.suggestedTransfer.suggestedCounterpartAccountId)
      : null;

    const matchedTransaction = transaction.suggestedTransfer.matchedTransactionId
      ? await ctx.db.get(transaction.suggestedTransfer.matchedTransactionId)
      : null;

    // Get all bank accounts for account picker
    const allBankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    const availableAccounts = allBankAccounts
      .filter((acc) => !acc.isDeleted && !acc.isClosed && acc._id !== transaction.bankAccountId)
      .map((acc) => ({
        _id: acc._id,
        name: acc.name,
        accountType: acc.accountType,
      }));

    return {
      transaction: {
        _id: transaction._id,
        date: transaction.date,
        totalAmount: transaction.totalAmount,
        importDetails: transaction.importDetails,
        reviewStatus: transaction.reviewStatus,
        suggestedTransfer: transaction.suggestedTransfer,
      },
      bankAccount: bankAccount
        ? {
            _id: bankAccount._id,
            name: bankAccount.name,
            accountType: bankAccount.accountType,
          }
        : null,
      suggestedCounterpartAccount: suggestedAccount
        ? {
            _id: suggestedAccount._id,
            name: suggestedAccount.name,
            accountType: suggestedAccount.accountType,
          }
        : null,
      matchedTransaction: matchedTransaction
        ? {
            _id: matchedTransaction._id,
            bankAccountId: matchedTransaction.bankAccountId,
            date: matchedTransaction.date,
            totalAmount: matchedTransaction.totalAmount,
          }
        : null,
      availableAccounts,
    };
  },
});
