import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

export const deleteRule = mutation({
  args: {
    id: v.id('transactionRule'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { id, workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const existing = await ctx.db.get(id);
    if (!existing || existing.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Rule not found or access denied');
    }

    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    });
  },
});
