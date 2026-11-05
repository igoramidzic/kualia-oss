import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { updateBankAccountBalance } from '../bankAccounts';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { buildTransactionComputedFields, validateTransferAccounts } from '../transactions/helpers';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';
import { isTransferEligibleAccountType, isValidManualTransferPlaceholder } from './findCounterpart';

/**
 * Transfer Detection Mutations
 *
 * Mutations for approving or rejecting transfer suggestions.
 */

type TransferSuggestion = NonNullable<Doc<'transaction'>['suggestedTransfer']>;

type TransferApprovalTransaction = Pick<
  Doc<'transaction'>,
  | '_id'
  | 'bankAccountId'
  | 'isDeleted'
  | 'suggestedTransfer'
  | 'totalAmount'
  | 'transferPairBankAccountId'
  | 'transferPairId'
  | 'type'
  | 'workspaceId'
>;

type TransferApprovalAccount = Pick<
  Doc<'bankAccount'>,
  '_id' | 'accountType' | 'isClosed' | 'isDeleted' | 'workspaceId'
>;

export function validateSingleTransferApprovalTransaction(
  transaction: TransferApprovalTransaction,
  hasCounterpartAccount: boolean
): TransferSuggestion {
  const suggestion = transaction.suggestedTransfer;
  if (!suggestion) {
    throw new ConvexError('Transaction has no transfer suggestion');
  }

  if (suggestion.status === 'linked_pending_approval') {
    throw new ConvexError('Use approveLinkedTransfer for linked transfers');
  }

  if (suggestion.status === 'pending') {
    if (
      transaction.type !== 'regular' ||
      transaction.transferPairId ||
      transaction.transferPairBankAccountId ||
      suggestion.matchedTransactionId
    ) {
      throw new ConvexError('Transfer suggestion is not an unlinked regular transaction');
    }
    return suggestion;
  }

  // Let a user finish a transfer that they previously approved without a
  // destination, while still rejecting every other terminal state.
  if (
    suggestion.status === 'approved_no_destination' &&
    hasCounterpartAccount &&
    transaction.type === 'transfer' &&
    !transaction.transferPairId &&
    !transaction.transferPairBankAccountId &&
    !suggestion.matchedTransactionId
  ) {
    return suggestion;
  }

  throw new ConvexError('Transfer suggestion is not pending');
}

export function validateTransferApprovalAccountEligibility(
  account: TransferApprovalAccount,
  role: 'source' | 'destination',
  requireOpen: boolean
): void {
  if (!isTransferEligibleAccountType(account.accountType)) {
    throw new ConvexError(
      role === 'destination'
        ? 'Transfers to Investment and Loan accounts are not yet supported'
        : 'Transfers from Investment and Loan accounts are not yet supported'
    );
  }
  if (requireOpen && account.isClosed) {
    throw new ConvexError('Destination account is closed');
  }
}

export function validateLinkedTransferApprovalPair(
  transaction: TransferApprovalTransaction,
  pairedTransaction: TransferApprovalTransaction,
  workspaceId: Id<'workspace'>
): { suggestion: TransferSuggestion; pairedSuggestion: TransferSuggestion } {
  if (
    transaction.isDeleted ||
    pairedTransaction.isDeleted ||
    transaction.workspaceId !== workspaceId ||
    pairedTransaction.workspaceId !== workspaceId
  ) {
    throw new ConvexError('Linked transfer transactions must belong to this workspace');
  }
  if (transaction._id === pairedTransaction._id) {
    throw new ConvexError('A transaction cannot be linked to itself');
  }
  if (transaction.bankAccountId === pairedTransaction.bankAccountId) {
    throw new ConvexError('Linked transfer transactions must use different accounts');
  }
  if (
    transaction.type !== 'regular' ||
    pairedTransaction.type !== 'regular' ||
    transaction.transferPairId ||
    pairedTransaction.transferPairId ||
    transaction.transferPairBankAccountId ||
    pairedTransaction.transferPairBankAccountId
  ) {
    throw new ConvexError('Linked transfer transactions must both be unpaired regular transactions');
  }
  if (transaction.totalAmount === 0n || transaction.totalAmount !== -pairedTransaction.totalAmount) {
    throw new ConvexError('Linked transfer transactions must have exact opposite non-zero amounts');
  }

  const suggestion = transaction.suggestedTransfer;
  const pairedSuggestion = pairedTransaction.suggestedTransfer;
  if (
    suggestion?.status !== 'linked_pending_approval' ||
    pairedSuggestion?.status !== 'linked_pending_approval' ||
    suggestion.matchedTransactionId !== pairedTransaction._id ||
    pairedSuggestion.matchedTransactionId !== transaction._id
  ) {
    throw new ConvexError('Linked transfer suggestions must reference each other');
  }
  if (
    (suggestion.suggestedCounterpartAccountId &&
      suggestion.suggestedCounterpartAccountId !== pairedTransaction.bankAccountId) ||
    (pairedSuggestion.suggestedCounterpartAccountId &&
      pairedSuggestion.suggestedCounterpartAccountId !== transaction.bankAccountId)
  ) {
    throw new ConvexError('Linked transfer suggestions reference the wrong accounts');
  }

  return { suggestion, pairedSuggestion };
}

export function canFinalizePendingTransferMatch(
  pendingMatch: Pick<Doc<'pendingTransferMatch'>, 'isDeleted' | 'status' | 'workspaceId'> | null,
  workspaceId: Id<'workspace'>,
  outcome: 'approved' | 'rejected'
): boolean {
  if (!pendingMatch || pendingMatch.isDeleted || pendingMatch.workspaceId !== workspaceId) {
    return false;
  }
  if (pendingMatch.status === 'awaiting_counterpart' || pendingMatch.status === 'matched') {
    return true;
  }
  return outcome === 'approved' && pendingMatch.status === 'user_approved_no_destination';
}

/**
 * Approve a transfer suggestion.
 *
 * For single-side imports (status = 'pending'):
 * - If counterpartAccountId provided: Creates paired transaction, links both, marks as approved
 * - If no counterpartAccountId: Marks as transfer, status='approved_no_destination'
 *
 * For linked imports (status = 'linked_pending_approval'):
 * - Use approveLinkedTransfer instead (this will throw an error)
 */
export const approveTransferSuggestion = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
    counterpartAccountId: v.optional(v.id('bankAccount')),
  },
  returns: v.object({ success: v.boolean(), transactionId: v.id('transaction') }),
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
      throw new ConvexError('Transaction not found');
    }

    const suggestedTransfer = validateSingleTransferApprovalTransaction(
      transaction,
      args.counterpartAccountId !== undefined
    );

    const now = new Date().toISOString();

    if (args.counterpartAccountId) {
      // Validate both account IDs against the authenticated workspace before
      // any writes, including a user-supplied destination account ID.
      await validateTransferAccounts(ctx, transaction.bankAccountId, args.counterpartAccountId, workspaceId);
      const [sourceAccount, counterpartAccount] = await Promise.all([
        ctx.db.get(transaction.bankAccountId),
        ctx.db.get(args.counterpartAccountId),
      ]);
      if (!sourceAccount || !counterpartAccount) {
        throw new ConvexError('Transfer account not found');
      }
      validateTransferApprovalAccountEligibility(sourceAccount, 'source', false);
      validateTransferApprovalAccountEligibility(counterpartAccount, 'destination', true);
      const eligibleAccountIds = new Set([sourceAccount._id.toString(), counterpartAccount._id.toString()]);

      // Dedup check: look for existing manual transfer placeholder on the same account
      // linked to the user-selected counterpart account. This prevents creating duplicate
      // transactions when a bank transfer arrives after the user already approved the first half.
      const existingManualTransfers = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) =>
          q.and(
            q.eq(q.field('bankAccountId'), transaction.bankAccountId),
            q.eq(q.field('type'), 'transfer'),
            q.eq(q.field('source'), 'manual'),
            q.eq(q.field('isDeleted'), false),
            q.neq(q.field('transferPairId'), undefined),
            q.eq(q.field('transferPairBankAccountId'), args.counterpartAccountId)
          )
        )
        .collect();

      // Filter for un-imported placeholders with matching amount and date (±7 days).
      // A candidate must also have an intact reciprocal pair before it is
      // allowed to absorb and soft-delete this imported transaction.
      const txnDate = new Date(transaction.date);
      const possiblePlaceholders = existingManualTransfers.filter((t) => {
        if (t.transactionImportRawId) return false;
        if (t.totalAmount !== transaction.totalAmount) return false;
        const tDate = new Date(t.date);
        const daysDiff = Math.abs(txnDate.getTime() - tDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysDiff <= 7;
      });
      let matchingPlaceholder: Doc<'transaction'> | undefined;
      for (const placeholder of possiblePlaceholders) {
        const placeholderPair = placeholder.transferPairId ? await ctx.db.get(placeholder.transferPairId) : null;
        if (isValidManualTransferPlaceholder(placeholder, placeholderPair, workspaceId, eligibleAccountIds)) {
          matchingPlaceholder = placeholder;
          break;
        }
      }

      if (matchingPlaceholder) {
        // Duplicate detected — merge C's import data into the existing placeholder (B),
        // then soft-delete C and reverse its side effects
        await ctx.db.patch(matchingPlaceholder._id, {
          transactionImportRawId: transaction.transactionImportRawId,
          importDetails: transaction.importDetails,
          updatedAt: now,
        });

        const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
        await ctx.db.patch(transaction._id, {
          isDeleted: true,
          deletedAt: now,
          suggestedTransfer: { ...suggestedTransfer, status: 'approved' },
          updatedAt: now,
        });
        await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);

        const [updatedPlaceholder, deletedTransaction] = await Promise.all([
          ctx.db.get(matchingPlaceholder._id),
          ctx.db.get(transaction._id),
        ]);
        if (updatedPlaceholder) {
          await recordTransactionActivity(ctx, {
            workspaceId,
            context: activityContext,
            type: 'transaction_updated',
            before: matchingPlaceholder,
            after: updatedPlaceholder,
          });
        }
        if (deletedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId,
            context: activityContext,
            type: 'transaction_deleted',
            before: transaction,
            after: deletedTransaction,
          });
        }

        await markPendingMatchAsApproved(ctx, transaction._id, workspaceId, now);

        return { success: true, transactionId: matchingPlaceholder._id };
      }

      // No duplicate found — proceed with creating new counterpart
      await createTransferPairFromSuggestion(ctx, {
        sourceTransaction: {
          ...transaction,
          suggestedTransfer,
        },
        counterpartAccountId: args.counterpartAccountId,
        workspaceId,
        timestamp: now,
      });
      const updatedTransaction = await ctx.db.get(transaction._id);
      if (updatedTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'transaction_updated',
          before: transaction,
          after: updatedTransaction,
        });
      }
    } else {
      const sourceAccount = await ctx.db.get(transaction.bankAccountId);
      if (!sourceAccount || sourceAccount.isDeleted || sourceAccount.workspaceId !== workspaceId) {
        throw new ConvexError('Source account not found');
      }
      validateTransferApprovalAccountEligibility(sourceAccount, 'source', false);

      // No destination selected - mark as approved without a pair. A later
      // explicit approval with an account can safely complete this transfer.
      const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
      const computedFields = await buildTransferComputedFieldsForTransaction(ctx, transaction);
      await ctx.db.patch(transaction._id, {
        type: 'transfer',
        merchantId: undefined,
        reviewStatus: 'reviewed',
        movements: computedFields.movements,
        searchText: computedFields.searchText,
        totalAmount: computedFields.totalAmount,
        hasUncategorized: computedFields.hasUncategorized,
        hasMissingPayee: computedFields.hasMissingPayee,
        suggestedTransfer: {
          ...suggestedTransfer,
          status: 'approved_no_destination',
        },
        updatedAt: now,
      });
      const updatedTransaction = await ctx.db.get(transaction._id);
      if (updatedTransaction) {
        const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
        await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot, {
          skipBankAccountBalance: true,
        });
        await recordTransactionActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'transaction_updated',
          before: transaction,
          after: updatedTransaction,
        });
      }

      // Update the pending match record if exists
      const pendingMatch = await ctx.db
        .query('pendingTransferMatch')
        .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', transaction._id))
        .first();

      if (
        pendingMatch &&
        !pendingMatch.isDeleted &&
        pendingMatch.workspaceId === workspaceId &&
        pendingMatch.status === 'awaiting_counterpart'
      ) {
        await ctx.db.patch(pendingMatch._id, {
          status: 'user_approved_no_destination',
          updatedAt: now,
        });
      }
    }

    return { success: true, transactionId: transaction._id };
  },
});

/**
 * Approve a linked transfer (when both sides are already imported).
 *
 * Marks this transaction as 'approved', reviewStatus='reviewed'.
 * CASCADE: Also marks paired transaction as 'cascade_approved', reviewStatus='reviewed'.
 * Both transactions are now fully approved with one action.
 */
export const approveLinkedTransfer = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
      throw new ConvexError('Transaction not found');
    }

    const initialSuggestion = transaction.suggestedTransfer;
    if (initialSuggestion?.status !== 'linked_pending_approval') {
      throw new ConvexError('Transfer is not linked pending approval');
    }

    if (!initialSuggestion.matchedTransactionId) {
      throw new ConvexError('No matched transaction found');
    }

    // Get the paired transaction
    const pairedTransaction = await ctx.db.get(initialSuggestion.matchedTransactionId);
    if (!pairedTransaction || pairedTransaction.isDeleted) {
      throw new ConvexError('Paired transaction not found');
    }

    const { suggestion, pairedSuggestion } = validateLinkedTransferApprovalPair(
      transaction,
      pairedTransaction,
      workspaceId
    );
    await validateTransferAccounts(ctx, transaction.bankAccountId, pairedTransaction.bankAccountId, workspaceId);
    const [sourceAccount, pairedAccount] = await Promise.all([
      ctx.db.get(transaction.bankAccountId),
      ctx.db.get(pairedTransaction.bankAccountId),
    ]);
    if (!sourceAccount || !pairedAccount) {
      throw new ConvexError('Transfer account not found');
    }
    validateTransferApprovalAccountEligibility(sourceAccount, 'source', false);
    validateTransferApprovalAccountEligibility(pairedAccount, 'destination', false);

    const now = new Date().toISOString();
    const [beforeSnapshot, pairedBeforeSnapshot] = await Promise.all([
      buildSnapshotFromTransaction(ctx, transaction),
      buildSnapshotFromTransaction(ctx, pairedTransaction),
    ]);
    const [computedFields, pairedComputedFields] = await Promise.all([
      buildTransferComputedFieldsForTransaction(ctx, transaction),
      buildTransferComputedFieldsForTransaction(ctx, pairedTransaction),
    ]);

    // Approve this transaction
    await ctx.db.patch(transaction._id, {
      type: 'transfer',
      merchantId: undefined,
      transferPairId: pairedTransaction._id,
      transferPairBankAccountId: pairedTransaction.bankAccountId,
      reviewStatus: 'reviewed',
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
      suggestedTransfer: {
        ...suggestion,
        status: 'approved',
      },
      updatedAt: now,
    });

    // CASCADE: Approve the paired transaction
    await ctx.db.patch(pairedTransaction._id, {
      type: 'transfer',
      merchantId: undefined,
      transferPairId: transaction._id,
      transferPairBankAccountId: transaction.bankAccountId,
      reviewStatus: 'reviewed',
      movements: pairedComputedFields.movements,
      searchText: pairedComputedFields.searchText,
      totalAmount: pairedComputedFields.totalAmount,
      hasUncategorized: pairedComputedFields.hasUncategorized,
      hasMissingPayee: pairedComputedFields.hasMissingPayee,
      suggestedTransfer: {
        ...pairedSuggestion,
        matchedTransactionId: transaction._id,
        status: 'cascade_approved',
      },
      updatedAt: now,
    });

    // Update pending match records for both transactions
    await markPendingMatchAsApproved(ctx, transaction._id, workspaceId, now);
    await markPendingMatchAsApproved(ctx, pairedTransaction._id, workspaceId, now);

    const [updatedTransaction, updatedPairedTransaction] = await Promise.all([
      ctx.db.get(transaction._id),
      ctx.db.get(pairedTransaction._id),
    ]);
    if (updatedTransaction && updatedPairedTransaction) {
      const [afterSnapshot, pairedAfterSnapshot] = await Promise.all([
        buildSnapshotFromTransaction(ctx, updatedTransaction),
        buildSnapshotFromTransaction(ctx, updatedPairedTransaction),
      ]);
      await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot, {
        skipBankAccountBalance: true,
      });
      await reconcileTransactionSideEffects(ctx, pairedBeforeSnapshot, pairedAfterSnapshot, {
        skipBankAccountBalance: true,
      });
    }

    if (updatedTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'transaction_updated',
        before: transaction,
        after: updatedTransaction,
      });
    }

    return { success: true };
  },
});

/**
 * Reject a transfer suggestion.
 *
 * Keeps as regular transaction, status='rejected'.
 * If linked pair exists: Unlink and mark other side as regular too.
 */
export const rejectTransferSuggestion = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
      throw new ConvexError('Transaction not found');
    }

    if (!transaction.suggestedTransfer) {
      throw new ConvexError('Transaction has no transfer suggestion');
    }
    if (
      transaction.suggestedTransfer.status !== 'pending' &&
      transaction.suggestedTransfer.status !== 'linked_pending_approval'
    ) {
      throw new ConvexError('Transfer suggestion is not actionable');
    }

    const now = new Date().toISOString();

    // Mark this transaction as rejected
    await ctx.db.patch(transaction._id, {
      suggestedTransfer: {
        ...transaction.suggestedTransfer,
        matchedTransactionId: undefined,
        status: 'rejected',
      },
      updatedAt: now,
    });

    // If there's a linked pair, unlink and mark it as regular too
    if (
      transaction.suggestedTransfer.status === 'linked_pending_approval' &&
      transaction.suggestedTransfer.matchedTransactionId
    ) {
      const pairedTransaction = await ctx.db.get(transaction.suggestedTransfer.matchedTransactionId);
      if (
        pairedTransaction &&
        !pairedTransaction.isDeleted &&
        pairedTransaction.workspaceId === workspaceId &&
        pairedTransaction.suggestedTransfer?.status === 'linked_pending_approval' &&
        pairedTransaction.suggestedTransfer.matchedTransactionId === transaction._id
      ) {
        // Mark paired transaction as rejected too
        await ctx.db.patch(pairedTransaction._id, {
          suggestedTransfer: {
            ...pairedTransaction.suggestedTransfer,
            matchedTransactionId: undefined,
            status: 'rejected',
          },
          updatedAt: now,
        });

        // Update pending match for paired transaction
        await markPendingMatchAsRejected(ctx, pairedTransaction._id, workspaceId, now);
      }
    }

    // Update pending match record
    await markPendingMatchAsRejected(ctx, transaction._id, workspaceId, now);

    return { success: true };
  },
});

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function buildTransferComputedFieldsForTransaction(ctx: MutationCtx, transaction: Doc<'transaction'>) {
  return buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: transaction.bankAccountId,
    transactionType: 'transfer',
    movements: [
      {
        categoryId: undefined,
        readyToAssign: false,
        amount: transaction.totalAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ],
    notes: transaction.notes,
  });
}

/**
 * Create a transfer pair from a single-side suggestion.
 * Converts the source transaction to a transfer and creates the paired transaction.
 */
async function createTransferPairFromSuggestion(
  ctx: MutationCtx,
  args: {
    sourceTransaction: Doc<'transaction'> & {
      suggestedTransfer: NonNullable<Doc<'transaction'>['suggestedTransfer']>;
    };
    counterpartAccountId: Id<'bankAccount'>;
    workspaceId: Id<'workspace'>;
    timestamp: string;
  }
): Promise<{
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
}> {
  const { sourceTransaction, counterpartAccountId, workspaceId, timestamp } = args;
  const sourceBeforeSnapshot = await buildSnapshotFromTransaction(ctx, sourceTransaction);

  // Validate that source and counterpart are different accounts
  if (sourceTransaction.bankAccountId === counterpartAccountId) {
    throw new ConvexError('Cannot transfer to the same account');
  }

  // Determine transfer direction based on amount sign
  const amount = sourceTransaction.totalAmount;
  const isOutflow = amount < 0n;
  const transferAmount = isOutflow ? -amount : amount;

  // Determine from/to accounts based on direction
  const fromAccountId = isOutflow ? sourceTransaction.bankAccountId : counterpartAccountId;
  const toAccountId = isOutflow ? counterpartAccountId : sourceTransaction.bankAccountId;

  // Build embedded movements for both transactions
  const fromMovementsInput = [
    {
      categoryId: undefined,
      readyToAssign: false,
      amount: -transferAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  const toMovementsInput = [
    {
      categoryId: undefined,
      readyToAssign: false,
      amount: transferAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  // Build computed fields
  const fromComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: fromAccountId,
    transactionType: 'transfer',
    movements: fromMovementsInput,
    notes: sourceTransaction.notes,
  });

  const toComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: toAccountId,
    transactionType: 'transfer',
    movements: toMovementsInput,
    notes: sourceTransaction.notes,
  });

  // Determine which transaction is the source
  const sourceIsFrom = sourceTransaction.bankAccountId === fromAccountId;

  if (sourceIsFrom) {
    // Source transaction is the "from" side - update it
    await ctx.db.patch(sourceTransaction._id, {
      type: 'transfer',
      merchantId: undefined,
      reviewStatus: 'reviewed',
      movements: fromComputedFields.movements,
      searchText: fromComputedFields.searchText,
      totalAmount: fromComputedFields.totalAmount,
      hasUncategorized: fromComputedFields.hasUncategorized,
      hasMissingPayee: fromComputedFields.hasMissingPayee,
      suggestedTransfer: {
        ...sourceTransaction.suggestedTransfer,
        suggestedCounterpartAccountId: counterpartAccountId,
        status: 'approved',
      },
      updatedAt: timestamp,
    });

    // Create the "to" transaction
    const toTransactionId = await ctx.db.insert('transaction', {
      bankAccountId: toAccountId,
      type: 'transfer',
      date: sourceTransaction.date,
      workspaceId,
      notes: sourceTransaction.notes,
      merchantId: undefined,
      isDeleted: false,
      status: sourceTransaction.status,
      source: 'manual',
      reviewStatus: 'reviewed',
      dateYearMonth: dateToYearMonth(sourceTransaction.date),
      movements: toComputedFields.movements,
      searchText: toComputedFields.searchText,
      totalAmount: toComputedFields.totalAmount,
      hasUncategorized: toComputedFields.hasUncategorized,
      hasMissingPayee: toComputedFields.hasMissingPayee,
      updatedAt: timestamp,
    });

    // Link them together
    await ctx.db.patch(sourceTransaction._id, {
      transferPairId: toTransactionId,
      transferPairBankAccountId: toAccountId,
    });
    await ctx.db.patch(toTransactionId, {
      transferPairId: sourceTransaction._id,
      transferPairBankAccountId: fromAccountId,
    });

    // Update bank account balances
    await updateBankAccountBalance(ctx, toAccountId, transferAmount, sourceTransaction.date, sourceTransaction.status);

    const [updatedSourceTransaction, createdToTransaction] = await Promise.all([
      ctx.db.get(sourceTransaction._id),
      ctx.db.get(toTransactionId),
    ]);
    if (updatedSourceTransaction && createdToTransaction) {
      const [sourceAfterSnapshot, toAfterSnapshot] = await Promise.all([
        buildSnapshotFromTransaction(ctx, updatedSourceTransaction),
        buildSnapshotFromTransaction(ctx, createdToTransaction),
      ]);
      await reconcileTransactionSideEffects(ctx, sourceBeforeSnapshot, sourceAfterSnapshot, {
        skipBankAccountBalance: true,
      });
      await reconcileTransactionSideEffects(ctx, null, toAfterSnapshot, {
        skipBankAccountBalance: true,
      });
    }

    // Update pending match record
    await markPendingMatchAsApproved(ctx, sourceTransaction._id, workspaceId, timestamp);

    return { fromTransactionId: sourceTransaction._id, toTransactionId };
  } else {
    // Source transaction is the "to" side - update it
    await ctx.db.patch(sourceTransaction._id, {
      type: 'transfer',
      merchantId: undefined,
      reviewStatus: 'reviewed',
      movements: toComputedFields.movements,
      searchText: toComputedFields.searchText,
      totalAmount: toComputedFields.totalAmount,
      hasUncategorized: toComputedFields.hasUncategorized,
      hasMissingPayee: toComputedFields.hasMissingPayee,
      suggestedTransfer: {
        ...sourceTransaction.suggestedTransfer,
        suggestedCounterpartAccountId: counterpartAccountId,
        status: 'approved',
      },
      updatedAt: timestamp,
    });

    // Create the "from" transaction
    const fromTransactionId = await ctx.db.insert('transaction', {
      bankAccountId: fromAccountId,
      type: 'transfer',
      date: sourceTransaction.date,
      workspaceId,
      notes: sourceTransaction.notes,
      merchantId: undefined,
      isDeleted: false,
      status: sourceTransaction.status,
      source: 'manual',
      reviewStatus: 'reviewed',
      dateYearMonth: dateToYearMonth(sourceTransaction.date),
      movements: fromComputedFields.movements,
      searchText: fromComputedFields.searchText,
      totalAmount: fromComputedFields.totalAmount,
      hasUncategorized: fromComputedFields.hasUncategorized,
      hasMissingPayee: fromComputedFields.hasMissingPayee,
      updatedAt: timestamp,
    });

    // Link them together
    await ctx.db.patch(sourceTransaction._id, {
      transferPairId: fromTransactionId,
      transferPairBankAccountId: fromAccountId,
    });
    await ctx.db.patch(fromTransactionId, {
      transferPairId: sourceTransaction._id,
      transferPairBankAccountId: toAccountId,
    });

    // Update bank account balances
    await updateBankAccountBalance(
      ctx,
      fromAccountId,
      -transferAmount,
      sourceTransaction.date,
      sourceTransaction.status
    );

    const [updatedSourceTransaction, createdFromTransaction] = await Promise.all([
      ctx.db.get(sourceTransaction._id),
      ctx.db.get(fromTransactionId),
    ]);
    if (updatedSourceTransaction && createdFromTransaction) {
      const [sourceAfterSnapshot, fromAfterSnapshot] = await Promise.all([
        buildSnapshotFromTransaction(ctx, updatedSourceTransaction),
        buildSnapshotFromTransaction(ctx, createdFromTransaction),
      ]);
      await reconcileTransactionSideEffects(ctx, sourceBeforeSnapshot, sourceAfterSnapshot, {
        skipBankAccountBalance: true,
      });
      await reconcileTransactionSideEffects(ctx, null, fromAfterSnapshot, {
        skipBankAccountBalance: true,
      });
    }

    // Update pending match record
    await markPendingMatchAsApproved(ctx, sourceTransaction._id, workspaceId, timestamp);

    return { fromTransactionId, toTransactionId: sourceTransaction._id };
  }
}

/**
 * Mark a pending match record as approved.
 */
async function markPendingMatchAsApproved(
  ctx: MutationCtx,
  transactionId: Id<'transaction'>,
  workspaceId: Id<'workspace'>,
  timestamp: string
): Promise<void> {
  const pendingMatch = await ctx.db
    .query('pendingTransferMatch')
    .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', transactionId))
    .first();

  if (pendingMatch && canFinalizePendingTransferMatch(pendingMatch, workspaceId, 'approved')) {
    await ctx.db.patch(pendingMatch._id, {
      status: 'user_approved',
      updatedAt: timestamp,
    });
  }
}

/**
 * Mark a pending match record as rejected.
 */
async function markPendingMatchAsRejected(
  ctx: MutationCtx,
  transactionId: Id<'transaction'>,
  workspaceId: Id<'workspace'>,
  timestamp: string
): Promise<void> {
  const pendingMatch = await ctx.db
    .query('pendingTransferMatch')
    .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', transactionId))
    .first();

  if (pendingMatch && canFinalizePendingTransferMatch(pendingMatch, workspaceId, 'rejected')) {
    await ctx.db.patch(pendingMatch._id, {
      status: 'user_rejected',
      updatedAt: timestamp,
    });
  }
}
