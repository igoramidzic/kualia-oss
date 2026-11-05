import { v } from 'convex/values';

import { query } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { listAccessibleWorkspacesForClerkId } from '../workspaces/access';

/**
 * Get the current user's profile
 */
export const getCurrentProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const userProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', user.subject))
      .first();

    if (!userProfile || userProfile.isDeleted === true) {
      return null;
    }

    // Determine onboarding status
    // For existing users without the field (before migration), check if they have workspaces
    // Cast to handle the transition period where existing docs may not have the field
    let onboardingCompleted = userProfile.onboardingCompleted as boolean | undefined;

    if (onboardingCompleted === undefined) {
      // Existing users with workspace access are considered onboarded
      const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, user.subject);
      onboardingCompleted = accessibleWorkspaces.length > 0;
    }

    return {
      _id: userProfile._id,
      name: userProfile.name,
      email: userProfile.email,
      clerkId: userProfile.clerkId,
      updatedAt: userProfile.updatedAt,
      activeWorkspaceId: userProfile.activeWorkspaceId,
      onboardingCompleted,
      // @deprecated - kept for backward compatibility with older iOS clients
      isV1User: userProfile.isV1User ?? false,
      notificationsEnabled: userProfile.notificationsEnabled ?? false,
      notificationPreferences: userProfile.notificationPreferences,
      checkIn: userProfile.checkIn,
    };
  },
});

/**
 * Get a user profile by ID (used for workspace member listings)
 */
export const getProfileById = query({
  args: {
    profileId: v.id('userProfile'),
  },
  handler: async (ctx, { profileId }) => {
    // Ensure user is authenticated
    await requireAuth(ctx);

    const userProfile = await ctx.db.get(profileId);

    if (!userProfile || userProfile.isDeleted === true) {
      return null;
    }

    return {
      _id: userProfile._id,
      name: userProfile.name,
      updatedAt: userProfile.updatedAt,
    };
  },
});

/**
 * Search user profiles by name (for adding workspace members)
 */
export const searchProfiles = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { searchTerm, limit = 10 }) => {
    // Ensure user is authenticated
    await requireAuth(ctx);

    if (searchTerm.length < 2) {
      return [];
    }

    // Simple search by name (case-insensitive)
    const profiles = await ctx.db
      .query('userProfile')
      .filter((q) => q.gte(q.field('name'), searchTerm.toLowerCase()))
      .take(limit);

    return profiles
      .filter((profile) => profile.isDeleted !== true)
      .map((profile) => ({
        _id: profile._id,
        updatedAt: profile.updatedAt,
      }));
  },
});
