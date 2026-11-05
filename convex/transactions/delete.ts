import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { activityAttributionValidator } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

import {
  budgetChangeValidator,
  captureBudgetBalances,
  finishBudgetReceipt,
  transactionBudgetTargets,
} from './budgetReceipt';
import { buildSnapshotFromTransaction } from './reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from './reconciliation/reconcile';

/**
 * Delete a transaction (soft delete)
 */
export const deleteTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, { workspaceId, transactionId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get the transaction
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.isDeleted) {
      throw new ConvexError('Transaction not found');
    }

    // Get the bank account to check workspace access
    const bankAccount = await ctx.db.get(transaction.bankAccountId);
    if (!bankAccount || bankAccount.isDeleted) {
      throw new ConvexError('Bank account not found');
    }

    // Check if bank account belongs to the workspace
    if (bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Snapshot the main transaction BEFORE deletion
    const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

    // If this is a transfer, also delete the paired transaction
    if (transaction.type === 'transfer' && transaction.transferPairId) {
      const pairedTransaction = await ctx.db.get(transaction.transferPairId);
      if (pairedTransaction && !pairedTransaction.isDeleted) {
        // Snapshot paired transaction BEFORE deletion
        const pairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);

        // Soft delete the paired transaction
        await ctx.db.patch(pairedTransaction._id, {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Reconcile: reverse all side effects for paired transaction
        await reconcileTransactionSideEffects(ctx, pairedSnapshot, null);
      }
    }

    // Soft delete the main transaction
    await ctx.db.patch(transactionId, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Reconcile: reverse all side effects for main transaction
    await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);

    const deletedTransaction = await ctx.db.get(transactionId);
    if (deletedTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'transaction_deleted',
        before: transaction,
        after: deletedTransaction,
      });
    }

    return { success: true };
  },
});

/**
 * Restore an archived transaction
 */
export const restoreTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, { workspaceId, transactionId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    const transaction = await ctx.db.get(transactionId);
    if (!transaction) {
      throw new ConvexError('Transaction not found');
    }

    // Verify the transaction belongs to the workspace
    const bankAccount = await ctx.db.get(transaction.bankAccountId);
    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Transaction not found or does not belong to workspace');
    }

    // If this is a transfer, also restore the paired transaction
    if (transaction.type === 'transfer' && transaction.transferPairId) {
      const pairedTransaction = await ctx.db.get(transaction.transferPairId);
      if (pairedTransaction && pairedTransaction.isDeleted) {
        // Restore paired transaction first
        await ctx.db.patch(pairedTransaction._id, {
          isDeleted: false,
          deletedAt: undefined,
          updatedAt: new Date().toISOString(),
        });

        // Re-read and snapshot paired transaction AFTER restore
        const updatedPaired = await ctx.db.get(pairedTransaction._id);
        if (updatedPaired) {
          const pairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
          // Reconcile: reapply all side effects for paired transaction
          await reconcileTransactionSideEffects(ctx, null, pairedSnapshot);
        }
      }
    }

    // Restore the main transaction
    await ctx.db.patch(transactionId, {
      isDeleted: false,
      deletedAt: undefined,
      updatedAt: new Date().toISOString(),
    });

    // Re-read and snapshot main transaction AFTER restore
    const updatedTransaction = await ctx.db.get(transactionId);
    if (!updatedTransaction) {
      throw new ConvexError('Failed to read back restored transaction');
    }
    const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);

    // Reconcile: reapply all side effects for main transaction
    await reconcileTransactionSideEffects(ctx, null, afterSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_restored',
      before: transaction,
      after: updatedTransaction,
    });

    return { success: true };
  },
});

/**
 * Restore multiple transactions in a batch
 */
export const restoreTransactions = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
    includeBudgetChanges: v.optional(v.boolean()),
  },
  returns: v.object({ success: v.boolean(), budgetChanges: v.optional(v.array(budgetChangeValidator)) }),
  handler: async (ctx, { workspaceId, transactionIds, includeBudgetChanges }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const budgetBefore = includeBudgetChanges
      ? await captureBudgetBalances(
          ctx,
          verifiedWorkspaceId,
          await transactionBudgetTargets(ctx, verifiedWorkspaceId, transactionIds)
        )
      : undefined;
    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    for (const transactionId of transactionIds) {
      try {
        const transaction = await ctx.db.get(transactionId);
        if (!transaction) {
          continue;
        }

        // Verify the transaction belongs to the workspace
        const bankAccount = await ctx.db.get(transaction.bankAccountId);
        if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
          continue;
        }

        // Skip if not deleted
        if (!transaction.isDeleted) {
          continue;
        }

        // If this is a transfer, also restore the paired transaction
        if (transaction.type === 'transfer' && transaction.transferPairId) {
          const pairedTransaction = await ctx.db.get(transaction.transferPairId);
          if (pairedTransaction && pairedTransaction.isDeleted) {
            // Restore paired transaction first
            await ctx.db.patch(pairedTransaction._id, {
              isDeleted: false,
              deletedAt: undefined,
              updatedAt: new Date().toISOString(),
            });

            // Re-read and snapshot paired transaction AFTER restore
            const updatedPaired = await ctx.db.get(pairedTransaction._id);
            if (updatedPaired) {
              const pairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
              // Reconcile: reapply all side effects for paired transaction
              await reconcileTransactionSideEffects(ctx, null, pairedSnapshot);
            }
          }
        }

        // Restore main transaction
        await ctx.db.patch(transactionId, {
          isDeleted: false,
          deletedAt: undefined,
          updatedAt: new Date().toISOString(),
        });

        // Re-read and snapshot main transaction AFTER restore
        const updatedTransaction = await ctx.db.get(transactionId);
        if (!updatedTransaction) {
          continue;
        }
        const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);

        // Reconcile: reapply all side effects for main transaction
        await reconcileTransactionSideEffects(ctx, null, afterSnapshot);
        await recordTransactionActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context,
          type: 'transaction_restored',
          before: transaction,
          after: updatedTransaction,
        });
      } catch (error: unknown) {
        console.error('Failed to restore transaction batch atomically:', error);
        throw error;
      }
    }

    return {
      success: true,
      ...(budgetBefore ? { budgetChanges: await finishBudgetReceipt(ctx, verifiedWorkspaceId, budgetBefore) } : {}),
    };
  },
});

/**
 * Delete multiple transactions in a batch (soft delete)
 */
export const deleteTransactions = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
    includeBudgetChanges: v.optional(v.boolean()),
  },
  returns: v.object({ success: v.boolean(), budgetChanges: v.optional(v.array(budgetChangeValidator)) }),
  handler: async (ctx, { workspaceId, transactionIds, includeBudgetChanges }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const budgetBefore = includeBudgetChanges
      ? await captureBudgetBalances(
          ctx,
          verifiedWorkspaceId,
          await transactionBudgetTargets(ctx, verifiedWorkspaceId, transactionIds)
        )
      : undefined;
    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    for (const transactionId of transactionIds) {
      try {
        const transaction = await ctx.db.get(transactionId);
        if (!transaction || transaction.isDeleted) {
          continue;
        }

        // Verify the transaction belongs to the workspace
        const bankAccount = await ctx.db.get(transaction.bankAccountId);
        if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
          continue;
        }

        // Snapshot the main transaction BEFORE deletion
        const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

        // If this is a transfer, also delete the paired transaction
        if (transaction.type === 'transfer' && transaction.transferPairId) {
          const pairedTransaction = await ctx.db.get(transaction.transferPairId);
          if (pairedTransaction && !pairedTransaction.isDeleted) {
            const pairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);

            await ctx.db.patch(pairedTransaction._id, {
              isDeleted: true,
              deletedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });

            await reconcileTransactionSideEffects(ctx, pairedSnapshot, null);
          }
        }

        // Soft delete the main transaction
        await ctx.db.patch(transactionId, {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);
        const deletedTransaction = await ctx.db.get(transactionId);
        if (deletedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context,
            type: 'transaction_deleted',
            before: transaction,
            after: deletedTransaction,
          });
        }
      } catch (error: unknown) {
        console.error('Failed to delete transaction batch atomically:', error);
        throw error;
      }
    }

    return {
      success: true,
      ...(budgetBefore ? { budgetChanges: await finishBudgetReceipt(ctx, verifiedWorkspaceId, budgetBefore) } : {}),
    };
  },
});

/**
 * Internal mutation called from MCP tool dispatch (action-context callers can't use the
 * regular `deleteTransactions` mutation directly because Convex's auth lives at the action
 * boundary). Workspace ownership is verified by the caller; we only re-check per-transaction
 * to defend against stale ids. Returns which ids were actually deleted vs ignored so the agent
 * can give the user an accurate summary.
 */
export const softDeleteTransactionsForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { workspaceId, transactionIds, attribution }) => {
    const deleted: Id<'transaction'>[] = [];
    const notFound: string[] = [];
    const context = await buildActivityContext(ctx, attribution);

    for (const rawId of transactionIds) {
      const transaction = await ctx.db.get(rawId as Id<'transaction'>).catch(() => null);
      if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
        notFound.push(rawId);
        continue;
      }

      const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

      if (transaction.type === 'transfer' && transaction.transferPairId) {
        const paired = await ctx.db.get(transaction.transferPairId);
        if (paired && !paired.isDeleted) {
          const pairedSnapshot = await buildSnapshotFromTransaction(ctx, paired);
          await ctx.db.patch(paired._id, {
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          await reconcileTransactionSideEffects(ctx, pairedSnapshot, null);
        }
      }

      await ctx.db.patch(transaction._id, {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);
      const deletedTransaction = await ctx.db.get(transaction._id);
      if (deletedTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId,
          context,
          type: 'transaction_deleted',
          before: transaction,
          after: deletedTransaction,
        });
      }
      deleted.push(transaction._id);
    }

    return { deleted, notFound };
  },
});

/**
 * Internal mutation called from MCP tool dispatch for restoring soft-deleted transactions.
 * Mirrors `softDeleteTransactionsForMcp`: workspace ownership is verified per-row to defend
 * against stale ids; we report which ids were restored vs not found (or already active) so
 * the agent can give the user an accurate summary.
 */
export const restoreTransactionsForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { workspaceId, transactionIds, attribution }) => {
    const restored: Id<'transaction'>[] = [];
    const notFound: string[] = [];
    const context = await buildActivityContext(ctx, attribution);

    for (const rawId of transactionIds) {
      const transaction = await ctx.db.get(rawId as Id<'transaction'>).catch(() => null);
      if (!transaction || !transaction.isDeleted || transaction.workspaceId !== workspaceId) {
        notFound.push(rawId);
        continue;
      }

      if (transaction.type === 'transfer' && transaction.transferPairId) {
        const paired = await ctx.db.get(transaction.transferPairId);
        if (paired && paired.isDeleted) {
          await ctx.db.patch(paired._id, {
            isDeleted: false,
            deletedAt: undefined,
            updatedAt: new Date().toISOString(),
          });
          const updatedPaired = await ctx.db.get(paired._id);
          if (updatedPaired) {
            const pairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
            await reconcileTransactionSideEffects(ctx, null, pairedSnapshot);
          }
        }
      }

      await ctx.db.patch(transaction._id, {
        isDeleted: false,
        deletedAt: undefined,
        updatedAt: new Date().toISOString(),
      });
      const updatedMain = await ctx.db.get(transaction._id);
      if (updatedMain) {
        const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedMain);
        await reconcileTransactionSideEffects(ctx, null, afterSnapshot);
        await recordTransactionActivity(ctx, {
          workspaceId,
          context,
          type: 'transaction_restored',
          before: transaction,
          after: updatedMain,
        });
      }
      restored.push(transaction._id);
    }

    return { restored, notFound };
  },
});

/**
 * Permanently delete a transaction
 */
export const permanentlyDeleteTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, { workspaceId, transactionId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const transaction = await ctx.db.get(transactionId);
    if (!transaction) {
      throw new ConvexError('Transaction not found');
    }

    // Only allow permanent deletion of already soft-deleted transactions
    // (side effects were already reversed during soft-delete)
    if (!transaction.isDeleted) {
      throw new ConvexError('Transaction must be soft-deleted before permanent deletion');
    }

    // Verify the transaction belongs to the workspace
    const bankAccount = await ctx.db.get(transaction.bankAccountId);
    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Transaction not found or does not belong to workspace');
    }

    // If this is a transfer, also permanently delete the paired transaction
    if (transaction.type === 'transfer' && transaction.transferPairId) {
      const pairedTransaction = await ctx.db.get(transaction.transferPairId);
      if (pairedTransaction) {
        // Delete paired transaction (movements are embedded, no separate deletion needed)
        await ctx.db.delete(pairedTransaction._id);
      }
    }

    // Delete transaction (movements are embedded, no separate deletion needed)
    await ctx.db.delete(transactionId);

    return { success: true };
  },
});
