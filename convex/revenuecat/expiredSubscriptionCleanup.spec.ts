import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, QueryCtx } from '../_generated/server';
import { plaidClient } from '../bankProviders/plaid/plaidClient';
import { cleanupEligibleAfter, inspectBankLink } from '../lib/plaidCleanup';
import {
  previewCleanup,
  processExpiredSubscriptions,
  removeEligibleBankLink,
  runNow,
} from './expiredSubscriptionCleanup';

const NOW = new Date('2026-09-13T02:00:00.000Z');
const OLD = '2026-08-01T00:00:00.000Z';
const RECENT = '2026-09-09T00:00:00.000Z';
type Row = Record<string, unknown> & { _id: string };
type Filter = { field: string; value: unknown };

class Index {
  filters: Filter[] = [];
  eq(field: string, value: unknown): Index {
    this.filters.push({ field, value });
    return this;
  }
}
class Rows {
  constructor(private rows: Row[]) {}
  withIndex(_name: string, callback?: (index: Index) => Index): Rows {
    const index = new Index();
    callback?.(index);
    return new Rows(this.rows.filter((row) => index.filters.every((f) => row[f.field] === f.value)));
  }
  async first() {
    return this.rows[0] ?? null;
  }
  async collect() {
    return this.rows;
  }
  async take(n: number) {
    return this.rows.slice(0, n);
  }
  async paginate({ numItems, cursor }: { numItems: number; cursor: string | null }) {
    const offset = Number(cursor ?? 0);
    return {
      page: this.rows.slice(offset, offset + numItems),
      isDone: offset + numItems >= this.rows.length,
      continueCursor: String(offset + numItems),
    };
  }
}
function context(tables: Record<string, Row[]> = {}): QueryCtx {
  return {
    db: {
      query: (name: string) => new Rows(tables[name] ?? []),
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
    },
  } as unknown as QueryCtx;
}
function link(overrides: Partial<Doc<'bankLink'>> = {}): Doc<'bankLink'> {
  return {
    _id: 'link_1' as Id<'bankLink'>,
    _creationTime: Date.parse(OLD),
    ownerId: 'owner',
    accessToken: 'secret_token',
    itemId: 'item_1',
    globalInstitutionId: 'institution_1' as Id<'globalInstitution'>,
    itemStatus: 'Healthy',
    createdAt: OLD,
    ...overrides,
  };
}
function sub(overrides: Partial<Doc<'subscription'>> = {}): Row {
  return {
    _id: 'sub_1',
    _creationTime: 1,
    clerkId: 'owner',
    subscriptionType: 'monthly',
    status: 'expired',
    expiresAt: OLD,
    updatedAt: OLD,
    createdAt: OLD,
    isDeleted: false,
    ...overrides,
  };
}
function member(clerkId: string, overrides: Partial<Doc<'familyGroupMember'>> = {}): Row {
  return {
    _id: `member_${clerkId}`,
    _creationTime: 1,
    clerkId,
    familyGroupId: 'group_1',
    userProfileId: `profile_${clerkId}`,
    role: clerkId === 'payer' ? 'owner' : 'member',
    updatedAt: OLD,
    isDeleted: false,
    ...overrides,
  };
}
const family = { _id: 'group_1', ownerClerkId: 'payer', isDeleted: false };

async function decision(tables: Record<string, Row[]> = {}, overrides: Partial<Doc<'bankLink'>> = {}) {
  return await inspectBankLink(context(tables), link(overrides), NOW);
}

describe('Plaid cleanup access and grace policy', () => {
  it.each([
    { status: 'active', subscriptionType: 'monthly', expiresAt: OLD },
    { status: 'active', subscriptionType: 'lifetime', expiresAt: null },
    { status: 'active', store: 'promotional' },
    { status: 'trialing', expiresAt: '2026-10-01T00:00:00Z' },
    { status: 'trialing', expiresAt: null },
    { status: 'canceled', expiresAt: '2026-10-01T00:00:00Z' },
  ] satisfies Partial<Doc<'subscription'>>[])('protects current app access: %j', async (overrides) => {
    expect((await decision({ subscription: [sub(overrides)] })).status).toBe('protected');
  });

  it('protects an active lifetime purchase alongside an expired recurring subscription', async () => {
    expect(
      (
        await decision({
          subscription: [
            sub(),
            sub({
              _id: 'lifetime' as Id<'subscription'>,
              status: 'active',
              subscriptionType: 'lifetime',
              expiresAt: null,
            }),
          ],
        })
      ).status
    ).toBe('protected');
  });

  it.each([
    { status: 'expired' },
    { status: 'canceled' },
    { status: 'trialing' },
    { status: 'billing_issue' },
    { status: 'paused' },
    { status: 'expired', periodType: 'PROMOTIONAL', store: 'promotional' },
    { status: 'expired', subscriptionType: 'lifetime' },
  ] satisfies Partial<Doc<'subscription'>>[])('removes only lapsed access after grace: %j', async (overrides) => {
    expect((await decision({ subscription: [sub(overrides)] })).status).toBe('eligible');
  });

  it('includes old links with no subscription or profile record', async () => {
    expect((await decision()).status).toBe('eligible');
  });
  it('includes disconnected links and old soft deletes lacking provider removal', async () => {
    expect((await decision({}, { itemStatus: 'Disconnected' })).status).toBe('eligible');
    expect((await decision({}, { isDeleted: true, deletedAt: OLD })).status).toBe('eligible');
    expect((await decision({}, { providerDisconnectedAt: OLD })).status).toBe('removed');
  });
  it('protects current access even for a deleted bank-link row', async () => {
    expect((await decision({ subscription: [sub({ status: 'active' })] }, { isDeleted: true })).status).toBe(
      'protected'
    );
  });
  it('gives new links without subscriptions a seven-day grace period', async () => {
    expect((await decision({}, { createdAt: RECENT })).status).toBe('grace_period');
    expect((await decision({}, { createdAt: undefined, _creationTime: Date.parse(RECENT) })).status).toBe(
      'grace_period'
    );
  });
  it('gives recent expiration, status updates, and account reactivation time to recover', async () => {
    expect((await decision({ subscription: [sub({ expiresAt: RECENT })] })).status).toBe('grace_period');
    expect((await decision({ subscription: [sub({ status: 'billing_issue', updatedAt: RECENT })] })).status).toBe(
      'grace_period'
    );
    expect(
      (await decision({ userProfile: [{ _id: 'profile', clerkId: 'owner', lastReactivatedAt: RECENT }] })).status
    ).toBe('grace_period');
  });
  it('fails closed for an invalid eligibility date and preserves the exact cutoff', async () => {
    expect(cleanupEligibleAfter(['bad date'])).toBeNull();
    expect((await decision({}, { createdAt: 'bad date' })).status).toBe('review');
    expect((await decision({}, { createdAt: '2026-09-06T02:00:00.000Z' })).status).toBe('grace_period');
  });
  it('protects active family coverage with no personal subscription', async () => {
    const result = await decision({
      familyGroup: [family],
      familyGroupMember: [member('owner'), member('payer')],
      subscription: [sub({ clerkId: 'payer', status: 'active' })],
    });
    expect(result.status).toBe('protected');
  });
  it('extends grace when family coverage recently expired or membership was removed', async () => {
    const tables = {
      familyGroup: [family],
      familyGroupMember: [member('owner'), member('payer')],
      subscription: [sub({ clerkId: 'payer', expiresAt: RECENT })],
    };
    expect((await decision(tables)).status).toBe('grace_period');
    expect(
      (await decision({ familyGroupMember: [member('owner', { isDeleted: true, deletedAt: RECENT })] })).status
    ).toBe('grace_period');
  });
  it('protects a paying user in a workspace supplied by an owner without access', async () => {
    const result = await decision({
      familyGroup: [family],
      familyGroupMember: [member('owner'), member('payer')],
      subscription: [
        sub({ clerkId: 'owner' }),
        sub({ clerkId: 'payer', status: 'expired' }),
        sub({ clerkId: 'other', status: 'active' }),
      ],
      workspace: [{ _id: 'workspace_1', ownerClerkId: 'other', isDeleted: false }],
      bankLinkAccount: [{ _id: 'linked_1', bankLinkId: 'link_1' }],
      bankAccount: [{ _id: 'account_1', bankLinkAccountId: 'linked_1', workspaceId: 'workspace_1', isDeleted: false }],
    });
    expect(result).toMatchObject({ status: 'protected', reason: 'Shared workspace user has app access' });
  });
  it('protects a shared family link before anyone attaches a bank account', async () => {
    const result = await decision({
      familyGroup: [family],
      familyGroupMember: [member('owner'), member('payer'), member('other')],
      subscription: [sub({ clerkId: 'payer' }), sub({ clerkId: 'other', status: 'active' })],
    });
    expect(result).toMatchObject({
      status: 'protected',
      reason: 'Family member using shared connections has app access',
    });
  });
  it('flags oversized access histories for review instead of assuming access was lost', async () => {
    const familyGroupMember = Array.from({ length: 101 }, (_, n) =>
      member('owner', { _id: `member_${n}` as Id<'familyGroupMember'> })
    );
    expect((await decision({ familyGroupMember })).status).toBe('review');
  });
  it('preview scans beyond the first page and never returns credentials', async () => {
    const rows = Array.from({ length: 26 }, (_, n) => link({ _id: `link_${n}` as Id<'bankLink'> }));
    const ctx = context({ bankLink: rows });
    const handler = (
      previewCleanup as unknown as {
        _handler: (
          ctx: QueryCtx,
          args: { now: string; cursor?: string }
        ) => Promise<{ decisions: unknown[]; nextCursor: string | null }>;
      }
    )._handler;
    const first = await handler(ctx, { now: NOW.toISOString() });
    const second = await handler(ctx, { now: NOW.toISOString(), cursor: first.nextCursor ?? undefined });
    expect(first.decisions).toHaveLength(25);
    expect(second.decisions).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toContain('secret_token');
  });
});

function actionContext(status = 'eligible') {
  const runQuery = vi
    .fn()
    .mockResolvedValue({ decision: { status }, accessToken: status === 'eligible' ? 'secret_token' : null });
  const runMutation = vi.fn().mockResolvedValue({ success: true });
  return { ctx: { runQuery, runMutation } as unknown as ActionCtx, runQuery, runMutation };
}

describe('Plaid cleanup execution', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['protected', 'grace_period', 'removed', 'review'])(
    'does not remove a link whose fresh check says %s',
    async (status) => {
      const { ctx, runMutation } = actionContext(status);
      const remove = vi.spyOn(plaidClient, 'itemRemove');
      expect(await removeEligibleBankLink(ctx, link()._id)).toBe(status);
      expect(remove).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();
    }
  );
  it('removes legacy Plaid links and only then records provider removal', async () => {
    const { ctx, runMutation } = actionContext();
    vi.spyOn(plaidClient, 'itemRemove').mockImplementation(async () => {
      expect(runMutation).not.toHaveBeenCalled();
      return {} as Awaited<ReturnType<typeof plaidClient.itemRemove>>;
    });
    expect(await removeEligibleBankLink(ctx, link()._id)).toBe('disconnected');
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      bankLinkId: link()._id,
      externalProviderDisconnected: true,
    });
  });
  it.each(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'])('finalizes an already-removed item: %s', async (error_code) => {
    const { ctx, runMutation } = actionContext();
    vi.spyOn(plaidClient, 'itemRemove').mockRejectedValue({ response: { data: { error_code } } });
    expect(await removeEligibleBankLink(ctx, link()._id)).toBe('disconnected');
    expect(runMutation).toHaveBeenCalledOnce();
  });
  it('leaves transient failures eligible for retry without exposing credentials', async () => {
    const { ctx, runMutation } = actionContext();
    vi.spyOn(plaidClient, 'itemRemove').mockRejectedValue({
      message: 'secret_token',
      config: { secret: 'secret_token' },
      response: { data: { error_code: 'INTERNAL_SERVER_ERROR' } },
    });
    await expect(removeEligibleBankLink(ctx, link()._id)).rejects.toThrow(
      'Plaid removal failed: INTERNAL_SERVER_ERROR'
    );
    expect(runMutation).not.toHaveBeenCalled();
  });
  it('can retry after provider removal succeeded but local finalization failed', async () => {
    const { ctx, runMutation } = actionContext();
    vi.spyOn(plaidClient, 'itemRemove')
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof plaidClient.itemRemove>>)
      .mockRejectedValueOnce({ response: { data: { error_code: 'ITEM_NOT_FOUND' } } });
    runMutation.mockRejectedValueOnce(new Error('temporary database failure'));
    await expect(removeEligibleBankLink(ctx, link()._id)).rejects.toThrow('temporary database failure');
    await expect(removeEligibleBankLink(ctx, link()._id)).resolves.toBe('disconnected');
  });
  it('continues to the next page and accumulates counts without sending a premature summary', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValue({ decisions: [{ bankLinkId: link()._id, status: 'protected' }], nextCursor: 'next_page' });
    const runAfter = vi.fn();
    const runAction = vi.fn();
    const ctx = { runQuery, runAction, scheduler: { runAfter } } as unknown as ActionCtx;
    const handler = (
      processExpiredSubscriptions as unknown as {
        _handler: (ctx: ActionCtx, args: Record<string, unknown>) => Promise<unknown>;
      }
    )._handler;
    await handler(ctx, {});
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      cursor: 'next_page',
      summary: expect.objectContaining({ inspected: 1, protected: 1 }),
    });
    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('manual Plaid cleanup', () => {
  const handler = (
    runNow as unknown as {
      _handler: (ctx: ActionCtx, args: { dryRun?: boolean }) => Promise<unknown>;
    }
  )._handler;

  it.each([{}, { dryRun: true }])('previews every page without side effects: %j', async (args) => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ decisions: [{ status: 'protected' }, { status: 'eligible' }], nextCursor: 'page_2' })
      .mockResolvedValueOnce({
        decisions: [{ status: 'eligible' }, { status: 'grace_period' }, { status: 'removed' }, { status: 'review' }],
        nextCursor: null,
      });
    const runAfter = vi.fn();
    const runMutation = vi.fn();
    const runAction = vi.fn();
    const ctx = { runQuery, runMutation, runAction, scheduler: { runAfter } } as unknown as ActionCtx;

    expect(await handler(ctx, args)).toEqual({
      mode: 'preview',
      summary: {
        inspected: 6,
        protected: 1,
        eligible: 2,
        gracePeriod: 1,
        alreadyRemoved: 1,
        disconnected: 0,
        errors: 1,
      },
    });
    expect(runQuery.mock.calls[1]?.[1]).toEqual({ cursor: 'page_2', now: runQuery.mock.calls[0]?.[1].now });
    expect(runAfter).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('starts the existing protected sweep immediately only when dryRun is false', async () => {
    const runAfter = vi.fn().mockResolvedValue('scheduled_cleanup');
    const runQuery = vi.fn();
    const ctx = { runQuery, scheduler: { runAfter } } as unknown as ActionCtx;

    expect(await handler(ctx, { dryRun: false })).toEqual({
      mode: 'started',
      scheduledFunctionId: 'scheduled_cleanup',
    });
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {});
    expect(runAfter).toHaveBeenCalledOnce();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
