import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import {
  MIN_GAP_THRESHOLD,
  SORT_ORDER_GAP,
  calculateSortOrderBetween,
  restructureCategoryGroupSortOrders,
} from './helpers';

export async function updateCategoryGroupImpl(
  ctx: MutationCtx,
  {
    categoryGroupId,
    workspaceId,
    name,
    type,
  }: {
    categoryGroupId: Id<'categoryGroup'>;
    workspaceId: Id<'workspace'>;
    name?: string;
    type?: 'expense';
  }
): Promise<{ success: true }> {
  const categoryGroup = await ctx.db.get(categoryGroupId);
  if (!categoryGroup || categoryGroup.workspaceId !== workspaceId || categoryGroup.isDeleted) {
    throw new ConvexError('Category group not found or does not belong to workspace');
  }

  if (categoryGroup.type === 'credit_card' && type !== undefined) {
    throw new ConvexError('Cannot change credit card category group type');
  }

  if (type !== undefined && type !== categoryGroup.type) {
    const hasCategories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', workspaceId).eq('categoryGroupId', categoryGroupId)
      )
      .first();
    if (hasCategories) {
      throw new ConvexError('Cannot change type of category group with existing categories');
    }
  }

  if (name && name !== categoryGroup.name) {
    const existingGroup = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) =>
        q.and(q.eq(q.field('name'), name), q.eq(q.field('isDeleted'), false), q.neq(q.field('_id'), categoryGroupId))
      )
      .first();

    if (existingGroup) {
      throw new ConvexError('Category group with this name already exists');
    }
  }

  const updates: Partial<typeof categoryGroup> = {
    updatedAt: new Date().toISOString(),
  };

  if (name !== undefined) updates.name = name;
  if (type !== undefined) updates.type = type;

  await ctx.db.patch(categoryGroupId, updates);

  return { success: true };
}

/**
 * Update a category group
 */
export const updateCategoryGroup = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    name: v.optional(v.string()),
    type: v.optional(v.literal('expense')),
  },
  handler: async (ctx, { categoryGroupId, workspaceId, name, type }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return updateCategoryGroupImpl(ctx, {
      categoryGroupId,
      workspaceId: verifiedWorkspaceId,
      name,
      type,
    });
  },
});

export const updateCategoryGroupForMcp = internalMutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    name: v.optional(v.string()),
    type: v.optional(v.literal('expense')),
  },
  handler: updateCategoryGroupImpl,
});

export async function updateCategoryGroupSortOrderImpl(
  ctx: MutationCtx,
  {
    categoryGroupId,
    workspaceId,
    newPosition,
  }: {
    categoryGroupId: Id<'categoryGroup'>;
    workspaceId: Id<'workspace'>;
    newPosition: number;
  }
): Promise<{ success: true }> {
  const categoryGroup = await ctx.db.get(categoryGroupId);
  if (!categoryGroup || categoryGroup.workspaceId !== workspaceId || categoryGroup.isDeleted) {
    throw new ConvexError('Category group not found or does not belong to workspace');
  }

  const allGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const sortedWorkspaceGroups = allGroups.sort((a, b) => a.sortOrder - b.sortOrder);
  const groupsWithoutMoved = sortedWorkspaceGroups.filter((g) => g._id !== categoryGroupId);

  let newSortOrder: number;
  if (newPosition === 0) {
    const firstGroup = groupsWithoutMoved[0];
    newSortOrder = firstGroup ? firstGroup.sortOrder - SORT_ORDER_GAP : 0;
  } else if (newPosition >= groupsWithoutMoved.length) {
    const lastGroup = groupsWithoutMoved[groupsWithoutMoved.length - 1];
    newSortOrder = lastGroup ? lastGroup.sortOrder + SORT_ORDER_GAP : groupsWithoutMoved.length * SORT_ORDER_GAP;
  } else {
    const prevGroup = groupsWithoutMoved[newPosition - 1];
    const nextGroup = groupsWithoutMoved[newPosition];
    newSortOrder = calculateSortOrderBetween(prevGroup?.sortOrder ?? null, nextGroup?.sortOrder ?? null);
  }

  await ctx.db.patch(categoryGroupId, {
    sortOrder: newSortOrder,
    updatedAt: new Date().toISOString(),
  });

  const allGroupsAfterMove = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const sortedAfterMove = allGroupsAfterMove.sort((a, b) => a.sortOrder - b.sortOrder);

  let needsRestructure = false;
  for (let i = 0; i < sortedAfterMove.length - 1; i++) {
    const gap = sortedAfterMove[i + 1].sortOrder - sortedAfterMove[i].sortOrder;
    if (gap < MIN_GAP_THRESHOLD) {
      needsRestructure = true;
      break;
    }
  }

  if (needsRestructure) {
    await restructureCategoryGroupSortOrders(ctx, workspaceId);
  }

  return { success: true };
}

/**
 * Update the sort order of a category group
 * Uses gap-based system and automatically restructures when gaps get too small
 */
export const updateCategoryGroupSortOrder = mutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    newPosition: v.number(),
  },
  handler: async (ctx, { categoryGroupId, workspaceId, newPosition }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return updateCategoryGroupSortOrderImpl(ctx, {
      categoryGroupId,
      workspaceId: verifiedWorkspaceId,
      newPosition,
    });
  },
});

export const updateCategoryGroupSortOrderForMcp = internalMutation({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
    newPosition: v.number(),
  },
  handler: updateCategoryGroupSortOrderImpl,
});

export async function bulkReorderCategoryGroupsImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    orderedCategoryGroupIds,
  }: {
    workspaceId: Id<'workspace'>;
    orderedCategoryGroupIds: Id<'categoryGroup'>[];
  }
): Promise<{ success: true; updatedCount: number }> {
  if (orderedCategoryGroupIds.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  const orderedSet = new Set<Id<'categoryGroup'>>(orderedCategoryGroupIds);
  if (orderedSet.size !== orderedCategoryGroupIds.length) {
    throw new ConvexError('Duplicate categoryGroupId in orderedCategoryGroupIds');
  }

  for (const id of orderedCategoryGroupIds) {
    const group = await ctx.db.get(id);
    if (!group || group.workspaceId !== workspaceId || group.isDeleted) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }
  }

  const allGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const unlisted = allGroups
    .filter((g) => !orderedSet.has(g._id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => g._id);

  const finalOrder: Id<'categoryGroup'>[] = [...orderedCategoryGroupIds, ...unlisted];

  const timestamp = new Date().toISOString();
  for (let i = 0; i < finalOrder.length; i++) {
    await ctx.db.patch(finalOrder[i], {
      sortOrder: i * SORT_ORDER_GAP,
      updatedAt: timestamp,
    });
  }

  return { success: true, updatedCount: orderedCategoryGroupIds.length };
}

/**
 * MCP entry point. Accepts raw strings so a hallucinated id from the LLM doesn't
 * trip Convex's argument validator and abort the whole batch. Invalid / wrong-table
 * ids are silently dropped.
 */
export const bulkReorderCategoryGroupsForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    orderedCategoryGroupIds: v.array(v.string()),
  },
  handler: async (ctx, { workspaceId, orderedCategoryGroupIds }) => {
    const normalized: Id<'categoryGroup'>[] = [];
    for (const id of orderedCategoryGroupIds) {
      const n = ctx.db.normalizeId('categoryGroup', id);
      if (n) {
        normalized.push(n);
      }
    }
    return bulkReorderCategoryGroupsImpl(ctx, { workspaceId, orderedCategoryGroupIds: normalized });
  },
});

export type CategoryGroupSortMode = 'name_asc' | 'name_desc' | 'created_asc' | 'created_desc';

/**
 * Build a name-sort key that strips leading decoration (emoji, symbols, punctuation,
 * whitespace) so "🛒 Groceries" sorts under G, not under whichever code point the
 * emoji happens to have. Falls back to the trimmed original when stripping leaves
 * the key empty (e.g. a group named just "🎉").
 */
function nameSortKey(name: string): string {
  const stripped = name.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return stripped.length > 0 ? stripped : name.trim();
}

function compareCategoryGroupsBy<T extends { name: string; _creationTime: number }>(
  a: T,
  b: T,
  mode: CategoryGroupSortMode
): number {
  switch (mode) {
    case 'name_asc':
      return nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, { sensitivity: 'base' });
    case 'name_desc':
      return nameSortKey(b.name).localeCompare(nameSortKey(a.name), undefined, { sensitivity: 'base' });
    case 'created_asc':
      return a._creationTime - b._creationTime;
    case 'created_desc':
      return b._creationTime - a._creationTime;
  }
}

export async function sortCategoryGroupsImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    sortBy,
  }: {
    workspaceId: Id<'workspace'>;
    sortBy: CategoryGroupSortMode;
  }
): Promise<{ success: true; updatedCount: number }> {
  const groups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  if (groups.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  const sorted = [...groups].sort((a, b) => compareCategoryGroupsBy(a, b, sortBy));
  return bulkReorderCategoryGroupsImpl(ctx, {
    workspaceId,
    orderedCategoryGroupIds: sorted.map((g) => g._id),
  });
}

export const sortCategoryGroupsForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    sortBy: v.union(v.literal('name_asc'), v.literal('name_desc'), v.literal('created_asc'), v.literal('created_desc')),
  },
  handler: sortCategoryGroupsImpl,
});
