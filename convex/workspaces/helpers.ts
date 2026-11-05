import { Doc } from '../_generated/dataModel';
import { QueryCtx } from '../_generated/server';
import { countOverspentCategoriesForWorkspace } from '../categoryBudgets/queries';
import { getCurrentYearMonthForTimezone } from '../lib/dates';

/**
 * Constant used for spacing sort orders in category groups and categories
 */
export const SORT_ORDER_GAP = 100;

/** Navigation only needs presence, so transaction reads stop at the first match. */
export async function calculateWorkspaceNavigationAttention(ctx: QueryCtx, workspace: Doc<'workspace'>) {
  const workspaceId = workspace._id;
  const currentMonth = getCurrentYearMonthForTimezone(workspace.timezone);
  const [overspentCount, uncategorized, missingPayee, needsReview] = await Promise.all([
    countOverspentCategoriesForWorkspace(ctx, workspaceId, currentMonth),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
      )
      .first(),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
      )
      .first(),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
      )
      .first(),
  ]);
  return {
    workspaceId,
    currentMonth,
    timezone: workspace.timezone ?? 'UTC',
    hasOverspending: overspentCount > 0,
    hasOverassignment: (workspace.readyToAssign ?? 0n) < 0n,
    hasMissingCategory: uncategorized !== null,
    hasMissingPayee: missingPayee !== null,
    // Review status is shared across devices; opening the menu never marks entries reviewed.
    hasNewTransactions: needsReview !== null,
  };
}
