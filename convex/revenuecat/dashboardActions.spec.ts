import { afterEach, describe, expect, it } from 'vitest';

import {
  filterUserProfilesForSync,
  getRevenueCatCustomerIdsForSync,
  getRevenueCatSyncEnvironment,
  selectPreferredRevenueCatSubscriptionMatch,
  type UserProfileInfo,
} from './dashboardActions';

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe('RevenueCat dashboard sync actions', () => {
  const originalRevenueCatSyncEnvironment = process.env['REVENUECAT_SYNC_ENVIRONMENT'];

  afterEach(() => {
    restoreEnvValue('REVENUECAT_SYNC_ENVIRONMENT', originalRevenueCatSyncEnvironment);
  });

  it('deduplicates Clerk and RevenueCat customer IDs for sync', () => {
    const user: UserProfileInfo = {
      clerkId: 'user_123',
      email: 'user@example.com',
      name: undefined,
      revenueCatCustomerIds: [' $RCAnonymousID:abc ', 'user_123', ''],
    };

    expect(getRevenueCatCustomerIdsForSync(user)).toEqual(['user_123', '$RCAnonymousID:abc']);
  });

  it('selects lifetime access even when another customer ID matched recurring access first', () => {
    const preferredMatch = selectPreferredRevenueCatSubscriptionMatch([
      {
        customerId: 'user_123',
        subscription: {
          customerId: 'user_123',
          environment: 'production',
          productId: 'monthly_subscription_999',
          subscriptionType: 'monthly',
          status: 'canceled',
          expiresAt: '2099-02-01T00:00:00.000Z',
          entitlementIds: ['premium'],
        },
      },
      {
        customerId: '$RCAnonymousID:lifetime',
        subscription: {
          customerId: '$RCAnonymousID:lifetime',
          environment: 'production',
          productId: 'lifetime_subscription',
          subscriptionType: 'lifetime',
          status: 'active',
          expiresAt: null,
          entitlementIds: ['premium'],
        },
      },
    ]);

    expect(preferredMatch?.customerId).toBe('$RCAnonymousID:lifetime');
    expect(preferredMatch?.subscription.subscriptionType).toBe('lifetime');
  });

  it('filters sync users by email case-insensitively', () => {
    const users: UserProfileInfo[] = [
      {
        clerkId: 'user_123',
        email: 'target@example.com',
        name: undefined,
        revenueCatCustomerIds: [],
      },
      {
        clerkId: 'user_456',
        email: 'other@example.com',
        name: undefined,
        revenueCatCustomerIds: [],
      },
    ];

    expect(filterUserProfilesForSync(users, ' TARGET@example.com ')).toEqual([users[0]]);
  });

  it('does not filter sync users when email is blank', () => {
    const users: UserProfileInfo[] = [
      {
        clerkId: 'user_123',
        email: 'target@example.com',
        name: undefined,
        revenueCatCustomerIds: [],
      },
    ];

    expect(filterUserProfilesForSync(users, '  ')).toEqual(users);
  });

  it('defaults the sync environment to production', () => {
    delete process.env['REVENUECAT_SYNC_ENVIRONMENT'];

    expect(getRevenueCatSyncEnvironment()).toBe('production');
  });

  it('uses an explicit sandbox sync environment', () => {
    process.env['REVENUECAT_SYNC_ENVIRONMENT'] = 'sandbox';

    expect(getRevenueCatSyncEnvironment()).toBe('sandbox');
  });
});
