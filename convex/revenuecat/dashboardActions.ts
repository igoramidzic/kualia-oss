import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  fetchRevenueCatPurchases,
  fetchRevenueCatSubscriptions,
  findActiveSubscription,
  selectPreferredActiveSubscription,
  type ActiveSubscription,
  type RevenueCatEnvironment,
} from './lib/revenueCatApi';

/**
 * Summary result from sync operation
 */
interface SyncSummary {
  totalUsers: number;
  synced: number;
  noSubscription: number;
  errors: number;
}

/**
 * User profile from database
 */
export interface UserProfileInfo {
  clerkId: string;
  email: string;
  name: string | undefined;
  revenueCatCustomerIds: string[];
}

export function getRevenueCatCustomerIdsForSync(user: UserProfileInfo): string[] {
  return [
    ...new Set([user.clerkId, ...user.revenueCatCustomerIds].map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
}

export interface RevenueCatSubscriptionMatch {
  customerId: string;
  subscription: ActiveSubscription;
}

export function selectPreferredRevenueCatSubscriptionMatch(
  matches: RevenueCatSubscriptionMatch[]
): RevenueCatSubscriptionMatch | null {
  const selectedSubscription = selectPreferredActiveSubscription(matches.map((match) => match.subscription));
  return matches.find((match) => match.subscription === selectedSubscription) ?? null;
}

function normalizeEmailForSync(email: string | undefined): string | null {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  return normalizedEmail.length > 0 ? normalizedEmail : null;
}

export function filterUserProfilesForSync(
  userProfiles: UserProfileInfo[],
  email: string | undefined
): UserProfileInfo[] {
  const normalizedEmail = normalizeEmailForSync(email);

  if (!normalizedEmail) {
    return userProfiles;
  }

  return userProfiles.filter((user) => user.email.trim().toLowerCase() === normalizedEmail);
}

export function getRevenueCatSyncEnvironment(): RevenueCatEnvironment {
  const configuredEnvironment = process.env['REVENUECAT_SYNC_ENVIRONMENT']?.trim();

  if (configuredEnvironment === 'sandbox' || configuredEnvironment === 'production') {
    return configuredEnvironment;
  }

  if (configuredEnvironment) {
    console.warn(
      `Ignoring invalid REVENUECAT_SYNC_ENVIRONMENT="${configuredEnvironment}". Expected "production" or "sandbox".`
    );
  }

  return 'production';
}

/**
 * Dashboard action to sync all user subscriptions from RevenueCat
 * This fetches subscription status for every user and updates the subscription table
 *
 * Run from dashboard:
 * - All users: `npx convex run revenuecat/dashboardActions:syncAllSubscriptions`
 * - Single user: `npx convex run revenuecat/dashboardActions:syncAllSubscriptions '{"email":"user@example.com"}'`
 */
export const syncAllSubscriptions = internalAction({
  args: {
    email: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SyncSummary> => {
    console.log('=== Starting RevenueCat subscription sync ===');

    // Get all user profiles
    const allUserProfiles: UserProfileInfo[] = await ctx.runQuery(
      internal.revenuecat.dashboardQueries.getAllUserProfiles
    );
    const userProfiles = filterUserProfilesForSync(allUserProfiles, args.email);

    if (args.email) {
      console.log(`Filtering sync to email: ${args.email.trim()}`);
    }

    console.log(`Found ${userProfiles.length} users to sync`);

    let successCount = 0;
    let errorCount = 0;
    let noSubscriptionCount = 0;
    const revenueCatEnvironment = getRevenueCatSyncEnvironment();

    console.log(`Checking RevenueCat ${revenueCatEnvironment} subscriptions`);

    for (const user of userProfiles) {
      try {
        const customerIds = getRevenueCatCustomerIdsForSync(user);
        const subscriptionMatches: RevenueCatSubscriptionMatch[] = [];
        let foundSubscriber = false;

        for (const customerId of customerIds) {
          // Fetch both subscriptions and purchases from RevenueCat
          const [subscriptions, purchases] = await Promise.all([
            fetchRevenueCatSubscriptions(customerId, revenueCatEnvironment),
            fetchRevenueCatPurchases(customerId, revenueCatEnvironment),
          ]);

          if (!subscriptions && !purchases) {
            continue;
          }

          foundSubscriber = true;

          const candidateSubscription = findActiveSubscription(subscriptions, purchases);
          if (!candidateSubscription) {
            continue;
          }

          subscriptionMatches.push({
            customerId,
            subscription: candidateSubscription,
          });
        }

        const preferredMatch = selectPreferredRevenueCatSubscriptionMatch(subscriptionMatches);
        const activeSubscription = preferredMatch?.subscription ?? null;
        const matchedCustomerId = preferredMatch?.customerId ?? null;

        if (!foundSubscriber) {
          console.log(
            `[${user.email}] No RevenueCat subscriber found in ${revenueCatEnvironment} for customer IDs: ${customerIds.join(', ')}`
          );
          noSubscriptionCount++;
          continue;
        }

        if (!activeSubscription || !matchedCustomerId) {
          console.log(
            `[${user.email}] No active ${revenueCatEnvironment} subscription found for customer IDs: ${customerIds.join(', ')}`
          );
          noSubscriptionCount++;
          continue;
        }

        // Log the subscription details
        console.log(
          `[${user.email}] Subscription: ${activeSubscription.subscriptionType} | ` +
            `Status: ${activeSubscription.status} | ` +
            `Product: ${activeSubscription.productId} | ` +
            `Environment: ${activeSubscription.environment} | ` +
            `Matched ID: ${matchedCustomerId} | ` +
            `Expires: ${activeSubscription.expiresAt ?? 'never'}`
        );

        const now = new Date().toISOString();

        // Update subscription in database
        // Sanitize data: filter falsy entitlementIds and convert falsy periodType to undefined
        await ctx.runMutation(internal.revenuecat.mutations.upsertSubscription, {
          clerkId: user.clerkId,
          revenueCatCustomerIds: customerIds,
          isAuthoritativeRevenueCatState: true,
          subscriptionData: {
            revenueCatSubscriberId:
              activeSubscription.originalCustomerId ?? activeSubscription.customerId ?? matchedCustomerId,
            originalTransactionId: activeSubscription.originalTransactionId,
            productId: activeSubscription.productId,
            entitlementIds: activeSubscription.entitlementIds.filter(Boolean),
            subscriptionType: activeSubscription.subscriptionType,
            status: activeSubscription.status,
            periodType: activeSubscription.periodType || undefined,
            store: activeSubscription.store,
            purchasedAt: activeSubscription.purchasedAt,
            expiresAt: activeSubscription.expiresAt,
            lastEventType: 'DASHBOARD_SYNC',
            lastEventTimestamp: now,
            updatedAt: now,
          },
        });

        successCount++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${user.email}] Error syncing subscription: ${errorMessage}`);
        errorCount++;
      }
    }

    const summary: SyncSummary = {
      totalUsers: userProfiles.length,
      synced: successCount,
      noSubscription: noSubscriptionCount,
      errors: errorCount,
    };

    console.log('=== Subscription sync complete ===');
    console.log(`Summary: ${JSON.stringify(summary)}`);

    return summary;
  },
});

/**
 * Backfill subscription status to Loops for all users
 * Determines each user's best subscription status and syncs it to Loops.
 *
 * Run from dashboard: `npx convex run revenuecat/dashboardActions:syncAllSubscriptionStatusesToLoops`
 */
export const syncAllSubscriptionStatusesToLoops = internalAction({
  args: {},
  handler: async (ctx): Promise<{ synced: number; errors: number; total: number }> => {
    console.log('=== Starting Loops subscription status backfill ===');

    const userProfiles: UserProfileInfo[] = await ctx.runQuery(internal.revenuecat.dashboardQueries.getAllUserProfiles);
    console.log(`Found ${userProfiles.length} users to sync to Loops`);

    let syncedCount = 0;
    let errorCount = 0;

    const STATUS_PRIORITY: Record<string, number> = {
      active: 1,
      trialing: 2,
      canceled: 3,
      billing_issue: 4,
      paused: 5,
      expired: 6,
    };

    for (const user of userProfiles) {
      try {
        const subscriptions = await ctx.runQuery(internal.revenuecat.dashboardQueries.getAllSubscriptionsForUser, {
          clerkId: user.clerkId,
        });

        let subscriptionStatus: string;

        if (!subscriptions || subscriptions.length === 0) {
          subscriptionStatus = 'none';
        } else {
          // Pick the best status: lowest priority number wins
          const bestSub = subscriptions.reduce((best, sub) => {
            const bestPriority = STATUS_PRIORITY[best.status] ?? 99;
            const currentPriority = STATUS_PRIORITY[sub.status] ?? 99;
            return currentPriority < bestPriority ? sub : best;
          });
          subscriptionStatus = bestSub.status;
        }

        await ctx.runAction(internal.notifications.loops.updateContact, {
          email: user.email,
          subscriptionStatus,
        });

        console.log(`[${user.email}] Synced subscriptionStatus="${subscriptionStatus}" to Loops`);
        syncedCount++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${user.email}] Error syncing to Loops: ${errorMessage}`);
        errorCount++;
      }
    }

    const summary = { total: userProfiles.length, synced: syncedCount, errors: errorCount };
    console.log('=== Loops subscription status backfill complete ===');
    console.log(`Summary: ${JSON.stringify(summary)}`);

    return summary;
  },
});
