import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

/**
 * Get workspace member emails.
 * Returns array of user emails for the workspace
 */
export const getWorkspaceMembers = internalAction({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    // Log the workspace ID for debugging
    console.log(`[getWorkspaceMembers] Fetching members for workspace ID: ${workspaceId}`);

    try {
      const clerkIds = await ctx.runQuery(internal.workspaces.getWorkspaceMemberClerkIds, {
        workspaceId,
      });

      // Extract emails from user profiles
      const emails: string[] = [];

      for (const clerkId of clerkIds) {
        // Get user profile by clerkId to get email
        const userProfile = await ctx.runQuery(internal.clerk.getUserByClerkId, {
          clerkId,
        });

        if (userProfile?.email) {
          emails.push(userProfile.email);
        }
      }

      console.log(`[getWorkspaceMembers] Found ${emails.length} member emails for workspace ${workspaceId}`);
      return emails;
    } catch (error) {
      console.error('[getWorkspaceMembers] Error fetching workspace members:', error);
      throw error;
    }
  },
});
