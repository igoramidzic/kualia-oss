import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { disconnectConnectionInternal } from './mutations';

type TableName =
  | 'financeKitConnection'
  | 'financeKitAccount'
  | 'bankAccount'
  | 'bankLink'
  | 'bankLinkAccount'
  | 'transactionImportRaw'
  | 'plaidWebhookLog';
type FakeRecord = Record<string, unknown> & { _id: string };
type FakeFilter = { field: string; value: unknown };
type PatchRecord = { tableName: TableName; id: string; updates: Record<string, unknown> };

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
  readonly patches: PatchRecord[] = [];

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

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    for (const [tableName, records] of this.recordsByTable.entries()) {
      const record = records.get(id);
      if (!record) {
        continue;
      }

      this.patches.push({ tableName, id, updates });
      Object.assign(record, updates);
      return;
    }

    throw new Error(`Missing fake record: ${id}`);
  }

  record(tableName: TableName, id: string): FakeRecord {
    const record = this.recordsByTable.get(tableName)?.get(id);
    if (!record) {
      throw new Error(`Missing fake record: ${tableName}.${id}`);
    }
    return record;
  }
}

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): { ctx: MutationCtx; db: FakeDb } {
  const tableMaps = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of [
    'financeKitConnection',
    'financeKitAccount',
    'bankAccount',
    'bankLink',
    'bankLinkAccount',
    'transactionImportRaw',
    'plaidWebhookLog',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  const db = new FakeDb(tableMaps);
  return { ctx: { db } as unknown as MutationCtx, db };
}

function financeKitConnectionRecord(): FakeRecord {
  return {
    _id: 'financekit_connection_1' as Id<'financeKitConnection'>,
    _creationTime: 1,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    ownerClerkId: 'clerk_owner',
    deviceId: 'device_1',
    status: 'active',
    syncStartDate: '2026-06-12',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    isDeleted: false,
  };
}

function financeKitAccountRecord(overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: 'financekit_account_1' as Id<'financeKitAccount'>,
    _creationTime: 2,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
    externalAccountId: 'external_account_1',
    accountKind: 'liability',
    accountType: 'credit_credit_card',
    displayName: 'Apple Card',
    currencyCode: 'USD',
    hasCompletedInitialSync: true,
    bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

describe('disconnectConnectionInternal', () => {
  it('soft-deletes FinanceKit rows and unlinks Kualia bank accounts', async () => {
    const { ctx, db } = createTestContext({
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [financeKitAccountRecord()],
      bankAccount: [
        {
          _id: 'bank_account_1' as Id<'bankAccount'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          name: 'Apple Card',
          financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
          accountType: 'credit_credit_card',
          currentBalance: -12345n,
          isClosed: false,
          isDeleted: false,
        },
      ],
      bankLink: [{ _id: 'bank_link_1', touched: false }],
      bankLinkAccount: [{ _id: 'bank_link_account_1', touched: false }],
      transactionImportRaw: [{ _id: 'raw_import_1', touched: false }],
      plaidWebhookLog: [{ _id: 'plaid_webhook_1', touched: false }],
    });

    const result = await disconnectConnectionInternal(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_owner',
      deviceId: 'device_1',
      connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
    });

    expect(result).toEqual({ disconnectedAccountCount: 1 });
    expect(db.record('financeKitConnection', 'financekit_connection_1').isDeleted).toBe(true);
    expect(db.record('financeKitAccount', 'financekit_account_1').isDeleted).toBe(true);
    expect(db.record('financeKitAccount', 'financekit_account_1').bankAccountId).toBeUndefined();
    expect(db.record('bankAccount', 'bank_account_1').financeKitAccountId).toBeUndefined();
    expect(db.record('bankAccount', 'bank_account_1')).toMatchObject({
      currentBalance: -12345n,
      isDeleted: false,
      isClosed: false,
    });
    expect(db.patches.map((patch) => patch.tableName)).not.toContain('bankLink');
    expect(db.patches.map((patch) => patch.tableName)).not.toContain('bankLinkAccount');
    expect(db.patches.map((patch) => patch.tableName)).not.toContain('transactionImportRaw');
    expect(db.patches.map((patch) => patch.tableName)).not.toContain('plaidWebhookLog');
  });

  it.each([
    { overrides: { deviceId: 'other_device' }, message: 'another device' },
    { overrides: { ownerClerkId: 'other_owner' }, message: 'another user' },
    { overrides: { workspaceId: 'other_workspace' as Id<'workspace'> }, message: 'not found' },
  ])('rejects mismatched connection ownership before mutating records: $overrides', async ({ overrides, message }) => {
    const { ctx, db } = createTestContext({
      financeKitConnection: [financeKitConnectionRecord()],
    });

    await expect(
      disconnectConnectionInternal(ctx, {
        workspaceId: 'workspace_1' as Id<'workspace'>,
        ownerClerkId: 'clerk_owner',
        deviceId: 'device_1',
        connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
        ...overrides,
      })
    ).rejects.toThrow(message);
    expect(db.patches).toEqual([]);
  });

  it('allows an owned FinanceKit connection to be disconnected without a device id', async () => {
    const { ctx, db } = createTestContext({
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [financeKitAccountRecord()],
      bankAccount: [
        {
          _id: 'bank_account_1' as Id<'bankAccount'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          name: 'Apple Card',
          financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
          accountType: 'credit_credit_card',
          currentBalance: -12345n,
          isClosed: false,
          isDeleted: false,
        },
      ],
    });

    const result = await disconnectConnectionInternal(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      ownerClerkId: 'clerk_owner',
      connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
    });

    expect(result).toEqual({ disconnectedAccountCount: 1 });
    expect(db.record('financeKitConnection', 'financekit_connection_1').isDeleted).toBe(true);
    expect(db.record('financeKitAccount', 'financekit_account_1').isDeleted).toBe(true);
    expect(db.record('bankAccount', 'bank_account_1').financeKitAccountId).toBeUndefined();
  });
});

describe('FinanceKit module isolation', () => {
  it('does not write through Plaid-shaped tables or Plaid provider modules', () => {
    const source = readFileSync(new URL('./mutations.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("'bankLink'");
    expect(source).not.toContain("'bankLinkAccount'");
    expect(source).not.toContain("'transactionImportRaw'");
    expect(source).not.toContain("'plaidWebhookLog'");
    expect(source).not.toContain('bankProviders/plaid');
  });
});
