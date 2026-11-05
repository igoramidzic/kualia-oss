import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { requireWorkspaceManagementAccess } from '../lib/auth';

/**
 * Delete a workspace (soft delete)
 */
export const deleteWorkspace = mutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceManagementAccess(ctx, workspaceId);

    const workspace = await ctx.db.get(verifiedWorkspaceId);
    if (!workspace || workspace.isDeleted) {
      throw new ConvexError('Workspace not found');
    }

    const timestamp = new Date().toISOString();

    await ctx.db.patch(verifiedWorkspaceId, {
      isDeleted: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
    });

    return { success: true };
  },
});
