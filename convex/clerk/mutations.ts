import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { normalizeProfileName } from '../userProfiles/helpers';

export function buildExistingClerkProfileUpdates(
  existingProfile: Pick<Doc<'userProfile'>, 'email' | 'name'>,
  input: { email: string; firstName?: string }
): Partial<Pick<Doc<'userProfile'>, 'email' | 'name'>> {
  const updates: Partial<Pick<Doc<'userProfile'>, 'email' | 'name'>> = {};
  const name = normalizeProfileName(input.firstName);

  if (input.email !== existingProfile.email) {
    updates.email = input.email;
  }

  if (name !== undefined && normalizeProfileName(existingProfile.name) === undefined) {
    updates.name = name;
  }

  return updates;
}

/**
 * Internal mutation to create a user profile from Clerk webhook
 * This is called when a user signs up via Clerk
 */
export const createUserFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, { clerkId, email, firstName }) => {
    const name = normalizeProfileName(firstName);

    // Check if user profile already exists
    const existingProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
      .first();

    if (existingProfile) {
      const updates: Partial<Pick<Doc<'userProfile'>, 'email' | 'name' | 'updatedAt'>> =
        buildExistingClerkProfileUpdates(existingProfile, { email, firstName });

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString();
        await ctx.db.patch(existingProfile._id, updates);
      }

      return existingProfile._id;
    }

    const profile: {
      clerkId: string;
      email: string;
      name?: string;
      onboardingCompleted: boolean;
      updatedAt: string;
    } = {
      clerkId,
      email,
      onboardingCompleted: false,
      updatedAt: new Date().toISOString(),
    };

    if (name !== undefined) {
      profile.name = name;
    }

    const profileId = await ctx.db.insert('userProfile', profile);

    return profileId;
  },
});

/**
 * Internal mutation to update user profile
 * Used by webhooks to set activeWorkspaceId and other fields
 */
export const updateUserProfile = internalMutation({
  args: {
    profileId: v.id('userProfile'),
    updates: v.object({
      activeWorkspaceId: v.optional(v.id('workspace')),
      updatedAt: v.string(),
    }),
  },
  handler: async (ctx, { profileId, updates }) => {
    await ctx.db.patch(profileId, updates);
    return profileId;
  },
});

/**
 * Internal mutation to handle Clerk subscription webhooks
 * This is now a no-op as we've migrated to Stripe for subscription management
 * Kept for backward compatibility with existing webhooks
 */
export const upsertSubscription = internalMutation({
  args: {
    clerkSubscriptionId: v.string(),
    clerkSubscriptionItemId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('incomplete'),
      v.literal('incomplete_expired'),
      v.literal('past_due'),
      v.literal('trialing'),
      v.literal('unpaid')
    ),
    planId: v.string(),
    planSlug: v.string(),
    planName: v.optional(v.string()),
    billingPeriod: v.union(v.literal('month'), v.literal('year')),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    trialEndDate: v.optional(v.string()),
    canceledAt: v.optional(v.string()),
  },
  handler: async (_ctx) => {
    console.log('Clerk subscription webhook received but ignored - using Stripe subscriptions instead');
    // No-op: We now manage subscriptions exclusively through Stripe
    return null;
  },
});
