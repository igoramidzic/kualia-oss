import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext, recordCategoryActivity } from '../activityLogs/helpers';
import { type ActivityAttribution, activityAttributionValidator } from '../activityLogs/types';
import { releaseCategoryFundsOnArchive } from '../categoryBudgets/update';
import { requireWorkspaceAccess } from '../lib/auth';

import { calculateSortOrderBetween, MIN_GAP_THRESHOLD, restructureCategorySortOrders, SORT_ORDER_GAP } from './helpers';

type UpdateCategoryArgs = {
  workspaceId: Id<'workspace'>;
  categoryId: Id<'category'>;
  name?: string;
  categoryGroupId?: Id<'categoryGroup'>;
  iconName?: string;
  sortOrder?: number;
  isArchived?: boolean;
  attribution: ActivityAttribution;
};

export async function updateCategoryImpl(
  ctx: MutationCtx,
  { workspaceId, categoryId, name, categoryGroupId, iconName, sortOrder, isArchived, attribution }: UpdateCategoryArgs
): Promise<{ success: true }> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found or does not belong to workspace');
  }

  if (category.isSystemCategory) {
    throw new ConvexError('Cannot update system categories');
  }

  if (isArchived !== undefined && category.categoryType === 'credit_card') {
    throw new ConvexError('Cannot archive credit card categories');
  }

  if (category.categoryType === 'credit_card' && categoryGroupId !== undefined) {
    const currentGroup = await ctx.db.get(category.categoryGroupId);
    const newGroup = await ctx.db.get(categoryGroupId);

    if (currentGroup?.type === 'credit_card' && newGroup?.type !== 'credit_card') {
      throw new ConvexError('Cannot move credit card categories out of the credit card group');
    }
  }

  if (categoryGroupId !== undefined && category.categoryType !== 'credit_card') {
    const newGroup = await ctx.db.get(categoryGroupId);
    if (newGroup?.type === 'credit_card') {
      throw new ConvexError('Cannot move non-credit card categories into the credit card group');
    }
  }

  if (categoryGroupId !== undefined) {
    const group = await ctx.db.get(categoryGroupId);
    if (!group || group.workspaceId !== workspaceId) {
      throw new ConvexError('Category group not found');
    }
  }

  if (name && name !== category.name) {
    const existingCategory = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) =>
        q.and(q.eq(q.field('name'), name), q.eq(q.field('isDeleted'), false), q.neq(q.field('_id'), categoryId))
      )
      .first();

    if (existingCategory) {
      throw new ConvexError('Category with this name already exists');
    }
  }

  const updates: Partial<typeof category> = {
    updatedAt: new Date().toISOString(),
  };

  if (name !== undefined) updates.name = name;
  if (categoryGroupId !== undefined) updates.categoryGroupId = categoryGroupId;
  if (iconName !== undefined) updates.iconName = iconName;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isArchived !== undefined) updates.isArchived = isArchived;

  if (isArchived === true && !category.isArchived) {
    await releaseCategoryFundsOnArchive(ctx, workspaceId, category, attribution);
  }

  await ctx.db.patch(categoryId, updates);

  if (name !== undefined && name !== category.name) {
    await ctx.runMutation(internal.internal.propagateNameChanges.propagateCategoryNameChange, {
      categoryId,
      workspaceId,
      newCategoryName: name,
    });
  }

  const updatedCategory = await ctx.db.get(categoryId);
  if (updatedCategory) {
    const type =
      isArchived !== undefined && isArchived !== (category.isArchived ?? false)
        ? isArchived
          ? 'category_archived'
          : 'category_unarchived'
        : 'category_updated';
    await recordCategoryActivity(ctx, {
      workspaceId,
      context: await buildActivityContext(ctx, attribution),
      type,
      before: category,
      after: updatedCategory,
    });
  }

  return { success: true };
}

/**
 * Update a category
 */
export const updateCategory = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    name: v.optional(v.string()),
    categoryGroupId: v.optional(v.id('categoryGroup')),
    iconName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isArchived: v.optional(v.boolean()),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { workspaceId, categoryId, name, categoryGroupId, iconName, sortOrder, isArchived }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return updateCategoryImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryId,
      name,
      categoryGroupId,
      iconName,
      sortOrder,
      isArchived,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId.
 */
export const updateCategoryForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    name: v.optional(v.string()),
    categoryGroupId: v.optional(v.id('categoryGroup')),
    iconName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isArchived: v.optional(v.boolean()),
    attribution: activityAttributionValidator,
  },
  returns: v.object({ success: v.literal(true) }),
  handler: updateCategoryImpl,
});

export async function archiveCategoriesImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    categoryIds,
    isArchived,
    attribution,
  }: {
    workspaceId: Id<'workspace'>;
    categoryIds: Id<'category'>[];
    isArchived: boolean;
    attribution: ActivityAttribution;
  }
): Promise<{ success: true; updatedCount: number }> {
  if (categoryIds.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  const uniqueCategoryIds = [...new Set(categoryIds)];
  const categories = await Promise.all(uniqueCategoryIds.map((id) => ctx.db.get(id)));

  for (const category of categories) {
    if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }
    if (category.isSystemCategory) {
      throw new ConvexError('Cannot archive system categories');
    }
    if (category.categoryType === 'credit_card') {
      throw new ConvexError('Cannot archive credit card categories');
    }
  }

  if (isArchived) {
    for (const category of categories) {
      if (category && !category.isArchived) {
        await releaseCategoryFundsOnArchive(ctx, workspaceId, category, attribution);
      }
    }
  }

  const timestamp = new Date().toISOString();

  await Promise.all(
    uniqueCategoryIds.map((id) =>
      ctx.db.patch(id, {
        isArchived,
        updatedAt: timestamp,
      })
    )
  );

  const context = await buildActivityContext(ctx, attribution);
  for (const category of categories) {
    if (!category || (category.isArchived ?? false) === isArchived) {
      continue;
    }
    const updatedCategory = await ctx.db.get(category._id);
    if (updatedCategory) {
      await recordCategoryActivity(ctx, {
        workspaceId,
        context,
        type: isArchived ? 'category_archived' : 'category_unarchived',
        before: category,
        after: updatedCategory,
      });
    }
  }

  return { success: true, updatedCount: uniqueCategoryIds.length };
}

/**
 * Archive or unarchive multiple categories
 */
export const archiveCategories = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    isArchived: v.boolean(),
  },
  returns: v.object({ success: v.literal(true), updatedCount: v.number() }),
  handler: async (ctx, { workspaceId, categoryIds, isArchived }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    return archiveCategoriesImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryIds,
      isArchived,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

export const archiveCategoriesForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
    isArchived: v.boolean(),
    attribution: activityAttributionValidator,
  },
  returns: v.object({ success: v.literal(true), updatedCount: v.number() }),
  handler: archiveCategoriesImpl,
});

export async function updateCategorySortOrderImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    categoryId,
    newPosition,
  }: {
    workspaceId: Id<'workspace'>;
    categoryId: Id<'category'>;
    newPosition: number;
  }
): Promise<{ success: true }> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found or does not belong to workspace');
  }

  // Credit card categories are system-managed, but their order within the group is user-controlled.
  if (category.isSystemCategory && category.categoryType !== 'credit_card') {
    throw new ConvexError('Cannot update system categories');
  }

  const allCategories = await ctx.db
    .query('category')
    .withIndex('by_workspaceId_categoryGroupId', (q) =>
      q.eq('workspaceId', workspaceId).eq('categoryGroupId', category.categoryGroupId)
    )
    .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('isArchived'), true)))
    .collect();

  const sortedCategories = allCategories.sort((a, b) => a.sortOrder - b.sortOrder);
  const categoriesWithoutMoved = sortedCategories.filter((c) => c._id !== categoryId);

  let newSortOrder: number;
  if (newPosition === 0) {
    const firstCategory = categoriesWithoutMoved[0];
    newSortOrder = firstCategory ? firstCategory.sortOrder - SORT_ORDER_GAP : 0;
  } else if (newPosition >= categoriesWithoutMoved.length) {
    const lastCategory = categoriesWithoutMoved[categoriesWithoutMoved.length - 1];
    newSortOrder = lastCategory
      ? lastCategory.sortOrder + SORT_ORDER_GAP
      : categoriesWithoutMoved.length * SORT_ORDER_GAP;
  } else {
    const prevCategory = categoriesWithoutMoved[newPosition - 1];
    const nextCategory = categoriesWithoutMoved[newPosition];
    newSortOrder = calculateSortOrderBetween(prevCategory?.sortOrder ?? null, nextCategory?.sortOrder ?? null);
  }

  await ctx.db.patch(categoryId, {
    sortOrder: newSortOrder,
    updatedAt: new Date().toISOString(),
  });

  const movedCategory = { ...category, sortOrder: newSortOrder };
  const sortedAfterMove = [...categoriesWithoutMoved, movedCategory].sort((a, b) => a.sortOrder - b.sortOrder);

  let needsRestructure = false;
  for (let i = 0; i < sortedAfterMove.length - 1; i++) {
    const gap = sortedAfterMove[i + 1].sortOrder - sortedAfterMove[i].sortOrder;
    if (gap < MIN_GAP_THRESHOLD) {
      needsRestructure = true;
      break;
    }
  }

  if (needsRestructure) {
    await restructureCategorySortOrders(ctx, category.categoryGroupId);
  }

  return { success: true };
}

/**
 * Update the sort order of a category
 * Uses gap-based system and automatically restructures when gaps get too small
 */
export const updateCategorySortOrder = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    newPosition: v.number(),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { workspaceId, categoryId, newPosition }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return updateCategorySortOrderImpl(ctx, { workspaceId: verifiedWorkspaceId, categoryId, newPosition });
  },
});

export const updateCategorySortOrderForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    newPosition: v.number(),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: updateCategorySortOrderImpl,
});

export async function moveCategoryToGroupImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    categoryId,
    targetGroupId,
    newPosition,
  }: {
    workspaceId: Id<'workspace'>;
    categoryId: Id<'category'>;
    targetGroupId: Id<'categoryGroup'>;
    newPosition: number;
  }
): Promise<{ success: true }> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found or does not belong to workspace');
  }

  if (category.isSystemCategory) {
    throw new ConvexError('Cannot move system categories');
  }

  if (category.isArchived) {
    throw new ConvexError('Cannot move archived categories');
  }

  const targetGroup = await ctx.db.get(targetGroupId);
  if (!targetGroup || targetGroup.workspaceId !== workspaceId || targetGroup.isDeleted) {
    throw new ConvexError('Target group not found');
  }

  if (category.categoryType === 'credit_card') {
    const currentGroup = await ctx.db.get(category.categoryGroupId);
    if (currentGroup?.type === 'credit_card' && targetGroup.type !== 'credit_card') {
      throw new ConvexError('Cannot move credit card categories out of the credit card group');
    }
  }

  if (category.categoryType !== 'credit_card' && targetGroup.type === 'credit_card') {
    throw new ConvexError('Cannot move non-credit card categories into the credit card group');
  }

  const targetGroupCategories = await ctx.db
    .query('category')
    .withIndex('by_workspaceId_categoryGroupId', (q) =>
      q.eq('workspaceId', workspaceId).eq('categoryGroupId', targetGroupId)
    )
    .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('isArchived'), true)))
    .collect();

  const sortedCategories = targetGroupCategories.sort((a, b) => a.sortOrder - b.sortOrder);

  let newSortOrder: number;
  if (sortedCategories.length === 0) {
    newSortOrder = 0;
  } else if (newPosition === 0) {
    const firstCategory = sortedCategories[0];
    newSortOrder = firstCategory.sortOrder - SORT_ORDER_GAP;
  } else if (newPosition >= sortedCategories.length) {
    const lastCategory = sortedCategories[sortedCategories.length - 1];
    newSortOrder = lastCategory.sortOrder + SORT_ORDER_GAP;
  } else {
    const prevCategory = sortedCategories[newPosition - 1];
    const nextCategory = sortedCategories[newPosition];
    newSortOrder = calculateSortOrderBetween(prevCategory?.sortOrder ?? null, nextCategory?.sortOrder ?? null);
  }

  await ctx.db.patch(categoryId, {
    categoryGroupId: targetGroupId,
    sortOrder: newSortOrder,
    updatedAt: new Date().toISOString(),
  });

  const allCategoriesAfterMove = await ctx.db
    .query('category')
    .withIndex('by_workspaceId_categoryGroupId', (q) =>
      q.eq('workspaceId', workspaceId).eq('categoryGroupId', targetGroupId)
    )
    .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('isArchived'), true)))
    .collect();

  const sortedAfterMove = allCategoriesAfterMove.sort((a, b) => a.sortOrder - b.sortOrder);

  let needsRestructure = false;
  for (let i = 0; i < sortedAfterMove.length - 1; i++) {
    const gap = sortedAfterMove[i + 1].sortOrder - sortedAfterMove[i].sortOrder;
    if (gap < MIN_GAP_THRESHOLD) {
      needsRestructure = true;
      break;
    }
  }

  if (needsRestructure) {
    await restructureCategorySortOrders(ctx, targetGroupId);
  }

  return { success: true };
}

/**
 * Move a category to a different group at a specific position
 * Handles cross-group movement with credit card constraints
 */
export const moveCategoryToGroup = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetGroupId: v.id('categoryGroup'),
    newPosition: v.number(),
  },
  handler: async (ctx, { workspaceId, categoryId, targetGroupId, newPosition }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return moveCategoryToGroupImpl(ctx, {
      workspaceId: verifiedWorkspaceId,
      categoryId,
      targetGroupId,
      newPosition,
    });
  },
});

export const moveCategoryToGroupForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetGroupId: v.id('categoryGroup'),
    newPosition: v.number(),
  },
  handler: moveCategoryToGroupImpl,
});

export type BulkReorderCategoriesGroupSpec = {
  categoryGroupId: Id<'categoryGroup'>;
  orderedCategoryIds: Id<'category'>[];
};

export async function bulkReorderCategoriesImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    groups,
  }: {
    workspaceId: Id<'workspace'>;
    groups: BulkReorderCategoriesGroupSpec[];
  }
): Promise<{ success: true; updatedCount: number }> {
  if (groups.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  const seenCategoryIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  // Archived and system categories are silently skipped (they're hidden from the active
  // list, so reordering them is a no-op). Build the effective per-group order here.
  const effectiveSpecs: BulkReorderCategoriesGroupSpec[] = [];

  for (const spec of groups) {
    if (seenGroupIds.has(spec.categoryGroupId)) {
      throw new ConvexError(`Duplicate categoryGroupId in groups: ${spec.categoryGroupId}`);
    }
    seenGroupIds.add(spec.categoryGroupId);

    const group = await ctx.db.get(spec.categoryGroupId);
    if (!group || group.workspaceId !== workspaceId || group.isDeleted) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }

    const orderedSet = new Set(spec.orderedCategoryIds);
    if (orderedSet.size !== spec.orderedCategoryIds.length) {
      throw new ConvexError(`Duplicate categoryId within group ${spec.categoryGroupId}`);
    }

    const effectiveOrderedIds: Id<'category'>[] = [];

    for (const categoryId of spec.orderedCategoryIds) {
      if (seenCategoryIds.has(categoryId)) {
        throw new ConvexError(`Category ${categoryId} listed in more than one group`);
      }
      seenCategoryIds.add(categoryId);

      const category = await ctx.db.get(categoryId);
      if (!category || category.workspaceId !== workspaceId || category.isDeleted) {
        throw new ConvexError('Category not found or does not belong to workspace');
      }
      if (category.isSystemCategory || category.isArchived) {
        continue;
      }
      if (category.categoryType === 'credit_card' && group.type !== 'credit_card') {
        throw new ConvexError(`Cannot move credit card category ${category.name} out of the credit card group`);
      }
      if (category.categoryType !== 'credit_card' && group.type === 'credit_card') {
        throw new ConvexError(`Cannot move non-credit card category ${category.name} into the credit card group`);
      }

      effectiveOrderedIds.push(categoryId);
    }

    effectiveSpecs.push({ categoryGroupId: spec.categoryGroupId, orderedCategoryIds: effectiveOrderedIds });
  }

  const timestamp = new Date().toISOString();
  let updatedCount = 0;
  const touchedGroupIds = new Set<Id<'categoryGroup'>>();

  for (const spec of effectiveSpecs) {
    const existing = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', workspaceId).eq('categoryGroupId', spec.categoryGroupId)
      )
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const orderedSet = new Set<Id<'category'>>(spec.orderedCategoryIds);
    // Skip system + archived from the unlisted tail so their sortOrder isn't churned.
    const unlisted = existing
      .filter((c) => !orderedSet.has(c._id) && !c.isSystemCategory && !c.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c._id);

    const finalOrder: Id<'category'>[] = [...spec.orderedCategoryIds, ...unlisted];

    for (let i = 0; i < finalOrder.length; i++) {
      await ctx.db.patch(finalOrder[i], {
        categoryGroupId: spec.categoryGroupId,
        sortOrder: i * SORT_ORDER_GAP,
        updatedAt: timestamp,
      });
      updatedCount++;
    }
    touchedGroupIds.add(spec.categoryGroupId);
  }

  // Cross-group moves can leave the source group with sortOrder gaps. Restructure any
  // source group that wasn't itself reordered, so its remaining categories renumber cleanly.
  const sourceGroupIds = new Set<Id<'categoryGroup'>>();
  for (const categoryId of seenCategoryIds) {
    const cat = await ctx.db.get(categoryId as Id<'category'>);
    if (cat && !touchedGroupIds.has(cat.categoryGroupId)) {
      sourceGroupIds.add(cat.categoryGroupId);
    }
  }
  for (const sourceGroupId of sourceGroupIds) {
    await restructureCategorySortOrders(ctx, sourceGroupId);
  }

  return { success: true, updatedCount };
}

/**
 * MCP entry point. Accepts raw strings for category and group ids so a hallucinated
 * id from the LLM doesn't trip Convex's argument validator and abort the whole batch.
 * Invalid / wrong-table category ids are silently dropped (same as archived ones);
 * an invalid group id is a real error and throws.
 */
export const bulkReorderCategoriesForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    groups: v.array(
      v.object({
        categoryGroupId: v.string(),
        orderedCategoryIds: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, { workspaceId, groups }) => {
    const normalizedGroups: BulkReorderCategoriesGroupSpec[] = groups.map((spec) => {
      const categoryGroupId = ctx.db.normalizeId('categoryGroup', spec.categoryGroupId);
      if (!categoryGroupId) {
        throw new ConvexError(`Invalid category group id: ${spec.categoryGroupId}`);
      }
      const orderedCategoryIds: Id<'category'>[] = [];
      for (const id of spec.orderedCategoryIds) {
        const normalized = ctx.db.normalizeId('category', id);
        if (normalized) {
          orderedCategoryIds.push(normalized);
        }
      }
      return { categoryGroupId, orderedCategoryIds };
    });
    return bulkReorderCategoriesImpl(ctx, { workspaceId, groups: normalizedGroups });
  },
});

export type CategorySortMode =
  | 'name_asc'
  | 'name_desc'
  | 'target_due_date_asc'
  | 'target_due_date_desc'
  | 'created_asc'
  | 'created_desc';

/**
 * Pick the comparable due-date string for a category's target. ISO dates sort lexicographically,
 * so we don't need a Date parse. Returns null when no meaningful date is associated with the
 * target (e.g. maintain_balance with no targetDate, or no target at all) — those rows sink to
 * the bottom of a target-date sort regardless of direction.
 */
function categoryTargetDateKey(category: {
  target_type?: string;
  target_targetDate?: string;
  target_firstDueDate?: string;
}): string | null {
  if (!category.target_type) return null;
  if (category.target_type === 'one_time') {
    return category.target_targetDate ?? null;
  }
  if (category.target_type === 'recurring' || category.target_type === 'recurring_rollover') {
    return category.target_firstDueDate ?? null;
  }
  // maintain_balance — targetDate is informational; use it when present.
  return category.target_targetDate ?? null;
}

/**
 * Build a name-sort key that strips leading decoration (emoji, symbols, punctuation,
 * whitespace) so "🛒 Groceries" sorts under G, not under whichever code point the
 * emoji happens to have. Falls back to the trimmed original when stripping leaves
 * the key empty (e.g. a category named just "🎉").
 */
function nameSortKey(name: string): string {
  const stripped = name.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return stripped.length > 0 ? stripped : name.trim();
}

function compareCategoriesBy<
  T extends {
    name: string;
    _creationTime: number;
    target_type?: string;
    target_targetDate?: string;
    target_firstDueDate?: string;
  },
>(a: T, b: T, mode: CategorySortMode): number {
  switch (mode) {
    case 'name_asc':
      return nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, { sensitivity: 'base' });
    case 'name_desc':
      return nameSortKey(b.name).localeCompare(nameSortKey(a.name), undefined, { sensitivity: 'base' });
    case 'created_asc':
      return a._creationTime - b._creationTime;
    case 'created_desc':
      return b._creationTime - a._creationTime;
    case 'target_due_date_asc':
    case 'target_due_date_desc': {
      const ak = categoryTargetDateKey(a);
      const bk = categoryTargetDateKey(b);
      // Categories without a date always sort to the bottom, regardless of direction —
      // a "no date" item has no meaningful position in either order.
      if (ak === null && bk === null) {
        return nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, { sensitivity: 'base' });
      }
      if (ak === null) return 1;
      if (bk === null) return -1;
      return mode === 'target_due_date_asc' ? ak.localeCompare(bk) : bk.localeCompare(ak);
    }
  }
}

export async function sortCategoriesImpl(
  ctx: MutationCtx,
  {
    workspaceId,
    categoryGroupId,
    sortBy,
  }: {
    workspaceId: Id<'workspace'>;
    /** Optional. When provided, only sorts categories within this group. Otherwise sorts every group. */
    categoryGroupId?: Id<'categoryGroup'>;
    sortBy: CategorySortMode;
  }
): Promise<{ success: true; sortedGroupCount: number; updatedCount: number }> {
  let targetGroupIds: Id<'categoryGroup'>[];
  if (categoryGroupId) {
    const group = await ctx.db.get(categoryGroupId);
    if (!group || group.workspaceId !== workspaceId || group.isDeleted) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }
    targetGroupIds = [categoryGroupId];
  } else {
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();
    targetGroupIds = allGroups.map((g) => g._id);
  }

  const specs: BulkReorderCategoriesGroupSpec[] = [];

  for (const groupId of targetGroupIds) {
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId_categoryGroupId', (q) =>
        q.eq('workspaceId', workspaceId).eq('categoryGroupId', groupId)
      )
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const sortable = categories.filter((c) => !c.isSystemCategory && !c.isArchived);
    if (sortable.length === 0) continue;

    sortable.sort((a, b) => compareCategoriesBy(a, b, sortBy));
    specs.push({ categoryGroupId: groupId, orderedCategoryIds: sortable.map((c) => c._id) });
  }

  if (specs.length === 0) {
    return { success: true, sortedGroupCount: 0, updatedCount: 0 };
  }

  const result = await bulkReorderCategoriesImpl(ctx, { workspaceId, groups: specs });
  return { success: true, sortedGroupCount: specs.length, updatedCount: result.updatedCount };
}

export const sortCategoriesForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryGroupId: v.optional(v.string()),
    sortBy: v.union(
      v.literal('name_asc'),
      v.literal('name_desc'),
      v.literal('target_due_date_asc'),
      v.literal('target_due_date_desc'),
      v.literal('created_asc'),
      v.literal('created_desc')
    ),
  },
  handler: async (ctx, { workspaceId, categoryGroupId, sortBy }) => {
    let normalizedGroupId: Id<'categoryGroup'> | undefined;
    if (categoryGroupId !== undefined) {
      const n = ctx.db.normalizeId('categoryGroup', categoryGroupId);
      if (!n) {
        throw new ConvexError(`Invalid category group id: ${categoryGroupId}`);
      }
      normalizedGroupId = n;
    }
    return sortCategoriesImpl(ctx, { workspaceId, categoryGroupId: normalizedGroupId, sortBy });
  },
});
