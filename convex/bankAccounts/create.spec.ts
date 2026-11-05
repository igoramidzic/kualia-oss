import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { addAccountToOrdering } from '../workspaces/bankAccountOrdering';
import { createBankAccountHandler } from './create';
import { createOrUpdateStartingBalanceTransaction } from './helpers';

vi.mock('../workspaces/bankAccountOrdering', () => ({
  addAccountToOrdering: vi.fn(),
}));

vi.mock('./helpers', () => ({
  createOrUpdateStartingBalanceTransaction: vi.fn(),
}));

type TableName =
  | 'workspace'
  | 'userProfile'
  | 'activityLog'
  | 'bankAccount'
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
    const id = `${tableName}_${this.nextId}`;
    this.nextId += 1;

    const fakeRecord: FakeRecord = {
      _id: id,
      _creationTime: this.nextId,
      ...record,
    };
    this.recordsByTable.get(tableName)?.set(id, fakeRecord);
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
    latestCurrentBalance: 12345n,
    syncStartDate: '2026-06-12',
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
    isClosed: false,
    isDeleted: false,
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('createBankAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records account opening without separately recording its starting balance transaction', async () => {
    const { ctx, db } = createTestContext({
      workspace: [workspaceRecord()],
    });

    const bankAccountId = await createBankAccountHandler(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      name: 'Test',
      accountType: 'banking_checking',
      initialBalance: 1_231_300n,
      initialBalanceDate: '2026-07-11',
    });

    expect(createOrUpdateStartingBalanceTransaction).toHaveBeenCalledWith(ctx, {
      bankAccountId,
      workspaceId: 'workspace_1',
      amount: 1_231_300n,
      date: '2026-07-11',
      source: 'manual',
    });
    expect(db.record('activityLog', 'activityLog_2').type).toBe('bank_account_created');
  });

  it('creates and links a bank account from a FinanceKit account', async () => {
    const { ctx, db } = createTestContext({
      workspace: [workspaceRecord()],
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [financeKitAccountRecord()],
    });

    const bankAccountId = await createBankAccountHandler(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      name: 'Apple Cash',
      financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
    });

    expect(db.record('bankAccount', bankAccountId).financeKitAccountId).toBe('financekit_account_1');
    expect(db.record('bankAccount', bankAccountId).accountType).toBe('banking_cash');
    expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(12345n);
    expect(db.record('financeKitAccount', 'financekit_account_1').bankAccountId).toBe(bankAccountId);
    expect(addAccountToOrdering).toHaveBeenCalledWith(ctx, 'workspace_1', bankAccountId, 'banking_cash');
    expect(createOrUpdateStartingBalanceTransaction).toHaveBeenCalledWith(ctx, {
      bankAccountId,
      workspaceId: 'workspace_1',
      amount: 12345n,
      date: '2026-06-12',
      source: 'automatic_import',
    });
    expect(db.record('activityLog', 'activityLog_2').type).toBe('bank_account_created');
  });

  it('rejects a FinanceKit account that is already linked to an active bank account', async () => {
    const { ctx } = createTestContext({
      workspace: [workspaceRecord()],
      bankAccount: [
        bankAccountRecord({
          financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
        }),
      ],
      financeKitConnection: [financeKitConnectionRecord()],
      financeKitAccount: [financeKitAccountRecord()],
    });

    await expect(
      createBankAccountHandler(ctx, {
        workspaceId: 'workspace_1' as Id<'workspace'>,
        name: 'Apple Cash',
        financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
      })
    ).rejects.toThrow('Apple Wallet account is already connected to another bank account');
  });
});
