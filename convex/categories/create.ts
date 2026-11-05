import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordCategoryActivity } from '../activityLogs/helpers';
import { activityAttributionValidator, type ActivityAttribution } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

import { restructureCategorySortOrders, SORT_ORDER_GAP } from './helpers';

export async function createCategoryImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    name,
    categoryGroupId,
    attribution,
  }: {
    workspaceId: Id<'workspace'>;
    name: string;
    categoryGroupId: Id<'categoryGroup'>;
    attribution: ActivityAttribution;
  }
): Promise<Id<'category'>> {
  const group = await ctx.db.get(categoryGroupId);
  if (!group || group.workspaceId !== workspaceId) {
    throw new ConvexError('Category group not found');
  }

  const existingCategory = await ctx.db
    .query('category')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.and(q.eq(q.field('name'), name), q.eq(q.field('isDeleted'), false)))
    .first();

  if (existingCategory) {
    throw new ConvexError('Category with this name already exists');
  }

  const existingCategories = await ctx.db
    .query('category')
    .withIndex('by_workspaceId_categoryGroupId', (q) =>
      q.eq('workspaceId', workspaceId).eq('categoryGroupId', categoryGroupId)
    )
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const timestamp = new Date().toISOString();

  const hasCategoryAtZero = existingCategories.some((c) => c.sortOrder <= 0);

  if (hasCategoryAtZero) {
    await restructureCategorySortOrders(ctx, categoryGroupId);

    const restructuredCategories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', workspaceId).eq('categoryGroupId', categoryGroupId)
      )
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const category of restructuredCategories) {
      await ctx.db.patch(category._id, {
        sortOrder: category.sortOrder + SORT_ORDER_GAP,
        updatedAt: timestamp,
      });
    }
  }

  const categoryId = await ctx.db.insert('category', {
    name,
    workspaceId,
    categoryGroupId,
    sortOrder: 0,
    isDeleted: false,
    updatedAt: timestamp,
  });

  const category = await ctx.db.get(categoryId);
  if (category) {
    await recordCategoryActivity(ctx, {
      workspaceId,
      context: await buildActivityContext(ctx, attribution),
      type: 'category_created',
      after: category,
    });
  }

  return categoryId;
}

/**
 * Create a new category
 * By default, inserts at the top of the group (sortOrder 0)
 */
export const createCategory = mutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    categoryGroupId: v.id('categoryGroup'),
  },
  handler: async (ctx, { workspaceId, name, categoryGroupId }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return createCategoryImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      name,
      categoryGroupId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId
 * (`resolveWorkspace` already verified access).
 */
export const createCategoryForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    categoryGroupId: v.id('categoryGroup'),
    attribution: activityAttributionValidator,
  },
  handler: createCategoryImpl,
});
