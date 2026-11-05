import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { listSubscriptionsForClerkId } from '../lib/appAccess';

interface UserProfileWithRevenueCatIds {
  clerkId: string;
  email: string;
  name: string | undefined;
  revenueCatCustomerIds: string[];
}

function uniqueNonEmptyValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter((value) => value.length > 0))];
}

/**
 * Internal query to get all user profiles (used by dashboard sync actions)
 */
export const getAllUserProfiles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('userProfile').collect();
    const results: UserProfileWithRevenueCatIds[] = [];

    for (const profile of profiles) {
      const subscriptions = await listSubscriptionsForClerkId(ctx, profile.clerkId);
      const customerAliases = await ctx.db
        .query('revenueCatCustomerAlias')
        .withIndex('by_clerkId_and_isDeleted', (q) => q.eq('clerkId', profile.clerkId).eq('isDeleted', false))
        .take(100);

      results.push({
        clerkId: profile.clerkId,
        email: profile.email,
        name: profile.name,
        revenueCatCustomerIds: uniqueNonEmptyValues(
          subscriptions
            .map((subscription) => subscription.revenueCatSubscriberId)
            .concat(customerAliases.map((alias) => alias.customerId))
        ),
      });
    }

    return results;
  },
});

/**
 * Get all expired subscriptions where expiresAt is more than a specified number of days ago
 * Used by the expired subscription cleanup job
 */
export const getExpiredSubscriptions = internalQuery({
  args: {
    expiredBeforeDate: v.string(), // ISO date string
  },
  handler: async (ctx, { expiredBeforeDate }) => {
    const subscriptions = await ctx.db
      .query('subscription')
      .withIndex('by_status_isDeleted', (q) => q.eq('status', 'expired').eq('isDeleted', false))
      .collect();

    // Filter to those expired before the specified date
    return subscriptions.filter((sub) => {
      if (!sub.expiresAt) return false;
      return new Date(sub.expiresAt) < new Date(expiredBeforeDate);
    });
  },
});

/**
 * Get all subscriptions for a user (to check for exemptions like lifetime, promotional, or active)
 */
export const getAllSubscriptionsForUser = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }) => {
    return await listSubscriptionsForClerkId(ctx, clerkId);
  },
});
