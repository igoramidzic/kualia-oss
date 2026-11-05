import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext, buildAssignmentMoneyMovements, insertActivityLog } from '../activityLogs/helpers';
import { type ActivityAttribution, activityAttributionValidator } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';
import { getCurrentYearMonthForTimezone } from '../lib/dates';

import { calculateBudgetCarryoverChain, dateToYearMonth } from './calculations';
import { updateCategorySpending, updateCreditCategorySpending } from './helpers';

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

type UpsertCategoryBudgetOperationResult = {
  previousAssignedAmount: bigint;
  assignedAmount: bigint;
  readyToAssignDelta: bigint;
  createdBudgetRow: boolean;
};

type AssignmentChange = {
  categoryId: Id<'category'>;
  categoryName: string;
  previousAssignedAmount: bigint;
  assignedAmount: bigint;
};

async function recordAssignmentActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    yearMonth: number;
    changes: AssignmentChange[];
    attribution: ActivityAttribution;
  }
): Promise<void> {
  const movements = buildAssignmentMoneyMovements(
    args.changes.map((change) => ({
      category: { id: change.categoryId, name: change.categoryName },
      previousAssignedAmount: change.previousAssignedAmount,
      assignedAmount: change.assignedAmount,
    }))
  );

  if (movements.length === 0) {
    return;
  }

  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: await buildActivityContext(ctx, args.attribution),
    type: 'money_moved',
    entityType: 'budget_assignment',
    entityId: args.changes.length === 1 ? args.changes[0].categoryId : args.workspaceId,
    details: {
      kind: 'money_movement',
      yearMonth: args.yearMonth,
      movements,
    },
  });
}

function assertInt64Range(value: bigint, field: string): void {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new ConvexError(`${field} must be a signed 64-bit integer`);
  }
}

async function validateCategoryBelongsToWorkspace(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>
): Promise<void> {
  const category = await ctx.db.get(categoryId);
  if (!category) {
    throw new ConvexError('Category not found');
  }

  if (category.isDeleted || (!category.isSystemCategory && category.workspaceId !== workspaceId)) {
    throw new ConvexError('Category not found or does not belong to workspace');
  }
  if (category.isArchived) {
    throw new ConvexError('Archived categories cannot be assigned money');
  }
}

async function applyCategoryBudgetAssignment(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    categoryId: Id<'category'>;
    yearMonth: number;
    assignedAmount: bigint;
  },
  options?: {
    updateWorkspaceReadyToAssign?: boolean;
  }
): Promise<UpsertCategoryBudgetOperationResult> {
  const { workspaceId, categoryId, yearMonth, assignedAmount } = args;
  const updateWorkspaceReadyToAssign = options?.updateWorkspaceReadyToAssign ?? true;

  assertInt64Range(assignedAmount, 'assignedAmount');
  await validateCategoryBelongsToWorkspace(ctx, workspaceId, categoryId);

  const now = new Date().toISOString();
  const yearMonthStr = yearMonth.toString();

  const existing = await ctx.db
    .query('categoryBudget')
    .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
    .first();

  if (existing) {
    const monthlyAmounts = { ...existing.monthlyAssignedAmounts };
    const previousAssignedAmount = monthlyAmounts[yearMonthStr] ?? 0n;
    const readyToAssignDelta = previousAssignedAmount - assignedAmount;

    if (assignedAmount === 0n) {
      delete monthlyAmounts[yearMonthStr];
    } else {
      monthlyAmounts[yearMonthStr] = assignedAmount;
    }

    await ctx.db.patch(existing._id, {
      monthlyAssignedAmounts: monthlyAmounts,
      updatedAt: now,
    });

    if (updateWorkspaceReadyToAssign && readyToAssignDelta !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId,
        amountDelta: readyToAssignDelta,
        yearMonth,
      });
    }

    return {
      previousAssignedAmount,
      assignedAmount,
      readyToAssignDelta,
      createdBudgetRow: false,
    };
  }

  const monthlyAmounts: Record<string, bigint> = {};
  if (assignedAmount !== 0n) {
    monthlyAmounts[yearMonthStr] = assignedAmount;
  }

  await ctx.db.insert('categoryBudget', {
    categoryId,
    workspaceId,
    monthlyAssignedAmounts: monthlyAmounts,
    updatedAt: now,
  });

  const readyToAssignDelta = -assignedAmount;
  if (updateWorkspaceReadyToAssign && readyToAssignDelta !== 0n) {
    await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
      workspaceId,
      amountDelta: readyToAssignDelta,
      yearMonth,
    });
  }

  return {
    previousAssignedAmount: 0n,
    assignedAmount,
    readyToAssignDelta,
    createdBudgetRow: true,
  };
}

/** Release spendable funds atomically before hiding a category. Past budgets and spending stay intact. */
export async function releaseCategoryFundsOnArchive(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  category: Doc<'category'>,
  attribution: ActivityAttribution
): Promise<void> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.isDeleted) throw new ConvexError('Workspace not found');
  const currentMonth = getCurrentYearMonthForTimezone(workspace.timezone);
  const budget = await ctx.db
    .query('categoryBudget')
    .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', category._id))
    .first();
  const assigned = budget?.monthlyAssignedAmounts ?? {};
  const spending = category.monthlySpending ?? {};
  // Include all history, even carryover older than the visible budget range.
  // Missing months have no activity and pass their signed balance through unchanged.
  const months = [...new Set([...Object.keys(assigned), ...Object.keys(spending), String(currentMonth)])]
    .map(Number)
    .filter((month) => month <= currentMonth)
    .sort((a, b) => a - b);
  const balances = calculateBudgetCarryoverChain(
    months.map((yearMonth) => ({
      yearMonth,
      assignedAmount: assigned[String(yearMonth)] ?? 0n,
      inflowAmount: spending[String(yearMonth)]?.inflowAmount ?? 0n,
      outflowAmount: spending[String(yearMonth)]?.outflowAmount ?? 0n,
    }))
  );
  const available = balances[balances.length - 1]?.available ?? 0n;
  const changes = Object.entries(assigned)
    .filter(([month, amount]) => Number(month) > currentMonth && amount !== 0n)
    .map(([month]) => ({ yearMonth: Number(month), assignedAmount: 0n }));
  // Only unspent money can return to RTA. Keep spending covered and preserve overspending.
  if (available > 0n) {
    changes.unshift({
      yearMonth: currentMonth,
      assignedAmount: (assigned[String(currentMonth)] ?? 0n) - available,
    });
  }
  for (const change of changes) {
    const result = await applyCategoryBudgetAssignment(ctx, {
      workspaceId,
      categoryId: category._id,
      ...change,
    });
    await recordAssignmentActivity(ctx, {
      workspaceId,
      yearMonth: change.yearMonth,
      attribution,
      changes: [
        {
          categoryId: category._id,
          categoryName: category.name,
          previousAssignedAmount: result.previousAssignedAmount,
          assignedAmount: result.assignedAmount,
        },
      ],
    });
  }
}

/**
 * Update an existing category budget
 * Note: Only assignedAmount is stored. Other fields (totalSpent, carryover, available) are calculated on-demand
 */
export const updateCategoryBudget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    yearMonth: v.number(),
    assignedAmount: v.int64(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { workspaceId, categoryId, yearMonth, assignedAmount }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    // Validate category exists and belongs to workspace
    const category = await ctx.db.get(categoryId);
    if (!category) {
      throw new ConvexError('Category not found');
    }

    if (!category.isSystemCategory && category.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    await validateCategoryBelongsToWorkspace(ctx, verifiedWorkspaceId, categoryId);

    // Get the budget row for this category
    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryId', categoryId)
      )
      .first();

    if (!budget) {
      throw new ConvexError('Category budget not found');
    }

    const yearMonthStr = yearMonth.toString();
    const monthlyAmounts = { ...budget.monthlyAssignedAmounts };
    const oldAmount = monthlyAmounts[yearMonthStr] ?? 0n;

    // Calculate delta for readyToAssign if assignedAmount is changing
    let readyToAssignDelta: bigint | undefined;
    if (assignedAmount !== oldAmount) {
      // Delta is negative because assigning more means subtracting from readyToAssign
      readyToAssignDelta = oldAmount - assignedAmount;
    }

    // Update or remove the map entry
    if (assignedAmount === 0n) {
      // Remove entry if amount is 0 (optional optimization)
      delete monthlyAmounts[yearMonthStr];
    } else {
      monthlyAmounts[yearMonthStr] = assignedAmount;
    }

    const updates: Partial<Doc<'categoryBudget'>> = {
      monthlyAssignedAmounts: monthlyAmounts,
      updatedAt: new Date().toISOString(),
    };

    await ctx.db.patch(budget._id, updates);

    // Update workspace readyToAssign if assignedAmount changed
    if (readyToAssignDelta !== undefined && readyToAssignDelta !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId: verifiedWorkspaceId,
        amountDelta: readyToAssignDelta,
        yearMonth,
      });
    }

    await recordAssignmentActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      yearMonth,
      changes: [
        {
          categoryId,
          categoryName: category.name,
          previousAssignedAmount: oldAmount,
          assignedAmount,
        },
      ],
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });

    return { success: true };
  },
});

/**
 * Create or update a category budget (useful for bulk operations)
 */
export const upsertCategoryBudget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    yearMonth: v.int64(),
    assignedAmount: v.optional(v.int64()),
  },
  returns: v.object({
    success: v.literal(true),
    previousAssignedAmount: v.int64(),
    assignedAmount: v.int64(),
    readyToAssignDelta: v.int64(),
    createdBudgetRow: v.boolean(),
  }),
  handler: async (ctx, { workspaceId, categoryId, yearMonth, assignedAmount }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const month = yearMonth % 100n;
    if (yearMonth < 100001n || yearMonth > 999912n || month < 1n || month > 12n) {
      throw new ConvexError('yearMonth must be a valid month in YYYYMM format');
    }
    const category = await ctx.db.get(categoryId);
    // System categories also belong to a specific workspace; the flag does not grant cross-workspace access.
    if (!category || category.workspaceId !== verifiedWorkspaceId || category.isDeleted) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }
    if (category.isArchived) {
      throw new ConvexError('Archived categories cannot be assigned money');
    }

    const upsertResult = await applyCategoryBudgetAssignment(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryId,
      yearMonth: Number(yearMonth),
      assignedAmount: assignedAmount ?? 0n,
    });

    await recordAssignmentActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      yearMonth: Number(yearMonth),
      changes: [
        {
          categoryId,
          categoryName: category.name,
          previousAssignedAmount: upsertResult.previousAssignedAmount,
          assignedAmount: upsertResult.assignedAmount,
        },
      ],
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });

    return { success: true as const, ...upsertResult };
  },
});

/**
 * Internal upsert entry point for MCP write tools.
 * Applies the same assignment semantics as upsertCategoryBudget.
 */
export const upsertCategoryBudgetInternal = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    yearMonth: v.number(),
    assignedAmount: v.int64(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { workspaceId, categoryId, yearMonth, assignedAmount, attribution }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) {
      throw new ConvexError('Workspace not found');
    }

    if (workspace.isArchived) {
      throw new ConvexError('Workspace is archived');
    }

    const result = await applyCategoryBudgetAssignment(ctx, {
      workspaceId,
      categoryId,
      yearMonth,
      assignedAmount,
    });

    const category = await ctx.db.get(categoryId);
    if (category) {
      await recordAssignmentActivity(ctx, {
        workspaceId,
        yearMonth,
        changes: [
          {
            categoryId,
            categoryName: category.name,
            previousAssignedAmount: result.previousAssignedAmount,
            assignedAmount: result.assignedAmount,
          },
        ],
        attribution,
      });
    }

    return result;
  },
});

export const upsertCategoryBudgetsInternal = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    updates: v.array(
      v.object({
        categoryId: v.id('category'),
        yearMonth: v.number(),
        assignedAmount: v.int64(),
      })
    ),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { workspaceId, updates, attribution }) => {
    if (updates.length === 0) {
      throw new ConvexError('updates must contain at least one item');
    }

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) {
      throw new ConvexError('Workspace not found');
    }

    if (workspace.isArchived) {
      throw new ConvexError('Workspace is archived');
    }

    let totalReadyToAssignDelta = 0n;
    const results: Array<
      UpsertCategoryBudgetOperationResult & {
        categoryId: Id<'category'>;
        yearMonth: number;
      }
    > = [];
    const assignmentChanges: AssignmentChange[] = [];

    for (const update of updates) {
      const result = await applyCategoryBudgetAssignment(
        ctx,
        {
          workspaceId,
          categoryId: update.categoryId,
          yearMonth: update.yearMonth,
          assignedAmount: update.assignedAmount,
        },
        { updateWorkspaceReadyToAssign: false }
      );

      totalReadyToAssignDelta += result.readyToAssignDelta;
      const category = await ctx.db.get(update.categoryId);
      results.push({
        categoryId: update.categoryId,
        yearMonth: update.yearMonth,
        ...result,
      });
      assignmentChanges.push({
        categoryId: update.categoryId,
        categoryName: category?.name ?? 'Deleted category',
        previousAssignedAmount: result.previousAssignedAmount,
        assignedAmount: result.assignedAmount,
      });
    }

    if (totalReadyToAssignDelta !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId,
        amountDelta: totalReadyToAssignDelta,
      });
    }

    const changesByMonth = new Map<number, AssignmentChange[]>();
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const changes = changesByMonth.get(result.yearMonth) ?? [];
      changes.push(assignmentChanges[index]);
      changesByMonth.set(result.yearMonth, changes);
    }
    for (const [yearMonth, changes] of changesByMonth) {
      await recordAssignmentActivity(ctx, { workspaceId, yearMonth, changes, attribution });
    }

    return {
      updates: results,
      totalReadyToAssignDelta,
    };
  },
});

/**
 * Internal mutation to move money from one category to another
 * Used for credit card transactions - moves money from spending category to credit card category
 */
export const moveMoneyBetweenCategories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    fromCategoryId: v.id('category'),
    toCategoryId: v.id('category'),
    amount: v.int64(),
    transactionDate: v.string(), // ISO date string
    isRefund: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, fromCategoryId, toCategoryId, amount, transactionDate, isRefund = false }) => {
    // Check if the TO category is a credit card category
    const toCategory = await ctx.db.get(toCategoryId);
    const isCreditCardCategory = toCategory?.categoryType === 'credit_card';

    // Move money FROM spending category (track as spending, decreases available)
    // Mark as credit card spending since it's funding a CC category
    await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
      workspaceId,
      categoryId: fromCategoryId,
      transactionDate,
      amountDelta: amount, // Positive delta increases spending, decreases available
      transactionCountDelta: 1n, // Indicates creating/adding spending
    });

    if (isCreditCardCategory && toCategory?.bankAccountId) {
      // For credit card categories: use creditCategorySpending
      // Track as spending (not payment) - this is a charge on the credit card
      // Note: amount is negative for spending (-$100), positive for refunds (+$100)
      // For refunds: we track them in refundedSpending (positive value)
      // For spending: we negate it so that -$100 becomes +$100 (adds to spendingAmount)
      const yearMonth = dateToYearMonth(transactionDate);
      await updateCreditCategorySpending(
        ctx,
        workspaceId,
        toCategoryId,
        toCategory.bankAccountId,
        yearMonth,
        isRefund ? amount : -amount, // Refund: use as-is (+), Spending: negate (-$100 → +$100)
        false, // isPayment = false (this is a charge or refund, not a payment)
        isRefund // Pass refund flag
      );
    } else {
      // For regular categories: use regular categorySpending
      // Move money TO category (track as negative spending, increases available)
      await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
        workspaceId,
        categoryId: toCategoryId,
        transactionDate,
        amountDelta: -amount, // Negative delta decreases spending, increases available
      });
    }
  },
});

/**
 * Internal mutation to reverse money movement between categories
 * Used when credit card transactions are deleted or uncategorized
 */
export const reverseMoneyMovementBetweenCategories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    fromCategoryId: v.id('category'), // Credit card category (money moves FROM here)
    toCategoryId: v.id('category'), // Spending category (money moves TO here)
    amount: v.int64(),
    transactionDate: v.string(), // ISO date string
    isRefund: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, fromCategoryId, toCategoryId, amount, transactionDate, isRefund = false }) => {
    // Check if the FROM category is a credit card category
    const fromCategory = await ctx.db.get(fromCategoryId);
    const isCreditCardCategory = fromCategory?.categoryType === 'credit_card';

    if (isCreditCardCategory && fromCategory?.bankAccountId) {
      // For credit card categories: reverse using creditCategorySpending
      // To reverse the spending/refund we previously added, we need to negate what we did in moveMoneyBetweenCategories
      // For refunds: we added +amount to refundedSpending, so we pass -amount to reverse
      // For spending: we added +amount to spendingAmount (negated from -amount), so we pass -amount to reverse
      const yearMonth = dateToYearMonth(transactionDate);
      await updateCreditCategorySpending(
        ctx,
        workspaceId,
        fromCategoryId,
        fromCategory.bankAccountId,
        yearMonth,
        isRefund ? -amount : amount, // Refund: negate to reverse, Spending: keep positive to reverse
        false, // isPayment = false
        isRefund // Pass refund flag
      );
    } else {
      // For regular categories: use regular categorySpending
      // Reverse: move money FROM category (increase spending, decrease available)
      await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
        workspaceId,
        categoryId: fromCategoryId,
        transactionDate,
        amountDelta: amount, // Positive delta increases spending, decreases available
        transactionCountDelta: -1n, // Indicates reversing/deleting spending
      });
    }

    // Reverse: move money TO spending category (decrease spending, increase available)
    // This reverses the spending we added when moving money FROM spending category
    await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
      workspaceId,
      categoryId: toCategoryId,
      transactionDate,
      amountDelta: -amount, // Negative delta decreases spending, increases available
      transactionCountDelta: -1n, // Indicates reversing/deleting spending
    });
  },
});

/**
 * Batch update multiple category budgets in a single transaction
 * More efficient than calling upsertCategoryBudget multiple times
 * Updates workspace readyToAssign once with total delta
 */
export const batchUpdateCategoryBudgets = mutation({
  args: {
    workspaceId: v.id('workspace'),
    yearMonth: v.number(),
    updates: v.array(
      v.object({
        categoryId: v.id('category'),
        assignedAmount: v.int64(),
      })
    ),
  },
  returns: v.object({ success: v.boolean(), updatedCount: v.number() }),
  handler: async (ctx, { workspaceId, yearMonth, updates }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    // Track total delta for workspace readyToAssign
    let totalReadyToAssignDelta = 0n;
    const now = new Date().toISOString();
    const yearMonthStr = yearMonth.toString();

    // ===== OPTIMIZATION: Batch fetch all categories and budgets upfront =====
    // Fetch all categories in parallel
    const categories = await Promise.all(updates.map(({ categoryId }) => ctx.db.get(categoryId)));

    // Validate all categories exist and belong to workspace
    for (let i = 0; i < updates.length; i++) {
      const category = categories[i];
      const { categoryId } = updates[i];
      if (!category) {
        throw new ConvexError(`Category ${categoryId} not found`);
      }

      if (!category.isSystemCategory && category.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError(`Category ${categoryId} does not belong to workspace`);
      }
    }

    for (const { categoryId } of updates) {
      await validateCategoryBelongsToWorkspace(ctx, verifiedWorkspaceId, categoryId);
    }

    // Fetch all existing budgets for this workspace in one query
    const allExistingBudgets = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    // Build a Map for O(1) lookups by categoryId
    const budgetsByCategoryId = new Map<Id<'category'>, Doc<'categoryBudget'>>();
    for (const budget of allExistingBudgets) {
      budgetsByCategoryId.set(budget.categoryId, budget);
    }

    // ===== OPTIMIZATION: Collect all write operations to execute in parallel =====
    const writeOperations: Array<Promise<unknown>> = [];
    const assignmentChanges: AssignmentChange[] = [];

    // Process each update using pre-fetched data
    for (const { categoryId, assignedAmount } of updates) {
      const existing = budgetsByCategoryId.get(categoryId);

      if (existing) {
        // Update existing budget row - update the map entry
        const monthlyAmounts = { ...existing.monthlyAssignedAmounts };
        const oldAmount = monthlyAmounts[yearMonthStr] ?? 0n;

        if (assignedAmount !== oldAmount) {
          // Calculate delta: old amount - new amount
          totalReadyToAssignDelta += oldAmount - assignedAmount;

          // Update or remove the map entry
          if (assignedAmount === 0n) {
            delete monthlyAmounts[yearMonthStr];
          } else {
            monthlyAmounts[yearMonthStr] = assignedAmount;
          }

          // Collect patch operation to execute in parallel
          writeOperations.push(
            ctx.db.patch(existing._id, {
              monthlyAssignedAmounts: monthlyAmounts,
              updatedAt: now,
            })
          );
          assignmentChanges.push({
            categoryId,
            categoryName: categories.find((category) => category?._id === categoryId)?.name ?? 'Deleted category',
            previousAssignedAmount: oldAmount,
            assignedAmount,
          });
        }
      } else {
        // Create new budget row with map entry
        const monthlyAmounts: Record<string, bigint> = {};
        if (assignedAmount !== 0n) {
          monthlyAmounts[yearMonthStr] = assignedAmount;
        }

        // Collect insert operation to execute in parallel
        writeOperations.push(
          ctx.db.insert('categoryBudget', {
            categoryId,
            workspaceId: verifiedWorkspaceId,
            monthlyAssignedAmounts: monthlyAmounts,
            updatedAt: now,
          })
        );

        // Delta is negative when creating new assignments
        totalReadyToAssignDelta -= assignedAmount;
        if (assignedAmount !== 0n) {
          assignmentChanges.push({
            categoryId,
            categoryName: categories.find((category) => category?._id === categoryId)?.name ?? 'Deleted category',
            previousAssignedAmount: 0n,
            assignedAmount,
          });
        }
      }
    }

    // Execute all write operations in parallel
    await Promise.all(writeOperations);

    // Update workspace readyToAssign once with total delta
    if (totalReadyToAssignDelta !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId: verifiedWorkspaceId,
        amountDelta: totalReadyToAssignDelta,
        yearMonth,
      });
    }

    await recordAssignmentActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      yearMonth,
      changes: assignmentChanges,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });

    return { success: true, updatedCount: updates.length };
  },
});

/**
 * Toggle target snooze for a category in a specific month
 * When snoozed, target calculations are skipped but overspending is still tracked
 */
export const toggleTargetSnooze = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    yearMonth: v.number(),
    snoozed: v.boolean(),
  },
  handler: async (ctx, { workspaceId, categoryId, yearMonth, snoozed }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get the budget row for this category
    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryId', categoryId)
      )
      .first();

    const yearMonthStr = yearMonth.toString();
    const now = new Date().toISOString();

    if (budget) {
      const snoozedTargetMonths = { ...(budget.snoozedTargetMonths ?? {}) };

      if (snoozed) {
        snoozedTargetMonths[yearMonthStr] = true;
      } else {
        delete snoozedTargetMonths[yearMonthStr];
      }

      await ctx.db.patch(budget._id, {
        snoozedTargetMonths,
        updatedAt: now,
      });
    } else {
      // Create a new budget row if none exists
      const snoozedTargetMonths: Record<string, boolean> = {};
      if (snoozed) {
        snoozedTargetMonths[yearMonthStr] = true;
      }

      await ctx.db.insert('categoryBudget', {
        categoryId,
        workspaceId: verifiedWorkspaceId,
        monthlyAssignedAmounts: {},
        snoozedTargetMonths,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * NEW: Simplified internal mutation to update spending when transaction is created/updated/deleted
 * This replaces the complex cascading update logic with a simple single-row update
 *
 * Benefits:
 * - Only updates ONE record (categorySpending for the transaction month)
 * - No cascading updates to future months
 * - Much simpler and easier to reason about
 * - Carryover is calculated on-demand when viewing budgets
 */
export const updateCategorySpendingForTransaction = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    transactionDate: v.string(), // ISO date string
    amountDelta: v.int64(), // Amount change (positive for add, negative for remove/update)
    transactionCountDelta: v.optional(v.int64()), // Transaction count change (1 for create, -1 for delete)
  },
  handler: async (ctx, { workspaceId, categoryId, transactionDate, amountDelta, transactionCountDelta = 0n }) => {
    // Convert transaction date to yearMonth
    const yearMonth = dateToYearMonth(transactionDate);

    // Update or create the spending record for this month
    await updateCategorySpending(ctx, workspaceId, categoryId, yearMonth, amountDelta, transactionCountDelta);
  },
});

/**
 * Batch update category spending records for category deletion/recategorization
 *
 * This mutation optimizes the spending update process by:
 * 1. Grouping deltas by category for efficient processing
 * 2. Applying all deltas in parallel
 * 3. Reducing N×M mutation calls to a single batch operation
 *
 * Note: Spending data is now stored directly on the category table (no separate categorySpending table)
 */
export const batchUpdateCategorySpendingForDelete = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    spendingDeltas: v.array(
      v.object({
        categoryId: v.id('category'),
        yearMonth: v.number(),
        amountDelta: v.int64(),
        transactionCountDelta: v.int64(),
      })
    ),
  },
  handler: async (ctx, { workspaceId, spendingDeltas }) => {
    if (spendingDeltas.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    // Collect all write operations
    const writeOperations: Array<Promise<Id<'category'>>> = [];

    // Group deltas by categoryId for efficient processing
    const deltasByCategoryId = new Map<Id<'category'>, typeof spendingDeltas>();
    for (const delta of spendingDeltas) {
      if (!deltasByCategoryId.has(delta.categoryId)) {
        deltasByCategoryId.set(delta.categoryId, []);
      }
      deltasByCategoryId.get(delta.categoryId)!.push(delta);
    }

    // Process each category's deltas
    for (const [categoryId, categoryDeltas] of deltasByCategoryId.entries()) {
      // Apply all deltas for this category using the existing helper
      for (const delta of categoryDeltas) {
        writeOperations.push(
          updateCategorySpending(
            ctx,
            workspaceId,
            categoryId,
            delta.yearMonth,
            delta.amountDelta,
            delta.transactionCountDelta
          )
        );
      }
    }

    // Execute all writes in parallel
    await Promise.all(writeOperations);

    return { success: true, updatedCount: spendingDeltas.length };
  },
});
