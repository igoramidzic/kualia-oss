import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import type { MovementTotalIssue, TransferPairIssue } from '../types';

/**
 * Validate that transaction totalAmount matches sum of movements
 * Also validates transfer pair integrity
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<(MovementTotalIssue | TransferPairIssue)[]> => {
    const issues: (MovementTotalIssue | TransferPairIssue)[] = [];

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const transaction of transactions) {
      const movements = transaction.movements ?? [];

      // Check movement sum matches totalAmount
      const movementSum = movements.reduce((sum, m) => sum + m.amount, 0n);

      if (transaction.totalAmount !== undefined && transaction.totalAmount !== movementSum) {
        issues.push({
          type: 'movement_total_mismatch',
          severity: 'error',
          description: `Transaction totalAmount (${transaction.totalAmount}) doesn't match movement sum (${movementSum})`,
          transactionId: transaction._id,
          storedTotal: transaction.totalAmount,
          calculatedSum: movementSum,
        });
      }

      // Check that movements exist
      if (movements.length === 0) {
        issues.push({
          type: 'transfer_pair_issue',
          severity: 'error',
          description: 'Transaction has no embedded movements',
          transactionId: transaction._id,
          issueType: 'missing_pair',
          details: 'Transaction has no embedded movements',
        });
      }

      // Check transfer pairs
      if (transaction.type === 'transfer') {
        if (!transaction.transferPairId) {
          issues.push({
            type: 'transfer_pair_issue',
            severity: 'error',
            description: 'Transfer transaction is missing transferPairId',
            transactionId: transaction._id,
            issueType: 'missing_pair',
            details: 'Transfer transaction is missing transferPairId',
          });
        } else {
          const pairTransaction = await ctx.db.get(transaction.transferPairId);

          if (!pairTransaction) {
            issues.push({
              type: 'transfer_pair_issue',
              severity: 'error',
              description: `Transfer pair ${transaction.transferPairId} does not exist`,
              transactionId: transaction._id,
              issueType: 'broken_pair',
              details: `Transfer pair ${transaction.transferPairId} does not exist`,
            });
          } else {
            // Check that amounts are opposite
            const pairMovementSum =
              pairTransaction.totalAmount ?? pairTransaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

            if (movementSum !== -pairMovementSum) {
              issues.push({
                type: 'transfer_pair_issue',
                severity: 'error',
                description: `Transfer pair amounts do not match: ${movementSum} and ${pairMovementSum} (should be opposite)`,
                transactionId: transaction._id,
                issueType: 'amount_mismatch',
                details: `Transfer pair amounts do not match: ${movementSum} and ${pairMovementSum}`,
              });
            }

            // Check that the pair points back to this transaction
            if (pairTransaction.transferPairId !== transaction._id) {
              issues.push({
                type: 'transfer_pair_issue',
                severity: 'error',
                description: 'Transfer pair does not point back to this transaction',
                transactionId: transaction._id,
                issueType: 'no_back_reference',
                details: 'Transfer pair does not point back to this transaction',
              });
            }
          }
        }
      }
    }

    return issues;
  },
});

/**
 * Fix movement total discrepancies by recalculating totalAmount from movements
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

    for (const transaction of transactions) {
      try {
        const movements = transaction.movements ?? [];
        const movementSum = movements.reduce((sum, m) => sum + m.amount, 0n);

        if (transaction.totalAmount !== movementSum) {
          await ctx.db.patch(transaction._id, {
            totalAmount: movementSum,
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
