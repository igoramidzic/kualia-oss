import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

type TableName = 'workspace' | 'financeKitConnection' | 'financeKitAccount' | 'bankAccount' | 'userProfile';
type FakeRecord = Record<string, unknown> & { _id: string; _creationTime: number };
type FakeFilter = { field: string; value: unknown };

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

  async take(limit: number): Promise<FakeRecord[]> {
    return this.applyFilters().slice(0, limit);
  }

  async first(): Promise<FakeRecord | null> {
    return this.applyFilters()[0] ?? null;
  }

  private applyFilters(): FakeRecord[] {
    return this.records.filter((record) => this.filters.every((filter) => record[filter.field] === filter.value));
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

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): { ctx: QueryCtx; db: FakeDb } {
  const tableMaps = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of [
    'workspace',
    'financeKitConnection',
    'financeKitAccount',
    'bankAccount',
    'userProfile',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  const db = new FakeDb(tableMaps);
  return { ctx: { db } as unknown as QueryCtx, db };
}

describe('listConnectionsInternal', () => {
  it('retains owned connections outside the bounded workspace page', async () => {
    const { listConnectionsInternal } = await import('./queries');
    const connection = (index: number, ownerClerkId: string): FakeRecord => ({
      _id: `connection-${index}`,
      _creationTime: index,
      workspaceId: 'workspace_1',
      ownerClerkId,
      deviceId: 'device_1',
      status: 'active',
      syncStartDate: '2026-09-01',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      isDeleted: false,
    });
    const { ctx } = createTestContext({
      financeKitConnection: [
        ...Array.from({ length: 100 }, (_, index) => connection(index, 'other')),
        connection(100, 'owner'),
      ],
    });
    const result = await listConnectionsInternal(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'owner',
      deviceId: 'device_1',
    });
    expect(result.map((item) => item._id)).toEqual(['connection-100']);
    expect(result[0].canManageConnection).toBe(true);
  });

  it('returns only the current user and device FinanceKit connections', async () => {
    const { listConnectionsInternal } = await import('./queries');

    const { ctx } = createTestContext({
      financeKitConnection: [
        {
          _id: 'financekit_connection_current' as Id<'financeKitConnection'>,
          _creationTime: 1,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_owner',
          deviceId: 'device_1',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
        {
          _id: 'financekit_connection_other_device' as Id<'financeKitConnection'>,
          _creationTime: 2,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_owner',
          deviceId: 'device_2',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
        {
          _id: 'financekit_connection_other_user' as Id<'financeKitConnection'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_other',
          deviceId: 'device_1',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
      ],
      financeKitAccount: [
        {
          _id: 'financekit_account_current' as Id<'financeKitAccount'>,
          _creationTime: 4,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_current' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_current',
          accountKind: 'asset',
          accountType: 'banking_cash',
          displayName: 'Apple Cash',
          currencyCode: 'USD',
          latestCurrentBalance: 12345n,
          hasCompletedInitialSync: true,
          isDeleted: false,
        },
        {
          _id: 'financekit_account_other_user' as Id<'financeKitAccount'>,
          _creationTime: 5,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_other_user' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_other_user',
          accountKind: 'liability',
          accountType: 'credit_credit_card',
          displayName: 'Other User Apple Card',
          currencyCode: 'USD',
          latestCurrentBalance: -99999n,
          hasCompletedInitialSync: true,
          isDeleted: false,
        },
      ],
    });

    const result = await listConnectionsInternal(ctx as unknown as QueryCtx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_owner',
      deviceId: 'device_1',
    });

    expect(result.map((connection) => connection._id)).toEqual(['financekit_connection_current']);
    expect(result[0]?.accounts.map((account) => account._id)).toEqual(['financekit_account_current']);
  });

  it('returns all current user FinanceKit connections when no device id is provided', async () => {
    const { listConnectionsInternal } = await import('./queries');

    const { ctx, db } = createTestContext({
      financeKitConnection: [
        {
          _id: 'financekit_connection_phone' as Id<'financeKitConnection'>,
          _creationTime: 1,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_owner',
          deviceId: 'phone_device',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
        {
          _id: 'financekit_connection_ipad' as Id<'financeKitConnection'>,
          _creationTime: 2,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_owner',
          deviceId: 'ipad_device',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
        {
          _id: 'financekit_connection_other_user' as Id<'financeKitConnection'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_other',
          deviceId: 'phone_device',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
      ],
      financeKitAccount: [
        {
          _id: 'financekit_account_phone' as Id<'financeKitAccount'>,
          _creationTime: 4,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_phone' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_phone',
          accountKind: 'asset',
          accountType: 'banking_cash',
          displayName: 'Apple Cash',
          currencyCode: 'USD',
          hasCompletedInitialSync: true,
          isDeleted: false,
        },
        {
          _id: 'financekit_account_ipad' as Id<'financeKitAccount'>,
          _creationTime: 5,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_ipad' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_ipad',
          accountKind: 'liability',
          accountType: 'credit_credit_card',
          displayName: 'Apple Card',
          currencyCode: 'USD',
          hasCompletedInitialSync: true,
          isDeleted: false,
        },
      ],
    });

    const reads = vi.spyOn(db, 'query');
    const result = await listConnectionsInternal(ctx as unknown as QueryCtx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_owner',
    });

    expect(reads.mock.calls.filter(([table]) => table === 'financeKitConnection')).toHaveLength(1);
    expect(reads.mock.calls.filter(([table]) => table === 'userProfile')).toHaveLength(2);
    expect(result.map((connection) => connection._id)).toEqual([
      'financekit_connection_phone',
      'financekit_connection_ipad',
    ]);
    expect(result.flatMap((connection) => connection.accounts.map((account) => account._id))).toEqual([
      'financekit_account_phone',
      'financekit_account_ipad',
    ]);
  });

  it('returns a redacted shared view for family members when accounts are linked to bank accounts', async () => {
    const { listConnectionsInternal } = await import('./queries');

    const { ctx } = createTestContext({
      financeKitConnection: [
        {
          _id: 'financekit_connection_owner' as Id<'financeKitConnection'>,
          _creationTime: 1,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          ownerClerkId: 'clerk_owner',
          deviceId: 'owner_device',
          status: 'active',
          syncStartDate: '2026-06-16',
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
          isDeleted: false,
        },
      ],
      financeKitAccount: [
        {
          _id: 'financekit_account_linked' as Id<'financeKitAccount'>,
          _creationTime: 2,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_owner' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_private',
          accountKind: 'liability',
          accountType: 'credit_credit_card',
          displayName: 'Private Apple Card Display',
          currencyCode: 'USD',
          latestCurrentBalance: -99999n,
          transactionHistoryToken: 'private_history_token',
          hasCompletedInitialSync: true,
          bankAccountId: 'bank_account_linked' as Id<'bankAccount'>,
          isDeleted: false,
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
        {
          _id: 'financekit_account_unlinked' as Id<'financeKitAccount'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_owner' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_unlinked_private',
          accountKind: 'asset',
          accountType: 'banking_cash',
          displayName: 'Private Apple Cash',
          currencyCode: 'USD',
          latestCurrentBalance: 12345n,
          hasCompletedInitialSync: true,
          isDeleted: false,
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      bankAccount: [
        {
          _id: 'bank_account_linked' as Id<'bankAccount'>,
          _creationTime: 4,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          name: 'Shared Apple Card',
          financeKitAccountId: 'financekit_account_linked' as Id<'financeKitAccount'>,
          accountType: 'credit_credit_card',
          currentBalance: -99999n,
          pendingBalance: 0n,
          clearedBalance: -99999n,
          isClosed: false,
          isDeleted: false,
        },
      ],
      userProfile: [
        {
          _id: 'user_profile_owner',
          _creationTime: 5,
          clerkId: 'clerk_owner',
          name: 'Taylor Owner',
          email: 'taylor@example.com',
          onboardingCompleted: true,
        },
      ],
    });

    const result = await listConnectionsInternal(ctx as unknown as QueryCtx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_family_member',
      deviceId: 'family_device',
    });

    expect(result.map((connection) => connection._id)).toEqual(['financekit_connection_owner']);
    expect(result[0]?.deviceId).toBe('shared');
    expect(result[0]?.accounts.map((account) => account._id)).toEqual(['financekit_account_linked']);

    const sharedAccount = result[0]?.accounts[0];
    expect(sharedAccount).toBeDefined();
    if (!sharedAccount) {
      throw new Error('Expected a shared FinanceKit account');
    }
    expect(sharedAccount?.externalAccountId).toBe('shared:financekit_account_linked');
    expect(sharedAccount?.displayName).toBe('Shared Apple Card');
    expect(sharedAccount?.bankAccountId).toBe('bank_account_linked');
    expect(result[0]?.ownerClerkId).toBe('clerk_owner');
    expect(result[0]?.owner).toEqual({
      clerkId: 'clerk_owner',
      name: 'Taylor Owner',
      email: 'taylor@example.com',
    });
    expect(result[0]?.isOwnedByCurrentUser).toBe(false);
    expect(result[0]?.canManageConnection).toBe(false);
    expect('latestCurrentBalance' in sharedAccount).toBe(false);
    expect('transactionHistoryToken' in sharedAccount).toBe(false);
  });
});
