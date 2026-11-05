import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { applyCategoryChangeToTransaction } from '../transactions/helpers/categoryUpdate';

import { evaluateRule, reconcilePlannedLinkAfterRule } from './helpers';
import { actionsValidator, conditionsValidator, type Transaction } from './types';

export const updateRule = mutation({
  args: {
    id: v.id('transactionRule'),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    conditions: v.optional(conditionsValidator),
    actions: v.optional(actionsValidator),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { id, workspaceId, ...updates }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    const existing = await ctx.db.get(id);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new ConvexError('Rule not found or access denied');
    }

    // Validate between operator has valueTo if conditions are being updated
    if (updates.conditions?.amount) {
      for (const cond of updates.conditions.amount) {
        if (cond.operator === 'between' && cond.valueTo === undefined) {
          throw new ConvexError('Between operator requires valueTo value');
        }
      }
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const applyRuleToExisting = mutation({
  args: {
    id: v.id('transactionRule'),
    workspaceId: v.id('workspace'),
  },
  returns: v.number(),
  handler: async (ctx, { id, workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    const rule = await ctx.db.get(id);
    if (!rule || rule.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Rule not found or access denied');
    }

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const now = new Date().toISOString();
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });
    let appliedCount = 0;
    for (const transaction of transactions) {
      if (await evaluateRule(ctx, transaction, rule)) {
        const updates: Partial<Transaction> = {
          updatedAt: now,
        };

        // Handle merchantId change with stats updates
        if (rule.actions.setMerchantId !== undefined) {
          const newMerchantId = rule.actions.setMerchantId;
          const oldMerchantId = transaction.merchantId;
          const merchantChanged = oldMerchantId !== newMerchantId;

          // Skip manual merchant stats when a category change will also be applied,
          // because applyCategoryChangeToTransaction's reconciliation will handle
          // merchant stats automatically (it compares stale vs fresh snapshots).
          const willApplyCategory = rule.actions.setCategoryId !== undefined && transaction.movements?.length > 0;

          if (merchantChanged && !willApplyCategory) {
            const transactionAmount = transaction.totalAmount ?? 0n;

            // 1. Decrement stats from old merchant (if any)
            if (oldMerchantId) {
              await ctx.runMutation(internal.merchants.update.updateMerchantStatsForTransaction, {
                merchantId: oldMerchantId,
                transactionDate: transaction.date,
                transactionCountDelta: -1n,
                transactionAmount,
              });
            }

            // 2. Increment stats for new merchant
            await ctx.runMutation(internal.merchants.update.updateMerchantStatsForTransaction, {
              merchantId: newMerchantId,
              transactionDate: transaction.date,
              transactionCountDelta: 1n,
              transactionAmount,
            });
          }

          updates.merchantId = newMerchantId;
        }

        await ctx.db.patch(transaction._id, updates);

        // Handle categoryId by updating the first embedded movement
        if (rule.actions.setCategoryId !== undefined && transaction.movements?.length > 0) {
          await applyCategoryChangeToTransaction(ctx, {
            workspaceId: verifiedWorkspaceId,
            transactionId: transaction._id,
            transaction,
            newCategoryId: rule.actions.setCategoryId,
            movementIndex: 0,
          });
        } else {
          await reconcilePlannedLinkAfterRule(ctx, transaction);
        }

        const updatedTransaction = await ctx.db.get(transaction._id);
        if (updatedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context: activityContext,
            type: 'transaction_updated',
            before: transaction,
            after: updatedTransaction,
          });
        }

        appliedCount++;
      }
    }

    // Update rule usage stats
    if (appliedCount > 0) {
      await ctx.db.patch(id, {
        usageCount: (rule.usageCount ?? 0) + appliedCount,
        lastUsedAt: now,
        updatedAt: now,
      });
    }

    return appliedCount;
  },
});
