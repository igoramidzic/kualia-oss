import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Delete a category budget
 */
export const deleteCategoryBudget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryBudgetId: v.id('categoryBudget'),
  },
  handler: async (ctx, { workspaceId, categoryBudgetId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const budget = await ctx.db.get(categoryBudgetId);
    if (!budget || budget.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category budget not found or does not belong to workspace');
    }

    // Get monthly assigned amounts from the budget
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};

    await ctx.db.delete(categoryBudgetId);

    // Add back the assigned amounts to readyToAssign for each month when budget is deleted
    for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
      if (amount !== 0n) {
        await ctx.scheduler.runAfter(0, internal.workspaces.updateWorkspaceReadyToAssign, {
          workspaceId: verifiedWorkspaceId,
          amountDelta: amount, // Positive delta adds back to readyToAssign
          yearMonth: parseInt(yearMonthStr, 10),
        });
      }
    }

    return { success: true };
  },
});
