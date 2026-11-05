import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';
import {
  cancelRevenueCatBillingSubscription,
  determineSubscriptionType,
  fetchAllRevenueCatSubscriptionsOrThrow,
  fetchRevenueCatPurchases,
  fetchRevenueCatSubscriptions,
  findActiveSubscription,
  mapWebhookStore,
  type RevenueCatV2Subscription,
} from '../lib/revenueCatApi';
import {
  shouldIgnoreDuplicateOrOlderEvent,
  shouldPreserveExistingLifetimeSubscription,
  shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate,
} from '../mutations';
import { formatPrice, getRevenueCatCustomerIdsForEvent, handleRevenueCatWebhook } from './subscriptionWebhook';

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

type RunMutationMock = ReturnType<typeof vi.fn>;
type RunActionMock = ReturnType<typeof vi.fn>;
type RunQueryMock = ReturnType<typeof vi.fn>;
type GuardSubscription = Parameters<typeof shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate>[0];

interface WebhookTestContext {
  ctx: ActionCtx;
  runMutation: RunMutationMock;
  runAction: RunActionMock;
  runQuery: RunQueryMock;
}

interface UpsertMutationArgs {
  clerkId: string;
  subscriptionData: {
    productId: string;
    status: string;
    subscriptionType: string;
    store?: string;
    periodType?: string;
    expiresAt?: string | null;
    lastEventType: string;
    lastEventTimestamp: string;
  };
  revenueCatCustomerIds?: string[];
  isAuthoritativeRevenueCatState?: boolean;
}

interface LoopsActionArgs {
  email: string;
  subscriptionStatus: string;
}

function createWebhookTestContext(persistedStatus: string): WebhookTestContext {
  const runMutation = vi.fn(async () => ({ subscriptionId: 'subscription_doc_123', status: persistedStatus }));
  const runAction = vi.fn(async () => null);
  const runQuery = vi.fn(async () => ({ email: 'user@example.com' }));

  return {
    ctx: { runMutation, runAction, runQuery } as unknown as ActionCtx,
    runMutation,
    runAction,
    runQuery,
  };
}

function createWebhookRequest(event: Record<string, unknown>): Request {
  return new Request('https://kualia.test/revenuecat', {
    method: 'POST',
    headers: { Authorization: 'Bearer test_webhook_secret' },
    body: JSON.stringify({
      api_version: '1.0',
      event,
    }),
  });
}

function subscriptionApiItem(overrides: Partial<RevenueCatV2Subscription> = {}): RevenueCatV2Subscription {
  return {
    id: 'sub_rc_billing_123',
    product_id: 'monthly',
    status: 'active',
    store: 'rc_billing',
    auto_renewal_status: 'will_renew',
    ownership: 'purchased',
    environment: 'production',
    ...overrides,
  };
}

describe('RevenueCat subscription webhook formatting', () => {
  const originalRevenueCatApiKey = process.env['REVENUECAT_API_KEY'];
  const originalRevenueCatProjectId = process.env['REVENUECAT_PROJECT_ID'];
  const originalRevenueCatWebhookSecret = process.env['REVENUECAT_WEBHOOK_SECRET'];

  beforeEach(() => {
    process.env['REVENUECAT_API_KEY'] = 'test_api_key';
    process.env['REVENUECAT_PROJECT_ID'] = 'proj_test';
    process.env['REVENUECAT_WEBHOOK_SECRET'] = 'test_webhook_secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnvValue('REVENUECAT_API_KEY', originalRevenueCatApiKey);
    restoreEnvValue('REVENUECAT_PROJECT_ID', originalRevenueCatProjectId);
    restoreEnvValue('REVENUECAT_WEBHOOK_SECRET', originalRevenueCatWebhookSecret);
  });

  it('classifies Kualia Pro Year products as yearly', () => {
    expect(determineSubscriptionType('Kualia Pro Year', 'NORMAL')).toBe('yearly');
    expect(determineSubscriptionType('kualia_pro_year', 'NORMAL')).toBe('yearly');
  });

  it('maps RevenueCat Billing webhook events to the web subscription store', () => {
    expect(mapWebhookStore('RC_BILLING')).toBe('stripe');
  });

  it('fetches every page when checking subscriptions for account deletion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [subscriptionApiItem({ id: 'sub_page_1' })],
            next_page: '/v2/projects/proj_test/customers/user_123/subscriptions?starting_after=sub_page_1',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [subscriptionApiItem({ id: 'sub_page_2' })], next_page: null }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAllRevenueCatSubscriptionsOrThrow('user_123')).resolves.toMatchObject([
      { id: 'sub_page_1' },
      { id: 'sub_page_2' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the account-deletion subscription lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('temporarily unavailable', { status: 503 }))
    );

    await expect(fetchAllRevenueCatSubscriptionsOrThrow('user_123')).rejects.toThrow(
      'RevenueCat API subscription lookup for production failed (503)'
    );
  });

  it('cancels RevenueCat Web Billing with the server-side action endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await cancelRevenueCatBillingSubscription('sub_rc_billing_123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v2/projects/proj_test/subscriptions/sub_rc_billing_123/actions/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test_api_key' }),
      })
    );
  });

  it('falls back to monthly when RevenueCat omits the product id', () => {
    expect(determineSubscriptionType(null, 'NORMAL')).toBe('monthly');
  });

  it('uses gives_access and does not crash when RevenueCat returns a null product id', () => {
    const subscription = findActiveSubscription({
      items: [
        {
          id: 'sub_123',
          customer_id: '$RCAnonymousID:abc',
          original_customer_id: null,
          product_id: null,
          starts_at: '2026-06-01T00:00:00.000Z',
          current_period_ends_at: '2026-06-02T00:00:00.000Z',
          gives_access: true,
          status: 'active',
          store: 'app_store',
          ownership: 'purchased',
          entitlements: {
            items: [{ entitlement_id: 'premium' }],
          },
          environment: 'sandbox',
        },
      ],
    });

    expect(subscription).toMatchObject({
      customerId: '$RCAnonymousID:abc',
      environment: 'sandbox',
      productId: 'sub_123',
      subscriptionType: 'monthly',
      status: 'active',
      entitlementIds: ['premium'],
    });
  });

  it('uses RevenueCat entitlement lookup keys from API v2 responses', () => {
    const subscription = findActiveSubscription({
      items: [
        {
          id: 'sub_rc_billing',
          customer_id: 'user_123',
          original_customer_id: '$RCAnonymousID:abc',
          product_id: 'prod_monthly',
          starts_at: 1774279607690,
          current_period_ends_at: 1782228407690,
          gives_access: true,
          status: 'active',
          store: 'rc_billing',
          ownership: 'purchased',
          entitlements: {
            items: [{ id: 'entl_123', lookup_key: 'premium', display_name: 'Premium' }],
          },
          environment: 'production',
        },
      ],
    });

    expect(subscription).toMatchObject({
      customerId: 'user_123',
      originalCustomerId: '$RCAnonymousID:abc',
      environment: 'production',
      status: 'active',
      store: 'stripe',
      entitlementIds: ['premium'],
    });
  });

  it('prefers a paid active subscription over a promotional grant', () => {
    const subscription = findActiveSubscription({
      items: [
        {
          id: 'promo_sub',
          customer_id: 'user_123',
          product_id: 'promo_month',
          starts_at: '2099-01-01T00:00:00.000Z',
          current_period_ends_at: '2099-03-01T00:00:00.000Z',
          gives_access: true,
          status: 'active',
          store: 'promotional',
          ownership: 'purchased',
          environment: 'production',
        },
        {
          id: 'paid_sub',
          customer_id: 'user_123',
          product_id: 'kualia_pro_year',
          starts_at: '2099-01-05T00:00:00.000Z',
          current_period_ends_at: '2099-02-01T00:00:00.000Z',
          gives_access: true,
          status: 'active',
          store: 'app_store',
          ownership: 'purchased',
          environment: 'production',
        },
      ],
    });

    expect(subscription).toMatchObject({
      productId: 'kualia_pro_year',
      subscriptionType: 'yearly',
      store: 'app_store',
      status: 'active',
    });
  });

  it('selects the latest paid active subscription from unordered API items', () => {
    const subscription = findActiveSubscription({
      items: [
        {
          id: 'old_paid_sub',
          customer_id: 'user_123',
          product_id: 'kualia_pro_month',
          starts_at: '2099-01-01T00:00:00.000Z',
          current_period_ends_at: '2099-02-01T00:00:00.000Z',
          gives_access: true,
          status: 'active',
          store: 'app_store',
          ownership: 'purchased',
          environment: 'production',
        },
        {
          id: 'new_paid_sub',
          customer_id: 'user_123',
          product_id: 'kualia_pro_year',
          starts_at: '2099-02-01T00:00:00.000Z',
          current_period_ends_at: '2099-04-01T00:00:00.000Z',
          gives_access: true,
          status: 'active',
          store: 'app_store',
          ownership: 'purchased',
          environment: 'production',
        },
      ],
    });

    expect(subscription?.productId).toBe('kualia_pro_year');
  });

  it('does not select billing retry subscriptions when RevenueCat says they do not grant access', () => {
    const subscription = findActiveSubscription({
      items: [
        {
          id: 'retry_paid_sub',
          customer_id: 'user_123',
          product_id: 'kualia_pro_month',
          starts_at: '2099-01-01T00:00:00.000Z',
          current_period_ends_at: '2099-02-01T00:00:00.000Z',
          gives_access: false,
          status: 'in_billing_retry',
          store: 'app_store',
          ownership: 'purchased',
          environment: 'production',
        },
      ],
    });

    expect(subscription).toBeNull();
  });

  it('prefers an owned lifetime purchase over an active recurring subscription', () => {
    const subscription = findActiveSubscription(
      {
        items: [
          {
            id: 'monthly_sub',
            customer_id: 'user_123',
            product_id: 'monthly_subscription_999',
            starts_at: '2099-01-01T00:00:00.000Z',
            current_period_ends_at: '2099-02-01T00:00:00.000Z',
            gives_access: true,
            status: 'active',
            store: 'rc_billing',
            ownership: 'purchased',
            environment: 'production',
          },
        ],
      },
      {
        items: [
          {
            id: 'lifetime_purchase',
            customer_id: 'user_123',
            product_id: 'lifetime_subscription',
            purchased_at: '2099-01-15T00:00:00.000Z',
            status: 'owned',
            store: 'rc_billing',
            store_purchase_identifier: 'lifetime_transaction',
            ownership: 'purchased',
            entitlements: {
              items: [{ lookup_key: 'premium', state: 'active' }],
            },
            environment: 'production',
          },
        ],
      }
    );

    expect(subscription).toMatchObject({
      productId: 'lifetime_subscription',
      subscriptionType: 'lifetime',
      status: 'active',
      expiresAt: null,
      originalTransactionId: 'lifetime_transaction',
    });
  });

  it('ignores a revoked lifetime purchase and falls back to recurring access', () => {
    const subscription = findActiveSubscription(
      {
        items: [
          {
            id: 'monthly_sub',
            customer_id: 'user_123',
            product_id: 'monthly_subscription_999',
            starts_at: '2099-01-01T00:00:00.000Z',
            current_period_ends_at: '2099-02-01T00:00:00.000Z',
            gives_access: true,
            status: 'active',
            store: 'rc_billing',
            ownership: 'purchased',
            environment: 'production',
          },
        ],
      },
      {
        items: [
          {
            id: 'lifetime_purchase',
            customer_id: 'user_123',
            product_id: 'lifetime_subscription',
            purchased_at: '2099-01-15T00:00:00.000Z',
            status: 'refunded',
            store: 'rc_billing',
            ownership: 'purchased',
            environment: 'production',
          },
        ],
      }
    );

    expect(subscription).toMatchObject({
      productId: 'monthly_subscription_999',
      subscriptionType: 'monthly',
    });
  });

  it('deduplicates all RevenueCat customer IDs from webhook identity fields', () => {
    expect(
      getRevenueCatCustomerIdsForEvent({
        app_user_id: 'user_123',
        original_app_user_id: ' $RCAnonymousID:abc ',
        aliases: ['user_123', '$RCAnonymousID:abc', 'alias_456'],
        product_id: 'monthly_subscription_999',
      })
    ).toEqual(['user_123', '$RCAnonymousID:abc', 'alias_456']);
  });

  it('requests production subscriptions explicitly by default', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchRevenueCatSubscriptions('$RCAnonymousID:abc');

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(String(firstCall?.[0])).toBe(
      'https://api.revenuecat.com/v2/projects/proj_test/customers/%24RCAnonymousID%3Aabc/subscriptions?environment=production'
    );
  });

  it('passes a sandbox environment when explicitly requested', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchRevenueCatPurchases('user_123', 'sandbox');

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(String(firstCall?.[0])).toBe(
      'https://api.revenuecat.com/v2/projects/proj_test/customers/user_123/purchases?environment=sandbox'
    );
  });

  it('reconciles a promotional expiration webhook to the current paid RevenueCat subscription', async () => {
    const { ctx, runAction, runMutation } = createWebhookTestContext('active');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscriptions')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'paid_sub',
                customer_id: 'user_123',
                original_customer_id: '$RCAnonymousID:abc',
                product_id: 'kualia_pro_year',
                starts_at: '2099-01-01T00:00:00.000Z',
                current_period_ends_at: '2099-02-01T00:00:00.000Z',
                gives_access: true,
                status: 'active',
                store: 'app_store',
                store_subscription_identifier: 'paid_transaction',
                ownership: 'purchased',
                entitlements: { items: [{ lookup_key: 'premium' }] },
                environment: 'production',
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRevenueCatWebhook(
      ctx,
      createWebhookRequest({
        type: 'EXPIRATION',
        app_user_id: 'user_123',
        product_id: 'promo_month',
        period_type: 'PROMOTIONAL',
        store: 'PROMOTIONAL',
        entitlement_ids: ['premium'],
      })
    );

    expect(response.status).toBe(200);

    const mutationArgs = runMutation.mock.calls[0]?.[1] as UpsertMutationArgs | undefined;
    expect(mutationArgs).toBeDefined();
    expect(mutationArgs?.clerkId).toBe('user_123');
    expect(mutationArgs?.subscriptionData).toMatchObject({
      productId: 'kualia_pro_year',
      status: 'active',
      store: 'app_store',
      periodType: 'NORMAL',
      lastEventType: 'EXPIRATION',
    });

    const loopsArgs = runAction.mock.calls[0]?.[1] as LoopsActionArgs | undefined;
    expect(loopsArgs).toEqual({
      email: 'user@example.com',
      subscriptionStatus: 'active',
    });
  });

  it('keeps lifetime access when the user cancels an overlapping monthly subscription', async () => {
    const { ctx, runAction, runMutation } = createWebhookTestContext('active');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const isLifetimeAlias = url.includes(encodeURIComponent('$RCAnonymousID:lifetime'));

      if (url.includes('/subscriptions')) {
        return new Response(
          JSON.stringify({
            items: isLifetimeAlias
              ? []
              : [
                  {
                    id: 'monthly_sub',
                    customer_id: 'user_123',
                    product_id: 'monthly_subscription_999',
                    starts_at: '2099-01-01T00:00:00.000Z',
                    current_period_ends_at: '2099-02-01T00:00:00.000Z',
                    gives_access: true,
                    auto_renewal_status: 'will_not_renew',
                    status: 'active',
                    store: 'rc_billing',
                    ownership: 'purchased',
                    entitlements: { items: [{ lookup_key: 'premium' }] },
                    environment: 'production',
                  },
                ],
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          items: isLifetimeAlias
            ? [
                {
                  id: 'lifetime_purchase',
                  customer_id: '$RCAnonymousID:lifetime',
                  original_customer_id: '$RCAnonymousID:lifetime',
                  product_id: 'lifetime_subscription',
                  purchased_at: '2099-01-15T00:00:00.000Z',
                  status: 'owned',
                  store: 'rc_billing',
                  store_purchase_identifier: 'lifetime_transaction',
                  ownership: 'purchased',
                  entitlements: { items: [{ lookup_key: 'premium', state: 'active' }] },
                  environment: 'production',
                },
              ]
            : [],
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRevenueCatWebhook(
      ctx,
      createWebhookRequest({
        type: 'CANCELLATION',
        id: 'event_cancellation_123',
        event_timestamp_ms: Date.parse('2099-01-20T00:00:00.000Z'),
        app_user_id: 'user_123',
        original_app_user_id: '$RCAnonymousID:lifetime',
        aliases: ['user_123', '$RCAnonymousID:lifetime'],
        product_id: 'monthly_subscription_999',
        period_type: 'NORMAL',
        store: 'STRIPE',
        entitlement_ids: ['premium'],
        expiration_at_ms: Date.parse('2099-02-01T00:00:00.000Z'),
      })
    );

    expect(response.status).toBe(200);

    const mutationArgs = runMutation.mock.calls[0]?.[1] as UpsertMutationArgs | undefined;
    expect(mutationArgs).toMatchObject({
      clerkId: 'user_123',
      revenueCatCustomerIds: ['user_123', '$RCAnonymousID:lifetime'],
      isAuthoritativeRevenueCatState: true,
      subscriptionData: {
        productId: 'lifetime_subscription',
        subscriptionType: 'lifetime',
        status: 'active',
        expiresAt: null,
        lastEventType: 'CANCELLATION',
        lastEventTimestamp: '2099-01-20T00:00:00.000Z',
      },
    });

    const loopsArgs = runAction.mock.calls[0]?.[1] as LoopsActionArgs | undefined;
    expect(loopsArgs?.subscriptionStatus).toBe('active');
  });

  it('falls back to the expiration webhook when RevenueCat has no current access', async () => {
    const { ctx, runAction, runMutation } = createWebhookTestContext('expired');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRevenueCatWebhook(
      ctx,
      createWebhookRequest({
        type: 'EXPIRATION',
        app_user_id: 'user_123',
        product_id: 'kualia_pro_month',
        period_type: 'NORMAL',
        store: 'APP_STORE',
        entitlement_ids: ['premium'],
      })
    );

    expect(response.status).toBe(200);

    const mutationArgs = runMutation.mock.calls[0]?.[1] as UpsertMutationArgs | undefined;
    expect(mutationArgs?.subscriptionData).toMatchObject({
      productId: 'kualia_pro_month',
      status: 'expired',
      store: 'app_store',
      periodType: 'NORMAL',
      lastEventType: 'EXPIRATION',
    });

    const loopsArgs = runAction.mock.calls[0]?.[1] as LoopsActionArgs | undefined;
    expect(loopsArgs?.subscriptionStatus).toBe('expired');
  });

  it('records billing_issue when RevenueCat reconciliation returns suspended billing retry access', async () => {
    const { ctx, runAction, runMutation } = createWebhookTestContext('billing_issue');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscriptions')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'retry_paid_sub',
                customer_id: 'user_123',
                product_id: 'kualia_pro_month',
                starts_at: '2099-01-01T00:00:00.000Z',
                current_period_ends_at: '2099-02-01T00:00:00.000Z',
                gives_access: false,
                status: 'in_billing_retry',
                store: 'app_store',
                ownership: 'purchased',
                entitlements: { items: [{ lookup_key: 'premium' }] },
                environment: 'production',
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleRevenueCatWebhook(
      ctx,
      createWebhookRequest({
        type: 'BILLING_ISSUE',
        app_user_id: 'user_123',
        product_id: 'kualia_pro_month',
        period_type: 'NORMAL',
        store: 'APP_STORE',
        entitlement_ids: ['premium'],
      })
    );

    expect(response.status).toBe(200);

    const mutationArgs = runMutation.mock.calls[0]?.[1] as UpsertMutationArgs | undefined;
    expect(mutationArgs?.subscriptionData).toMatchObject({
      productId: 'kualia_pro_month',
      status: 'billing_issue',
      store: 'app_store',
      periodType: 'NORMAL',
      lastEventType: 'BILLING_ISSUE',
    });

    const loopsArgs = runAction.mock.calls[0]?.[1] as LoopsActionArgs | undefined;
    expect(loopsArgs?.subscriptionStatus).toBe('billing_issue');
  });

  it('preserves existing paid access from stale promotional terminal updates', () => {
    const existing: GuardSubscription = {
      subscriptionType: 'yearly',
      status: 'active',
      periodType: 'NORMAL',
      store: 'app_store',
      expiresAt: '2099-02-01T00:00:00.000Z',
      lastEventType: 'RENEWAL',
    };
    const incoming: GuardSubscription = {
      subscriptionType: 'monthly',
      status: 'expired',
      periodType: 'PROMOTIONAL',
      store: 'promotional',
      expiresAt: '2026-06-01T00:00:00.000Z',
      lastEventType: 'EXPIRATION',
    };

    expect(
      shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate(
        existing,
        incoming,
        new Date('2026-06-18T00:00:00.000Z')
      )
    ).toBe(true);
  });

  it('allows real non-promotional expiration updates through the guard', () => {
    const existing: GuardSubscription = {
      subscriptionType: 'yearly',
      status: 'active',
      periodType: 'NORMAL',
      store: 'app_store',
      expiresAt: '2099-02-01T00:00:00.000Z',
      lastEventType: 'RENEWAL',
    };
    const incoming: GuardSubscription = {
      subscriptionType: 'yearly',
      status: 'expired',
      periodType: 'NORMAL',
      store: 'app_store',
      expiresAt: '2026-06-01T00:00:00.000Z',
      lastEventType: 'EXPIRATION',
    };

    expect(
      shouldPreserveExistingSubscriptionForStalePromotionalTerminalUpdate(
        existing,
        incoming,
        new Date('2026-06-18T00:00:00.000Z')
      )
    ).toBe(false);
  });

  it('preserves active lifetime access from an unrelated recurring cancellation fallback', () => {
    const existing: GuardSubscription = {
      subscriptionType: 'lifetime',
      status: 'active',
      expiresAt: null,
      originalTransactionId: 'lifetime_transaction',
      lastEventType: 'NON_RENEWING_PURCHASE',
    };
    const incoming: GuardSubscription = {
      subscriptionType: 'monthly',
      status: 'canceled',
      expiresAt: '2099-02-01T00:00:00.000Z',
      originalTransactionId: 'monthly_transaction',
      lastEventType: 'CANCELLATION',
    };

    expect(shouldPreserveExistingLifetimeSubscription(existing, incoming, new Date('2099-01-20T00:00:00.000Z'))).toBe(
      true
    );
  });

  it('allows a matching lifetime refund through the lifetime guard', () => {
    const existing: GuardSubscription = {
      subscriptionType: 'lifetime',
      status: 'active',
      expiresAt: null,
      originalTransactionId: 'lifetime_transaction',
      lastEventType: 'NON_RENEWING_PURCHASE',
    };
    const incoming: GuardSubscription = {
      subscriptionType: 'monthly',
      status: 'expired',
      expiresAt: null,
      originalTransactionId: 'lifetime_transaction',
      lastEventType: 'REFUND',
    };

    expect(shouldPreserveExistingLifetimeSubscription(existing, incoming)).toBe(false);
  });

  it('ignores duplicate and older webhook fallback updates', () => {
    const existing: GuardSubscription = {
      subscriptionType: 'lifetime',
      status: 'active',
      expiresAt: null,
      lastEventId: 'event_lifetime',
      lastEventTimestamp: '2099-01-20T00:00:00.000Z',
      lastEventType: 'NON_RENEWING_PURCHASE',
    };

    expect(
      shouldIgnoreDuplicateOrOlderEvent(existing, {
        subscriptionType: 'lifetime',
        status: 'active',
        expiresAt: null,
        lastEventId: 'event_lifetime',
        lastEventTimestamp: '2099-01-20T00:00:00.000Z',
        lastEventType: 'NON_RENEWING_PURCHASE',
      })
    ).toBe(true);

    expect(
      shouldIgnoreDuplicateOrOlderEvent(existing, {
        subscriptionType: 'monthly',
        status: 'canceled',
        expiresAt: '2099-02-01T00:00:00.000Z',
        lastEventId: 'event_older_cancellation',
        lastEventTimestamp: '2099-01-19T00:00:00.000Z',
        lastEventType: 'CANCELLATION',
      })
    ).toBe(true);
  });

  it('formats RevenueCat webhook prices as USD', () => {
    expect(formatPrice(52.23)).toBe('$52.23');
    expect(formatPrice(45)).toBe('$45.00');
  });

  it('handles missing RevenueCat prices', () => {
    expect(formatPrice(null)).toBe('N/A');
    expect(formatPrice(undefined)).toBe('N/A');
  });
});
