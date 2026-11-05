import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { buildActivityContext, recordCategoryActivity } from '../activityLogs/helpers';
import { activityAttributionValidator, type ActivityAttribution } from '../activityLogs/types';
import { requireWorkspaceAccess } from '../lib/auth';

const targetTypeValidator = v.union(
  v.literal('recurring'),
  v.literal('recurring_rollover'),
  v.literal('maintain_balance'),
  v.literal('one_time')
);

const frequencyValidator = v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly'), v.literal('yearly'));

type CreateCategoryTargetArgs = {
  categoryId: Id<'category'>;
  targetType: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
  amount: number;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  frequencyInterval?: number;
  dayOfWeek?: number;
  dueDay?: number;
  firstDueDate?: string;
  targetDate?: string;
  monthlyContribution?: number;
  targetBalance?: number;
};

export async function createCategoryTargetImpl(
  ctx: MutationCtx,
  args: CreateCategoryTargetArgs & { workspaceId: Id<'workspace'>; attribution: ActivityAttribution }
): Promise<Id<'category'>> {
  const category = await ctx.db.get(args.categoryId);
  if (!category || category.workspaceId !== args.workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found');
  }

  if (category.categoryType === 'credit_card') {
    throw new ConvexError('Cannot set a target on a credit card category');
  }

  if (category.enableTarget === true) {
    throw new ConvexError('A target already exists for this category. Please delete the existing target first.');
  }

  if (args.targetType === 'one_time') {
    if (!args.targetDate) {
      throw new ConvexError('targetDate is required for one_time targets');
    }
    const targetDateObj = new Date(args.targetDate);
    const now = new Date();
    if (targetDateObj <= now) {
      throw new ConvexError('targetDate must be in the future for one_time targets');
    }
  } else {
    if (!args.frequency) {
      throw new ConvexError('frequency is required for this target type');
    }
    if (!args.frequencyInterval) {
      throw new ConvexError('frequencyInterval is required for this target type');
    }
    if (args.frequency === 'weekly' && args.dayOfWeek === undefined) {
      throw new ConvexError('dayOfWeek is required for weekly frequency');
    }
  }

  if (args.targetType === 'maintain_balance' && args.monthlyContribution === undefined) {
    throw new ConvexError('monthlyContribution is required for maintain_balance targets');
  }

  let firstDueDate = args.firstDueDate;
  if (!firstDueDate && (args.targetType === 'recurring' || args.targetType === 'recurring_rollover')) {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    firstDueDate = `${year}-${month}-01`;
  }

  if (args.dayOfWeek !== undefined && (args.dayOfWeek < 0 || args.dayOfWeek > 6)) {
    throw new ConvexError('dayOfWeek must be between 0 (Sunday) and 6 (Saturday)');
  }

  if (args.dueDay !== undefined && args.dueDay !== -1 && (args.dueDay < 1 || args.dueDay > 31)) {
    throw new ConvexError('dueDay must be between 1 and 31, or -1 for last day of month');
  }

  const now = new Date().toISOString();

  await ctx.db.patch(args.categoryId, {
    enableTarget: true,
    target_type: args.targetType,
    target_amount: BigInt(args.amount),
    target_frequency: args.frequency,
    target_frequencyInterval: args.frequencyInterval,
    target_dayOfWeek: args.dayOfWeek,
    target_dueDay: args.dueDay,
    target_firstDueDate: firstDueDate ?? '',
    target_targetDate: args.targetDate,
    target_monthlyContribution: args.monthlyContribution ? BigInt(args.monthlyContribution) : undefined,
    target_targetBalance: args.targetBalance ? BigInt(args.targetBalance) : undefined,
    updatedAt: now,
  });
  const updatedCategory = await ctx.db.get(args.categoryId);
  if (updatedCategory) {
    await recordCategoryActivity(ctx, {
      workspaceId: args.workspaceId,
      context: await buildActivityContext(ctx, args.attribution),
      type: 'category_updated',
      before: category,
      after: updatedCategory,
    });
  }

  return args.categoryId;
}

/**
 * Create a new category target
 * Sets target fields directly on the category
 * Only one target per category is allowed - will fail if target already exists
 */
export const createCategoryTarget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetType: targetTypeValidator,
    amount: v.number(),
    frequency: v.optional(frequencyValidator),
    frequencyInterval: v.optional(v.number()),
    dayOfWeek: v.optional(v.number()),
    dueDay: v.optional(v.number()),
    firstDueDate: v.optional(v.string()),
    targetDate: v.optional(v.string()),
    monthlyContribution: v.optional(v.number()),
    targetBalance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return createCategoryTargetImpl(ctx, {
      ...args,
      workspaceId: verifiedWorkspaceId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

export const createCategoryTargetForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetType: targetTypeValidator,
    amount: v.number(),
    frequency: v.optional(frequencyValidator),
    frequencyInterval: v.optional(v.number()),
    dayOfWeek: v.optional(v.number()),
    dueDay: v.optional(v.number()),
    firstDueDate: v.optional(v.string()),
    targetDate: v.optional(v.string()),
    monthlyContribution: v.optional(v.number()),
    targetBalance: v.optional(v.number()),
    attribution: activityAttributionValidator,
  },
  handler: createCategoryTargetImpl,
});
