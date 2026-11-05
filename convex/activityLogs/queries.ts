import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

export const BUDGET_HISTORY_LIMIT = 100;

export async function getBudgetHistory(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  since: string
): Promise<{ entries: Doc<'activityLog'>[]; hasMore: boolean }> {
  const entries = await ctx.db
    .query('activityLog')
    .withIndex('by_workspaceId_and_type_and_occurredAt', (q) =>
      q.eq('workspaceId', workspaceId).eq('type', 'money_moved').gte('occurredAt', since)
    )
    .order('desc')
    .take(BUDGET_HISTORY_LIMIT + 1);

  return {
    entries: entries.slice(0, BUDGET_HISTORY_LIMIT),
    hasMore: entries.length > BUDGET_HISTORY_LIMIT,
  };
}

export const listActivity = query({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    return await ctx.db
      .query('activityLog')
      .withIndex('by_workspaceId_and_occurredAt', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .paginate(args.paginationOpts);
  },
});

export const listBudgetHistory = query({
  args: {
    workspaceId: v.id('workspace'),
    since: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    return await getBudgetHistory(ctx, workspaceId, args.since);
  },
});
