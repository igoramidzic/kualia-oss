import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { disconnectConnectionInternal } from '../financeKit/mutations';

const MAX_ACCOUNT_RESOURCES = 250;
const BILLING_CANCELLATION_ALERT_ATTEMPTS = 9;
const BILLING_CANCELLATION_INITIAL_RETRY_DELAY_MS = 60_000;
const BILLING_CANCELLATION_MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

interface BillingCancellationFailureState {
  attemptCount: number;
  nextAttemptAt: number;
  shouldAlert: boolean;
}

function uniqueNonEmptyValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter((value) => value.length > 0))];
}

export function billingCancellationFailureState(args: {
  previousAttemptCount: number;
  previousAlertSentAt?: string;
  attemptedAtMs: number;
}): BillingCancellationFailureState {
  const attemptCount = args.previousAttemptCount + 1;
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 30);
  const retryDelayMs = Math.min(
    BILLING_CANCELLATION_INITIAL_RETRY_DELAY_MS * 2 ** exponent,
    BILLING_CANCELLATION_MAX_RETRY_DELAY_MS
  );

  return {
    attemptCount,
    nextAttemptAt: args.attemptedAtMs + retryDelayMs,
    shouldAlert: attemptCount >= BILLING_CANCELLATION_ALERT_ATTEMPTS && args.previousAlertSentAt === undefined,
  };
}

export const getDeletionContext = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .first();

    if (!profile) {
      return null;
    }

    const subscriptions = await ctx.db
      .query('subscription')
      .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', args.clerkId).eq('isDeleted', false))
      .take(MAX_ACCOUNT_RESOURCES);
    const customerAliases = await ctx.db
      .query('revenueCatCustomerAlias')
      .withIndex('by_clerkId_and_isDeleted', (q) => q.eq('clerkId', args.clerkId).eq('isDeleted', false))
      .take(MAX_ACCOUNT_RESOURCES);
    const billingCleanup = await ctx.db
      .query('accountDeletionBillingCleanup')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .first();

    return {
      profileId: profile._id,
      email: profile.email,
      revenueCatCustomerIds: uniqueNonEmptyValues([
        args.clerkId,
        ...subscriptions.map((subscription) => subscription.revenueCatSubscriberId),
        ...customerAliases.map((alias) => alias.customerId),
      ]),
      isDeleted: profile.isDeleted === true,
      deletedAt: profile.deletedAt,
      clerkDeletedAt: profile.clerkDeletedAt,
      clerkMarkedDeletedAt: profile.clerkMarkedDeletedAt,
      clerkSessionsRevokedAt: profile.clerkSessionsRevokedAt,
      loopsUnsubscribedAt: profile.loopsUnsubscribedAt,
      externalCleanupCompletedAt: profile.externalCleanupCompletedAt,
      billingCancellationStatus: billingCleanup?.status,
      billingCancellationAttemptCount: billingCleanup?.attemptCount ?? 0,
    };
  },
});

export const listPendingPlaidDisconnections = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('bankLink')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', args.clerkId))
      .filter((q) => q.eq(q.field('providerDisconnectedAt'), undefined))
      .take(MAX_ACCOUNT_RESOURCES);
  },
});

export const hasPendingPlaidDisconnections = internalQuery({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('bankLink')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', args.clerkId))
      .filter((q) => q.eq(q.field('providerDisconnectedAt'), undefined))
      .first();

    return pending !== null;
  },
});

async function revokeClerkScopedCredentials(ctx: MutationCtx, clerkId: string, now: string): Promise<void> {
  const mcpTokens = await ctx.db
    .query('mcpToken')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const token of mcpTokens) {
    if (!token.revokedAt) await ctx.db.patch(token._id, { revokedAt: now });
  }

  const accessTokens = await ctx.db
    .query('mcpOauthAccessToken')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const token of accessTokens) {
    if (!token.revokedAt) await ctx.db.patch(token._id, { revokedAt: now });
  }

  const refreshTokens = await ctx.db
    .query('mcpOauthRefreshToken')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const token of refreshTokens) {
    if (!token.revokedAt) await ctx.db.patch(token._id, { revokedAt: now });
  }

  const oauthConnections = await ctx.db
    .query('mcpOauthConnection')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const connection of oauthConnections) {
    if (!connection.revokedAt) await ctx.db.patch(connection._id, { revokedAt: now });
  }

  const authorizationCodes = await ctx.db
    .query('mcpOauthAuthorizationCode')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const code of authorizationCodes) {
    if (!code.consumedAt) await ctx.db.patch(code._id, { consumedAt: now });
  }

  const apiKeys = await ctx.db
    .query('apiKey')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const apiKey of apiKeys) {
    if (!apiKey.revokedAt) await ctx.db.patch(apiKey._id, { revokedAt: now });
  }

  const widgetTokens = await ctx.db
    .query('widgetToken')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const token of widgetTokens) {
    if (!token.isRevoked) await ctx.db.patch(token._id, { isRevoked: true });
  }

  const financeKitTokens = await ctx.db
    .query('financeKitSyncToken')
    .withIndex('by_ownerClerkId', (q) => q.eq('ownerClerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const token of financeKitTokens) {
    if (!token.isRevoked) {
      await ctx.db.patch(token._id, { isRevoked: true, revokedAt: now });
    }
  }
}

async function softDeleteFamilyData(ctx: MutationCtx, clerkId: string, now: string): Promise<void> {
  const memberships = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const membership of memberships) {
    if (!membership.isDeleted) {
      await ctx.db.patch(membership._id, { isDeleted: true, deletedAt: now, updatedAt: now });
    }
  }

  const ownedGroups = await ctx.db
    .query('familyGroup')
    .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', clerkId))
    .take(MAX_ACCOUNT_RESOURCES);

  for (const group of ownedGroups) {
    if (!group.isDeleted) {
      await ctx.db.patch(group._id, { isDeleted: true, deletedAt: now, updatedAt: now });
    }

    const groupMembers = await ctx.db
      .query('familyGroupMember')
      .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', group._id))
      .take(MAX_ACCOUNT_RESOURCES);
    for (const member of groupMembers) {
      if (!member.isDeleted) {
        await ctx.db.patch(member._id, { isDeleted: true, deletedAt: now, updatedAt: now });
      }
    }

    const invites = await ctx.db
      .query('familyGroupInvite')
      .withIndex('by_familyGroupId_status_isDeleted', (q) => q.eq('familyGroupId', group._id))
      .take(MAX_ACCOUNT_RESOURCES);
    for (const invite of invites) {
      if (!invite.isDeleted) {
        await ctx.db.patch(invite._id, { isDeleted: true, deletedAt: now, updatedAt: now });
      }
    }
  }
}

async function initializeBillingCancellation(
  ctx: MutationCtx,
  args: { clerkId: string; email: string; reset: boolean; now: string; nowMs: number }
): Promise<void> {
  const existing = await ctx.db
    .query('accountDeletionBillingCleanup')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
    .first();

  if (existing && !args.reset) return;

  const pendingState = {
    email: args.email,
    status: 'pending' as const,
    attemptCount: 0,
    nextAttemptAt: args.nowMs,
    lastAttemptAt: undefined,
    confirmedAt: undefined,
    lastError: undefined,
    alertSentAt: undefined,
    updatedAt: args.now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, pendingState);
    return;
  }

  await ctx.db.insert('accountDeletionBillingCleanup', {
    clerkId: args.clerkId,
    createdAt: args.now,
    ...pendingState,
  });
}

async function softDeleteAccountHandler(
  ctx: MutationCtx,
  args: { clerkId: string; deletedAt?: string; clerkDeletedAt?: string }
): Promise<{ profileId: string; deletedAt: string } | null> {
  const profile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
    .first();

  if (!profile) {
    return null;
  }

  const now = new Date().toISOString();
  const deletedAt = profile.deletedAt ?? args.deletedAt ?? now;
  await initializeBillingCancellation(ctx, {
    clerkId: args.clerkId,
    email: profile.email,
    reset: profile.isDeleted !== true,
    now,
    nowMs: Date.now(),
  });
  await ctx.db.patch(profile._id, {
    activeWorkspaceId: undefined,
    apnsDeviceToken: undefined,
    notificationsEnabled: false,
    isDeleted: true,
    deletedAt,
    lastDeletedAt: deletedAt,
    deletionCount: (profile.deletionCount ?? 0) + (profile.isDeleted === true ? 0 : 1),
    clerkDeletedAt: args.clerkDeletedAt ?? profile.clerkDeletedAt,
    updatedAt: now,
  });

  const workspaces = await ctx.db
    .query('workspace')
    .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', args.clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const workspace of workspaces) {
    if (workspace.isDeleted !== true) {
      await ctx.db.patch(workspace._id, {
        isDeleted: true,
        deletedAt,
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });
    }
  }

  const financeKitConnections = await ctx.db
    .query('financeKitConnection')
    .withIndex('by_ownerClerkId_and_isDeleted', (q) => q.eq('ownerClerkId', args.clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const connection of financeKitConnections) {
    if (!connection.isDeleted) {
      await disconnectConnectionInternal(ctx, {
        workspaceId: connection.workspaceId,
        ownerClerkId: args.clerkId,
        connectionId: connection._id,
      });
    }
  }

  const bankLinks = await ctx.db
    .query('bankLink')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', args.clerkId))
    .take(MAX_ACCOUNT_RESOURCES);
  for (const bankLink of bankLinks) {
    const result: { success: boolean } = await ctx.runMutation(internal.internal.bankLinks.softDeleteBankLink, {
      bankLinkId: bankLink._id,
      externalProviderDisconnected: bankLink.providerDisconnectedAt !== undefined,
    });
    void result;
  }

  await revokeClerkScopedCredentials(ctx, args.clerkId, now);
  await softDeleteFamilyData(ctx, args.clerkId, now);

  return { profileId: profile._id, deletedAt };
}

export const softDeleteAccount = internalMutation({
  args: {
    clerkId: v.string(),
    deletedAt: v.string(),
  },
  handler: softDeleteAccountHandler,
});

export const softDeleteAccountFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    deletedAt: v.string(),
  },
  handler: async (ctx, args) => {
    return await softDeleteAccountHandler(ctx, {
      clerkId: args.clerkId,
      deletedAt: args.deletedAt,
      clerkDeletedAt: args.deletedAt,
    });
  },
});

export const markBankLinkProviderDisconnected = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, args) => {
    const bankLink = await ctx.db.get(args.bankLinkId);
    if (!bankLink) return null;

    const now = new Date().toISOString();
    await ctx.db.patch(bankLink._id, {
      providerDisconnectedAt: now,
      itemStatus: 'Disconnected',
      isDeleted: true,
      deletedAt: bankLink.deletedAt ?? now,
      updatedAt: now,
    });
    return null;
  },
});

export const recordBillingCancellationAttempt = internalMutation({
  args: {
    clerkId: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      attemptCount: v.number(),
      nextAttemptAt: v.union(v.number(), v.null()),
      shouldAlert: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .first();
    if (!profile || profile.isDeleted !== true) return null;

    const existing = await ctx.db
      .query('accountDeletionBillingCleanup')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .first();
    if (existing?.status === 'confirmed') {
      return {
        attemptCount: existing.attemptCount,
        nextAttemptAt: null,
        shouldAlert: false,
      };
    }

    const attemptedAtMs = Date.now();
    const attemptedAt = new Date(attemptedAtMs).toISOString();
    const attemptCount = (existing?.attemptCount ?? 0) + 1;

    if (args.success) {
      const confirmedState = {
        email: profile.email,
        status: 'confirmed' as const,
        attemptCount,
        nextAttemptAt: undefined,
        lastAttemptAt: attemptedAt,
        confirmedAt: attemptedAt,
        lastError: undefined,
        updatedAt: attemptedAt,
      };
      if (existing) {
        await ctx.db.patch(existing._id, confirmedState);
      } else {
        await ctx.db.insert('accountDeletionBillingCleanup', {
          clerkId: args.clerkId,
          alertSentAt: undefined,
          createdAt: attemptedAt,
          ...confirmedState,
        });
      }
      return { attemptCount, nextAttemptAt: null, shouldAlert: false };
    }

    const failureState = billingCancellationFailureState({
      previousAttemptCount: existing?.attemptCount ?? 0,
      previousAlertSentAt: existing?.alertSentAt,
      attemptedAtMs,
    });
    const pendingState = {
      email: profile.email,
      status: 'pending' as const,
      attemptCount: failureState.attemptCount,
      nextAttemptAt: failureState.nextAttemptAt,
      lastAttemptAt: attemptedAt,
      confirmedAt: undefined,
      lastError: args.error,
      alertSentAt: failureState.shouldAlert ? attemptedAt : existing?.alertSentAt,
      updatedAt: attemptedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, pendingState);
    } else {
      await ctx.db.insert('accountDeletionBillingCleanup', {
        clerkId: args.clerkId,
        createdAt: attemptedAt,
        ...pendingState,
      });
    }

    return {
      attemptCount: failureState.attemptCount,
      nextAttemptAt: failureState.nextAttemptAt,
      shouldAlert: failureState.shouldAlert,
    };
  },
});

export const listDueBillingCancellations = internalQuery({
  args: {
    now: v.number(),
  },
  returns: v.array(v.object({ clerkId: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('accountDeletionBillingCleanup')
      .withIndex('by_status_and_nextAttemptAt', (q) => q.eq('status', 'pending').lte('nextAttemptAt', args.now))
      .take(25);
    return rows.map((row) => ({ clerkId: row.clerkId }));
  },
});

export const markExternalCleanupAttempt = internalMutation({
  args: {
    clerkId: v.string(),
    clerkDeleted: v.boolean(),
    clerkMarkedDeleted: v.boolean(),
    clerkSessionsRevoked: v.boolean(),
    loopsUnsubscribed: v.boolean(),
    complete: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .first();
    if (!profile || profile.isDeleted !== true) return null;

    const now = new Date().toISOString();
    await ctx.db.patch(profile._id, {
      clerkDeletedAt: args.clerkDeleted ? (profile.clerkDeletedAt ?? now) : profile.clerkDeletedAt,
      clerkMarkedDeletedAt: args.clerkMarkedDeleted
        ? (profile.clerkMarkedDeletedAt ?? now)
        : profile.clerkMarkedDeletedAt,
      clerkSessionsRevokedAt: args.clerkSessionsRevoked
        ? (profile.clerkSessionsRevokedAt ?? now)
        : profile.clerkSessionsRevokedAt,
      loopsUnsubscribedAt: args.loopsUnsubscribed ? (profile.loopsUnsubscribedAt ?? now) : profile.loopsUnsubscribedAt,
      externalCleanupLastAttemptAt: now,
      externalCleanupCompletedAt: args.complete ? (profile.externalCleanupCompletedAt ?? now) : undefined,
      externalCleanupError: args.error,
      updatedAt: now,
    });
    return null;
  },
});
