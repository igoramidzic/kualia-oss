import { describe, expect, it, vi } from 'vitest';

import type { RevenueCatV2Subscription } from '../revenuecat/lib/revenueCatApi';
import {
  buildBillingCancellationFailureNotification,
  cancelStripeSubscriptionRenewal,
  cancelWebSubscriptionRenewals,
  commitAccountDeletion,
  isAlreadyDisconnectedPlaidError,
  revokeAllActiveClerkSessions,
  shouldCancelWebSubscriptionRenewal,
  stripeSubscriptionIdFromItem,
} from './actionsNode';
import { billingCancellationFailureState } from './mutations';

function subscription(overrides: Partial<RevenueCatV2Subscription> = {}): RevenueCatV2Subscription {
  return {
    id: 'sub_rc_123',
    product_id: 'monthly',
    status: 'active',
    store: 'rc_billing',
    auto_renewal_status: 'will_renew',
    ownership: 'purchased',
    environment: 'production',
    ...overrides,
  };
}

describe('web subscription cleanup', () => {
  it('only targets renewing RevenueCat Billing and Stripe subscriptions', () => {
    expect(shouldCancelWebSubscriptionRenewal(subscription())).toBe(true);
    expect(shouldCancelWebSubscriptionRenewal(subscription({ store: 'stripe' }))).toBe(true);
    expect(shouldCancelWebSubscriptionRenewal(subscription({ store: 'app_store' }))).toBe(false);
    expect(shouldCancelWebSubscriptionRenewal(subscription({ auto_renewal_status: 'will_not_renew' }))).toBe(false);
    expect(shouldCancelWebSubscriptionRenewal(subscription({ status: 'expired' }))).toBe(false);
  });

  it('cancels each renewing web subscription once across RevenueCat aliases', async () => {
    const revenueCatSubscription = subscription();
    const stripeSubscription = subscription({
      id: 'sub_revenuecat_stripe',
      store: 'stripe',
      store_subscription_identifier: 'si_stripe_123',
    });
    const fetchSubscriptions = vi.fn(async (customerId: string) =>
      customerId === 'user_123'
        ? [revenueCatSubscription, stripeSubscription, subscription({ id: 'app_store', store: 'app_store' })]
        : [revenueCatSubscription]
    );
    const cancelRevenueCatBilling = vi.fn(async () => undefined);
    const cancelStripeBilling = vi.fn(async () => undefined);

    await expect(
      cancelWebSubscriptionRenewals({
        customerIds: ['user_123', '$RCAnonymousID:abc'],
        environment: 'production',
        dependencies: {
          fetchSubscriptions,
          cancelRevenueCatBilling,
          cancelStripeBilling,
        },
      })
    ).resolves.toEqual({ revenueCatBillingCanceled: 1, stripeBillingCanceled: 1 });

    expect(fetchSubscriptions).toHaveBeenCalledTimes(2);
    expect(cancelRevenueCatBilling).toHaveBeenCalledWith('sub_rc_123');
    expect(cancelStripeBilling).toHaveBeenCalledWith('si_stripe_123');
  });

  it('resolves Stripe subscription-item identifiers and schedules an end-of-period cancellation', async () => {
    const retrieveSubscriptionItem = vi.fn(async () => ({ subscription: 'sub_stripe_123' }));
    const retrieveSubscription = vi.fn(async () => ({
      id: 'sub_stripe_123',
      status: 'trialing',
      cancelAtPeriodEnd: false,
    }));
    const scheduleCancellation = vi.fn(async () => undefined);

    await cancelStripeSubscriptionRenewal('si_stripe_123', {
      retrieveSubscriptionItem,
      retrieveSubscription,
      scheduleCancellation,
    });

    expect(retrieveSubscriptionItem).toHaveBeenCalledWith('si_stripe_123');
    expect(retrieveSubscription).toHaveBeenCalledWith('sub_stripe_123');
    expect(scheduleCancellation).toHaveBeenCalledWith('sub_stripe_123');
  });

  it('normalizes Stripe subscription-item relations and rejects detached items', () => {
    expect(stripeSubscriptionIdFromItem('si_string', 'sub_string')).toBe('sub_string');
    expect(stripeSubscriptionIdFromItem('si_expanded', { id: 'sub_expanded' })).toBe('sub_expanded');
    expect(() => stripeSubscriptionIdFromItem('si_detached', null)).toThrow(
      'Stripe subscription item si_detached is not attached to a subscription'
    );
  });

  it('keeps an already scheduled Stripe cancellation idempotent', async () => {
    const scheduleCancellation = vi.fn(async () => undefined);

    await cancelStripeSubscriptionRenewal('sub_stripe_123', {
      retrieveSubscriptionItem: vi.fn(),
      retrieveSubscription: vi.fn(async () => ({
        id: 'sub_stripe_123',
        status: 'active',
        cancelAtPeriodEnd: true,
      })),
      scheduleCancellation,
    });

    expect(scheduleCancellation).not.toHaveBeenCalled();
  });
});

describe('durable billing cancellation retries', () => {
  it('keeps failures pending with hourly retries and escalates on the ninth failed attempt', () => {
    expect(
      billingCancellationFailureState({
        previousAttemptCount: 0,
        attemptedAtMs: 1_000,
      })
    ).toEqual({
      attemptCount: 1,
      nextAttemptAt: 61_000,
      shouldAlert: false,
    });

    expect(
      billingCancellationFailureState({
        previousAttemptCount: 8,
        attemptedAtMs: 1_000,
      })
    ).toEqual({
      attemptCount: 9,
      nextAttemptAt: 3_601_000,
      shouldAlert: true,
    });
  });

  it('only sends the manual-investigation alert once while retries continue', () => {
    expect(
      billingCancellationFailureState({
        previousAttemptCount: 9,
        previousAlertSentAt: '2026-09-01T12:00:00.000Z',
        attemptedAtMs: 1_000,
      })
    ).toEqual({
      attemptCount: 10,
      nextAttemptAt: 3_601_000,
      shouldAlert: false,
    });
  });

  it('builds an actionable Discord escalation that documents continued automatic retries', () => {
    expect(
      buildBillingCancellationFailureNotification({
        clerkId: 'user_123',
        email: 'user@example.com',
        attemptCount: 9,
        error: 'RevenueCat unavailable',
        nextAttemptAt: Date.parse('2026-09-01T13:00:00.000Z'),
      })
    ).toMatchObject({
      channel: 'notifications',
      title: 'Account deletion billing cancellation needs attention',
      description: expect.stringContaining('Automatic hourly retries will continue'),
      emoji: '❌',
      userId: 'user_123',
      userEmail: 'user@example.com',
      metadata: {
        Attempts: '9',
        'Next automatic attempt': '2026-09-01T13:00:00.000Z',
        'Last error': 'RevenueCat unavailable',
      },
    });
  });
});

describe('Plaid account deletion retries', () => {
  it('treats already removed Plaid items as disconnected', () => {
    expect(isAlreadyDisconnectedPlaidError({ response: { data: { error_code: 'ITEM_NOT_FOUND' } } })).toBe(true);
    expect(isAlreadyDisconnectedPlaidError({ response: { data: { error_code: 'INVALID_ACCESS_TOKEN' } } })).toBe(true);
    expect(isAlreadyDisconnectedPlaidError({ response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } })).toBe(false);
  });
});

describe('account deletion commit', () => {
  it('records the local tombstone without deleting the Clerk identity', async () => {
    const softDeleteAccount = vi.fn(async (deletedAt: string) => ({ profileId: `profile:${deletedAt}` }));

    await expect(
      commitAccountDeletion({
        softDeleteAccount,
        now: () => '2026-08-03T12:00:00.000Z',
      })
    ).resolves.toEqual({ profileId: 'profile:2026-08-03T12:00:00.000Z' });

    expect(softDeleteAccount).toHaveBeenCalledWith('2026-08-03T12:00:00.000Z');
  });

  it('fails when the local profile cannot be tombstoned', async () => {
    await expect(
      commitAccountDeletion({
        softDeleteAccount: async () => null,
        now: () => '2026-08-03T12:00:00.000Z',
      })
    ).rejects.toThrow('Unable to start account deletion');
  });
});

describe('Clerk session cleanup', () => {
  it('revokes every active session across Clerk pages', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: `session_${index}` }));
    const secondPage = [{ id: 'session_500' }];
    const listActiveSessions = vi
      .fn<(offset: number) => Promise<{ data: Array<{ id: string }> }>>()
      .mockResolvedValueOnce({ data: firstPage })
      .mockResolvedValueOnce({ data: secondPage });
    const revokeSession = vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined);

    await revokeAllActiveClerkSessions({ listActiveSessions, revokeSession });

    expect(listActiveSessions).toHaveBeenNthCalledWith(1, 0);
    expect(listActiveSessions).toHaveBeenNthCalledWith(2, 500);
    expect(revokeSession).toHaveBeenCalledTimes(501);
    expect(revokeSession).toHaveBeenLastCalledWith('session_500');
  });
});
