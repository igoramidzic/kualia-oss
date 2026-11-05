import { describe, expect, it } from 'vitest';
import { formatBillingDate, getStoreManagementURL, resolveManagementURL } from './billing';

describe('formatBillingDate', () => {
  it('omits the year for dates in the current year', () => {
    expect(formatBillingDate('2026-06-07T12:00:00.000Z', new Date('2026-06-12T12:00:00.000Z'))).toBe('Jun 7');
  });

  it('includes the year for dates outside the current year', () => {
    expect(formatBillingDate('2027-06-07T12:00:00.000Z', new Date('2026-06-12T12:00:00.000Z'))).toBe('Jun 7, 2027');
  });
});

describe('getStoreManagementURL', () => {
  it('returns the App Store subscriptions URL for App Store subscriptions', () => {
    expect(getStoreManagementURL('app_store')).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns null when RevenueCat should provide the management URL', () => {
    expect(getStoreManagementURL('stripe')).toBeNull();
  });
});

describe('resolveManagementURL', () => {
  it('returns null for family access even when a previous RevenueCat URL exists', () => {
    expect(
      resolveManagementURL({
        currentUserId: 'user_family_member',
        hasFamilyAccess: true,
        revenueCatManagementURL: 'https://pay.rev.cat/customer-center/previous',
        sdkInitializedUserId: 'user_previous',
        storeManagementURL: 'https://apps.apple.com/account/subscriptions',
      })
    ).toBeNull();
  });

  it('ignores a RevenueCat URL initialized for a different user', () => {
    expect(
      resolveManagementURL({
        currentUserId: 'user_current',
        hasFamilyAccess: false,
        revenueCatManagementURL: 'https://pay.rev.cat/customer-center/previous',
        sdkInitializedUserId: 'user_previous',
        storeManagementURL: 'https://apps.apple.com/account/subscriptions',
      })
    ).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns the RevenueCat URL when it belongs to the current user', () => {
    expect(
      resolveManagementURL({
        currentUserId: 'user_current',
        hasFamilyAccess: false,
        revenueCatManagementURL: 'https://pay.rev.cat/customer-center/current',
        sdkInitializedUserId: 'user_current',
        storeManagementURL: 'https://apps.apple.com/account/subscriptions',
      })
    ).toBe('https://pay.rev.cat/customer-center/current');
  });
});
