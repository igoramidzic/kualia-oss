import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordCategoryActivity } from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { SORT_ORDER_GAP } from '../categories/helpers';
import { requireWorkspaceAccess } from '../lib/auth';

export async function deleteCategoryGroupImpl(
  ctx: MutationCtx,
  {
    categoryGroupId,
    workspaceId,
  }: {
    categoryGroupId: Id<'categoryGroup'>;
    workspaceId: Id<'workspace'>;
  }
): Promise<{ success: true }> {
  const categoryGroup = await ctx.db.get(categoryGroupId);
  if (!categoryGroup || categoryGroup.workspaceId !== workspaceId || categoryGroup.isDeleted) {
    throw new ConvexError('Category group not found or does not belong to workspace');
  }

  if (categoryGroup.type === 'credit_card') {
    throw new ConvexError('Cannot delete credit card category group');
  }

  const hasCategories = await ctx.db
    .query('category')
    .withIndex('by_workspaceId_categoryGroupId', (q) =>
      q.eq('workspaceId', workspaceId).eq('categoryGroupId', categoryGroupId)
    )
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .first();

  if (hasCategories) {
    throw new ConvexError(
      'Cannot delete a group that contains categories. Please move or delete the categories first.'
    );
  }

  const timestamp = new Date().toISOString();

  await ctx.db.patch(categoryGroupId, {
    isDeleted: true,
    deletedAt: timestamp,
    updatedAt: timestamp,
  });

  return { success: true };
}

/**
 * Delete a category group (soft delete)
 * Only allowed if the group has no categories (including archived).
 * Use deleteCategoryGroupWithMove if you need to move categories first.
 */
export const deleteCategoryGroup = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { categoryGroupId, workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return deleteCategoryGroupImpl(ctx, { categoryGroupId, workspaceId: verifiedWorkspaceId });
  },
});

export const deleteCategoryGroupForMcp = internalMutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
  },
  handler: deleteCategoryGroupImpl,
});

export async function restoreCategoryGroupImpl(
  ctx: MutationCtx,
  {
    categoryGroupId,
    workspaceId,
    restoreCategories = false,
    activityContext,
  }: {
    categoryGroupId: Id<'categoryGroup'>;
    workspaceId: Id<'workspace'>;
    restoreCategories?: boolean;
    activityContext?: ActivityContext;
  }
): Promise<{ success: true }> {
  const categoryGroup = await ctx.db.get(categoryGroupId);
  if (!categoryGroup || categoryGroup.workspaceId !== workspaceId) {
    throw new ConvexError('Category group not found or does not belong to workspace');
  }

  if (categoryGroup.type === 'credit_card') {
    throw new ConvexError('Cannot restore credit card category group');
  }

  const timestamp = new Date().toISOString();

  await ctx.db.patch(categoryGroupId, {
    isDeleted: false,
    deletedAt: undefined,
    updatedAt: timestamp,
  });

  if (restoreCategories) {
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', workspaceId).eq('categoryGroupId', categoryGroupId)
      )
      .collect();

    for (const category of categories) {
      await ctx.db.patch(category._id, {
        isDeleted: false,
        deletedAt: undefined,
        updatedAt: timestamp,
      });
      const restoredCategory = await ctx.db.get(category._id);
      if (activityContext && category.isDeleted && restoredCategory) {
        await recordCategoryActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'category_restored',
          before: category,
          after: restoredCategory,
        });
      }
    }
  }

  return { success: true };
}

/**
 * Restore an archived category group
 */
export const restoreCategoryGroup = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    restoreCategories: v.optional(v.boolean()),
  },
  handler: async (ctx, { categoryGroupId, workspaceId, restoreCategories = false }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return restoreCategoryGroupImpl(ctx, {
      categoryGroupId,
      workspaceId: verifiedWorkspaceId,
      restoreCategories,
      activityContext: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
    });
  },
});

export const restoreCategoryGroupForMcp = internalMutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    restoreCategories: v.optional(v.boolean()),
  },
  handler: restoreCategoryGroupImpl,
});

/**
 * Permanently delete a category group
 */
export const permanentlyDeleteCategoryGroup = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { categoryGroupId, workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const categoryGroup = await ctx.db.get(categoryGroupId);
    if (!categoryGroup || categoryGroup.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }

    // Block deletion if group has categories
    const hasCategories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryGroupId', categoryGroupId)
      )
      .first();

    if (hasCategories) {
      throw new ConvexError('Cannot permanently delete category group with categories. Delete categories first.');
    }

    await ctx.db.delete(categoryGroupId);

    return { success: true };
  },
});

/**
 * Delete a category group with optional category movement
 * If the group has categories and newCategoryGroupId is provided, moves categories to the new group
 * If the group has categories and no newCategoryGroupId is provided, throws an error
 * If the group is empty, deletes it directly
 */
export const deleteCategoryGroupWithMove = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    newCategoryGroupId: v.optional(v.id('categoryGroup')),
  },
  handler: async (ctx, { categoryGroupId, workspaceId, newCategoryGroupId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const activityContext = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    // Get the category group to delete
    const categoryGroup = await ctx.db.get(categoryGroupId);
    if (!categoryGroup || categoryGroup.workspaceId !== verifiedWorkspaceId || categoryGroup.isDeleted) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }

    // Prevent deleting credit card groups
    if (categoryGroup.type === 'credit_card') {
      throw new ConvexError('Cannot delete credit card category group');
    }

    // Prevent deleting system groups
    if (categoryGroup.isSystemGroup) {
      throw new ConvexError('Cannot delete system category group');
    }

    // Get all non-deleted categories in this group (including archived ones)
    // Note: We don't filter by isArchived - archived categories also need to be moved
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('categoryGroupId', categoryGroupId)
      )
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const timestamp = new Date().toISOString();
    let movedCategoryCount = 0;

    // If there are categories, we need to move them
    if (categories.length > 0) {
      if (!newCategoryGroupId) {
        throw new ConvexError('Cannot delete group with categories without specifying a target group');
      }

      // Validate target group
      const targetGroup = await ctx.db.get(newCategoryGroupId);
      if (!targetGroup || targetGroup.workspaceId !== verifiedWorkspaceId || targetGroup.isDeleted) {
        throw new ConvexError('Target category group not found');
      }

      // Prevent moving to credit card group (unless source is also credit card, but we already blocked credit card deletion)
      if (targetGroup.type === 'credit_card') {
        throw new ConvexError('Cannot move categories to a credit card group');
      }

      // Get the max sortOrder in the target group to append categories at the end
      const targetGroupCategories = await ctx.db
        .query('category')
        .withIndex('by_workspaceId_categoryGroupId', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('categoryGroupId', newCategoryGroupId)
        )
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      const maxSortOrder =
        targetGroupCategories.length > 0 ? Math.max(...targetGroupCategories.map((c) => c.sortOrder)) : -SORT_ORDER_GAP;

      // Move all categories to the target group, appending at the end
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        await ctx.db.patch(category._id, {
          categoryGroupId: newCategoryGroupId,
          sortOrder: maxSortOrder + (i + 1) * SORT_ORDER_GAP,
          updatedAt: timestamp,
        });
        const updatedCategory = await ctx.db.get(category._id);
        if (updatedCategory) {
          await recordCategoryActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context: activityContext,
            type: 'category_updated',
            before: category,
            after: updatedCategory,
          });
        }
      }

      movedCategoryCount = categories.length;
    }

    // Soft delete the category group
    await ctx.db.patch(categoryGroupId, {
      isDeleted: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
    });

    return { success: true, movedCategoryCount };
  },
});
