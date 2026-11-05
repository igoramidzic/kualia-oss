import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import * as bankLinkHelpers from '../bankLinks/helpers';
import { listBankLinksInternal } from '../bankLinks/queries';
import { APPLE_WALLET_LOGO_URL } from '../lib/logoUtils';
import { toAppleWalletConnection, toPlaidConnection } from './queries';

describe('toPlaidConnection', () => {
  it.each([false, true])('exposes initial sync completion as %s', (hasCompletedFirstSync) => {
    const connection = toPlaidConnection({
      _id: 'bank_link_1' as Id<'bankLink'>,
      _creationTime: 1,
      itemId: 'item_1',
      itemStatus: 'Healthy',
      reauthorization: undefined,
      lastSyncedAt: undefined,
      hasCompletedFirstSync,
      ownerId: 'clerk_owner',
      owner: null,
      isOwnedByCurrentUser: true,
      canManageConnection: true,
      institution: null,
      accounts: [
        {
          _id: 'bank_link_account_1' as Id<'bankLinkAccount'>,
          name: 'Checking',
          accountType: 'banking_checking',
          accountNumberMask: '1234',
          initialBalance: 12500,
          officialName: undefined,
          currentBalance: undefined,
          availableBalance: undefined,
          lastUpdated: undefined,
          hasCompletedInitialSync: hasCompletedFirstSync,
          connectedBankAccount: null,
        },
      ],
    });

    expect(connection.accounts[0].hasCompletedInitialSync).toBe(hasCompletedFirstSync);
    expect(connection.accounts[0].ref).toEqual({ provider: 'plaid', accountId: 'bank_link_account_1' });
  });
});

describe('toAppleWalletConnection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the Apple Wallet logo for provider-neutral connection views', () => {
    const connection = toAppleWalletConnection({
      _id: 'financekit_connection_1' as Id<'financeKitConnection'>,
      _creationTime: 1,
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_owner',
      deviceId: 'device_1',
      status: 'active',
      syncStartDate: '2026-06-16',
      lastSyncedAt: undefined,
      owner: null,
      isOwnedByCurrentUser: true,
      canManageConnection: true,
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
      isDeleted: false,
      accounts: [],
    } as Parameters<typeof toAppleWalletConnection>[0]);

    expect(connection.logoUrl).toBe(APPLE_WALLET_LOGO_URL);
  });
});

describe('Plaid connection hydration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shares owner and institution reads while preserving ordering, workspace linkage and sync status', async () => {
    vi.spyOn(bankLinkHelpers, 'listBankLinkOwnerClerkIdsForWorkspace').mockResolvedValue(['owner', 'relative']);
    type Row = Record<string, unknown> & { _id: string };
    const rows: Record<string, Row[]> = {
      bankLink: [
        {
          _id: 'one',
          _creationTime: 2,
          ownerId: 'owner',
          globalInstitutionId: 'institution',
          itemStatus: 'Healthy',
          hasCompletedFirstSync: true,
          reauthorization: {
            reason: 'connection_expiring',
            requiredBy: '2026-09-19T12:00:00.000Z',
            providerReason: 'INSTITUTION_TOKEN_EXPIRATION',
          },
        },
        { _id: 'two', _creationTime: 3, ownerId: 'owner', globalInstitutionId: 'institution', itemStatus: 'Healthy' },
        {
          _id: 'shared',
          _creationTime: 1,
          ownerId: 'relative',
          globalInstitutionId: 'institution',
          itemStatus: 'Error',
        },
        { _id: 'deleted', _creationTime: 0, ownerId: 'owner', globalInstitutionId: 'institution', isDeleted: true },
      ],
      userProfile: [
        { _id: 'profile', clerkId: 'owner', name: 'Owner' },
        { _id: 'relative-profile', clerkId: 'relative', name: 'Relative' },
      ],
      bankLinkAccount: [
        { _id: 'a', bankLinkId: 'one', name: 'Checking', accountType: 'banking_checking' },
        { _id: 'b', bankLinkId: 'two', name: 'Savings', accountType: 'banking_savings' },
        { _id: 'c', bankLinkId: 'shared', name: 'Shared', accountType: 'banking_checking' },
      ],
      bankAccount: [
        { _id: 'foreign', bankLinkAccountId: 'a', workspaceId: 'foreign', isDeleted: false },
        { _id: 'deleted-account', bankLinkAccountId: 'a', workspaceId: 'workspace', isDeleted: true },
        {
          _id: 'local',
          bankLinkAccountId: 'a',
          workspaceId: 'workspace',
          name: 'Local',
          isDeleted: false,
          plaidInitialSync: { status: 'pending' },
        },
      ],
    };
    const queryTables: string[] = [];
    const get = vi.fn(async () => ({ _id: 'institution', name: 'Bank' }));
    const ctx = {
      db: {
        get,
        query: (table: string) => {
          queryTables.push(table);
          const tests: ((row: Row) => boolean)[] = [];
          const bounds = {
            eq: (field: string, value: unknown) => {
              tests.push((row) => row[field] === value);
              return bounds;
            },
          };
          const filter = {
            field: (field: string) => (row: Row) => row[field],
            eq: (field: (row: Row) => unknown, value: unknown) => (row: Row) => field(row) === value,
            neq: (field: (row: Row) => unknown, value: unknown) => (row: Row) => field(row) !== value,
            and:
              (...conditions: ((row: Row) => boolean)[]) =>
              (row: Row) =>
                conditions.every((condition) => condition(row)),
          };
          const result = () => (rows[table] ?? []).filter((row) => tests.every((test) => test(row)));
          const query = {
            withIndex: (_index: string, build: (q: typeof bounds) => unknown) => {
              build(bounds);
              return query;
            },
            filter: (build: (q: typeof filter) => (row: Row) => boolean) => {
              tests.push(build(filter));
              return query;
            },
            collect: async () => result(),
            first: async () => result()[0] ?? null,
          };
          return query;
        },
      },
    } as unknown as QueryCtx;
    const result = await listBankLinksInternal(ctx, {
      workspaceId: 'workspace' as Id<'workspace'>,
      currentUserClerkId: 'owner',
    });
    expect(toPlaidConnection(result[0])).toMatchObject({
      status: 'connected',
      reauthorization: {
        reason: 'connection_expiring',
        requiredBy: '2026-09-19T12:00:00.000Z',
        providerReason: 'INSTITUTION_TOKEN_EXPIRATION',
      },
    });
    expect(toPlaidConnection(result[1]).reauthorization).toBeNull();
    expect(result.map((connection) => connection._id)).toEqual(['one', 'two', 'shared']);
    expect(result.map((connection) => connection.canManageConnection)).toEqual([true, true, false]);
    expect(result[0].accounts[0]).toMatchObject({
      connectedBankAccount: { _id: 'local', name: 'Local' },
      hasCompletedInitialSync: false,
    });
    expect(result[1].accounts[0].connectedBankAccount).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(queryTables.filter((table) => table === 'userProfile')).toHaveLength(2);
  });
});
