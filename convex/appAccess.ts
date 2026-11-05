import { ConvexError, v } from 'convex/values';

import { internalQuery, query } from './_generated/server';
import { resolveAppAccessForClerkId } from './lib/appAccess';
import { requireAuth } from './lib/auth';

const appAccessValidator = v.object({
  hasAppAccess: v.boolean(),
  accessSource: v.union(v.literal('own_subscription'), v.literal('family_owner_subscription'), v.null()),
  ownSubscription: v.union(
    v.object({
      status: v.union(
        v.literal('active'),
        v.literal('trialing'),
        v.literal('canceled'),
        v.literal('expired'),
        v.literal('billing_issue'),
        v.literal('paused')
      ),
      subscriptionType: v.union(v.literal('trial'), v.literal('monthly'), v.literal('yearly'), v.literal('lifetime')),
      periodType: v.union(
        v.literal('TRIAL'),
        v.literal('INTRO'),
        v.literal('NORMAL'),
        v.literal('PROMOTIONAL'),
        v.literal('PREPAID'),
        v.null()
      ),
      expiresAt: v.union(v.string(), v.null()),
      isActive: v.boolean(),
    }),
    v.null()
  ),
  familyAccess: v.union(
    v.object({
      familyGroupId: v.id('familyGroup'),
      role: v.union(v.literal('owner'), v.literal('member')),
      ownerClerkId: v.string(),
      owner: v.object({
        clerkId: v.string(),
        name: v.union(v.string(), v.null()),
        email: v.union(v.string(), v.null()),
      }),
      ownerHasValidSubscription: v.boolean(),
    }),
    v.null()
  ),
  nextCheckAt: v.union(v.string(), v.null()),
});

export const getCurrentAppAccess = query({
  args: { refreshKey: v.optional(v.string()) },
  returns: appAccessValidator,
  handler: async (ctx, { refreshKey }) => {
    const identity = await requireAuth(ctx);
    // A changed key re-evaluates time-dependent access without trusting a client clock.
    // Existing clients can keep subscribing without arguments.
    if (refreshKey !== undefined && refreshKey.length > 64) throw new ConvexError('Invalid refresh key');
    return await resolveAppAccessForClerkId(ctx, identity.subject);
  },
});

export const getAppAccessForClerkId = internalQuery({
  args: {
    clerkId: v.string(),
  },
  returns: appAccessValidator,
  handler: async (ctx, { clerkId }) => {
    return await resolveAppAccessForClerkId(ctx, clerkId);
  },
});
