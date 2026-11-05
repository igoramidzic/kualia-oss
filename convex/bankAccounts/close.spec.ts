import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { closeBankAccountHandler } from './close';
import { deleteBankAccountForWorkspace, restoreBankAccountHandler } from './delete';

type TableName =
  | 'workspace'
  | 'userProfile'
  | 'activityLog'
  | 'bankAccount'
  | 'financeKitAccount'
  | 'transaction'
  | 'category'
  | 'categoryGroup';
type FakeRecord = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (record: FakeRecord) => boolean;
type FakeFilter = { field: string; value: unknown };

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeExpressionBuilder {
  field(fieldName: string): string {
    return fieldName;
  }

  eq(fieldName: string, value: unknown): Predicate {
    return (record) => record[fieldName] === value;
  }

  and(...predicates: Predicate[]): Predicate {
    return (record) => predicates.every((predicate) => predicate(record));
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[] = [],
    private readonly predicate: Predicate = () => true
  ) {}

  withIndex(_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters, this.predicate);
  }

  filter(callback: (q: FakeExpressionBuilder) => Predicate): FakeQuery {
    const builder = new FakeExpressionBuilder();
    return new FakeQuery(this.records, this.filters, callback(builder));
  }

  async collect(): Promise<FakeRecord[]> {
    return this.records.filter(
      (record) => this.filters.every((filter) => record[filter.field] === filter.value) && this.predicate(record)
    );
  }

  async first(): Promise<FakeRecord | null> {
    return (await this.collect())[0] ?? null;
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
    'financeKitAccount',
    'transaction',
    'category',
    'categoryGroup',
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

describe('closeBankAccountHandler', () => {
  it('unlinks FinanceKit accounts on both records when closing a bank account', async () => {
    const { ctx, db } = createTestContext({
      workspace: [
        {
          _id: 'workspace_1' as Id<'workspace'>,
          _creationTime: 1,
          name: 'Personal',
          ownerClerkId: 'clerk_owner',
          isDeleted: false,
        },
      ],
      bankAccount: [
        {
          _id: 'bank_account_1' as Id<'bankAccount'>,
          _creationTime: 2,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          name: 'Apple Card',
          accountType: 'credit_credit_card',
          financeKitAccountId: 'financekit_account_1' as Id<'financeKitAccount'>,
          currentBalance: -12345n,
          isClosed: false,
          isDeleted: false,
        },
      ],
      financeKitAccount: [
        {
          _id: 'financekit_account_1' as Id<'financeKitAccount'>,
          _creationTime: 3,
          workspaceId: 'workspace_1' as Id<'workspace'>,
          connectionId: 'financekit_connection_1' as Id<'financeKitConnection'>,
          externalAccountId: 'external_account_1',
          accountKind: 'liability',
          accountType: 'credit_credit_card',
          displayName: 'Apple Card',
          currencyCode: 'USD',
          bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
          isDeleted: false,
        },
      ],
      transaction: [],
    });

    await closeBankAccountHandler(ctx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      bankAccountId: 'bank_account_1' as Id<'bankAccount'>,
    });

    expect(db.record('bankAccount', 'bank_account_1').isClosed).toBe(true);
    expect(db.record('bankAccount', 'bank_account_1').financeKitAccountId).toBeUndefined();
    expect(db.record('financeKitAccount', 'financekit_account_1').bankAccountId).toBeUndefined();
    expect(db.record('activityLog', 'activityLog_1').type).toBe('bank_account_closed');
  });
});

describe('bank account deletion undo', () => {
  const workspaceId = 'workspace_1' as Id<'workspace'>;
  const bankAccountId = 'bank_account_1' as Id<'bankAccount'>;
  const args = { workspaceId, bankAccountId };

  function fixture(categoryDeletedAt?: string) {
    return createTestContext({
      workspace: [
        { _id: workspaceId, _creationTime: 1, name: 'Personal', ownerClerkId: 'clerk_owner', isDeleted: false },
      ],
      bankAccount: [
        {
          _id: bankAccountId,
          _creationTime: 2,
          workspaceId,
          name: 'Card',
          accountType: 'credit_credit_card',
          currentBalance: 0n,
          isClosed: false,
          isDeleted: false,
        },
      ],
      category: [
        {
          _id: 'category_1',
          _creationTime: 3,
          workspaceId,
          name: 'Card payment',
          bankAccountId,
          categoryGroupId: 'group_1',
          sortOrder: 0,
          isDeleted: categoryDeletedAt !== undefined,
          deletedAt: categoryDeletedAt,
        },
      ],
      categoryGroup: [{ _id: 'group_1', _creationTime: 4, workspaceId, name: 'Credit cards', isDeleted: false }],
    });
  }

  it('restores the same empty credit account and the category deleted with it', async () => {
    const { ctx, db } = fixture();
    await deleteBankAccountForWorkspace(ctx, {
      ...args,
      attribution: { clerkId: 'clerk_owner', source: { type: 'kualia_ui' } },
    });
    expect(db.record('bankAccount', bankAccountId).isDeleted).toBe(true);
    expect(db.record('category', 'category_1').deletedAt).toBe(db.record('bankAccount', bankAccountId).deletedAt);
    await restoreBankAccountHandler(ctx, args);
    expect(db.record('bankAccount', bankAccountId).isDeleted).toBe(false);
    expect(db.record('category', 'category_1').isDeleted).toBe(false);
    expect(db.record('category', 'category_1').deletedAt).toBeUndefined();
    await restoreBankAccountHandler(ctx, args);
    expect(db.record('bankAccount', bankAccountId).isDeleted).toBe(false);
  });

  it('does not resurrect a category deleted before the account', async () => {
    const { ctx, db } = fixture('2020-01-01T00:00:00.000Z');
    await deleteBankAccountForWorkspace(ctx, {
      ...args,
      attribution: { clerkId: 'clerk_owner', source: { type: 'kualia_ui' } },
    });
    await restoreBankAccountHandler(ctx, args);
    expect(db.record('bankAccount', bankAccountId).isDeleted).toBe(false);
    expect(db.record('category', 'category_1').isDeleted).toBe(true);
  });

  it('rejects restoration of another workspace account', async () => {
    const { ctx, db } = fixture();
    await db.patch(bankAccountId, { workspaceId: 'other_workspace', isDeleted: true });
    await expect(restoreBankAccountHandler(ctx, args)).rejects.toThrow('does not belong to workspace');
    expect(db.record('bankAccount', bankAccountId).isDeleted).toBe(true);
  });

  it('retains closed status when undoing deletion of a closed account', async () => {
    const { ctx, db } = fixture();
    await db.patch(bankAccountId, { isClosed: true, closedAt: '2026-01-01T00:00:00.000Z' });
    await deleteBankAccountForWorkspace(ctx, {
      ...args,
      attribution: { clerkId: 'clerk_owner', source: { type: 'kualia_ui' } },
    });
    await restoreBankAccountHandler(ctx, args);
    expect(db.record('bankAccount', bankAccountId).isClosed).toBe(true);
    expect(db.record('bankAccount', bankAccountId).closedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
