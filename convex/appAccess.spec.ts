import { describe, expect, it } from 'vitest';

import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { resolveAppAccessForClerkId } from './lib/appAccess';
import { getUserSubscription } from './revenuecat/queries';

type TableName = 'subscription' | 'familyGroup' | 'familyGroupMember' | 'userProfile';
type FakeRecord = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};
type FakeFilter = { field: string; value: unknown };

const NOW = new Date('2026-06-11T12:00:00.000Z');
const PAST = '2026-06-01T12:00:00.000Z';
const FUTURE = '2026-06-21T12:00:00.000Z';

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[] = []
  ) {}

  withIndex(_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  async first(): Promise<FakeRecord | null> {
    return this.applyFilters()[0] ?? null;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.applyFilters();
  }

  private applyFilters(): FakeRecord[] {
    return this.records
      .filter((record) => this.filters.every((filter) => record[filter.field] === filter.value))
      .sort((left, right) => left._creationTime - right._creationTime);
  }
}

class FakeDb {
  constructor(private readonly recordsByTable: Map<TableName, Map<string, FakeRecord>>) {}

  async get(id: string): Promise<FakeRecord | null> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) {
        return record;
      }
    }

    return null;
  }

  query(tableName: TableName): FakeQuery {
    return new FakeQuery(Array.from((this.recordsByTable.get(tableName) ?? new Map()).values()));
  }
}

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): QueryCtx {
  const tableMaps = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of ['subscription', 'familyGroup', 'familyGroupMember', 'userProfile'] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  return { db: new FakeDb(tableMaps) } as unknown as QueryCtx;
}

function subscription(id: Id<'subscription'>, clerkId: string, overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    clerkId,
    revenueCatSubscriberId: clerkId,
    productId: 'kualia_pro_month',
    entitlementIds: ['premium'],
    subscriptionType: 'monthly',
    status: 'active',
    periodType: 'NORMAL',
    expiresAt: FUTURE,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function familyGroup(id: Id<'familyGroup'>, overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    ownerUserProfileId: 'profile_owner' as Id<'userProfile'>,
    ownerClerkId: 'clerk_owner',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function familyMember(
  id: Id<'familyGroupMember'>,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string,
  role: 'owner' | 'member',
  overrides: Partial<FakeRecord> = {}
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    familyGroupId,
    userProfileId: `${clerkId}_profile` as Id<'userProfile'>,
    clerkId,
    role,
    joinedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function userProfile(clerkId: string, overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: `${clerkId}_profile` as Id<'userProfile'>,
    _creationTime: 1,
    clerkId,
    name: clerkId === 'clerk_owner' ? 'Family Owner' : 'Kualia User',
    email: `${clerkId}@example.com`,
    onboardingCompleted: true,
    ...overrides,
  };
}

describe('resolveAppAccessForClerkId', () => {
  it('allows access through an own active subscription', async () => {
    const ctx = createTestContext({
      subscription: [subscription('sub_user' as Id<'subscription'>, 'clerk_user')],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(true);
    expect(access.accessSource).toBe('own_subscription');
    expect(access.ownSubscription).toMatchObject({
      status: 'active',
      subscriptionType: 'monthly',
      periodType: 'NORMAL',
      expiresAt: FUTURE,
      isActive: true,
    });
  });

  it('allows access through an own trialing subscription', async () => {
    const ctx = createTestContext({
      subscription: [
        subscription('sub_trial' as Id<'subscription'>, 'clerk_user', {
          status: 'trialing',
          subscriptionType: 'trial',
          periodType: 'TRIAL',
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(true);
    expect(access.accessSource).toBe('own_subscription');
    expect(access.nextCheckAt).toBe(FUTURE);
  });

  it.each([PAST, NOW.toISOString(), 'invalid'])('denies a trial when its known expiry is %s', async (expiresAt) => {
    const ctx = createTestContext({
      subscription: [
        subscription('sub_trial' as Id<'subscription'>, 'clerk_user', {
          status: 'trialing',
          subscriptionType: 'trial',
          periodType: 'TRIAL',
          expiresAt,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);
    expect(access.hasAppAccess).toBe(false);
    expect(access.ownSubscription?.isActive).toBe(false);
    expect(access.nextCheckAt).toBeNull();
  });

  it('re-evaluates a family trial at its expiry even before an expiration webhook', async () => {
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      subscription: [
        subscription('sub_owner' as Id<'subscription'>, 'clerk_owner', {
          status: 'trialing',
          subscriptionType: 'trial',
          expiresAt: FUTURE,
        }),
      ],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user', 'member'),
      ],
      userProfile: [userProfile('clerk_owner')],
    });

    const before = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);
    expect(before.hasAppAccess).toBe(true);
    expect(before.nextCheckAt).toBe(FUTURE);
    const after = await resolveAppAccessForClerkId(ctx, 'clerk_user', new Date(FUTURE));
    expect(after.hasAppAccess).toBe(false);
    expect(after.familyAccess?.ownerHasValidSubscription).toBe(false);
    expect(after.nextCheckAt).toBeNull();
  });

  it('allows access through an active subscription even when expiresAt is stale', async () => {
    const ctx = createTestContext({
      subscription: [
        subscription('sub_active_stale_expiration' as Id<'subscription'>, 'clerk_user', {
          status: 'active',
          expiresAt: PAST,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(true);
    expect(access.accessSource).toBe('own_subscription');
    expect(access.ownSubscription?.isActive).toBe(true);
  });

  it('allows access through a canceled subscription until expiresAt', async () => {
    const ctx = createTestContext({
      subscription: [
        subscription('sub_canceled' as Id<'subscription'>, 'clerk_user', {
          status: 'canceled',
          expiresAt: FUTURE,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(true);
    expect(access.accessSource).toBe('own_subscription');
    expect(access.ownSubscription?.isActive).toBe(true);
  });

  it('selects lifetime access over a more recently updated canceled subscription', async () => {
    const ctx = createTestContext({
      subscription: [
        subscription('sub_lifetime' as Id<'subscription'>, 'clerk_user', {
          productId: 'lifetime_subscription',
          subscriptionType: 'lifetime',
          status: 'active',
          periodType: undefined,
          expiresAt: null,
          updatedAt: '2026-06-10T12:00:00.000Z',
        }),
        subscription('sub_canceled' as Id<'subscription'>, 'clerk_user', {
          status: 'canceled',
          expiresAt: FUTURE,
          updatedAt: '2026-06-11T12:00:00.000Z',
          _creationTime: 2,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.ownSubscription).toMatchObject({
      subscriptionType: 'lifetime',
      status: 'active',
      expiresAt: null,
      isActive: true,
    });
  });

  it.each([
    ['expired', 'expired'],
    ['paused', 'paused'],
    ['billing issue', 'billing_issue'],
  ] as const)('does not allow access through an own %s subscription', async (_label, status) => {
    const ctx = createTestContext({
      subscription: [
        subscription(`sub_${status}` as Id<'subscription'>, 'clerk_user', {
          status,
          expiresAt: PAST,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(false);
    expect(access.accessSource).toBeNull();
    expect(access.ownSubscription?.isActive).toBe(false);
  });

  it('allows an active family member through the family owner subscription', async () => {
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      subscription: [subscription('sub_owner' as Id<'subscription'>, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user', 'member'),
      ],
      userProfile: [userProfile('clerk_owner')],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(true);
    expect(access.accessSource).toBe('family_owner_subscription');
    expect(access.familyAccess).toMatchObject({
      familyGroupId,
      role: 'member',
      ownerClerkId: 'clerk_owner',
      owner: {
        clerkId: 'clerk_owner',
        name: 'Family Owner',
        email: 'clerk_owner@example.com',
      },
      ownerHasValidSubscription: true,
    });
  });

  it('does not allow family access through a deleted membership', async () => {
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      subscription: [subscription('sub_owner' as Id<'subscription'>, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user', 'member', {
          isDeleted: true,
        }),
      ],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(false);
    expect(access.familyAccess).toBeNull();
  });

  it('does not allow family access through a deleted family group', async () => {
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      subscription: [subscription('sub_owner' as Id<'subscription'>, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId, { isDeleted: true })],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user', 'member'),
      ],
      userProfile: [userProfile('clerk_owner')],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(false);
    expect(access.familyAccess).toBeNull();
  });

  it('does not grant member access when the family owner has no valid subscription', async () => {
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      subscription: [
        subscription('sub_owner_expired' as Id<'subscription'>, 'clerk_owner', {
          status: 'expired',
          expiresAt: PAST,
        }),
      ],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user', 'member'),
      ],
      userProfile: [userProfile('clerk_owner')],
    });

    const access = await resolveAppAccessForClerkId(ctx, 'clerk_user', NOW);

    expect(access.hasAppAccess).toBe(false);
    expect(access.accessSource).toBeNull();
    expect(access.familyAccess?.ownerHasValidSubscription).toBe(false);
    expect(access.familyAccess?.owner).toMatchObject({
      clerkId: 'clerk_owner',
      name: 'Family Owner',
      email: 'clerk_owner@example.com',
    });
  });
});

describe('settings subscription timing', () => {
  const handler = (
    getUserSubscription as unknown as {
      _handler: (ctx: QueryCtx, args: Record<string, never>) => Promise<unknown>;
    }
  )._handler;

  it('returns only the signed-in user timing and cancellation details', async () => {
    const ctx = createTestContext({
      subscription: [
        subscription('own' as Id<'subscription'>, 'clerk_user', {
          purchasedAt: '2026-06-07T12:00:00.000Z',
          canceledAt: '2026-06-10T12:00:00.000Z',
          periodType: 'TRIAL',
          status: 'canceled',
        }),
        subscription('other' as Id<'subscription'>, 'clerk_other', { purchasedAt: '2026-06-09T12:00:00.000Z' }),
      ],
    });
    ctx.auth = {
      getUserIdentity: async () => ({ subject: 'clerk_user', issuer: 'test', tokenIdentifier: 'test|clerk_user' }),
    };
    expect(await handler(ctx, {})).toMatchObject({
      purchasedAt: '2026-06-07T12:00:00.000Z',
      canceledAt: '2026-06-10T12:00:00.000Z',
      periodType: 'TRIAL',
      status: 'canceled',
      expiresAt: FUTURE,
    });
  });

  it('uses null for legacy records without timing metadata and rejects unauthenticated reads', async () => {
    const ctx = createTestContext({ subscription: [subscription('own' as Id<'subscription'>, 'clerk_user')] });
    ctx.auth = {
      getUserIdentity: async () => ({ subject: 'clerk_user', issuer: 'test', tokenIdentifier: 'test|clerk_user' }),
    };
    expect(await handler(ctx, {})).toMatchObject({ purchasedAt: null, canceledAt: null });
    ctx.auth = { getUserIdentity: async () => null };
    await expect(handler(ctx, {})).rejects.toThrow('Authentication required');
  });
});
