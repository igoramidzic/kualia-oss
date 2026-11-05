import { ConvexError, v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { getFavoriteCategoryIds } from './favorites';
import { enrichCategoryWithStats, enrichCategoryWithType } from './helpers';

/**
 * Get all categories for a workspace
 */
export const listCategories = query({
  args: {
    workspaceId: v.id('workspace'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, includeDeleted = false }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const favoriteCategoryIds = await getFavoriteCategoryIds(ctx, verifiedWorkspaceId, user.subject);

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    const filteredCategories = categories.filter((c) => (includeDeleted ? undefined : c.isDeleted === false));

    // Enrich categories with stats
    const enrichedCategories = await Promise.all(
      filteredCategories.map((c) => enrichCategoryWithStats(ctx, c, verifiedWorkspaceId))
    );

    return enrichedCategories.map((category) => ({
      ...category,
      isFavorite: favoriteCategoryIds.has(category._id),
    }));
  },
});

/**
 * Get all categories organized by category groups
 */
export const listCategoriesHierarchical = query({
  args: {
    workspaceId: v.id('workspace'),
    type: v.optional(v.union(v.literal('expense'), v.literal('credit_card'))),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, type, includeDeleted = false }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const favoriteCategoryIds = await getFavoriteCategoryIds(ctx, verifiedWorkspaceId, user.subject);

    // Get workspace-specific category groups
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    // Filter groups by type and deletion status
    const filteredGroups = allGroups.filter((g) => {
      const matchesDeleted = includeDeleted || !g.isDeleted;
      const matchesType = !type || g.type === type;
      return matchesDeleted && matchesType;
    });

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    // Filter categories by deletion status
    const filteredCategories = categories.filter((c) => includeDeleted || !c.isDeleted);

    // Build map of categories by group
    const categoriesByGroup = new Map<string, typeof filteredCategories>();

    filteredCategories.forEach((c) => {
      const groupId = c.categoryGroupId;
      if (!categoriesByGroup.has(groupId)) {
        categoriesByGroup.set(groupId, []);
      }
      categoriesByGroup.get(groupId)!.push(c);
    });

    // Build hierarchical structure: groups with their categories
    // Sort groups by sortOrder, then by name
    const sortedGroups = filteredGroups.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.name.localeCompare(b.name);
    });

    return sortedGroups.map((group) => {
      const groupCategories = categoriesByGroup.get(group._id) ?? [];
      // Sort categories by sortOrder, then by name
      const sortedCategories = groupCategories.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
      // Enrich categories with type from group
      const enrichedCategories = sortedCategories.map((cat) => ({
        ...cat,
        type: group.type,
        isFavorite: favoriteCategoryIds.has(cat._id),
      }));
      return {
        group,
        categories: enrichedCategories,
      };
    });
  },
});

/**
 * Internal query to get all categories organized by category groups (no auth required)
 * Used by internal actions like categorization
 */
export const internalListCategoriesHierarchical = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    type: v.optional(v.union(v.literal('expense'), v.literal('credit_card'))),
    includeDeleted: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, type, includeDeleted = false, includeArchived = true }) => {
    // Get workspace-specific category groups
    const allGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Filter groups by type and deletion status
    const filteredGroups = allGroups.filter((g) => {
      const matchesDeleted = includeDeleted || !g.isDeleted;
      const matchesType = !type || g.type === type;
      return matchesDeleted && matchesType;
    });

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Filter categories by deletion and archived status
    const filteredCategories = categories.filter(
      (c) => (includeDeleted || !c.isDeleted) && (includeArchived || !c.isArchived)
    );

    // Build map of categories by group
    const categoriesByGroup = new Map<string, typeof filteredCategories>();

    filteredCategories.forEach((c) => {
      const groupId = c.categoryGroupId;
      if (!categoriesByGroup.has(groupId)) {
        categoriesByGroup.set(groupId, []);
      }
      categoriesByGroup.get(groupId)!.push(c);
    });

    // Build hierarchical structure: groups with their categories
    return filteredGroups.map((group) => {
      const groupCategories = categoriesByGroup.get(group._id) ?? [];
      // Sort categories by sortOrder, then by name
      const sortedCategories = groupCategories.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
      // Enrich categories with type from group
      const enrichedCategories = sortedCategories.map((cat) => ({
        ...cat,
        type: group.type,
      }));
      return {
        group,
        categories: enrichedCategories,
      };
    });
  },
});

/**
 * Get a specific category by ID
 */
export const getCategory = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const category = await ctx.db.get(categoryId);
    if (!category) {
      throw new ConvexError('Category not found');
    }

    // Allow access to system categories or workspace-owned categories
    if (!category.isSystemCategory && category.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    // Enrich category with type from its group
    return await enrichCategoryWithType(ctx, category);
  },
});

/**
 * Get a specific category by ID with stats
 */
export const getCategoryWithStats = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const category = await ctx.db.get(categoryId);
    if (!category) {
      throw new ConvexError('Category not found');
    }

    // Allow access to system categories or workspace-owned categories
    if (!category.isSystemCategory && category.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    return await enrichCategoryWithStats(ctx, category, verifiedWorkspaceId);
  },
});

/**
 * Get category by short ID with stats
 */
export const getCategoryByShortIdWithStats = query({
  args: {
    workspaceId: v.id('workspace'),
    shortId: v.string(),
  },
  handler: async (ctx, { workspaceId, shortId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get all categories for this workspace (includes system categories with workspaceId)
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const category = categories.find((c) => c._id.slice(-8) === shortId);

    if (!category) {
      return null;
    }

    return await enrichCategoryWithStats(ctx, category, verifiedWorkspaceId);
  },
});

/**
 * Get all archived (soft-deleted) categories for a workspace
 */
export const listArchivedCategories = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), true))
      .collect();

    // Enrich categories with type from their groups
    const enrichedCategories = await Promise.all(categories.map((c) => enrichCategoryWithType(ctx, c)));

    // Sort by deletion date (newest first)
    return enrichedCategories.sort((a, b) => {
      if (!a.deletedAt && !b.deletedAt) return 0;
      if (!a.deletedAt) return 1;
      if (!b.deletedAt) return -1;
      return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
    });
  },
});
