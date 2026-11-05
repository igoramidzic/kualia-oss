import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type AppAccessCtx = QueryCtx | MutationCtx;
type SubscriptionPeriodType = NonNullable<Doc<'subscription'>['periodType']>;

export type AppAccessSource = 'own_subscription' | 'family_owner_subscription' | null;
export type AppAccessSubscriptionStatus = Doc<'subscription'>['status'];

export interface AppAccessSubscription {
  status: AppAccessSubscriptionStatus;
  subscriptionType: Doc<'subscription'>['subscriptionType'];
  periodType: SubscriptionPeriodType | null;
  expiresAt: string | null;
  isActive: boolean;
}

export interface AppAccessFamily {
  familyGroupId: Id<'familyGroup'>;
  role: Doc<'familyGroupMember'>['role'];
  ownerClerkId: string;
  owner: {
    clerkId: string;
    name: string | null;
    email: string | null;
  };
  ownerHasValidSubscription: boolean;
}

export interface AppAccessResult {
  hasAppAccess: boolean;
  accessSource: AppAccessSource;
  ownSubscription: AppAccessSubscription | null;
  familyAccess: AppAccessFamily | null;
  nextCheckAt: string | null;
}

type SubscriptionValidityInput = Pick<Doc<'subscription'>, 'expiresAt' | 'status'>;

function isFutureIsoDate(value: string, now: Date): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime();
}

export function isSubscriptionValidForAppAccess(subscription: SubscriptionValidityInput, now = new Date()): boolean {
  const expiresAt = subscription.expiresAt ?? null;

  if (subscription.status === 'active') {
    return true;
  }

  if (subscription.status === 'trialing') {
    return expiresAt === null || isFutureIsoDate(expiresAt, now);
  }

  if (subscription.status === 'canceled') {
    return expiresAt !== null && isFutureIsoDate(expiresAt, now);
  }

  return false;
}

function subscriptionNextCheckAt(subscription: AppAccessSubscription | null, now: Date): string | null {
  if (!subscription || (subscription.status !== 'trialing' && subscription.status !== 'canceled')) return null;
  return subscription.expiresAt && isFutureIsoDate(subscription.expiresAt, now) ? subscription.expiresAt : null;
}

export function toAppAccessSubscription(subscription: Doc<'subscription'>, now = new Date()): AppAccessSubscription {
  return {
    status: subscription.status,
    subscriptionType: subscription.subscriptionType,
    periodType: subscription.periodType ?? null,
    expiresAt: subscription.expiresAt ?? null,
    isActive: isSubscriptionValidForAppAccess(subscription, now),
  };
}

function subscriptionSortTime(subscription: Doc<'subscription'>): number {
  const updatedAt = Date.parse(subscription.updatedAt);
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(subscription.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return subscription._creationTime;
}

export function selectCurrentSubscription(
  subscriptions: Doc<'subscription'>[],
  now = new Date()
): Doc<'subscription'> | null {
  return (
    [...subscriptions].sort((left, right) => {
      const leftIsValid = isSubscriptionValidForAppAccess(left, now);
      const rightIsValid = isSubscriptionValidForAppAccess(right, now);

      if (leftIsValid !== rightIsValid) {
        return leftIsValid ? -1 : 1;
      }

      if (
        leftIsValid &&
        rightIsValid &&
        (left.subscriptionType === 'lifetime') !== (right.subscriptionType === 'lifetime')
      ) {
        return left.subscriptionType === 'lifetime' ? -1 : 1;
      }

      return subscriptionSortTime(right) - subscriptionSortTime(left);
    })[0] ?? null
  );
}

export async function listSubscriptionsForClerkId(ctx: AppAccessCtx, clerkId: string): Promise<Doc<'subscription'>[]> {
  return await ctx.db
    .query('subscription')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
    .collect();
}

export async function getCurrentSubscriptionForClerkId(
  ctx: AppAccessCtx,
  clerkId: string,
  now = new Date()
): Promise<Doc<'subscription'> | null> {
  const subscriptions = await listSubscriptionsForClerkId(ctx, clerkId);
  return selectCurrentSubscription(subscriptions, now);
}

async function getActiveFamilyMembership(ctx: AppAccessCtx, clerkId: string): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
    .first();
}

async function getActiveFamilyOwnerMembership(
  ctx: AppAccessCtx,
  familyGroupId: Id<'familyGroup'>,
  ownerClerkId: string
): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_clerkId_isDeleted', (q) =>
      q.eq('familyGroupId', familyGroupId).eq('clerkId', ownerClerkId).eq('isDeleted', false)
    )
    .first();
}

export async function resolveAppAccessForClerkId(
  ctx: AppAccessCtx,
  clerkId: string,
  now = new Date()
): Promise<AppAccessResult> {
  if (process.env['SELF_HOSTED'] === 'true') {
    return {
      hasAppAccess: true,
      accessSource: 'own_subscription',
      ownSubscription: {
        status: 'active',
        subscriptionType: 'lifetime',
        periodType: 'NORMAL',
        expiresAt: null,
        isActive: true,
      },
      familyAccess: null,
      nextCheckAt: null,
    };
  }
  const ownSubscriptionDocument = await getCurrentSubscriptionForClerkId(ctx, clerkId, now);
  const ownSubscription = ownSubscriptionDocument ? toAppAccessSubscription(ownSubscriptionDocument, now) : null;
  const ownSubscriptionIsActive = ownSubscription?.isActive ?? false;
  const ownNextCheckAt = subscriptionNextCheckAt(ownSubscription, now);

  const membership = await getActiveFamilyMembership(ctx, clerkId);
  if (!membership) {
    return {
      hasAppAccess: ownSubscriptionIsActive,
      accessSource: ownSubscriptionIsActive ? 'own_subscription' : null,
      ownSubscription,
      familyAccess: null,
      nextCheckAt: ownNextCheckAt,
    };
  }

  const familyGroup = await ctx.db.get(membership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return {
      hasAppAccess: ownSubscriptionIsActive,
      accessSource: ownSubscriptionIsActive ? 'own_subscription' : null,
      ownSubscription,
      familyAccess: null,
      nextCheckAt: ownNextCheckAt,
    };
  }

  const ownerMembership =
    familyGroup.ownerClerkId === clerkId
      ? membership
      : await getActiveFamilyOwnerMembership(ctx, familyGroup._id, familyGroup.ownerClerkId);

  if (!ownerMembership) {
    return {
      hasAppAccess: ownSubscriptionIsActive,
      accessSource: ownSubscriptionIsActive ? 'own_subscription' : null,
      ownSubscription,
      familyAccess: null,
      nextCheckAt: ownNextCheckAt,
    };
  }

  const ownerSubscriptionDocument =
    familyGroup.ownerClerkId === clerkId
      ? ownSubscriptionDocument
      : await getCurrentSubscriptionForClerkId(ctx, familyGroup.ownerClerkId, now);
  const ownerHasValidSubscription = ownerSubscriptionDocument
    ? isSubscriptionValidForAppAccess(ownerSubscriptionDocument, now)
    : false;
  const familyGrantsAccess = familyGroup.ownerClerkId !== clerkId && ownerHasValidSubscription;
  const ownerProfile = await ctx.db.get(ownerMembership.userProfileId);
  const ownerNextCheckAt = subscriptionNextCheckAt(
    ownerSubscriptionDocument ? toAppAccessSubscription(ownerSubscriptionDocument, now) : null,
    now
  );
  const nextCheckAt =
    [ownNextCheckAt, ownerNextCheckAt].filter((value): value is string => value !== null).sort()[0] ?? null;

  return {
    hasAppAccess: ownSubscriptionIsActive || familyGrantsAccess,
    accessSource: ownSubscriptionIsActive
      ? 'own_subscription'
      : familyGrantsAccess
        ? 'family_owner_subscription'
        : null,
    ownSubscription,
    nextCheckAt,
    familyAccess: {
      familyGroupId: familyGroup._id,
      role: membership.role,
      ownerClerkId: familyGroup.ownerClerkId,
      owner: {
        clerkId: familyGroup.ownerClerkId,
        name: ownerProfile?.name ?? null,
        email: ownerProfile?.email ?? null,
      },
      ownerHasValidSubscription,
    },
  };
}
