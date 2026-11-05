/**
 * Shared RevenueCat API utilities
 * Uses V2 API directly without conversion to V1 format
 */

/**
 * Subscription status type
 */
export type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'expired' | 'billing_issue' | 'paused';

/**
 * Subscription type
 */
export type SubscriptionType = 'trial' | 'monthly' | 'yearly' | 'lifetime';

type RevenueCatStore =
  | 'amazon'
  | 'app_store'
  | 'external'
  | 'galaxy_store'
  | 'mac_app_store'
  | 'paddle'
  | 'play_store'
  | 'promotional'
  | 'roku'
  | 'stripe'
  | 'rc_billing'
  | 'test_store'
  | 'unknown_store';
export type RevenueCatEnvironment = 'production' | 'sandbox';
type RevenueCatSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'expired'
  | 'in_grace_period'
  | 'in_billing_retry'
  | 'paused'
  | 'unknown'
  | 'incomplete';

/**
 * RevenueCat API v2 subscriptions response
 */
export interface RevenueCatV2SubscriptionsResponse {
  items: Array<RevenueCatV2Subscription>;
  next_page?: string | null;
}

/**
 * RevenueCat API v2 purchases response (for non-subscription products like lifetime)
 */
export interface RevenueCatV2PurchasesResponse {
  items: Array<RevenueCatV2Purchase>;
  next_page?: string;
}

/**
 * RevenueCat API v2 purchase item (non-subscription)
 */
export interface RevenueCatV2Purchase {
  id: string;
  customer_id?: string | null;
  original_customer_id?: string | null;
  product_id?: string | null;
  purchased_at?: string | number | null;
  status?: string | null;
  store?: RevenueCatStore | null;
  store_purchase_identifier?: string;
  ownership: 'purchased' | 'family_shared';
  entitlements?: {
    items: Array<{
      id?: string | null;
      lookup_key?: string | null;
      entitlement_id?: string | null;
      display_name?: string;
      state?: string | null;
    }>;
  } | null;
  environment: RevenueCatEnvironment;
  presented_offering_id?: string;
  country?: string;
  quantity?: number;
}

/**
 * RevenueCat API v2 subscription item
 */
export interface RevenueCatV2Subscription {
  id: string;
  customer_id?: string | null;
  original_customer_id?: string | null;
  product_id?: string | null;
  starts_at?: string | number | null;
  current_period_starts_at?: string | number | null;
  current_period_ends_at?: string | number | null;
  gives_access?: boolean | null;
  pending_payment?: boolean;
  auto_renewal_status?:
    | 'will_renew'
    | 'will_not_renew'
    | 'will_change_product'
    | 'will_pause'
    | 'requires_price_increase_consent'
    | 'has_already_renewed';
  status?: RevenueCatSubscriptionStatus | null;
  store?: RevenueCatStore | null;
  store_subscription_identifier?: string;
  ownership: 'purchased' | 'family_shared';
  entitlements?: {
    items: Array<{
      id?: string | null;
      lookup_key?: string | null;
      entitlement_id?: string | null;
      display_name?: string;
    }>;
  } | null;
  environment: RevenueCatEnvironment;
  presented_offering_id?: string;
  country?: string;
}

/**
 * Active subscription info extracted from RevenueCat
 */
export interface ActiveSubscription {
  customerId?: string;
  originalCustomerId?: string;
  environment: RevenueCatEnvironment;
  productId: string;
  subscriptionType: SubscriptionType;
  status: SubscriptionStatus;
  periodType?: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID';
  store?: 'app_store' | 'play_store' | 'stripe' | 'promotional';
  purchasedAt?: string;
  expiresAt?: string | null;
  originalTransactionId?: string;
  entitlementIds: string[];
}

/**
 * Get API credentials from environment
 */
function getApiCredentials(): { apiKey: string; projectId: string } | null {
  const apiKey = process.env['REVENUECAT_API_KEY'];
  const projectId = process.env['REVENUECAT_PROJECT_ID'];

  if (!apiKey) {
    console.error('Missing REVENUECAT_API_KEY environment variable');
    return null;
  }

  if (!projectId) {
    console.error('Missing REVENUECAT_PROJECT_ID environment variable');
    return null;
  }

  return { apiKey, projectId };
}

function requireApiCredentials(): { apiKey: string; projectId: string } {
  const credentials = getApiCredentials();
  if (!credentials) {
    throw new Error('RevenueCat API credentials are not configured');
  }
  return credentials;
}

function buildRevenueCatCustomerUrl(
  projectId: string,
  appUserId: string,
  resource: 'subscriptions' | 'purchases',
  environment: RevenueCatEnvironment
): string {
  const url = new URL(
    `https://api.revenuecat.com/v2/projects/${projectId}/customers/${encodeURIComponent(appUserId)}/${resource}`
  );
  url.searchParams.set('environment', environment);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSubscriptionsResponse(value: unknown): RevenueCatV2SubscriptionsResponse {
  if (!isRecord(value) || !Array.isArray(value['items'])) {
    throw new Error('RevenueCat subscriptions response did not contain an items array');
  }

  for (const item of value['items']) {
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].trim().length === 0) {
      throw new Error('RevenueCat subscriptions response contained an invalid subscription');
    }

    for (const field of ['store', 'status', 'auto_renewal_status', 'store_subscription_identifier'] as const) {
      const fieldValue = item[field];
      if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string') {
        throw new Error(`RevenueCat subscription ${item['id']} contained an invalid ${field}`);
      }
    }
  }

  const nextPage = value['next_page'];
  if (nextPage !== undefined && nextPage !== null && typeof nextPage !== 'string') {
    throw new Error('RevenueCat subscriptions response contained an invalid next page');
  }

  return {
    items: value['items'] as RevenueCatV2Subscription[],
    next_page: nextPage,
  };
}

async function revenueCatApiError(response: Response, operation: string): Promise<Error> {
  const responseBody = (await response.text()).trim().slice(0, 500);
  const detail = responseBody || response.statusText || 'Unknown error';
  return new Error(`RevenueCat API ${operation} failed (${response.status}): ${detail}`);
}

/**
 * Fetch every RevenueCat subscription for account-deletion billing cleanup.
 * Unlike the dashboard sync helper, provider/configuration errors throw so a
 * failed lookup cannot be mistaken for a customer with no subscription.
 */
export async function fetchAllRevenueCatSubscriptionsOrThrow(
  appUserId: string,
  environment: RevenueCatEnvironment = 'production'
): Promise<RevenueCatV2Subscription[]> {
  const { apiKey, projectId } = requireApiCredentials();
  const revenueCatOrigin = 'https://api.revenuecat.com';
  let nextUrl: string | null = buildRevenueCatCustomerUrl(projectId, appUserId, 'subscriptions', environment);
  const visitedUrls = new Set<string>();
  const subscriptions: RevenueCatV2Subscription[] = [];

  while (nextUrl) {
    if (visitedUrls.has(nextUrl) || visitedUrls.size >= 25) {
      throw new Error('RevenueCat subscriptions pagination did not terminate');
    }
    visitedUrls.add(nextUrl);

    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      return subscriptions;
    }
    if (!response.ok) {
      throw await revenueCatApiError(response, `subscription lookup for ${environment}`);
    }

    const page = parseSubscriptionsResponse((await response.json()) as unknown);
    subscriptions.push(...page.items);

    if (!page.next_page) {
      nextUrl = null;
      continue;
    }

    const resolvedNextUrl = new URL(page.next_page, revenueCatOrigin);
    if (resolvedNextUrl.origin !== revenueCatOrigin) {
      throw new Error('RevenueCat subscriptions response contained an unexpected pagination origin');
    }
    nextUrl = resolvedNextUrl.toString();
  }

  return subscriptions;
}

/**
 * Stop a RevenueCat Web Billing subscription from renewing. The subscription
 * remains active until its current paid period or trial ends.
 */
export async function cancelRevenueCatBillingSubscription(subscriptionId: string): Promise<void> {
  const { apiKey, projectId } = requireApiCredentials();
  const response = await fetch(
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/subscriptions/${encodeURIComponent(subscriptionId)}/actions/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw await revenueCatApiError(response, `subscription cancellation for ${subscriptionId}`);
  }
}

/**
 * Fetch subscriber subscriptions from RevenueCat REST API v2
 * Returns the raw V2 response directly
 */
export async function fetchRevenueCatSubscriptions(
  appUserId: string,
  environment: RevenueCatEnvironment = 'production'
): Promise<RevenueCatV2SubscriptionsResponse | null> {
  const credentials = getApiCredentials();
  if (!credentials) return null;

  const { apiKey, projectId } = credentials;

  try {
    const response = await fetch(buildRevenueCatCustomerUrl(projectId, appUserId, 'subscriptions', environment), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // 404 means no subscriber found - not an error
      if (response.status === 404) {
        return null;
      }
      console.error(`RevenueCat API error (subscriptions, ${environment}): ${response.status} ${response.statusText}`);
      return null;
    }

    return (await response.json()) as RevenueCatV2SubscriptionsResponse;
  } catch (error) {
    console.error(`Error fetching RevenueCat subscriptions (${environment}):`, error);
    return null;
  }
}

/**
 * Fetch non-subscription purchases from RevenueCat REST API v2
 * Used for lifetime/non-renewing products
 */
export async function fetchRevenueCatPurchases(
  appUserId: string,
  environment: RevenueCatEnvironment = 'production'
): Promise<RevenueCatV2PurchasesResponse | null> {
  const credentials = getApiCredentials();
  if (!credentials) return null;

  const { apiKey, projectId } = credentials;

  try {
    const response = await fetch(buildRevenueCatCustomerUrl(projectId, appUserId, 'purchases', environment), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // 404 means no purchases found - not an error
      if (response.status === 404) {
        return null;
      }
      console.error(`RevenueCat API error (purchases, ${environment}): ${response.status} ${response.statusText}`);
      return null;
    }

    return (await response.json()) as RevenueCatV2PurchasesResponse;
  } catch (error) {
    console.error(`Error fetching RevenueCat purchases (${environment}):`, error);
    return null;
  }
}

/**
 * Convert a value that may be a number timestamp or string to an ISO string
 * RevenueCat API sometimes returns timestamps as numbers instead of ISO strings
 */
function toISOString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  return value;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function getEntitlementIds(
  entitlements: RevenueCatV2Subscription['entitlements'] | RevenueCatV2Purchase['entitlements']
): string[] {
  return (entitlements?.items ?? [])
    .map((entitlement) => entitlement.entitlement_id ?? entitlement.lookup_key ?? entitlement.id)
    .filter((id): id is string => id !== undefined && id !== null && id.length > 0);
}

function isFutureIsoDate(value: string | null, now: Date): boolean {
  if (!value) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime();
}

function getTimestamp(value: string | number | null | undefined): number {
  const isoValue = toISOString(value);
  if (!isoValue) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = Date.parse(isoValue);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function isActiveRevenueCatSubscription(sub: RevenueCatV2Subscription, now: Date): boolean {
  if (sub.gives_access !== null && sub.gives_access !== undefined) {
    return sub.gives_access;
  }

  const rawExpiresAt = toISOString(sub.current_period_ends_at);
  const hasFutureExpiration = rawExpiresAt === null || isFutureIsoDate(rawExpiresAt, now);
  const knownInactiveStatus =
    sub.status === 'expired' ||
    sub.status === 'in_billing_retry' ||
    sub.status === 'incomplete' ||
    sub.status === 'paused' ||
    sub.status === 'unknown';

  return !knownInactiveStatus && hasFutureExpiration;
}

function isPromotionalSubscription(sub: RevenueCatV2Subscription): boolean {
  return sub.store === 'promotional';
}

function subscriptionSelectionRank(sub: RevenueCatV2Subscription): number {
  const isPromotional = isPromotionalSubscription(sub);
  const hasExplicitAccess = sub.gives_access === true;

  if (!isPromotional && hasExplicitAccess) {
    return 3;
  }

  if (!isPromotional) {
    return 2;
  }

  if (hasExplicitAccess) {
    return 1;
  }

  return 0;
}

function compareActiveSubscriptions(left: RevenueCatV2Subscription, right: RevenueCatV2Subscription): number {
  const rankDifference = subscriptionSelectionRank(right) - subscriptionSelectionRank(left);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const rightExpiresAt = getTimestamp(right.current_period_ends_at);
  const leftExpiresAt = getTimestamp(left.current_period_ends_at);
  if (rightExpiresAt !== leftExpiresAt) {
    return rightExpiresAt - leftExpiresAt;
  }

  const rightStartsAt = getTimestamp(right.current_period_starts_at ?? right.starts_at);
  const leftStartsAt = getTimestamp(left.current_period_starts_at ?? left.starts_at);
  if (rightStartsAt !== leftStartsAt) {
    return rightStartsAt - leftStartsAt;
  }

  return right.id.localeCompare(left.id);
}

function isActiveRevenueCatPurchase(purchase: RevenueCatV2Purchase): boolean {
  if (purchase.status !== undefined && purchase.status !== null && purchase.status !== 'owned') {
    return false;
  }

  const entitlements = purchase.entitlements?.items ?? [];
  return (
    entitlements.length === 0 ||
    entitlements.some(
      (entitlement) => entitlement.state === undefined || entitlement.state === null || entitlement.state === 'active'
    )
  );
}

function getActiveSubscriptionStatus(
  sub: RevenueCatV2Subscription,
  rawExpiresAt: string | null,
  now: Date
): SubscriptionStatus {
  if (sub.status === 'trialing') {
    return 'trialing';
  }

  if (sub.status === 'in_billing_retry') {
    return 'billing_issue';
  }

  if (sub.status === 'paused') {
    return 'paused';
  }

  if (sub.auto_renewal_status === 'will_not_renew' && rawExpiresAt && new Date(rawExpiresAt) > now) {
    return 'canceled';
  }

  return 'active';
}

function toActiveSubscription(sub: RevenueCatV2Subscription, now: Date): ActiveSubscription {
  const rawExpiresAt = toISOString(sub.current_period_ends_at);
  const status = getActiveSubscriptionStatus(sub, rawExpiresAt, now);
  const entitlementIds = getEntitlementIds(sub.entitlements);
  const purchasedAt = toISOString(sub.starts_at);
  const expiresAt = rawExpiresAt;
  const periodType = mapPeriodType(sub.status, sub.store);
  const productId = nonEmptyString(sub.product_id) ?? nonEmptyString(sub.id) ?? 'unknown';

  return {
    customerId: nonEmptyString(sub.customer_id) ?? undefined,
    originalCustomerId: nonEmptyString(sub.original_customer_id) ?? undefined,
    environment: sub.environment,
    productId,
    subscriptionType: determineSubscriptionType(sub.product_id, periodType),
    status,
    periodType,
    store: mapStore(sub.store),
    purchasedAt: purchasedAt ?? undefined,
    expiresAt,
    originalTransactionId: sub.store_subscription_identifier,
    entitlementIds,
  };
}

function toActivePurchase(purchase: RevenueCatV2Purchase): ActiveSubscription {
  const entitlementIds = getEntitlementIds(purchase.entitlements);
  const purchasedAt = toISOString(purchase.purchased_at);
  const productId = nonEmptyString(purchase.product_id) ?? nonEmptyString(purchase.id) ?? 'unknown';
  const isPromotional = purchase.store === 'promotional';

  return {
    customerId: nonEmptyString(purchase.customer_id) ?? undefined,
    originalCustomerId: nonEmptyString(purchase.original_customer_id) ?? undefined,
    environment: purchase.environment,
    productId,
    subscriptionType: isPromotional ? determineSubscriptionType(productId, 'PROMOTIONAL') : 'lifetime',
    status: 'active',
    periodType: isPromotional ? 'PROMOTIONAL' : undefined,
    store: mapStore(purchase.store),
    purchasedAt: purchasedAt ?? undefined,
    expiresAt: null,
    originalTransactionId: purchase.store_purchase_identifier,
    entitlementIds,
  };
}

function activeSubscriptionSortTime(subscription: ActiveSubscription): number {
  const expiresAt = subscription.expiresAt ? Date.parse(subscription.expiresAt) : Number.NEGATIVE_INFINITY;
  if (Number.isFinite(expiresAt)) {
    return expiresAt;
  }

  const purchasedAt = subscription.purchasedAt ? Date.parse(subscription.purchasedAt) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(purchasedAt) ? purchasedAt : Number.NEGATIVE_INFINITY;
}

function activeSubscriptionSelectionRank(subscription: ActiveSubscription): number {
  if (subscription.subscriptionType === 'lifetime') {
    return 3;
  }

  return subscription.store === 'promotional' || subscription.periodType === 'PROMOTIONAL' ? 1 : 2;
}

export function selectPreferredActiveSubscription(subscriptions: ActiveSubscription[]): ActiveSubscription | null {
  return (
    [...subscriptions].sort((left, right) => {
      const rankDifference = activeSubscriptionSelectionRank(right) - activeSubscriptionSelectionRank(left);
      if (rankDifference !== 0) {
        return rankDifference;
      }

      return activeSubscriptionSortTime(right) - activeSubscriptionSortTime(left);
    })[0] ?? null
  );
}

/**
 * Find active subscription from RevenueCat V2 API response
 * Works directly with V2 response format
 */
export function findActiveSubscription(
  subscriptions: RevenueCatV2SubscriptionsResponse | null,
  purchases?: RevenueCatV2PurchasesResponse | null
): ActiveSubscription | null {
  const now = new Date();
  const candidates: ActiveSubscription[] = [];

  if (subscriptions?.items && subscriptions.items.length > 0) {
    const activeSubscription = subscriptions.items
      .filter((sub) => isActiveRevenueCatSubscription(sub, now))
      .sort(compareActiveSubscriptions)[0];

    if (activeSubscription) {
      candidates.push(toActiveSubscription(activeSubscription, now));
    }
  }

  if (purchases?.items && purchases.items.length > 0) {
    const latestPurchase = purchases.items
      .filter(isActiveRevenueCatPurchase)
      .sort((left, right) => getTimestamp(right.purchased_at) - getTimestamp(left.purchased_at))[0];

    if (latestPurchase) {
      candidates.push(toActivePurchase(latestPurchase));
    }
  }

  return selectPreferredActiveSubscription(candidates);
}

/**
 * Map V2 status and store to period type
 */
function mapPeriodType(
  status: RevenueCatV2Subscription['status'],
  store: RevenueCatV2Subscription['store']
): 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID' | undefined {
  if (status === 'trialing') {
    return 'TRIAL';
  } else if (store === 'promotional') {
    return 'PROMOTIONAL';
  } else {
    return 'NORMAL';
  }
}

/**
 * Determine subscription type from product ID and period type
 */
export function determineSubscriptionType(
  productId: string | null | undefined,
  periodType?: string | null
): SubscriptionType {
  if (periodType === 'TRIAL') {
    return 'trial';
  }

  const lowerProductId = productId?.toLowerCase() ?? '';

  if (lowerProductId.includes('lifetime')) {
    return 'lifetime';
  } else if (lowerProductId.includes('year') || lowerProductId.includes('annual') || lowerProductId.includes('yr')) {
    return 'yearly';
  } else {
    return 'monthly';
  }
}

/**
 * Map RevenueCat V2 store to our schema store type
 */
export function mapStore(
  store?: RevenueCatV2Subscription['store']
): 'app_store' | 'play_store' | 'stripe' | 'promotional' | undefined {
  switch (store) {
    case 'app_store':
    case 'mac_app_store':
      return 'app_store';
    case 'play_store':
    case 'amazon':
      return 'play_store';
    case 'stripe':
    case 'rc_billing':
      return 'stripe';
    case 'promotional':
      return 'promotional';
    default:
      return undefined;
  }
}

/**
 * Map webhook store format (uppercase) to schema store type
 */
export function mapWebhookStore(store?: string): 'app_store' | 'play_store' | 'stripe' | 'promotional' | undefined {
  switch (store) {
    case 'APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'STRIPE':
    case 'RC_BILLING':
      return 'stripe';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return undefined;
  }
}
