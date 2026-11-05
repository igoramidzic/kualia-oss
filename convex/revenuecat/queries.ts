import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getCurrentSubscriptionForClerkId, isSubscriptionValidForAppAccess } from '../lib/appAccess';
import { requireAuth } from '../lib/auth';
import schema from '../schema';

const subscriptionFields = schema.tables.subscription.validator.fields;

/**
 * Get current user's subscription status
 * Returns subscription for authenticated user (clerkId)
 */
export const getUserSubscription = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      subscriptionType: subscriptionFields.subscriptionType,
      status: subscriptionFields.status,
      isActive: v.boolean(),
      entitlements: v.array(v.string()),
      productId: v.string(),
      expiresAt: subscriptionFields.expiresAt,
      isTrialing: v.boolean(),
      periodType: subscriptionFields.periodType,
      store: subscriptionFields.store,
      purchasedAt: v.union(v.string(), v.null()),
      canceledAt: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const clerkId = identity.subject;

    const subscription = await getCurrentSubscriptionForClerkId(ctx, clerkId);

    if (!subscription) {
      return null;
    }

    return {
      subscriptionType: subscription.subscriptionType,
      status: subscription.status,
      isActive: isSubscriptionValidForAppAccess(subscription),
      entitlements: subscription.entitlementIds,
      productId: subscription.productId,
      expiresAt: subscription.expiresAt,
      purchasedAt: subscription.purchasedAt ?? null,
      canceledAt: subscription.canceledAt ?? null,
      isTrialing: subscription.status === 'trialing',
      periodType: subscription.periodType,
      store: subscription.store,
    };
  },
});

/**
 * Check if user has active subscription
 * Simple boolean check for feature gates
 */
export const hasActiveSubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const clerkId = identity.subject;

    const subscription = await getCurrentSubscriptionForClerkId(ctx, clerkId);
    return subscription ? isSubscriptionValidForAppAccess(subscription) : false;
  },
});
