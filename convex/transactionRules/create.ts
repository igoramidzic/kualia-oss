import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { actionsValidator, conditionsValidator } from './types';

export const createRule = mutation({
  args: {
    name: v.string(),
    isActive: v.boolean(),
    priority: v.optional(v.number()),
    conditions: conditionsValidator,
    actions: actionsValidator,
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { name, isActive, priority, conditions, actions, workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    // Validate between operator has valueTo
    if (conditions.amount) {
      for (const cond of conditions.amount) {
        if (cond.operator === 'between' && cond.valueTo === undefined) {
          throw new ConvexError('Between operator requires valueTo value');
        }
      }
    }

    // Auto-assign priority if not provided
    let rulePriority = priority;
    if (rulePriority === undefined) {
      const existingRules = await ctx.db
        .query('transactionRule')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      const maxPriority = existingRules.reduce((max, r) => Math.max(max, r.priority), -1);
      rulePriority = maxPriority + 1;
    }

    const now = new Date().toISOString();

    const id = await ctx.db.insert('transactionRule', {
      name,
      workspaceId,
      isActive,
      priority: rulePriority,
      conditions,
      actions,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });

    return id;
  },
});
