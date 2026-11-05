import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import {
  type ActiveSubscription,
  determineSubscriptionType,
  fetchRevenueCatPurchases,
  fetchRevenueCatSubscriptions,
  findActiveSubscription,
  mapWebhookStore,
  type RevenueCatEnvironment,
  type SubscriptionStatus,
  type SubscriptionType,
  selectPreferredActiveSubscription,
} from '../lib/revenueCatApi';

/**
 * RevenueCat webhook event types
 */
type RevenueCatEventType =
  | 'TEST'
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'NON_RENEWING_PURCHASE'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'TRANSFER'
  | 'REFUND';

/**
 * RevenueCat webhook event data structure
 */
interface RevenueCatEventData {
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  id?: string;
  event_timestamp_ms?: number;
  environment?: 'PRODUCTION' | 'SANDBOX';
  product_id: string;
  entitlement_ids?: string[];
  period_type?: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID';
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  original_transaction_id?: string;
  store?: 'APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'RC_BILLING' | 'PROMOTIONAL';
  price?: number | null;
  currency?: string | null;
  price_in_purchased_currency?: number | null;
  cancel_reason?: string;
  is_trial_conversion?: boolean;
  new_product_id?: string;
}

/**
 * RevenueCat TRANSFER event data structure
 * TRANSFER events have different fields than other events
 */
interface RevenueCatTransferEventData {
  transferred_from: string[];
  transferred_to: string[];
  id?: string;
  event_timestamp_ms?: number;
  product_id?: string;
  entitlement_ids?: string[];
  store?: 'APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'RC_BILLING' | 'PROMOTIONAL';
}

interface UpsertSubscriptionResult {
  status: SubscriptionStatus;
}

function uniqueNonEmptyValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter((value) => value.length > 0))];
}

export function getRevenueCatCustomerIdsForEvent(eventData: RevenueCatEventData): string[] {
  return uniqueNonEmptyValues([eventData.app_user_id, eventData.original_app_user_id, ...(eventData.aliases ?? [])]);
}

function getRevenueCatEventTimestamp(eventData: { event_timestamp_ms?: number }): string {
  if (eventData.event_timestamp_ms !== undefined) {
    const timestamp = new Date(eventData.event_timestamp_ms);
    if (Number.isFinite(timestamp.getTime())) {
      return timestamp.toISOString();
    }
  }

  return new Date().toISOString();
}

function getRevenueCatEventEnvironment(eventData: RevenueCatEventData): RevenueCatEnvironment {
  return eventData.environment === 'SANDBOX' ? 'sandbox' : 'production';
}

/**
 * Handle RevenueCat webhook events
 * RevenueCat uses Bearer token authentication in the Authorization header
 */
export async function handleRevenueCatWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
  try {
    // 1. Verify Authorization Header
    const authHeader = request.headers.get('Authorization');
    const webhookSecret = process.env['REVENUECAT_WEBHOOK_SECRET'];

    if (!webhookSecret) {
      console.error('Missing REVENUECAT_WEBHOOK_SECRET environment variable');
      return new Response('Webhook secret not configured', { status: 500 });
    }

    // RevenueCat sends the authorization header as configured in their dashboard
    // Support both raw secret and Bearer token format
    const isValidAuth = authHeader === webhookSecret || authHeader === `Bearer ${webhookSecret}`;

    if (!isValidAuth) {
      console.error('Invalid RevenueCat webhook authorization');
      return new Response('Unauthorized', { status: 401 });
    }

    // 2. Parse webhook payload
    const payload = (await request.json()) as {
      api_version?: string;
      event?: {
        type: RevenueCatEventType;
      } & (RevenueCatEventData | RevenueCatTransferEventData);
    };

    const eventType = payload.event?.type;
    const eventData = payload.event;

    if (!eventType || !eventData) {
      console.error('Invalid RevenueCat webhook payload');
      return new Response('Invalid payload', { status: 400 });
    }

    // Handle TRANSFER events separately (they have different payload structure)
    if (eventType === 'TRANSFER') {
      const transferData = eventData as { type: RevenueCatEventType } & RevenueCatTransferEventData;
      console.log(
        `RevenueCat webhook: TRANSFER from [${transferData.transferred_from.join(', ')}] to [${transferData.transferred_to.join(', ')}]`
      );
      return handleTransfer(ctx, transferData);
    }

    // All other events have app_user_id
    const standardEventData = eventData as { type: RevenueCatEventType } & RevenueCatEventData;
    const appUserId = standardEventData.app_user_id;
    console.log(`RevenueCat webhook: ${eventType} for user ${appUserId}`);

    // 3. Handle event types
    switch (eventType) {
      case 'TEST':
        console.log('RevenueCat test webhook received');
        return new Response('Test event received', { status: 200 });

      case 'INITIAL_PURCHASE':
        return handleInitialPurchase(ctx, standardEventData);

      case 'RENEWAL':
        return handleRenewal(ctx, standardEventData);

      case 'CANCELLATION':
        return handleCancellation(ctx, standardEventData);

      case 'UNCANCELLATION':
        return handleUncancellation(ctx, standardEventData);

      case 'NON_RENEWING_PURCHASE':
        return handleNonRenewingPurchase(ctx, standardEventData);

      case 'SUBSCRIPTION_PAUSED':
        return handleSubscriptionPaused(ctx, standardEventData);

      case 'EXPIRATION':
        return handleExpiration(ctx, standardEventData);

      case 'BILLING_ISSUE':
        return handleBillingIssue(ctx, standardEventData);

      case 'PRODUCT_CHANGE':
        return handleProductChange(ctx, standardEventData);

      case 'REFUND':
        return handleRefund(ctx, standardEventData);

      default:
        // Unknown event types should still return 200 to avoid retries
        console.log(`Unhandled RevenueCat event type: ${eventType}`);
        return new Response('Event received', { status: 200 });
    }
  } catch (error: unknown) {
    console.error('Error processing RevenueCat webhook:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Fetch expiration date from RevenueCat API when webhook event doesn't include it
 * Note: Only fetches subscriptions (not purchases) since lifetime products don't have expiration
 */
async function fetchExpirationFromApi(appUserId: string): Promise<string | null> {
  const subscriptions = await fetchRevenueCatSubscriptions(appUserId);
  const activeSubscription = findActiveSubscription(subscriptions);
  if (activeSubscription?.expiresAt) {
    return activeSubscription.expiresAt;
  }
  return null;
}

/**
 * Reconcile access-risk webhook events against RevenueCat's current customer state.
 */
async function reconcileCurrentRevenueCatAccess(
  ctx: ActionCtx,
  eventData: RevenueCatEventData,
  eventType: RevenueCatEventType
): Promise<boolean> {
  const customerIds = getRevenueCatCustomerIdsForEvent(eventData);
  const environment = getRevenueCatEventEnvironment(eventData);
  const customerStates = await Promise.all(
    customerIds.map(async (customerId) => {
      const [subscriptions, purchases] = await Promise.all([
        fetchRevenueCatSubscriptions(customerId, environment),
        fetchRevenueCatPurchases(customerId, environment),
      ]);

      return {
        activeSubscription: findActiveSubscription(subscriptions, purchases),
        customerId,
        foundSubscriber: subscriptions !== null || purchases !== null,
      };
    })
  );

  if (!customerStates.some((customerState) => customerState.foundSubscriber)) {
    console.warn(`RevenueCat reconciliation unavailable for user ${eventData.app_user_id}; using webhook payload`);
    return false;
  }

  const activeSubscription = selectPreferredActiveSubscription(
    customerStates.flatMap((customerState) =>
      customerState.activeSubscription ? [customerState.activeSubscription] : []
    )
  );
  if (!activeSubscription) {
    console.log(`No current RevenueCat access found for user ${eventData.app_user_id}; using webhook payload`);
    return false;
  }

  const persistedStatus = await upsertCurrentRevenueCatSubscription(
    ctx,
    eventData,
    eventType,
    activeSubscription,
    customerIds
  );
  const userEmail = await getUserEmailForNotifications(ctx, eventData.app_user_id);
  await syncSubscriptionStatusToLoops(ctx, eventData.app_user_id, persistedStatus, userEmail);

  console.log(
    `Reconciled ${eventType} webhook for user ${eventData.app_user_id} to current RevenueCat product ${activeSubscription.productId} (${persistedStatus})`
  );
  return true;
}

async function upsertCurrentRevenueCatSubscription(
  ctx: ActionCtx,
  eventData: RevenueCatEventData,
  eventType: RevenueCatEventType,
  activeSubscription: ActiveSubscription,
  revenueCatCustomerIds: string[]
): Promise<SubscriptionStatus> {
  const eventTimestamp = getRevenueCatEventTimestamp(eventData);
  const result: UpsertSubscriptionResult = await ctx.runMutation(internal.revenuecat.mutations.upsertSubscription, {
    clerkId: eventData.app_user_id,
    revenueCatCustomerIds,
    isAuthoritativeRevenueCatState: true,
    subscriptionData: {
      revenueCatSubscriberId:
        activeSubscription.originalCustomerId ??
        activeSubscription.customerId ??
        eventData.original_app_user_id ??
        eventData.app_user_id,
      originalTransactionId: activeSubscription.originalTransactionId,
      productId: activeSubscription.productId,
      entitlementIds: activeSubscription.entitlementIds,
      subscriptionType: activeSubscription.subscriptionType,
      status: activeSubscription.status,
      periodType: activeSubscription.periodType,
      store: activeSubscription.store,
      purchasedAt: activeSubscription.purchasedAt,
      expiresAt: activeSubscription.expiresAt,
      canceledAt: activeSubscription.status === 'active' || activeSubscription.status === 'trialing' ? null : undefined,
      lastEventType: eventType,
      lastEventTimestamp: eventTimestamp,
      lastEventId: eventData.id,
      updatedAt: eventTimestamp,
    },
  });

  return result.status;
}

/**
 * Handle initial purchase (new subscription or trial start)
 */
async function handleInitialPurchase(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);
  const status: SubscriptionStatus = eventData.period_type === 'TRIAL' ? 'trialing' : 'active';

  // For initial purchase, ensure expiresAt is set from the event
  // If expiration_at_ms is missing, fetch from RevenueCat API
  let expiresAt: string | null = eventData.expiration_at_ms ? new Date(eventData.expiration_at_ms).toISOString() : null;

  if (!eventData.expiration_at_ms) {
    console.warn(
      `INITIAL_PURCHASE event missing expiration_at_ms for user ${eventData.app_user_id}, fetching from API`
    );
    expiresAt = await fetchExpirationFromApi(eventData.app_user_id);
  }

  await upsertSubscription(ctx, eventData, 'INITIAL_PURCHASE', {
    subscriptionType,
    status,
    expiresAt,
  });

  return new Response('Initial purchase processed', { status: 200 });
}

/**
 * Handle subscription renewal (including trial-to-paid conversion)
 */
async function handleRenewal(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);

  // For renewals, we must ensure expiresAt is updated with the new expiration
  // If expiration_at_ms is missing, fetch from RevenueCat API
  let expiresAt: string | null = eventData.expiration_at_ms ? new Date(eventData.expiration_at_ms).toISOString() : null;

  if (!eventData.expiration_at_ms) {
    console.warn(`RENEWAL event missing expiration_at_ms for user ${eventData.app_user_id}, fetching from API`);
    expiresAt = await fetchExpirationFromApi(eventData.app_user_id);
  }

  await upsertSubscription(ctx, eventData, 'RENEWAL', {
    subscriptionType,
    status: 'active',
    expiresAt,
    canceledAt: null, // Clear any previous cancellation on renewal
  });

  return new Response('Renewal processed', { status: 200 });
}

/**
 * Handle subscription cancellation
 * Note: User still has access until the end of the current period
 */
async function handleCancellation(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  if (await reconcileCurrentRevenueCatAccess(ctx, eventData, 'CANCELLATION')) {
    return new Response('Cancellation processed from current RevenueCat state', { status: 200 });
  }

  // For cancellation, expiresAt tells us when access will end
  // This is important - user still has access until expiration
  let expiresAt: string | null = eventData.expiration_at_ms ? new Date(eventData.expiration_at_ms).toISOString() : null;

  if (!eventData.expiration_at_ms) {
    console.warn(`CANCELLATION event missing expiration_at_ms for user ${eventData.app_user_id}, fetching from API`);
    expiresAt = await fetchExpirationFromApi(eventData.app_user_id);
  }

  await upsertSubscription(ctx, eventData, 'CANCELLATION', {
    status: 'canceled',
    expiresAt,
    canceledAt: new Date().toISOString(),
  });

  return new Response('Cancellation processed', { status: 200 });
}

/**
 * Handle subscription uncancellation (user reactivates auto-renewal)
 */
async function handleUncancellation(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  // For uncancellation, ensure expiresAt is updated with current expiration
  // If expiration_at_ms is missing, fetch from RevenueCat API
  let expiresAt: string | null = eventData.expiration_at_ms ? new Date(eventData.expiration_at_ms).toISOString() : null;

  if (!eventData.expiration_at_ms) {
    console.warn(`UNCANCELLATION event missing expiration_at_ms for user ${eventData.app_user_id}, fetching from API`);
    expiresAt = await fetchExpirationFromApi(eventData.app_user_id);
  }

  await upsertSubscription(ctx, eventData, 'UNCANCELLATION', {
    status: 'active',
    expiresAt,
    canceledAt: null, // Clear cancellation status
  });

  return new Response('Uncancellation processed', { status: 200 });
}

/**
 * Handle non-renewing purchase (lifetime purchase)
 */
async function handleNonRenewingPurchase(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  await upsertSubscription(ctx, eventData, 'NON_RENEWING_PURCHASE', {
    subscriptionType: 'lifetime',
    status: 'active',
    expiresAt: null, // Lifetime never expires
    canceledAt: null,
  });

  return new Response('Non-renewing purchase processed', { status: 200 });
}

/**
 * Handle subscription paused (Android only)
 */
async function handleSubscriptionPaused(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  if (await reconcileCurrentRevenueCatAccess(ctx, eventData, 'SUBSCRIPTION_PAUSED')) {
    return new Response('Subscription paused processed from current RevenueCat state', { status: 200 });
  }

  await upsertSubscription(ctx, eventData, 'SUBSCRIPTION_PAUSED', {
    status: 'paused',
  });

  return new Response('Subscription paused processed', { status: 200 });
}

/**
 * Handle subscription expiration
 */
async function handleExpiration(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  if (await reconcileCurrentRevenueCatAccess(ctx, eventData, 'EXPIRATION')) {
    return new Response('Expiration processed from current RevenueCat state', { status: 200 });
  }

  await upsertSubscription(ctx, eventData, 'EXPIRATION', {
    status: 'expired',
  });

  return new Response('Expiration processed', { status: 200 });
}

/**
 * Handle billing issue
 */
async function handleBillingIssue(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  if (await reconcileCurrentRevenueCatAccess(ctx, eventData, 'BILLING_ISSUE')) {
    return new Response('Billing issue processed from current RevenueCat state', { status: 200 });
  }

  await upsertSubscription(ctx, eventData, 'BILLING_ISSUE', {
    status: 'billing_issue',
  });

  return new Response('Billing issue processed', { status: 200 });
}

/**
 * Handle product change (upgrade/downgrade)
 */
async function handleProductChange(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  const newProductId = eventData.new_product_id ?? eventData.product_id;
  const subscriptionType = determineSubscriptionType(newProductId, eventData.period_type);

  // For product changes, we need to explicitly update expiresAt from the event data
  // If expiration_at_ms is not provided, set to null to clear old expiration
  const expiresAt = eventData.expiration_at_ms ? new Date(eventData.expiration_at_ms).toISOString() : null;

  await upsertSubscription(ctx, eventData, 'PRODUCT_CHANGE', {
    subscriptionType,
    productId: newProductId,
    status: 'active',
    expiresAt,
    canceledAt: null, // Clear any previous cancellation
  });

  return new Response('Product change processed', { status: 200 });
}

/**
 * Handle refund
 */
async function handleRefund(ctx: ActionCtx, eventData: RevenueCatEventData): Promise<Response> {
  if (await reconcileCurrentRevenueCatAccess(ctx, eventData, 'REFUND')) {
    return new Response('Refund processed from current RevenueCat state', { status: 200 });
  }

  await upsertSubscription(ctx, eventData, 'REFUND', {
    status: 'expired',
  });

  return new Response('Refund processed', { status: 200 });
}

/**
 * Handle subscription transfer (V1 to V2 migration)
 * When a user restores purchases with a new app_user_id, RevenueCat transfers the subscription
 */
async function handleTransfer(ctx: ActionCtx, transferData: RevenueCatTransferEventData): Promise<Response> {
  const transferredTo = transferData.transferred_to;

  if (!transferredTo || transferredTo.length === 0) {
    console.error('TRANSFER event missing transferred_to field');
    return new Response('Invalid transfer event', { status: 400 });
  }

  // The new user ID (Clerk ID in V2)
  const newUserId = transferredTo[0];
  console.log(`Processing transfer to user: ${newUserId}`);

  // Fetch both subscriptions and purchases from RevenueCat
  const [subscriptions, purchases] = await Promise.all([
    fetchRevenueCatSubscriptions(newUserId),
    fetchRevenueCatPurchases(newUserId),
  ]);

  if (!subscriptions && !purchases) {
    console.error(`Failed to fetch subscriber info for ${newUserId}`);
    // Return 200 to avoid retries - we'll get updated on next subscription event
    return new Response('Transfer processed (subscriber fetch failed)', { status: 200 });
  }

  // Find the active subscription (checks subscriptions first, then purchases for lifetime)
  const activeSubscription = findActiveSubscription(subscriptions, purchases);

  if (!activeSubscription) {
    console.log(`No active subscription found for transferred user ${newUserId}`);
    return new Response('Transfer processed (no active subscription)', { status: 200 });
  }

  const eventTimestamp = getRevenueCatEventTimestamp(transferData);
  const revenueCatCustomerIds = uniqueNonEmptyValues([
    newUserId,
    ...transferData.transferred_from,
    ...transferData.transferred_to,
  ]);

  // Create subscription record for the new user
  const result: UpsertSubscriptionResult = await ctx.runMutation(internal.revenuecat.mutations.upsertSubscription, {
    clerkId: newUserId,
    revenueCatCustomerIds,
    isAuthoritativeRevenueCatState: true,
    subscriptionData: {
      revenueCatSubscriberId: newUserId,
      originalTransactionId: activeSubscription.originalTransactionId,
      productId: activeSubscription.productId,
      entitlementIds: activeSubscription.entitlementIds,
      subscriptionType: activeSubscription.subscriptionType,
      status: activeSubscription.status,
      periodType: activeSubscription.periodType,
      store: activeSubscription.store,
      purchasedAt: activeSubscription.purchasedAt,
      expiresAt: activeSubscription.expiresAt,
      lastEventType: 'TRANSFER',
      lastEventTimestamp: eventTimestamp,
      lastEventId: transferData.id,
      updatedAt: eventTimestamp,
    },
  });

  console.log(`Created subscription for transferred user ${newUserId}`);

  // Sync subscription status to Loops (fire-and-forget)
  await syncSubscriptionStatusToLoops(ctx, newUserId, result.status);

  return new Response('Transfer processed', { status: 200 });
}

async function getUserEmailForNotifications(ctx: ActionCtx, clerkId: string): Promise<string | undefined> {
  try {
    const user = await ctx.runQuery(internal.clerk.getUserByClerkId, { clerkId });
    if (!user?.email) {
      console.warn(`Cannot resolve notification email for clerkId ${clerkId}`);
      return undefined;
    }

    return user.email;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to resolve notification email for clerkId ${clerkId}: ${message}`);
    return undefined;
  }
}

/**
 * Sync subscription status to Loops contact.
 * Fire-and-forget — never blocks webhook response.
 */
async function syncSubscriptionStatusToLoops(
  ctx: ActionCtx,
  clerkId: string,
  subscriptionStatus: string,
  email?: string
): Promise<void> {
  try {
    const userEmail = email ?? (await getUserEmailForNotifications(ctx, clerkId));
    if (!userEmail) {
      console.warn(`Cannot sync to Loops: no email found for clerkId ${clerkId}`);
      return;
    }

    await ctx.runAction(internal.notifications.loops.updateContact, {
      email: userEmail,
      subscriptionStatus,
    });

    console.log(`Synced subscriptionStatus="${subscriptionStatus}" to Loops for ${userEmail}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to sync subscription status to Loops for clerkId ${clerkId}: ${message}`);
  }
}

/**
 * Upsert subscription in the database
 */
async function upsertSubscription(
  ctx: ActionCtx,
  eventData: RevenueCatEventData,
  eventType: RevenueCatEventType,
  overrides: {
    subscriptionType?: SubscriptionType;
    status?: SubscriptionStatus;
    productId?: string;
    expiresAt?: string | null;
    canceledAt?: string | null;
  }
): Promise<SubscriptionStatus> {
  const eventTimestamp = getRevenueCatEventTimestamp(eventData);
  const price = eventData.price !== null && eventData.price !== undefined ? eventData.price : undefined;

  const result: UpsertSubscriptionResult = await ctx.runMutation(internal.revenuecat.mutations.upsertSubscription, {
    clerkId: eventData.app_user_id,
    revenueCatCustomerIds: getRevenueCatCustomerIdsForEvent(eventData),
    isAuthoritativeRevenueCatState: false,
    subscriptionData: {
      revenueCatSubscriberId: eventData.original_app_user_id ?? eventData.app_user_id,
      originalTransactionId: eventData.original_transaction_id,
      productId: overrides.productId ?? eventData.product_id,
      entitlementIds: eventData.entitlement_ids ?? [],
      subscriptionType:
        overrides.subscriptionType ?? determineSubscriptionType(eventData.product_id, eventData.period_type),
      status: overrides.status ?? 'active',
      periodType: eventData.period_type,
      price: price !== undefined ? Math.round(price * 100) : undefined,
      currency: price !== undefined ? 'USD' : undefined,
      store: mapWebhookStore(eventData.store),
      purchasedAt: eventData.purchased_at_ms ? new Date(eventData.purchased_at_ms).toISOString() : undefined,
      expiresAt:
        overrides.expiresAt !== undefined
          ? overrides.expiresAt
          : eventData.expiration_at_ms
            ? new Date(eventData.expiration_at_ms).toISOString()
            : undefined,
      canceledAt: overrides.canceledAt,
      lastEventType: eventType,
      lastEventTimestamp: eventTimestamp,
      lastEventId: eventData.id,
      updatedAt: eventTimestamp,
    },
  });

  // Sync subscription status to Loops (fire-and-forget)
  const userEmail = await getUserEmailForNotifications(ctx, eventData.app_user_id);
  await syncSubscriptionStatusToLoops(ctx, eventData.app_user_id, result.status, userEmail);

  // Send Discord notification for key subscription events (fire-and-forget)
  try {
    const metadata: Record<string, string> = {
      product: eventData.product_id,
    };

    if (eventType === 'INITIAL_PURCHASE' && eventData.period_type === 'TRIAL') {
      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'subscription',
        title: 'Trial Started',
        emoji: '🆓',
        userId: eventData.app_user_id,
        userEmail,
        metadata,
      });
    } else if (eventType === 'INITIAL_PURCHASE' && eventData.period_type !== 'TRIAL') {
      const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);
      const priceDisplay = formatPrice(eventData.price);
      const planLabel = formatPlanLabel(subscriptionType);

      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'subscription',
        title: 'New Purchase',
        description: `${planLabel} — ${priceDisplay}`,
        emoji: '💳',
        userId: eventData.app_user_id,
        userEmail,
        metadata: { ...metadata, plan: planLabel, price: priceDisplay },
      });
    } else if (eventType === 'RENEWAL' && eventData.is_trial_conversion) {
      const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);
      const priceDisplay = formatPrice(eventData.price);
      const planLabel = formatPlanLabel(subscriptionType);

      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'subscription',
        title: 'Trial Converted',
        description: `${planLabel} — ${priceDisplay}`,
        emoji: '💰',
        userId: eventData.app_user_id,
        userEmail,
        metadata: { ...metadata, plan: planLabel, price: priceDisplay },
      });
    } else if (eventType === 'CANCELLATION') {
      const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);
      const planLabel = formatPlanLabel(subscriptionType);
      const reason = eventData.cancel_reason ? ` — ${eventData.cancel_reason}` : '';

      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'subscription',
        title: 'Subscription Canceled',
        description: `${planLabel}${reason}`,
        emoji: '😢',
        userId: eventData.app_user_id,
        userEmail,
        metadata: {
          ...metadata,
          plan: planLabel,
          ...(eventData.cancel_reason ? { reason: eventData.cancel_reason } : {}),
        },
      });
    } else if (eventType === 'REFUND') {
      const subscriptionType = determineSubscriptionType(eventData.product_id, eventData.period_type);
      const planLabel = formatPlanLabel(subscriptionType);
      const priceDisplay = formatPrice(eventData.price);

      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'subscription',
        title: 'Refund',
        description: `${planLabel} — ${priceDisplay}`,
        emoji: '😞',
        userId: eventData.app_user_id,
        userEmail,
        metadata: { ...metadata, plan: planLabel, price: priceDisplay },
      });
    }
  } catch (error: unknown) {
    console.error('Failed to send Discord subscription event:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result.status;
}

/**
 * Format RevenueCat's USD price for display (e.g. "$4.99")
 */
export function formatPrice(price?: number | null): string {
  if (price === undefined || price === null) {
    return 'N/A';
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  } catch (_error: unknown) {
    return `${price} USD`;
  }
}

/**
 * Format subscription type as a display label (e.g. "Monthly", "Yearly", "Lifetime")
 */
function formatPlanLabel(subscriptionType: SubscriptionType): string {
  switch (subscriptionType) {
    case 'monthly':
      return 'Monthly';
    case 'yearly':
      return 'Yearly';
    case 'lifetime':
      return 'Lifetime';
    case 'trial':
      return 'Trial';
    default:
      return subscriptionType;
  }
}
