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

type UpdateCategoryTargetArgs = {
  workspaceId: Id<'workspace'>;
  categoryId: Id<'category'>;
  targetType?: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
  amount?: number;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  frequencyInterval?: number;
  dayOfWeek?: number | null;
  dueDay?: number | null;
  firstDueDate?: string;
  targetDate?: string | null;
  monthlyContribution?: number | null;
  targetBalance?: number | null;
  attribution: ActivityAttribution;
};

export async function updateCategoryTargetImpl(
  ctx: MutationCtx,
  args: UpdateCategoryTargetArgs
): Promise<Id<'category'>> {
  const category = await ctx.db.get(args.categoryId);
  if (!category || category.workspaceId !== args.workspaceId || category.isDeleted) {
    throw new ConvexError('Category not found');
  }

  if (category.enableTarget !== true) {
    throw new ConvexError('Category does not have a target');
  }

  const updates: Partial<typeof category> = {
    enableTarget: true,
    updatedAt: new Date().toISOString(),
  };

  if (args.targetType !== undefined) {
    updates.target_type = args.targetType;
  }

  if (args.amount !== undefined) {
    updates.target_amount = BigInt(args.amount);
  }

  if (args.frequency !== undefined) {
    updates.target_frequency = args.frequency;
  }

  if (args.frequencyInterval !== undefined) {
    updates.target_frequencyInterval = args.frequencyInterval;
  }

  if (args.dayOfWeek !== undefined) {
    updates.target_dayOfWeek = args.dayOfWeek === null ? undefined : args.dayOfWeek;
  }

  if (args.dueDay !== undefined) {
    updates.target_dueDay = args.dueDay === null ? undefined : args.dueDay;
  }

  if (args.firstDueDate !== undefined) {
    updates.target_firstDueDate = args.firstDueDate;
  }

  if (args.targetDate !== undefined) {
    updates.target_targetDate = args.targetDate === null ? undefined : args.targetDate;
  }

  if (args.monthlyContribution !== undefined) {
    updates.target_monthlyContribution =
      args.monthlyContribution === null ? undefined : BigInt(args.monthlyContribution);
  }

  if (args.targetBalance !== undefined) {
    updates.target_targetBalance = args.targetBalance === null ? undefined : BigInt(args.targetBalance);
  }

  const finalTargetType = updates.target_type ?? category.target_type;
  const finalFrequency = updates.target_frequency ?? category.target_frequency;

  if (finalTargetType === 'one_time') {
    const finalTargetDate = updates.target_targetDate ?? category.target_targetDate;
    if (!finalTargetDate) {
      throw new ConvexError('targetDate is required for one_time targets');
    }
  } else {
    if (!finalFrequency) {
      throw new ConvexError('frequency is required for this target type');
    }
    if (finalFrequency === 'weekly') {
      const finalDayOfWeek = updates.target_dayOfWeek ?? category.target_dayOfWeek;
      if (finalDayOfWeek === undefined) {
        throw new ConvexError('dayOfWeek is required for weekly frequency');
      }
    }
  }

  if (finalTargetType === 'maintain_balance') {
    const finalMonthlyContribution = updates.target_monthlyContribution ?? category.target_monthlyContribution;
    if (finalMonthlyContribution === undefined) {
      throw new ConvexError('monthlyContribution is required for maintain_balance targets');
    }
  }

  await ctx.db.patch(args.categoryId, updates);
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
 * Update an existing category target
 * Updates target fields directly on the category
 */
export const updateCategoryTarget = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetType: v.optional(targetTypeValidator),
    amount: v.optional(v.number()),
    frequency: v.optional(frequencyValidator),
    frequencyInterval: v.optional(v.number()),
    dayOfWeek: v.optional(v.union(v.number(), v.null())),
    dueDay: v.optional(v.union(v.number(), v.null())),
    firstDueDate: v.optional(v.string()),
    targetDate: v.optional(v.union(v.string(), v.null())),
    monthlyContribution: v.optional(v.union(v.number(), v.null())),
    targetBalance: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return updateCategoryTargetImpl(ctx, {
      ...args,
      workspaceId: verifiedWorkspaceId,
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
  },
});

export const updateCategoryTargetForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    targetType: v.optional(targetTypeValidator),
    amount: v.optional(v.number()),
    frequency: v.optional(frequencyValidator),
    frequencyInterval: v.optional(v.number()),
    dayOfWeek: v.optional(v.union(v.number(), v.null())),
    dueDay: v.optional(v.union(v.number(), v.null())),
    firstDueDate: v.optional(v.string()),
    targetDate: v.optional(v.union(v.string(), v.null())),
    monthlyContribution: v.optional(v.union(v.number(), v.null())),
    targetBalance: v.optional(v.union(v.number(), v.null())),
    attribution: activityAttributionValidator,
  },
  handler: updateCategoryTargetImpl,
});
