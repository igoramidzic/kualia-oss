import type { UserIdentity } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { normalizeProfileName } from './helpers';

type ProfileBootstrapStatus = 'created' | 'existing' | 'reactivated';

interface ProfileBootstrapResult {
  profileId: Doc<'userProfile'>['_id'];
  status: ProfileBootstrapStatus;
}

function normalizedIdentityEmail(identity: UserIdentity): string | undefined {
  if (typeof identity.email !== 'string') return undefined;
  const email = identity.email.trim().toLowerCase();
  return email.length > 0 ? email : undefined;
}

export function buildProfileBootstrapUpdates(
  profile: Doc<'userProfile'>,
  identity: Pick<UserIdentity, 'email' | 'givenName'>,
  now: string
): Partial<Doc<'userProfile'>> {
  if (profile.isDeleted === true && profile.purgeStartedAt !== undefined && profile.purgeCompletedAt === undefined) {
    throw new ConvexError('Your previous account cleanup is still finishing. Please try again shortly.');
  }
  if (profile.isDeleted === true && profile.externalCleanupCompletedAt === undefined) {
    throw new ConvexError('Your account deletion is still finishing. Please try again shortly.');
  }

  const updates: Partial<Doc<'userProfile'>> = {};
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : undefined;
  const name = normalizeProfileName(identity.givenName);

  if (email && email !== profile.email) updates.email = email;
  if (name !== undefined && normalizeProfileName(profile.name) === undefined) updates.name = name;

  if (profile.isDeleted === true) {
    Object.assign(updates, {
      activeWorkspaceId: undefined,
      apnsDeviceToken: undefined,
      notificationsEnabled: false,
      notificationPreferences: undefined,
      checkIn: undefined,
      onboardingCompleted: false,
      isDeleted: false,
      deletedAt: undefined,
      clerkMarkedDeletedAt: undefined,
      clerkSessionsRevokedAt: undefined,
      loopsUnsubscribedAt: undefined,
      externalCleanupLastAttemptAt: undefined,
      externalCleanupCompletedAt: undefined,
      externalCleanupError: undefined,
      purgeStartedAt: undefined,
      purgeCompletedAt: undefined,
      lastReactivatedAt: now,
    });
  }

  if (Object.keys(updates).length > 0) updates.updatedAt = now;
  return updates;
}

async function scheduleLoopsProfileSync(
  ctx: MutationCtx,
  identity: UserIdentity,
  email: string | undefined
): Promise<void> {
  if (!email || !process.env['LOOPS_API_KEY']) return;

  const firstName = normalizeProfileName(identity.givenName);
  const lastName = normalizeProfileName(identity.familyName);
  await ctx.scheduler.runAfter(0, internal.notifications.loops.updateContact, {
    email,
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    userId: identity.subject,
    source: 'Kualia App',
  });
}

/**
 * Idempotently bootstrap the authenticated user's profile.
 *
 * Clerk webhooks remain the source of later identity updates, but client startup
 * no longer depends on webhook delivery. A retained deleted profile is
 * reactivated into a fresh onboarding state after external cleanup completes.
 */
export const ensureCurrentProfile = mutation({
  args: {},
  handler: async (ctx): Promise<ProfileBootstrapResult> => {
    const identity = await requireAuth(ctx);
    const now = new Date().toISOString();
    const email = normalizedIdentityEmail(identity);
    const existingProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .first();

    if (existingProfile) {
      const wasDeleted = existingProfile.isDeleted === true;
      const updates = buildProfileBootstrapUpdates(existingProfile, identity, now);
      if (Object.keys(updates).length > 0) await ctx.db.patch(existingProfile._id, updates);
      if (wasDeleted) {
        await scheduleLoopsProfileSync(ctx, identity, email);
        await ctx.scheduler.runAfter(0, internal.accountDeletion.actionsNode.markAccountReactivated, {
          clerkId: identity.subject,
          reactivatedAt: now,
        });
      }
      return { profileId: existingProfile._id, status: wasDeleted ? 'reactivated' : 'existing' };
    }

    const name = normalizeProfileName(identity.givenName);
    const profileId = await ctx.db.insert('userProfile', {
      ...(name !== undefined ? { name } : {}),
      clerkId: identity.subject,
      email: email ?? '',
      onboardingCompleted: false,
      updatedAt: now,
    });
    await scheduleLoopsProfileSync(ctx, identity, email);
    return { profileId, status: 'created' };
  },
});

/**
 * Create a user profile (typically called after user registration)
 * Note: This is now handled by the Clerk webhook, but keeping for manual creation if needed
 */
export const createProfile = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const identity = await requireAuth(ctx);

    // Check if profile already exists
    const existingProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .first();

    if (existingProfile) {
      throw new ConvexError('User profile already exists');
    }

    const email = normalizedIdentityEmail(identity);

    if (!email) {
      throw new ConvexError('Email is required to create a user profile');
    }

    const profileId = await ctx.db.insert('userProfile', {
      name,
      clerkId: identity.subject,
      email,
      onboardingCompleted: false,
      updatedAt: new Date().toISOString(),
    });

    return profileId;
  },
});
