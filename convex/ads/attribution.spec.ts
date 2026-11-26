import type { FunctionArgs } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { sha256Hex } from '../lib/crypto';
import { upsertSubscription } from '../revenuecat/mutations';
import { expire, revoke, sync } from './attribution';

const profileId = 'profile-1' as Id<'userProfile'>;
const click = () => ({
  consent: true,
  measurementPolicy: 'us-opt-out-v1' as const,
  preferenceUpdatedAt: new Date().toISOString(),
  oppref: 'opaque-click',
  clickedAt: new Date().toISOString(),
  facebook: { fbclid: 'facebook-click', clickedAt: new Date().toISOString(), clientUserAgent: 'Test browser' },
});
function handler<Context, Args>(registered: unknown) {
  return (registered as { _handler: (ctx: Context, args: Args) => Promise<unknown> })._handler;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('legacy attribution cleanup', () => {
  function setup() {
    const profile: Doc<'userProfile'> = {
      _id: profileId,
      _creationTime: Date.now(),
      clerkId: 'user-1',
      email: 'test@example.com',
      onboardingCompleted: true,
      adAttribution: { ...click(), updatedAt: new Date().toISOString() },
      adConsentRevocationKey: 'old-key',
    };
    const patch = vi.fn(async (_id: Id<'userProfile'>, changes: Partial<Doc<'userProfile'>>) => {
      Object.assign(profile, changes);
    });
    const runAfter = vi.fn();
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'user-1', tokenIdentifier: 'clerk|user-1' }) },
      db: { get: async () => profile, patch, query: () => ({ withIndex: () => ({ first: async () => profile }) }) },
      scheduler: { runAfter },
    } as unknown as MutationCtx;
    return { ctx, profile, patch, runAfter };
  }

  it('rejects old clients enabling tracking by clearing stored data without issuing a capability', async () => {
    const test = setup();
    const syncHandler = handler<MutationCtx, FunctionArgs<typeof api.ads.attribution.sync>>(sync);
    expect(await syncHandler(test.ctx, { attribution: click() })).toBeNull();
    expect(await syncHandler(test.ctx, { attribution: click() })).toBeNull();
    expect(test.patch).toHaveBeenCalledTimes(1);
    expect(test.profile.adAttribution).toBeUndefined();
    expect(test.profile.adConsentRevocationKey).toBeUndefined();
    expect(test.runAfter).not.toHaveBeenCalled();
  });

  it('still authenticates old revocation capabilities and permits retries after cleanup', async () => {
    const test = setup();
    const revokeHandler = handler<MutationCtx, FunctionArgs<typeof api.ads.attribution.revoke>>(revoke);
    await expect(revokeHandler(test.ctx, { profileId, token: 'invalid' })).rejects.toThrow();
    expect(test.patch).not.toHaveBeenCalled();
    const token = await sha256Hex('revoke-ad-consent:old-key');
    expect(await revokeHandler(test.ctx, { profileId, token })).toBeNull();
    expect(await revokeHandler(test.ctx, { profileId, token })).toBeNull();
    expect(test.profile.adAttribution).toBeUndefined();
    expect(test.profile.adConsentRevocationKey).toBeUndefined();
  });

  it.each([undefined, 'facebook' as const])(
    'uses already-scheduled expiry jobs to clear both platforms: %s',
    async (platform) => {
      const test = setup();
      const expireHandler = handler<MutationCtx, FunctionArgs<typeof internal.ads.attribution.expire>>(expire);
      await expireHandler(test.ctx, { profileId, clickedAt: 'older-click-time', platform });
      expect(test.profile.adAttribution).toBeUndefined();
      expect(test.profile.adConsentRevocationKey).toBeUndefined();
    }
  );
});

describe('billing without conversion sharing', () => {
  it('ignores an old webhook conversion payload without reverting newer subscription state', async () => {
    type UpsertArgs = FunctionArgs<typeof internal.revenuecat.mutations.upsertSubscription>;
    const handler = (
      upsertSubscription as unknown as {
        _handler: (ctx: MutationCtx, args: UpsertArgs) => Promise<unknown>;
      }
    )._handler;
    const existing = {
      _id: 'subscription-1',
      status: 'canceled',
      subscriptionType: 'monthly',
      lastEventTimestamp: new Date().toISOString(),
      lastEventId: 'cancellation-1',
    };
    const patch = vi.fn();
    const runAfter = vi.fn();
    const profile = { _id: profileId, adAttribution: click() };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            first: async () =>
              table === 'subscription' ? existing : table === 'userProfile' ? profile : { _id: 'alias-1' },
          }),
        }),
        get: async () => profile,
        patch,
      },
      scheduler: { runAfter },
    } as unknown as MutationCtx;
    const timestamp = new Date(Date.now() - 60_000).toISOString();
    const args: UpsertArgs = {
      clerkId: 'user-1',
      subscriptionData: {
        revenueCatSubscriberId: 'user-1',
        productId: 'monthly',
        entitlementIds: ['premium'],
        subscriptionType: 'monthly',
        status: 'active',
        lastEventId: 'purchase-1',
        lastEventType: 'INITIAL_PURCHASE',
        lastEventTimestamp: timestamp,
        updatedAt: timestamp,
      },
      adConversion: { type: 'subscription_created', eventId: 'revenuecat_purchase-1', timestamp },
    };
    await handler(ctx, args);
    await handler(ctx, args);
    expect(patch.mock.calls.some(([id]) => id === existing._id)).toBe(false);
    expect(runAfter).not.toHaveBeenCalled();
  });
});
