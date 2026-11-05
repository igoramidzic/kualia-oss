import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { calculateTargetForMonth, getCurrentYearMonth } from './helpers';
import type { CategoryTarget, CategoryTargetWithCalculation, ValidCategoryTarget } from './types';
import { extractTarget } from './types';

/**
 * Get a single category target by category ID
 * Extracts target from category fields
 * @deprecated Use extractTarget helper directly on the category object instead.
 * This query is kept for backwards compatibility only.
 */
export const getCategoryTarget = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
  },
  handler: async (ctx, { workspaceId, categoryId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    // Get the category
    const category = await ctx.db.get(categoryId);
    if (!category) {
      return null;
    }

    // Extract target from category fields
    const target = extractTarget(category);

    return target;
  },
});

/**
 * Get all category targets for a workspace
 * Returns targets extracted from all categories that have targets
 */
export const listCategoryTargets = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    // Get all categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Extract targets from categories that have them enabled
    const targets: CategoryTarget[] = [];
    for (const category of categories) {
      if (category.enableTarget === true) {
        const target = extractTarget(category);
        targets.push(target);
      }
    }

    return targets;
  },
});

/**
 * Get category targets with calculations for a specific month
 * Used by the budget screen to show target progress
 */
export const listCategoryTargetsWithCalculations = query({
  args: {
    workspaceId: v.id('workspace'),
    yearMonth: v.number(),
    currentYearMonth: v.optional(v.number()), // Defaults to actual current month if not provided
  },
  handler: async (ctx, { workspaceId, yearMonth, currentYearMonth }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    // Use provided currentYearMonth or default to actual current month
    const effectiveCurrentYearMonth = currentYearMonth ?? getCurrentYearMonth();

    // Get all categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // For each category with a target, calculate the assignment for the requested month
    const targetsWithCalculations: CategoryTargetWithCalculation[] = [];

    for (const category of categories) {
      if (category.enableTarget !== true) {
        continue;
      }

      const targetData = extractTarget(category);
      // Cast to ValidCategoryTarget since we've validated enableTarget is true
      const target = targetData as ValidCategoryTarget;

      // Get previous month's carryover for the category
      // This would come from the category budget calculation
      // For now, we'll use 0n as placeholder - this will be integrated with budget queries
      const previousMonthCarryover = 0n;
      const currentBalance = 0n;
      const assignedAmount = 0n;

      const calculation = calculateTargetForMonth({
        target,
        yearMonth,
        currentYearMonth: effectiveCurrentYearMonth,
        previousMonthCarryover,
        currentBalance,
        assignedAmount,
      });

      targetsWithCalculations.push({
        ...target,
        calculation,
      });
    }

    return targetsWithCalculations;
  },
});

/**
 * Get a map of category targets keyed by categoryId
 * Useful for efficient lookups when rendering budget rows
 */
export const getCategoryTargetMapByCategories = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryIds: v.array(v.id('category')),
  },
  handler: async (ctx, { workspaceId, categoryIds }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    const targetMap = new Map<Id<'category'>, CategoryTarget>();

    // Batch fetch all categories for the workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Filter to requested categories and extract targets
    const categoryIdSet = new Set(categoryIds);
    for (const category of categories) {
      if (!categoryIdSet.has(category._id)) {
        continue;
      }

      if (category.enableTarget === true) {
        const target = extractTarget(category);
        targetMap.set(category._id, target);
      }
    }

    return Object.fromEntries(targetMap);
  },
});
