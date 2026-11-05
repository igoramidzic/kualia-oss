import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { conversionType, conversionValue } from '../ads/types';

const billingConversionValidator = v.object({
  type: conversionType,
  eventId: v.string(),
  timestamp: v.string(),
  value: v.optional(conversionValue),
});

type SubscriptionDoc = Doc<'subscription'>;
type SubscriptionStatus = SubscriptionDoc['status'];
type SubscriptionType = SubscriptionDoc['subscriptionType'];
type SubscriptionGuardInput = Pick<
  SubscriptionDoc,
  | 'expiresAt'
  | 'lastEventId'
  | 'lastEventTimestamp'
  | 'lastEventType'
  | 'originalTransactionId'
  | 'periodType'
  | 'status'
  | 'store'
  | 'subscriptionType'
>;

const paidSubscriptionTypes: ReadonlySet<SubscriptionType> = new Set(['monthly', 'yearly', 'lifetime']);
const accessRevokingStatuses: ReadonlySet<SubscriptionStatus> = new Set(['expired', 'billing_issue', 'paused']);
const stalePromotionalTerminalEvents: ReadonlySet<string> = new Set([
  'EXPIRATION',
  'REFUND',
  'BILLING_ISSUE',
  'SUBSCRIPTION_PAUSED',
]);

function isFutureIsoDate(value: string | null | undefined, now: Date): boolean {
  if (!value) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime();
}

function hasValidAccess(subscription: SubscriptionGuardInput, now: Date): boolean {
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    return true;
  }

  if (subscription.status === 'canceled') {
    return isFutureIsoDate(subscription.expiresAt, now);
  }

  return false;
}

function isNonPromotionalPaidOrLifetime(subscription: SubscriptionGuardInput): boolean {
  return (
    paidSubscriptionTypes.has(subscription.subscriptionType) &&
    subscription.periodType !== 'PROMOTIONAL' &&
    subscription.store !== 'promotional'
  );
}

function isPromotionalTerminalUpdate(subscription: SubscriptionGuardInput): boolean {
  return (
    stalePromotionalTerminalEvents.has(subscription.lastEventType ?? '') &&
    accessRevokingStatuses.has(subscription.status) &&
    (subscription.periodType === 'PROMOTIONAL' || subscription.store === 'promotional')
  );
}

export function shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate(
  existing: SubscriptionGuardInput,
  incoming: SubscriptionGuardInput,
  now = new Date()
): boolean {
  return (
    isPromotionalTerminalUpdate(incoming) && hasValidAccess(existing, now) && isNonPromotionalPaidOrLifetime(existing)
  );
}

export function shouldPreserveExistingLifetimeSubscription(
  existing: SubscriptionGuardInput,
  incoming: SubscriptionGuardInput,
  now = new Date()
): boolean {
  const isSamePurchase =
    existing.originalTransactionId !== undefined &&
    incoming.originalTransactionId !== undefined &&
    existing.originalTransactionId === incoming.originalTransactionId;

  return (
    existing.subscriptionType === 'lifetime' &&
    hasValidAccess(existing, now) &&
    incoming.subscriptionType !== 'lifetime' &&
    !isSamePurchase
  );
}

export function shouldIgnoreDuplicateOrOlderEvent(
  existing: SubscriptionGuardInput,
  incoming: SubscriptionGuardInput
): boolean {
  if (existing.lastEventId && incoming.lastEventId && existing.lastEventId === incoming.lastEventId) {
    return true;
  }

  if (!existing.lastEventTimestamp || !incoming.lastEventTimestamp) {
    return false;
  }

  const existingTime = Date.parse(existing.lastEventTimestamp);
  const incomingTime = Date.parse(incoming.lastEventTimestamp);
  return Number.isFinite(existingTime) && Number.isFinite(incomingTime) && incomingTime < existingTime;
}

/**
 * Upsert subscription from RevenueCat webhook
 * Creates or updates subscription based on clerkId
 */
export const upsertSubscription = internalMutation({
  args: {
    clerkId: v.string(),
    subscriptionData: v.object({
      revenueCatSubscriberId: v.string(),
      originalTransactionId: v.optional(v.string()),
      productId: v.string(),
      entitlementIds: v.array(v.string()),
      subscriptionType: v.union(v.literal('trial'), v.literal('monthly'), v.literal('yearly'), v.literal('lifetime')),
      status: v.union(
        v.literal('active'),
        v.literal('trialing'),
        v.literal('canceled'),
        v.literal('expired'),
        v.literal('billing_issue'),
        v.literal('paused')
      ),
      periodType: v.optional(
        v.union(
          v.literal('TRIAL'),
          v.literal('INTRO'),
          v.literal('NORMAL'),
          v.literal('PROMOTIONAL'),
          v.literal('PREPAID')
        )
      ),
      price: v.optional(v.number()),
      currency: v.optional(v.string()),
      store: v.optional(
        v.union(v.literal('app_store'), v.literal('play_store'), v.literal('stripe'), v.literal('promotional'))
      ),
      purchasedAt: v.optional(v.string()),
      expiresAt: v.optional(v.union(v.string(), v.null())),
      canceledAt: v.optional(v.union(v.string(), v.null())),
      lastEventType: v.string(),
      lastEventTimestamp: v.string(),
      lastEventId: v.optional(v.string()),
      updatedAt: v.string(),
    }),
    revenueCatCustomerIds: v.optional(v.array(v.string())),
    isAuthoritativeRevenueCatState: v.optional(v.boolean()),
    // Accept in-flight calls from the retired webhook version, but ignore their ad event.
    adConversion: v.optional(billingConversionValidator),
  },
  handler: async (ctx, { clerkId, subscriptionData, revenueCatCustomerIds, isAuthoritativeRevenueCatState }) => {
    // Find existing subscription for this user
    const existing = await ctx.db
      .query('subscription')
      .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
      .first();

    const now = new Date().toISOString();
    const customerIds = [
      ...new Set(
        [subscriptionData.revenueCatSubscriberId, ...(revenueCatCustomerIds ?? [])]
          .map((customerId) => customerId.trim())
          .filter((customerId) => customerId.length > 0)
      ),
    ];

    for (const customerId of customerIds) {
      const existingAlias = await ctx.db
        .query('revenueCatCustomerAlias')
        .withIndex('by_clerkId_and_customerId', (q) => q.eq('clerkId', clerkId).eq('customerId', customerId))
        .first();

      if (existingAlias) {
        await ctx.db.patch(existingAlias._id, {
          isDeleted: false,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert('revenueCatCustomerAlias', {
          clerkId,
          customerId,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        });
      }
    }

    if (existing) {
      if (!isAuthoritativeRevenueCatState && shouldIgnoreDuplicateOrOlderEvent(existing, subscriptionData)) {
        console.warn(
          `Skipped duplicate or older ${subscriptionData.lastEventType} update for user ${clerkId}; preserving ${existing.status} ${existing.subscriptionType} subscription`
        );
        return { subscriptionId: existing._id, status: existing.status };
      }

      if (!isAuthoritativeRevenueCatState && shouldPreserveExistingLifetimeSubscription(existing, subscriptionData)) {
        console.warn(
          `Skipped ${subscriptionData.lastEventType} update for user ${clerkId}; preserving active lifetime subscription`
        );
        return { subscriptionId: existing._id, status: existing.status };
      }

      if (shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate(existing, subscriptionData)) {
        console.warn(
          `Skipped stale promotional ${subscriptionData.lastEventType} update for user ${clerkId}; preserving ${existing.status} ${existing.subscriptionType} subscription`
        );
        return { subscriptionId: existing._id, status: existing.status };
      }

      // Update existing subscription
      await ctx.db.patch(existing._id, {
        ...subscriptionData,
        updatedAt: now,
      });

      console.log(`Updated subscription for user ${clerkId}: ${subscriptionData.lastEventType}`);
      return { subscriptionId: existing._id, status: subscriptionData.status };
    } else {
      // Create new subscription
      const subscriptionId = await ctx.db.insert('subscription', {
        clerkId,
        ...subscriptionData,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });

      console.log(`Created subscription for user ${clerkId}: ${subscriptionData.lastEventType}`);
      return { subscriptionId, status: subscriptionData.status };
    }
  },
});
