import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import {
  buildActivityContext,
  insertActivityLog,
  recordCategoryActivity,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import {
  activityAttributionValidator,
  type ActivityAttribution,
  type MoneyMovementSnapshot,
} from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';
import { isRefundMovement, patchTransactionMovements } from '../transactions/helpers';
import type { EmbeddedMovement } from '../transactions/types';
import { aggregateSpendingDeltas } from './helpers';

/**
 * Restore an archived category
 */
export const restoreCategory = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    const category = await ctx.db.get(categoryId);
    if (!category || category.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    // Prevent restoring system categories
    if (category.isSystemCategory) {
      throw new ConvexError('Cannot restore system categories');
    }

    // Ensure group is not deleted
    const group = await ctx.db.get(category.categoryGroupId);
    if (group && group.isDeleted) {
      throw new ConvexError('Cannot restore a category when its group is deleted');
    }

    const timestamp = new Date().toISOString();

    await ctx.db.patch(categoryId, {
      isDeleted: false,
      deletedAt: undefined,
      updatedAt: timestamp,
    });

    const restoredCategory = await ctx.db.get(categoryId);
    if (restoredCategory) {
      await recordCategoryActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'category_restored',
        before: category,
        after: restoredCategory,
      });
    }

    return { success: true };
  },
});

/**
 * Permanently delete a category
 */
export const permanentlyDeleteCategory = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const category = await ctx.db.get(categoryId);
    if (!category || category.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    // Prevent permanently deleting system categories
    if (category.isSystemCategory) {
      throw new ConvexError('Cannot permanently delete system categories');
    }

    // Prevent permanently deleting credit card categories
    if (category.categoryType === 'credit_card') {
      throw new ConvexError('Cannot permanently delete credit card categories');
    }

    await ctx.db.delete(categoryId);

    return { success: true };
  },
});

/**
 * Delete multiple categories with optional transaction recategorization.
 * Shared implementation behind the public `deleteCategoriesWithRecategorization`
 * mutation (UI) and the `deleteCategoriesForMcp` internal mutation (MCP/chat).
 * Assumes `workspaceId` has already been resolved and authorized by the caller.
 */
export async function deleteCategoriesWithRecategorizationImpl(
  ctx: MutationCtx,
  {
    workspaceId: verifiedWorkspaceId,
    categoryIds,
    newCategoryId,
    attribution,
  }: {
    workspaceId: Id<'workspace'>;
    categoryIds: Id<'category'>[];
    newCategoryId?: Id<'category'>;
    attribution: ActivityAttribution;
  }
) {
  const timestamp = new Date().toISOString();

  // 1. Validate all categories exist and belong to workspace
  const categories = await Promise.all(categoryIds.map((id) => ctx.db.get(id)));

  for (const category of categories) {
    if (!category || category.workspaceId !== verifiedWorkspaceId || category.isDeleted) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }
    if (category.isSystemCategory) {
      throw new ConvexError('Cannot delete system categories');
    }
    if (category.categoryType === 'credit_card') {
      throw new ConvexError('Cannot delete credit card categories');
    }
  }

  // 2. Validate transaction counts - if any category has transactions, newCategoryId is required
  // transactionCount is now stored directly on category (no separate categorySpending table)
  for (const category of categories) {
    if (!category) continue;
    const transactionCount = category.transactionCount ?? 0n;

    if (transactionCount > 0n && !newCategoryId) {
      throw new ConvexError(
        'One or more categories have transactions assigned. Please provide a category to move transactions to.'
      );
    }
  }

  // 3. If recategorizing, validate new category
  if (newCategoryId) {
    const newCategory = await ctx.db.get(newCategoryId);
    if (!newCategory || newCategory.workspaceId !== verifiedWorkspaceId || newCategory.isDeleted) {
      throw new ConvexError('New category not found or does not belong to workspace');
    }
    if (categoryIds.includes(newCategoryId)) {
      throw new ConvexError('Cannot recategorize to a category being deleted');
    }
  }
  const context = await buildActivityContext(ctx, attribution);

  // 4. Fetch all transactions with movements containing these categories
  const transactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const transactionsToUpdate = transactions.filter((t) =>
    t.movements?.some((m) => categoryIds.includes(m.categoryId as (typeof categoryIds)[number]))
  );

  // 4a. For very large deletions, delegate to async processing
  const ASYNC_THRESHOLD = 500;
  if (transactionsToUpdate.length > ASYNC_THRESHOLD) {
    await ctx.scheduler.runAfter(0, internal.categories.processLargeCategoryDeletion, {
      workspaceId: verifiedWorkspaceId,
      categoryIds,
      newCategoryId,
      transactionIds: transactionsToUpdate.map((t) => t._id),
      attribution,
    });

    return {
      success: true,
      isAsync: true,
      deletedCount: categoryIds.length,
      transactionCount: transactionsToUpdate.length,
      message: `Deletion is being processed in the background (${transactionsToUpdate.length} transactions)`,
    };
  }

  // 5. Aggregate spending deltas upfront (for regular movements only)
  // Credit card movements will be handled separately with existing mutations
  const spendingDeltas = aggregateSpendingDeltas(transactionsToUpdate, categoryIds, newCategoryId);

  // 6. Update transactions and spending records
  let movedTransactionCount = 0;

  if (newCategoryId) {
    // Recategorize to new category
    await Promise.all(
      transactionsToUpdate.map(async (txn) => {
        // Only handle credit card transfers here - regular spending is batched
        const creditCardMutations: Array<Promise<unknown>> = [];

        for (const movement of txn.movements) {
          // Check if this movement's category needs to be changed
          if (movement.categoryId && categoryIds.includes(movement.categoryId as (typeof categoryIds)[number])) {
            // Handle credit card transfers (complex logic, keep as separate mutations)
            if (movement.creditCardTransfer) {
              // Detect if this was a refund transaction
              const isRefund = isRefundMovement(movement, txn.type === 'transfer');

              // Reverse the old credit card transfer (collect, don't await)
              creditCardMutations.push(
                ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
                  workspaceId: verifiedWorkspaceId,
                  fromCategoryId: movement.creditCardTransfer.creditCardCategoryId,
                  toCategoryId: movement.creditCardTransfer.spendingCategoryId,
                  amount: movement.amount,
                  transactionDate: txn.date,
                  isRefund,
                })
              );

              // Create new credit card transfer with new category (collect, don't await)
              creditCardMutations.push(
                ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
                  workspaceId: verifiedWorkspaceId,
                  fromCategoryId: newCategoryId,
                  toCategoryId: movement.creditCardTransfer.creditCardCategoryId,
                  amount: movement.amount,
                  transactionDate: txn.date,
                  isRefund,
                })
              );
            }
            // Regular spending is handled by batch update below - skip here
          }
        }

        // Execute all credit card mutations in parallel
        await Promise.all(creditCardMutations);

        // Now update the movements with new categoryId and creditCardTransfer metadata
        const updatedMovements = txn.movements.map((m) => {
          if (categoryIds.includes(m.categoryId as (typeof categoryIds)[number])) {
            movedTransactionCount++;
            // If this is a credit card transfer, update the metadata
            if (m.creditCardTransfer) {
              return {
                ...m,
                categoryId: newCategoryId,
                creditCardTransfer: {
                  ...m.creditCardTransfer,
                  spendingCategoryId: newCategoryId,
                },
              };
            }
            return { ...m, categoryId: newCategoryId };
          }
          return m;
        });

        // Use helper to patch movements - ensures searchText and categoryName are updated
        await patchTransactionMovements(ctx, txn._id, txn, updatedMovements);
        const updatedTransaction = await ctx.db.get(txn._id);
        if (updatedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context,
            type: 'transaction_updated',
            before: txn,
            after: updatedTransaction,
          });
        }
      })
    );
  } else {
    // Clear category (set to uncategorized)
    await Promise.all(
      transactionsToUpdate.map(async (txn) => {
        const updatedMovements = txn.movements.map((m) => {
          if (categoryIds.includes(m.categoryId as (typeof categoryIds)[number])) {
            return { ...m, categoryId: undefined };
          }
          return m;
        });

        // Use helper to patch movements - ensures searchText and categoryName are updated
        await patchTransactionMovements(ctx, txn._id, txn, updatedMovements);
        const updatedTransaction = await ctx.db.get(txn._id);
        if (updatedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context,
            type: 'transaction_updated',
            before: txn,
            after: updatedTransaction,
          });
        }

        // Only handle credit card transfers here - regular spending is batched
        const creditCardMutations: Array<Promise<unknown>> = [];

        for (const oldMovement of txn.movements) {
          if (oldMovement.categoryId && categoryIds.includes(oldMovement.categoryId as (typeof categoryIds)[number])) {
            // Handle credit card transfers (complex logic, keep as separate mutations)
            if (oldMovement.creditCardTransfer) {
              // Reverse the credit card transfer (collect, don't await)
              creditCardMutations.push(
                ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
                  workspaceId: verifiedWorkspaceId,
                  fromCategoryId: oldMovement.creditCardTransfer.creditCardCategoryId,
                  toCategoryId: oldMovement.creditCardTransfer.spendingCategoryId,
                  amount: oldMovement.amount,
                  transactionDate: txn.date,
                  isRefund: false,
                })
              );
            }
            // Regular spending is handled by batch update below - skip here
          }
        }

        // Execute all credit card mutations in parallel
        await Promise.all(creditCardMutations);
      })
    );
  }

  // 7. Batch update all regular spending records (non-credit-card movements)
  if (spendingDeltas.size > 0) {
    await ctx.runMutation(internal.categoryBudgets.batchUpdateCategorySpendingForDelete, {
      workspaceId: verifiedWorkspaceId,
      spendingDeltas: Array.from(spendingDeltas.values()),
    });
  }

  // 8. Delete categoryBudget rows and release assigned funds back to ReadyToAssign
  // Fetch all categoryBudget rows for the categories being deleted
  const categoryBudgets = await Promise.all(
    categoryIds.map((categoryId) =>
      ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId_categoryId', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('categoryId', categoryId)
        )
        .first()
    )
  );

  // Calculate assigned amounts per month across all categories
  const monthlyAssignedAmounts: Record<string, bigint> = {};
  const releasedMovementsByMonth = new Map<number, MoneyMovementSnapshot[]>();
  const budgetDeletions: Array<Promise<unknown>> = [];

  for (let index = 0; index < categoryBudgets.length; index++) {
    const budget = categoryBudgets[index];
    const category = categories[index];
    if (budget) {
      // Collect assigned amounts by month
      const budgetMonthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      for (const [yearMonthStr, amount] of Object.entries(budgetMonthlyAmounts)) {
        monthlyAssignedAmounts[yearMonthStr] = (monthlyAssignedAmounts[yearMonthStr] ?? 0n) + amount;
        if (amount !== 0n && category) {
          const yearMonth = parseInt(yearMonthStr, 10);
          const movements = releasedMovementsByMonth.get(yearMonth) ?? [];
          movements.push(
            amount > 0n
              ? {
                  amount,
                  from: { type: 'category', category: { id: category._id, name: category.name } },
                  to: { type: 'ready_to_assign' },
                }
              : {
                  amount: -amount,
                  from: { type: 'ready_to_assign' },
                  to: { type: 'category', category: { id: category._id, name: category.name } },
                }
          );
          releasedMovementsByMonth.set(yearMonth, movements);
        }
      }

      // Delete the categoryBudget row
      budgetDeletions.push(ctx.db.delete(budget._id));
    }
  }

  // Delete all categoryBudget rows in parallel
  await Promise.all(budgetDeletions);

  // Release assigned funds back to ReadyToAssign for each month
  for (const [yearMonthStr, amount] of Object.entries(monthlyAssignedAmounts)) {
    if (amount !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId: verifiedWorkspaceId,
        amountDelta: amount, // Positive delta adds back to readyToAssign
        yearMonth: parseInt(yearMonthStr, 10),
      });
    }
  }
  for (const [yearMonth, movements] of releasedMovementsByMonth) {
    await insertActivityLog(ctx, {
      workspaceId: verifiedWorkspaceId,
      context,
      type: 'money_moved',
      entityType: 'budget_assignment',
      entityId: verifiedWorkspaceId,
      details: { kind: 'money_movement', yearMonth, movements },
    });
  }

  // 9. Soft delete all categories
  // Note: monthlySpending and transactionCount are now stored directly on category,
  // so they will be retained for historical data but category is marked as deleted
  await Promise.all(
    categoryIds.map((id) =>
      ctx.db.patch(id, {
        isDeleted: true,
        deletedAt: timestamp,
        updatedAt: timestamp,
      })
    )
  );

  for (const category of categories) {
    if (!category) {
      continue;
    }
    const deletedCategory = await ctx.db.get(category._id);
    if (deletedCategory) {
      await recordCategoryActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context,
        type: 'category_deleted',
        before: category,
        after: deletedCategory,
      });
    }
  }

  return {
    success: true,
    deletedCount: categoryIds.length,
    movedTransactionCount,
  };
}

export const deleteCategoriesWithRecategorization = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    newCategoryId: v.optional(v.id('category')),
  },
  handler: async (ctx, { workspaceId, categoryIds, newCategoryId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return deleteCategoriesWithRecategorizationImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryIds,
      newCategoryId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId (already
 * resolved and authorized by the MCP handler). Same recategorization + delete
 * behavior as {@link deleteCategoriesWithRecategorization}.
 */
export const deleteCategoriesForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    newCategoryId: v.optional(v.id('category')),
    attribution: activityAttributionValidator,
  },
  handler: (ctx, args) => deleteCategoriesWithRecategorizationImpl(ctx, args),
});

/**
 * Internal mutation for processing large category deletions asynchronously
 * Processes transactions in chunks to avoid timeout
 */
export const processLargeCategoryDeletion = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    newCategoryId: v.optional(v.id('category')),
    transactionIds: v.array(v.id('transaction')),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { workspaceId, categoryIds, newCategoryId, transactionIds, attribution }) => {
    const timestamp = new Date().toISOString();
    const CHUNK_SIZE = 100; // Process 100 transactions at a time
    const categories = await Promise.all(categoryIds.map((categoryId) => ctx.db.get(categoryId)));
    const context = await buildActivityContext(ctx, attribution);

    // Process transactions in chunks
    for (let i = 0; i < transactionIds.length; i += CHUNK_SIZE) {
      const chunkIds = transactionIds.slice(i, i + CHUNK_SIZE);

      // Fetch transactions for this chunk
      const transactions = await Promise.all(chunkIds.map((id) => ctx.db.get(id)));
      const validTransactions = transactions.filter((t): t is NonNullable<typeof t> => t !== null);

      // Aggregate spending deltas for this chunk
      const spendingDeltas = aggregateSpendingDeltas(validTransactions, categoryIds, newCategoryId);

      // Process transactions (same optimized logic as main function)
      if (newCategoryId) {
        // Recategorize to new category
        await Promise.all(
          validTransactions.map(async (txn) => {
            // Only handle credit card transfers here - regular spending is batched
            const creditCardMutations: Array<Promise<unknown>> = [];

            for (const movement of txn.movements) {
              if (movement.categoryId && categoryIds.includes(movement.categoryId as (typeof categoryIds)[number])) {
                if (movement.creditCardTransfer) {
                  // Detect if this was a refund transaction
                  const isRefund = isRefundMovement(movement, txn.type === 'transfer');

                  creditCardMutations.push(
                    ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
                      workspaceId,
                      fromCategoryId: movement.creditCardTransfer.creditCardCategoryId,
                      toCategoryId: movement.creditCardTransfer.spendingCategoryId,
                      amount: movement.amount,
                      transactionDate: txn.date,
                      isRefund,
                    })
                  );

                  creditCardMutations.push(
                    ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
                      workspaceId,
                      fromCategoryId: newCategoryId,
                      toCategoryId: movement.creditCardTransfer.creditCardCategoryId,
                      amount: movement.amount,
                      transactionDate: txn.date,
                      isRefund,
                    })
                  );
                }
              }
            }

            await Promise.all(creditCardMutations);

            // Update the movements
            const updatedMovements = txn.movements.map((m: EmbeddedMovement) => {
              if (categoryIds.includes(m.categoryId as (typeof categoryIds)[number])) {
                if (m.creditCardTransfer) {
                  return {
                    ...m,
                    categoryId: newCategoryId,
                    creditCardTransfer: {
                      ...m.creditCardTransfer,
                      spendingCategoryId: newCategoryId,
                    },
                  };
                }
                return { ...m, categoryId: newCategoryId };
              }
              return m;
            });

            // Use helper to patch movements - ensures searchText and categoryName are updated
            await patchTransactionMovements(ctx, txn._id, txn, updatedMovements);
            const updatedTransaction = await ctx.db.get(txn._id);
            if (updatedTransaction) {
              await recordTransactionActivity(ctx, {
                workspaceId,
                context,
                type: 'transaction_updated',
                before: txn,
                after: updatedTransaction,
              });
            }
          })
        );
      } else {
        // Clear category (set to uncategorized)
        await Promise.all(
          validTransactions.map(async (txn) => {
            const updatedMovements = txn.movements.map((m: EmbeddedMovement) => {
              if (categoryIds.includes(m.categoryId as (typeof categoryIds)[number])) {
                return { ...m, categoryId: undefined };
              }
              return m;
            });

            // Use helper to patch movements - ensures searchText and categoryName are updated
            await patchTransactionMovements(ctx, txn._id, txn, updatedMovements);
            const updatedTransaction = await ctx.db.get(txn._id);
            if (updatedTransaction) {
              await recordTransactionActivity(ctx, {
                workspaceId,
                context,
                type: 'transaction_updated',
                before: txn,
                after: updatedTransaction,
              });
            }

            // Only handle credit card transfers here - regular spending is batched
            const creditCardMutations: Array<Promise<unknown>> = [];

            for (const oldMovement of txn.movements) {
              if (
                oldMovement.categoryId &&
                categoryIds.includes(oldMovement.categoryId as (typeof categoryIds)[number])
              ) {
                if (oldMovement.creditCardTransfer) {
                  creditCardMutations.push(
                    ctx.runMutation(internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
                      workspaceId,
                      fromCategoryId: oldMovement.creditCardTransfer.creditCardCategoryId,
                      toCategoryId: oldMovement.creditCardTransfer.spendingCategoryId,
                      amount: oldMovement.amount,
                      transactionDate: txn.date,
                      isRefund: false,
                    })
                  );
                }
              }
            }

            await Promise.all(creditCardMutations);
          })
        );
      }

      // Batch update all regular spending records for this chunk
      if (spendingDeltas.size > 0) {
        await ctx.runMutation(internal.categoryBudgets.batchUpdateCategorySpendingForDelete, {
          workspaceId,
          spendingDeltas: Array.from(spendingDeltas.values()),
        });
      }
    }

    // After all chunks are processed, delete categoryBudget rows and release funds
    // Fetch all categoryBudget rows for the categories being deleted
    const categoryBudgets = await Promise.all(
      categoryIds.map((categoryId: Id<'category'>) =>
        ctx.db
          .query('categoryBudget')
          .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
          .first()
      )
    );

    // Calculate assigned amounts per month across all categories
    const monthlyAssignedAmountsInternal: Record<string, bigint> = {};
    const releasedMovementsByMonth = new Map<number, MoneyMovementSnapshot[]>();
    const budgetDeletions: Array<Promise<unknown>> = [];

    for (let index = 0; index < categoryBudgets.length; index++) {
      const budget = categoryBudgets[index];
      const category = categories[index];
      if (budget) {
        // Collect assigned amounts by month
        const budgetMonthlyAmounts = budget.monthlyAssignedAmounts ?? {};
        for (const [yearMonthStr, amount] of Object.entries(budgetMonthlyAmounts)) {
          monthlyAssignedAmountsInternal[yearMonthStr] = (monthlyAssignedAmountsInternal[yearMonthStr] ?? 0n) + amount;
          if (amount !== 0n && category) {
            const yearMonth = parseInt(yearMonthStr, 10);
            const movements = releasedMovementsByMonth.get(yearMonth) ?? [];
            movements.push(
              amount > 0n
                ? {
                    amount,
                    from: { type: 'category', category: { id: category._id, name: category.name } },
                    to: { type: 'ready_to_assign' },
                  }
                : {
                    amount: -amount,
                    from: { type: 'ready_to_assign' },
                    to: { type: 'category', category: { id: category._id, name: category.name } },
                  }
            );
            releasedMovementsByMonth.set(yearMonth, movements);
          }
        }

        // Delete the categoryBudget row
        budgetDeletions.push(ctx.db.delete(budget._id));
      }
    }

    // Delete all categoryBudget rows in parallel
    await Promise.all(budgetDeletions);

    // Release assigned funds back to ReadyToAssign for each month
    for (const [yearMonthStr, amount] of Object.entries(monthlyAssignedAmountsInternal)) {
      if (amount !== 0n) {
        await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
          workspaceId,
          amountDelta: amount, // Positive delta adds back to readyToAssign
          yearMonth: parseInt(yearMonthStr, 10),
        });
      }
    }
    for (const [yearMonth, movements] of releasedMovementsByMonth) {
      await insertActivityLog(ctx, {
        workspaceId,
        context,
        type: 'money_moved',
        entityType: 'budget_assignment',
        entityId: workspaceId,
        details: { kind: 'money_movement', yearMonth, movements },
      });
    }

    // Soft delete all categories
    // Note: monthlySpending and transactionCount are now stored directly on category,
    // so they will be retained for historical data but category is marked as deleted
    await Promise.all(
      categoryIds.map((id: Id<'category'>) =>
        ctx.db.patch(id, {
          isDeleted: true,
          deletedAt: timestamp,
          updatedAt: timestamp,
        })
      )
    );

    for (const category of categories) {
      if (!category) {
        continue;
      }
      const deletedCategory = await ctx.db.get(category._id);
      if (deletedCategory) {
        await recordCategoryActivity(ctx, {
          workspaceId,
          context,
          type: 'category_deleted',
          before: category,
          after: deletedCategory,
        });
      }
    }

    return {
      success: true,
      deletedCount: categoryIds.length,
      processedTransactions: transactionIds.length,
    };
  },
});
