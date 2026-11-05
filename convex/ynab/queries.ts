/**
 * Public queries for YNAB import status
 */

import { query } from '../_generated/server';
import { requireAuth } from '../lib/auth';

/**
 * Get current YNAB import status for the authenticated user
 * Used by the frontend to poll for import progress
 */
export const getYnabImportStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);

    const userProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .first();

    if (!userProfile) {
      return null;
    }

    const status = await ctx.db
      .query('ynabImportStatus')
      .withIndex('by_userId', (q) => q.eq('userId', userProfile._id))
      .first();

    if (!status) {
      return null;
    }

    return {
      status: status.status,
      errorMessage: status.errorMessage,
      progress: status.progress,
      workspaceId: status.workspaceId,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
    };
  },
});
