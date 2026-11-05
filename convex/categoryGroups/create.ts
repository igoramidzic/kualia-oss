import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { SORT_ORDER_GAP, restructureCategoryGroupSortOrders } from './helpers';

export async function createCategoryGroupImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    name,
    type,
  }: {
    workspaceId: Id<'workspace'>;
    name: string;
    type: 'expense' | 'credit_card';
  }
): Promise<Id<'categoryGroup'>> {
  if (type === 'credit_card') {
    const existingCreditCardGroup = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId_type', (q) => q.eq('workspaceId', workspaceId).eq('type', 'credit_card'))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .first();

    if (existingCreditCardGroup) {
      throw new ConvexError('A credit card category group already exists for this workspace');
    }
  }

  const existingGroup = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.and(q.eq(q.field('name'), name), q.eq(q.field('isDeleted'), false)))
    .first();

  if (existingGroup) {
    throw new ConvexError('Category group with this name already exists');
  }

  const existingGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const timestamp = new Date().toISOString();
  const hasGroupAtZero = existingGroups.some((g) => g.sortOrder <= 0);

  if (hasGroupAtZero) {
    await restructureCategoryGroupSortOrders(ctx, workspaceId);

    const restructuredGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const group of restructuredGroups) {
      await ctx.db.patch(group._id, {
        sortOrder: group.sortOrder + SORT_ORDER_GAP,
        updatedAt: timestamp,
      });
    }
  }

  const categoryGroupId = await ctx.db.insert('categoryGroup', {
    name,
    type,
    workspaceId,
    sortOrder: 0,
    isDeleted: false,
    updatedAt: timestamp,
  });

  return categoryGroupId;
}

/**
 * Create a new category group
 */
export const createCategoryGroup = mutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    type: v.union(v.literal('expense'), v.literal('credit_card')),
  },
  handler: async (ctx, { workspaceId, name, type }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return createCategoryGroupImpl(ctx, { workspaceId: verifiedWorkspaceId, name, type });
  },
});

export const createCategoryGroupForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    type: v.union(v.literal('expense'), v.literal('credit_card')),
  },
  handler: createCategoryGroupImpl,
});
