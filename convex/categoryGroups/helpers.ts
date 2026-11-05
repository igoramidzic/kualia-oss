import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';

export const SORT_ORDER_GAP = 100; // Gap between items (0, 100, 200, 300...)
export const MIN_GAP_THRESHOLD = 10; // Restructure when gap < 10

/**
 * Calculate a sortOrder value between two existing values
 */
export function calculateSortOrderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) {
    return 0;
  }
  if (prev === null) {
    // Insert before first item (allow negative values for correct ordering)
    return next! - SORT_ORDER_GAP;
  }
  if (next === null) {
    // Insert after last item
    return prev + SORT_ORDER_GAP;
  }
  // Insert between two items
  const gap = next - prev;
  if (gap < MIN_GAP_THRESHOLD) {
    // Gap too small, return midpoint (will trigger restructuring)
    return Math.floor((prev + next) / 2);
  }
  return Math.floor((prev + next) / 2);
}

/**
 * Restructure sortOrder values for category groups in a workspace
 * Renumbers all groups with gaps of SORT_ORDER_GAP
 */
export async function restructureCategoryGroupSortOrders(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<void> {
  const groups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  // Sort by current sortOrder
  const sortedGroups = groups.sort((a, b) => a.sortOrder - b.sortOrder);

  // Renumber with gaps
  const timestamp = new Date().toISOString();
  for (let i = 0; i < sortedGroups.length; i++) {
    await ctx.db.patch(sortedGroups[i]._id, {
      sortOrder: i * SORT_ORDER_GAP,
      updatedAt: timestamp,
    });
  }
}

/**
 * Get or create the workspace-specific "Credit Card" category group
 * This is a helper function used internally
 */
export async function getOrCreateCreditCardCategoryGroup(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<Id<'categoryGroup'>> {
  // Check if credit card group already exists for this workspace
  const existingGroup = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId_type', (q) => q.eq('workspaceId', workspaceId).eq('type', 'credit_card'))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .first();

  if (existingGroup) {
    return existingGroup._id;
  }

  // Create the workspace-specific credit card group
  // Get max sortOrder from existing workspace groups to place it at the end
  const workspaceGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  const maxSortOrder = workspaceGroups.length > 0 ? Math.max(...workspaceGroups.map((g) => g.sortOrder)) : -1;

  const groupId = await ctx.db.insert('categoryGroup', {
    name: 'Credit Card',
    type: 'credit_card',
    workspaceId,
    sortOrder: maxSortOrder + SORT_ORDER_GAP,
    isSystemGroup: true,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  });

  return groupId;
}

/**
 * Internal mutation to ensure credit card category group exists
 * Can be called from migrations or other internal mutations
 */
export const ensureCreditCardCategoryGroup = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    return await getOrCreateCreditCardCategoryGroup(ctx, workspaceId);
  },
});
