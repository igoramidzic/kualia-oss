import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordCategoryActivity } from '../activityLogs/helpers';
import { activityAttributionValidator, type ActivityAttribution } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

export async function deleteCategoryTargetImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    categoryId,
    attribution,
  }: {
    workspaceId: Id<'workspace'>;
    categoryId: Id<'category'>;
    attribution: ActivityAttribution;
  }
): Promise<{ success: true }> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found');
  }

  if (category.enableTarget !== true) {
    return { success: true };
  }

  await ctx.db.patch(categoryId, {
    enableTarget: false,
    updatedAt: new Date().toISOString(),
  });
  const updatedCategory = await ctx.db.get(categoryId);
  if (updatedCategory) {
    await recordCategoryActivity(ctx, {
      workspaceId,
      context: await buildActivityContext(ctx, attribution),
      type: 'category_updated',
      before: category,
      after: updatedCategory,
    });
  }

  return { success: true };
}

/**
 * Delete (disable) a category target
 * Sets enableTarget to false to preserve target settings
 * Idempotent - succeeds even if target doesn't exist
 */
export const deleteCategoryTarget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return deleteCategoryTargetImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryId: args.categoryId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

export const deleteCategoryTargetForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    attribution: activityAttributionValidator,
  },
  handler: deleteCategoryTargetImpl,
});

/**
 * Delete a category target by category ID
 * Alias for deleteCategoryTarget for backward compatibility
 * Idempotent - succeeds even if target doesn't exist
 */
export const deleteCategoryTargetByCategoryId = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return await deleteCategoryTargetImpl(ctx, {
      workspaceId,
      categoryId: args.categoryId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

/**
 * Remove targets from all credit card categories in a workspace.
 * Idempotent - safe to run multiple times.
 */
export const removeCreditCardCategoryTargets = mutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    const creditCardCategoriesWithTargets = categories.filter(
      (c) => c.categoryType === 'credit_card' && c.enableTarget === true
    );

    for (const category of creditCardCategoriesWithTargets) {
      await ctx.db.patch(category._id, {
        enableTarget: false,
        updatedAt: new Date().toISOString(),
      });
      const updatedCategory = await ctx.db.get(category._id);
      if (updatedCategory) {
        await recordCategoryActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'category_updated',
          before: category,
          after: updatedCategory,
        });
      }
    }

    return { removedCount: creditCardCategoriesWithTargets.length };
  },
});
