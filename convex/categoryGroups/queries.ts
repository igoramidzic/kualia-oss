import { ConvexError, v } from 'convex/values';

import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Get all category groups for a workspace
 */
export const listCategoryGroups = query({
  args: {
    workspaceId: v.id('workspace'),
    type: v.optional(v.union(v.literal('expense'), v.literal('credit_card'))),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, type, includeDeleted = false }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get workspace-specific groups
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    const filtered = allGroups.filter((g) => {
      const matchesDeleted = includeDeleted || !g.isDeleted;
      const matchesType = !type || g.type === type;
      return matchesDeleted && matchesType;
    });

    // Sort by sortOrder, then by name
    return filtered.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.name.localeCompare(b.name);
    });
  },
});

/**
 * Get a specific category group by ID
 */
export const getCategoryGroup = query({
  args: {
    categoryGroupId: v.id('categoryGroup'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { categoryGroupId, workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const categoryGroup = await ctx.db.get(categoryGroupId);
    if (!categoryGroup) {
      throw new ConvexError('Category group not found');
    }

    // Verify workspace ownership
    if (categoryGroup.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category group not found or does not belong to workspace');
    }

    return categoryGroup;
  },
});

/**
 * Get all archived (soft-deleted) category groups for a workspace
 */
export const listArchivedCategoryGroups = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const categoryGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), true))
      .collect();

    // Sort by deletion date (newest first)
    return categoryGroups.sort((a, b) => {
      if (!a.deletedAt && !b.deletedAt) return 0;
      if (!a.deletedAt) return 1;
      if (!b.deletedAt) return -1;
      return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
    });
  },
});
