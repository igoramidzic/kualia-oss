'use node';

import { invalidateSessions } from '@convex-dev/auth/server';

import { ConvexError, v } from 'convex/values';
import Stripe from 'stripe';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { plaidClient } from '../bankProviders/plaid/plaidClient';
import { DISCORD_NOTIFICATIONS_CHANNEL, type DiscordNotificationArgs } from '../lib/discord';
import {
  cancelRevenueCatBillingSubscription,
  fetchAllRevenueCatSubscriptionsOrThrow,
  type RevenueCatEnvironment,
  type RevenueCatV2Subscription,
} from '../revenuecat/lib/revenueCatApi';

const MAX_RETRY_ATTEMPTS = 8;

interface StripeCancellationClient {
  retrieveSubscriptionItem: (subscriptionItemId: string) => Promise<{ subscription: string | { id: string } }>;
  retrieveSubscription: (subscriptionId: string) => Promise<{ id: string; status: string; cancelAtPeriodEnd: boolean }>;
  scheduleCancellation: (subscriptionId: string) => Promise<void>;
}

interface WebSubscriptionCancellationDependencies {
  fetchSubscriptions: (customerId: string, environment: RevenueCatEnvironment) => Promise<RevenueCatV2Subscription[]>;
  cancelRevenueCatBilling: (subscriptionId: string) => Promise<void>;
  cancelStripeBilling: (storeSubscriptionIdentifier: string) => Promise<void>;
}

interface WebSubscriptionCancellationSummary {
  revenueCatBillingCanceled: number;
  stripeBillingCanceled: number;
}

interface AccountBillingCancellationContext {
  clerkId: string;
  email: string;
  revenueCatCustomerIds: string[];
  billingCancellationStatus?: 'pending' | 'confirmed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const status = Reflect.get(error, 'status');
  return typeof status === 'number' ? status : undefined;
}

function revenueCatEnvironmentForAccountDeletion(): RevenueCatEnvironment {
  const configuredEnvironment = process.env['REVENUECAT_SYNC_ENVIRONMENT']?.trim();
  return configuredEnvironment === 'sandbox' ? 'sandbox' : 'production';
}

export function buildBillingCancellationFailureNotification(args: {
  clerkId: string;
  email: string;
  attemptCount: number;
  error: string;
  nextAttemptAt: number;
}): DiscordNotificationArgs {
  return {
    channel: DISCORD_NOTIFICATIONS_CHANNEL,
    title: 'Account deletion billing cancellation needs attention',
    description:
      'RevenueCat or Stripe cancellation has failed after the initial attempt and eight retries. ' +
      'Automatic hourly retries will continue until cancellation is confirmed; investigate the provider manually.',
    emoji: '❌',
    userId: args.clerkId,
    userEmail: args.email,
    metadata: {
      Attempts: String(args.attemptCount),
      'Next automatic attempt': new Date(args.nextAttemptAt).toISOString(),
      'Last error': args.error.slice(0, 1000),
    },
  };
}

export function stripeSubscriptionIdFromItem(
  subscriptionItemId: string,
  subscription: string | { id: string } | null
): string {
  if (!subscription) {
    throw new Error(`Stripe subscription item ${subscriptionItemId} is not attached to a subscription`);
  }

  return typeof subscription === 'string' ? subscription : subscription.id;
}

function stripeClientForAccountDeletion(): StripeCancellationClient {
  const secretKey = process.env['STRIPE_SECRET_KEY'];
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }

  const stripe = new Stripe(secretKey);
  return {
    retrieveSubscriptionItem: async (subscriptionItemId) => {
      const item = await stripe.subscriptionItems.retrieve(subscriptionItemId);
      return {
        subscription: stripeSubscriptionIdFromItem(subscriptionItemId, item.subscription),
      };
    },
    retrieveSubscription: async (subscriptionId) => {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    },
    scheduleCancellation: async (subscriptionId) => {
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      if (!updatedSubscription.cancel_at_period_end) {
        throw new Error(`Stripe did not confirm cancellation for subscription ${subscriptionId}`);
      }
    },
  };
}

export function shouldCancelWebSubscriptionRenewal(subscription: RevenueCatV2Subscription): boolean {
  if (subscription.store !== 'rc_billing' && subscription.store !== 'stripe') {
    return false;
  }

  return subscription.status !== 'expired' && subscription.auto_renewal_status !== 'will_not_renew';
}

export async function cancelStripeSubscriptionRenewal(
  storeSubscriptionIdentifier: string,
  client: StripeCancellationClient
): Promise<void> {
  let subscriptionId = storeSubscriptionIdentifier;
  if (storeSubscriptionIdentifier.startsWith('si_')) {
    const subscriptionItem = await client.retrieveSubscriptionItem(storeSubscriptionIdentifier);
    subscriptionId =
      typeof subscriptionItem.subscription === 'string'
        ? subscriptionItem.subscription
        : subscriptionItem.subscription.id;
  }

  if (!subscriptionId.startsWith('sub_')) {
    throw new Error(`Unsupported Stripe subscription identifier: ${storeSubscriptionIdentifier}`);
  }

  const subscription = await client.retrieveSubscription(subscriptionId);
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    return;
  }
  if (!subscription.cancelAtPeriodEnd) {
    await client.scheduleCancellation(subscription.id);
  }
}

export async function cancelWebSubscriptionRenewals(args: {
  customerIds: string[];
  environment: RevenueCatEnvironment;
  dependencies: WebSubscriptionCancellationDependencies;
}): Promise<WebSubscriptionCancellationSummary> {
  const subscriptionsById = new Map<string, RevenueCatV2Subscription>();
  for (const customerId of args.customerIds) {
    const subscriptions = await args.dependencies.fetchSubscriptions(customerId, args.environment);
    for (const subscription of subscriptions) {
      subscriptionsById.set(subscription.id, subscription);
    }
  }

  let revenueCatBillingCanceled = 0;
  let stripeBillingCanceled = 0;

  for (const subscription of subscriptionsById.values()) {
    if (!shouldCancelWebSubscriptionRenewal(subscription)) continue;

    if (subscription.store === 'rc_billing') {
      await args.dependencies.cancelRevenueCatBilling(subscription.id);
      revenueCatBillingCanceled++;
      continue;
    }

    const storeSubscriptionIdentifier = subscription.store_subscription_identifier?.trim();
    if (!storeSubscriptionIdentifier) {
      throw new Error(`Stripe subscription ${subscription.id} is missing its store subscription identifier`);
    }
    await args.dependencies.cancelStripeBilling(storeSubscriptionIdentifier);
    stripeBillingCanceled++;
  }

  return { revenueCatBillingCanceled, stripeBillingCanceled };
}

async function cancelAccountWebSubscriptionRenewals(
  customerIds: string[]
): Promise<WebSubscriptionCancellationSummary> {
  let stripeClient: StripeCancellationClient | undefined;
  return await cancelWebSubscriptionRenewals({
    customerIds,
    environment: revenueCatEnvironmentForAccountDeletion(),
    dependencies: {
      fetchSubscriptions: fetchAllRevenueCatSubscriptionsOrThrow,
      cancelRevenueCatBilling: cancelRevenueCatBillingSubscription,
      cancelStripeBilling: async (storeSubscriptionIdentifier) => {
        stripeClient ??= stripeClientForAccountDeletion();
        await cancelStripeSubscriptionRenewal(storeSubscriptionIdentifier, stripeClient);
      },
    },
  });
}

async function attemptAccountBillingCancellation(
  ctx: ActionCtx,
  context: AccountBillingCancellationContext
): Promise<{ confirmed: boolean; error?: string }> {
  if (context.billingCancellationStatus === 'confirmed') {
    return { confirmed: true };
  }

  try {
    const billingCancellation = await cancelAccountWebSubscriptionRenewals(context.revenueCatCustomerIds);
    const recorded = await ctx.runMutation(internal.accountDeletion.mutations.recordBillingCancellationAttempt, {
      clerkId: context.clerkId,
      success: true,
    });
    if (!recorded) {
      return { confirmed: false, error: 'Billing: account deletion state is no longer pending' };
    }

    if (billingCancellation.revenueCatBillingCanceled > 0 || billingCancellation.stripeBillingCanceled > 0) {
      console.log('[Account deletion] Web subscription renewals canceled', {
        clerkId: context.clerkId,
        ...billingCancellation,
      });
    }
    return { confirmed: true };
  } catch (error: unknown) {
    const message = errorMessage(error).slice(0, 2000);
    const recorded = await ctx.runMutation(internal.accountDeletion.mutations.recordBillingCancellationAttempt, {
      clerkId: context.clerkId,
      success: false,
      error: message,
    });
    if (recorded?.shouldAlert && recorded.nextAttemptAt !== null) {
      await ctx.runAction(
        internal.discord.sendDiscordNotification,
        buildBillingCancellationFailureNotification({
          clerkId: context.clerkId,
          email: context.email,
          attemptCount: recorded.attemptCount,
          error: message,
          nextAttemptAt: recorded.nextAttemptAt,
        })
      );
    }
    return { confirmed: false, error: `Billing: ${message}` };
  }
}

function plaidErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const response = Reflect.get(error, 'response');
  if (response === null || typeof response !== 'object') return undefined;
  const data = Reflect.get(response, 'data');
  if (data === null || typeof data !== 'object') return undefined;
  const code = Reflect.get(data, 'error_code');
  return typeof code === 'string' ? code : undefined;
}

export function isAlreadyDisconnectedPlaidError(error: unknown): boolean {
  const code = plaidErrorCode(error);
  return code === 'ITEM_NOT_FOUND' || code === 'INVALID_ACCESS_TOKEN';
}

export async function revokeAllActiveClerkSessions(args: {
  listActiveSessions: (offset: number) => Promise<{ data: Array<{ id: string }> }>;
  revokeSession: (sessionId: string) => Promise<unknown>;
}): Promise<void> {
  const sessionIds: string[] = [];
  let offset = 0;

  while (true) {
    const page = await args.listActiveSessions(offset);
    sessionIds.push(...page.data.map((session) => session.id));
    if (page.data.length < 500) break;
    offset += page.data.length;
  }

  for (const sessionId of sessionIds) {
    await args.revokeSession(sessionId);
  }
}

async function revokeLocalAccountSessions(
  ctx: ActionCtx,
  clerkId: string
): Promise<{
  accountMarkedDeleted: boolean;
  sessionsRevoked: boolean;
  userAlreadyDeleted: boolean;
}> {
  await invalidateSessions(ctx, { userId: clerkId as Id<'users'> });
  return { accountMarkedDeleted: true, sessionsRevoked: true, userAlreadyDeleted: false };
}

export async function commitAccountDeletion<T>(args: {
  softDeleteAccount: (deletedAt: string) => Promise<T | null>;
  now: () => string;
}): Promise<T> {
  const deletion = await args.softDeleteAccount(args.now());
  if (!deletion) {
    throw new ConvexError('Unable to start account deletion');
  }
  return deletion;
}

async function cleanupExternalAccountData(
  ctx: ActionCtx,
  clerkId: string
): Promise<{ complete: boolean; errors: string[] }> {
  const context = await ctx.runQuery(internal.accountDeletion.mutations.getDeletionContext, { clerkId });
  if (!context) {
    return { complete: true, errors: [] };
  }

  const errors: string[] = [];
  const billingCancellation = await attemptAccountBillingCancellation(ctx, {
    clerkId,
    email: context.email,
    revenueCatCustomerIds: context.revenueCatCustomerIds,
    billingCancellationStatus: context.billingCancellationStatus,
  });
  const billingRenewalsCanceled = billingCancellation.confirmed;
  if (billingCancellation.error) errors.push(billingCancellation.error);

  const bankLinks = await ctx.runQuery(internal.accountDeletion.mutations.listPendingPlaidDisconnections, {
    clerkId,
  });

  for (const bankLink of bankLinks) {
    try {
      if (bankLink.provider === 'plaid') {
        try {
          await plaidClient.itemRemove({ access_token: bankLink.accessToken });
        } catch (error: unknown) {
          if (!isAlreadyDisconnectedPlaidError(error)) throw error;
        }
      }

      await ctx.runMutation(internal.accountDeletion.mutations.markBankLinkProviderDisconnected, {
        bankLinkId: bankLink._id,
      });
    } catch (error: unknown) {
      errors.push(`Plaid ${bankLink._id}: ${errorMessage(error)}`);
    }
  }

  let loopsUnsubscribed = context.loopsUnsubscribedAt !== undefined;
  if (!loopsUnsubscribed) {
    try {
      await ctx.runAction(internal.notifications.loops.updateContact, {
        email: context.email,
        userId: clerkId,
        subscribed: false,
      });
      loopsUnsubscribed = true;
    } catch (error: unknown) {
      errors.push(`Loops: ${errorMessage(error)}`);
    }
  }

  let clerkDeleted = context.clerkDeletedAt !== undefined;
  let clerkMarkedDeleted = context.clerkMarkedDeletedAt !== undefined;
  let clerkSessionsRevoked = context.clerkSessionsRevokedAt !== undefined;
  if (!clerkDeleted && (!clerkMarkedDeleted || !clerkSessionsRevoked)) {
    try {
      const clerkCleanup = await revokeLocalAccountSessions(ctx, clerkId);
      clerkDeleted = clerkCleanup.userAlreadyDeleted;
      clerkMarkedDeleted = clerkCleanup.accountMarkedDeleted;
      clerkSessionsRevoked = clerkCleanup.sessionsRevoked;
    } catch (error: unknown) {
      errors.push(`Clerk: ${errorMessage(error)}`);
    }
  }

  const hasPendingPlaid = await ctx.runQuery(internal.accountDeletion.mutations.hasPendingPlaidDisconnections, {
    clerkId,
  });
  const complete =
    billingRenewalsCanceled &&
    (clerkDeleted || (clerkMarkedDeleted && clerkSessionsRevoked)) &&
    loopsUnsubscribed &&
    !hasPendingPlaid;

  await ctx.runMutation(internal.accountDeletion.mutations.markExternalCleanupAttempt, {
    clerkId,
    clerkDeleted,
    clerkMarkedDeleted,
    clerkSessionsRevoked,
    loopsUnsubscribed,
    complete,
    error: errors.length > 0 ? errors.join('; ').slice(0, 2000) : undefined,
  });

  return {
    complete,
    errors,
  };
}

export const deleteAccountImpl = internalAction({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const context = await ctx.runQuery(internal.accountDeletion.mutations.getDeletionContext, args);
    if (!context) {
      throw new ConvexError('User profile not found. Please try again shortly.');
    }

    // The local tombstone is the commit point. Clerk is retained for support and
    // reactivation, while its sessions and every Kualia-scoped credential are revoked.
    await commitAccountDeletion({
      softDeleteAccount: async (deletedAt) =>
        await ctx.runMutation(internal.accountDeletion.mutations.softDeleteAccount, {
          clerkId: args.clerkId,
          deletedAt,
        }),
      now: () => new Date().toISOString(),
    });

    const cleanup = await cleanupExternalAccountData(ctx, args.clerkId);
    if (cleanup.errors.length > 0) {
      console.error('[Account deletion] External cleanup will be retried', {
        clerkId: args.clerkId,
        errors: cleanup.errors,
      });
    }
    if (!cleanup.complete) {
      await ctx.scheduler.runAfter(60_000, internal.accountDeletion.actionsNode.retryExternalDeletion, {
        clerkId: args.clerkId,
        attempt: 1,
      });
    }

    return { success: true };
  },
});

export const retryExternalDeletion = internalAction({
  args: {
    clerkId: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.accountDeletion.mutations.getDeletionContext, {
      clerkId: args.clerkId,
    });
    if (!context?.isDeleted) return null;

    const cleanup = await cleanupExternalAccountData(ctx, args.clerkId);
    const attempt = args.attempt ?? 1;
    if (!cleanup.complete && attempt < MAX_RETRY_ATTEMPTS) {
      const delayMs = Math.min(60_000 * 2 ** attempt, 24 * 60 * 60 * 1000);
      await ctx.scheduler.runAfter(delayMs, internal.accountDeletion.actionsNode.retryExternalDeletion, {
        clerkId: args.clerkId,
        attempt: attempt + 1,
      });
    }
    return null;
  },
});

export const processPendingBillingCancellations = internalAction({
  args: {},
  returns: v.object({
    examined: v.number(),
    confirmed: v.number(),
    failed: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (
    ctx
  ): Promise<{
    examined: number;
    confirmed: number;
    failed: number;
    continuationScheduled: boolean;
  }> => {
    const dueCancellations = await ctx.runQuery(internal.accountDeletion.mutations.listDueBillingCancellations, {
      now: Date.now(),
    });
    let confirmed = 0;
    let failed = 0;
    let encounteredUnexpectedError = false;

    for (const cancellation of dueCancellations) {
      try {
        await cleanupExternalAccountData(ctx, cancellation.clerkId);
        const context = await ctx.runQuery(internal.accountDeletion.mutations.getDeletionContext, {
          clerkId: cancellation.clerkId,
        });
        if (context?.billingCancellationStatus === 'confirmed') {
          confirmed++;
        } else {
          failed++;
        }
      } catch (error: unknown) {
        encounteredUnexpectedError = true;
        failed++;
        console.error('[Account deletion billing] Durable retry failed unexpectedly', {
          clerkId: cancellation.clerkId,
          error: errorMessage(error),
        });
      }
    }

    const continuationScheduled = dueCancellations.length === 25 && !encounteredUnexpectedError;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.actionsNode.processPendingBillingCancellations, {});
    }

    return {
      examined: dueCancellations.length,
      confirmed,
      failed,
      continuationScheduled,
    };
  },
});

export const markAccountReactivated = internalAction({
  args: {
    clerkId: v.string(),
    reactivatedAt: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.accountDeletion.mutations.getDeletionContext, {
      clerkId: args.clerkId,
    });
    if (!context || context.isDeleted) return null;

    return null;
  },
});

export const processDeletedAccounts = internalAction({
  args: {
    cursor: v.optional(v.string()),
    deletedBefore: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ examined: number; purgeStarted: number; continuationScheduled: boolean }> => {
    const deletedBefore = args.deletedBefore ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const profilesPage = await ctx.runQuery(internal.accountDeletion.purge.listEligibleDeletedProfiles, {
      deletedBefore,
      paginationOpts: { numItems: 25, cursor: args.cursor ?? null },
    });
    let purgeStarted = 0;

    for (const profile of profilesPage.page) {
      const cleanup = await cleanupExternalAccountData(ctx, profile.clerkId);
      if (!cleanup.complete) {
        console.error('[Account deletion purge] External cleanup incomplete', {
          clerkId: profile.clerkId,
          errors: cleanup.errors,
        });
        continue;
      }

      const started = await ctx.runMutation(internal.accountDeletion.purge.startPermanentPurge, {
        userProfileId: profile._id,
        clerkId: profile.clerkId,
        deletedBefore,
      });
      if (started) purgeStarted++;
    }

    if (!profilesPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.actionsNode.processDeletedAccounts, {
        cursor: profilesPage.continueCursor,
        deletedBefore,
      });
    }

    return {
      examined: profilesPage.page.length,
      purgeStarted,
      continuationScheduled: !profilesPage.isDone,
    };
  },
});
