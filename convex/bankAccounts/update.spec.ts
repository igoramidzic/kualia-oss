import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { updateBankAccountHandler } from './update';

type TableName =
  | 'workspace'
  | 'userProfile'
  | 'activityLog'
  | 'bankAccount'
  | 'bankLink'
  | 'bankLinkAccount'
  | 'familyGroupMember'
  | 'financeKitConnection'
  | 'financeKitAccount';
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

  async first(): Promise<FakeRecord | null> {
    return this.applyFilters()[0] ?? null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<FakeRecord> {
    yield* this.applyFilters();
  }

  private applyFilters(): FakeRecord[] {
    return this.records.filter((record) => this.filters.every((filter) => record[filter.field] === filter.value));
  }
}

class FakeDb {
  private nextId = 1;

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

  async insert(tableName: TableName, record: Record<string, unknown>): Promise<string> {
    const id = `${tableName}_${this.nextId++}`;
    this.recordsByTable.get(tableName)?.set(id, { _id: id, _creationTime: this.nextId, ...record });
    return id;
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (!record) {
        continue;
      }

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
    'workspace',
    'userProfile',
    'activityLog',
    'bankAccount',
    'bankLink',
    'bankLinkAccount',
    'familyGroupMember',
    'financeKitConnection',
    'financeKitAccount',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  const db = new FakeDb(tableMaps);
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: 'clerk_owner' }),
    },
    db,
  } as unknown as MutationCtx;

  return { ctx, db };
}

function workspaceRecord(): FakeRecord {
  return {
    _id: 'workspace_1' as Id<'workspace'>,
    _creationTime: 1,
    name: 'Personal',
    ownerClerkId: 'clerk_owner',
    isDeleted: false,
  };
}

function financeKitConnectionRecord(): FakeRecord {
  return {
    _id: 'financekit_connection_1' as Id<'financeKitConnection'>,
    _creationTime: 2,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    ownerClerkId: 'clerk_owner',
    deviceId: 'device_1',
    status: 'active',
    syncStartDate: '2026-06-16',
    isDeleted: false,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function financeKitAccountRecord(overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: 'financekit_account_1' as Id<'financeKitAccount'>,
    _creationTime: 3,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
    externalAccountId: 'external_account_1',
    accountKind: 'asset',
    accountType: 'banking_cash',
    displayName: 'Apple Cash',
    currencyCode: 'USD',
    isDeleted: false,
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

function bankAccountRecord(overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: 'bank_account_1' as Id<'bankAccount'>,
    _creationTime: 4,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    name: 'Cash',
    accountType: 'banking_cash',
    currentBalance: 0n,
    pendingBalance: 0n,
    clearedBalance: 0n,
    isClosed: false,
    isDeleted: false,
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('updateBankAccount', () => {
  function plaidContext(connectionType = 'banking_checking', accountOverrides: Partial<FakeRecord> = {}) {
    return createTestContext({
      workspace: [workspaceRecord()],
      bankAccount: [bankAccountRecord(accountOverrides)],
      bankLink: [{ _id: 'bank_link_1', _creationTime: 1, ownerId: 'clerk_owner', isDeleted: false }],
      bankLinkAccount: [
        {
          _id: 'bank_link_account_1',
          _creationTime: 2,
          bankLinkId: 'bank_link_1',
          accountType: connectionType,
          isDeleted: false,
        },
      ],
    });
  }

  const plaidLinkArgs = {
    workspaceId: 'workspace_1' as Id<'workspace'>,
    bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
    bankLinkAccountId: 'bank_link_account_1' as Id<'bankLinkAccount'>,
  };

  it('links a matching Plaid account without changing manual transactions or balance', async () => {
    const { ctx, db } = plaidContext('banking_checking', { currentBalance: 12500n });

    await updateBankAccountHandler(ctx, plaidLinkArgs);

    expect(db.record('bankAccount', 'bank_account_1').bankLinkAccountId).toBe('bank_link_account_1');
    expect(db.record('bankAccount', 'bank_account_1').currentBalance).toBe(12500n);
  });

  it('rejects linking a credit connection to a banking account', async () => {
    const { ctx, db } = plaidContext('credit_credit_card');

    await expect(updateBankAccountHandler(ctx, plaidLinkArgs)).rejects.toThrow('different account category');

    expect(db.record('bankAccount', 'bank_account_1').bankLinkAccountId).toBeUndefined();
  });

  it('rejects linking a closed manual account without changing its balance or closed state', async () => {
    const { ctx, db } = plaidContext('banking_checking', {
      isClosed: true,
      currentBalance: 12500n,
      closedAt: '2026-06-15T00:00:00.000Z',
    });

    await expect(updateBankAccountHandler(ctx, plaidLinkArgs)).rejects.toThrow('Reopen this account');

    expect(db.record('bankAccount', 'bank_account_1')).toMatchObject({
      isClosed: true,
      currentBalance: 12500n,
      closedAt: '2026-06-15T00:00:00.000Z',
    });
    expect(db.record('bankAccount', 'bank_account_1').bankLinkAccountId).toBeUndefined();
    expect(db.record('bankAccount', 'bank_account_1').plaidInitialSync).toBeUndefined();
  });

  it('still allows unlinking a closed Plaid account and clears its replay marker', async () => {
    const { ctx, db } = plaidContext('banking_checking', {
      isClosed: true,
      bankLinkAccountId: 'bank_link_account_1',
      plaidInitialSync: {
        bankLinkAccountId: 'bank_link_account_1',
        startDate: '2026-06-15',
        status: 'pending',
        preserveBalance: true,
      },
    });

    await updateBankAccountHandler(ctx, { ...plaidLinkArgs, bankLinkAccountId: null });

    expect(db.record('bankAccount', 'bank_account_1').isClosed).toBe(true);
    expect(db.record('bankAccount', 'bank_account_1').bankLinkAccountId).toBeUndefined();
    expect(db.record('bankAccount', 'bank_account_1').plaidInitialSync).toBeUndefined();
  });

  it('rejects unsupported investment connections even when the categories match', async () => {
    const { ctx } = plaidContext('investment_brokerage', { accountType: 'investment_brokerage' });

    await expect(updateBankAccountHandler(ctx, plaidLinkArgs)).rejects.toThrow('Only banking and credit');
  });

  it('links a bank account to a FinanceKit account on both records', async () => {
    const { ctx, db } = createTestContext({
      workspace: [workspaceRecord()],
      bankAccount: [bankAccountRecord()],
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [financeKitAccountRecord()],
    });

    await updateBankAccountHandler(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
      financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
    });

    expect(db.record('bankAccount', 'bank_account_1').financeKitAccountId).toBe('financekit_account_1');
    expect(db.record('financeKitAccount', 'financekit_account_1').bankAccountId).toBe('bank_account_1');
    expect(db.record('activityLog', 'activityLog_1').type).toBe('bank_account_updated');
  });

  it('unlinks a FinanceKit bank account on both records', async () => {
    const { ctx, db } = createTestContext({
      workspace: [workspaceRecord()],
      bankAccount: [
        bankAccountRecord({
          financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
        }),
      ],
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [
        financeKitAccountRecord({
          bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
        }),
      ],
    });

    await updateBankAccountHandler(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
      financeKitAccountId: null,
    });

    expect(db.record('bankAccount', 'bank_account_1').financeKitAccountId).toBeUndefined();
    expect(db.record('financeKitAccount', 'financekit_account_1').bankAccountId).toBeUndefined();
    expect(db.record('activityLog', 'activityLog_1').type).toBe('bank_account_updated');
  });
});
