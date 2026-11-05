import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { reconcileBankAccountHandler } from './reconcile';

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
        return structuredClone(record);
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

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): {
  ctx: MutationCtx;
  db: FakeDb;
  runMutation: ReturnType<typeof vi.fn>;
} {
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
  const runMutation = vi.fn(async () => null);
  const ctx = {
    runMutation,
    auth: {
      getUserIdentity: async () => ({ subject: 'clerk_owner' }),
    },
    db,
  } as unknown as MutationCtx;

  return { ctx, db, runMutation };
}

const workspaceId = 'workspace_1' as Id<'workspace'>;
const bankAccountId = 'bank_account_1' as Id<'bankAccount'>;
const request = {
  workspaceId,
  bankAccountId,
  reconciliationDate: '2026-09-11',
  reportedBalance: 10000n,
  includePending: true,
  allowBalanceAdjustment: false,
};

function setup(account: Record<string, unknown> = {}, transactions: FakeRecord[] = []) {
  return createTestContext({
    workspace: [
      { _id: workspaceId, _creationTime: 1, name: 'Personal', ownerClerkId: 'clerk_owner', isDeleted: false },
    ],
    bankAccount: [
      {
        _id: bankAccountId,
        _creationTime: 2,
        workspaceId,
        name: 'Checking',
        accountType: 'banking_checking',
        currentBalance: 10000n,
        pendingBalance: -2000n,
        clearedBalance: 12000n,
        isClosed: false,
        isDeleted: false,
        ...account,
      },
    ],
    transaction: transactions,
  });
}

function transaction(id: string, changes: Record<string, unknown> = {}): FakeRecord {
  return {
    _id: id,
    _creationTime: 3,
    workspaceId,
    bankAccountId,
    type: 'regular',
    date: '2026-09-10',
    status: 'cleared',
    reviewStatus: 'reviewed',
    isDeleted: false,
    totalAmount: 100n,
    movements: [],
    ...changes,
  };
}

describe('reconcileBankAccount', () => {
  it.each([true, false])(
    'confirms the selected balance and only reconciles reviewed, cleared transactions (pending: %s)',
    async (includePending) => {
      const { ctx, db, runMutation } = setup({}, [
        transaction('cleared'),
        transaction('pending', { status: 'pending' }),
        transaction('unreviewed', { reviewStatus: 'needs_review' }),
        transaction('deleted', { isDeleted: true }),
        transaction('already', { status: 'reconciled' }),
        transaction('otherAccount', { bankAccountId: 'other_account' }),
        transaction('otherWorkspace', { workspaceId: 'other_workspace' }),
      ]);
      const result = await reconcileBankAccountHandler(ctx, {
        ...request,
        includePending,
        reportedBalance: includePending ? 10000n : 12000n,
      });
      expect(result.adjustmentCreated).toBe(false);
      expect(result.reconciledTransactionCount).toBe(1);
      expect(db.record('transaction', 'cleared').status).toBe('reconciled');
      for (const id of ['pending', 'unreviewed', 'deleted', 'otherAccount', 'otherWorkspace']) {
        expect(db.record('transaction', id).status).toBe(id === 'pending' ? 'pending' : 'cleared');
      }
      expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(10000n);
      expect(db.record('bankAccount', bankAccountId).lastReconciledAt).toBe(result.reconciledAt);
      expect(runMutation).not.toHaveBeenCalled();
    }
  );

  it.each([
    { includePending: true, reportedBalance: 10500n, adjustment: 500n, finalCurrent: 10500n },
    { includePending: false, reportedBalance: 10500n, adjustment: -1500n, finalCurrent: 8500n },
  ])(
    'creates exactly the requested adjustment with the shared balance/RTA pipeline: $includePending',
    async ({ includePending, reportedBalance, adjustment, finalCurrent }) => {
      const { ctx, db, runMutation } = setup({}, [transaction('pending', { status: 'pending' })]);
      const result = await reconcileBankAccountHandler(ctx, {
        ...request,
        includePending,
        reportedBalance,
        allowBalanceAdjustment: true,
      });
      expect(result.balanceAdjustmentAmount).toBe(adjustment);
      expect(result.adjustmentCreated).toBe(true);
      const adjusted = db.record('bankAccount', bankAccountId);
      expect(adjusted.currentBalance).toBe(finalCurrent);
      expect(adjusted.clearedBalance).toBe(12000n + adjustment);
      expect(adjusted.pendingBalance).toBe(-2000n);
      expect(adjusted.monthlyBalances).toEqual({ '202609': adjustment });
      if (!result.balanceAdjustmentTransactionId) throw new Error('Expected an adjustment transaction');
      const created = db.record('transaction', result.balanceAdjustmentTransactionId);
      expect(created.type).toBe('balance_adjustment');
      expect(created.totalAmount).toBe(adjustment);
      expect(created.status).toBe('reconciled');
      expect(db.record('transaction', 'pending').status).toBe('pending');
      expect(runMutation).toHaveBeenCalledExactlyOnceWith(expect.anything(), { workspaceId, amountDelta: adjustment });
      // Retrying the same target after a lost response must not add a second adjustment.
      const retried = await reconcileBankAccountHandler(ctx, {
        ...request,
        includePending,
        reportedBalance,
        allowBalanceAdjustment: true,
      });
      expect(retried.adjustmentCreated).toBe(false);
      expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(finalCurrent);
    }
  );

  it('rejects a mismatch until corrected without making any financial writes', async () => {
    const { ctx, db, runMutation } = setup();
    await expect(reconcileBankAccountHandler(ctx, { ...request, reportedBalance: 10500n })).rejects.toThrow(
      'balances must match'
    );
    expect(db.record('bankAccount', bankAccountId).lastReconciledAt).toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
    await db.patch(bankAccountId, { currentBalance: 10500n, clearedBalance: 12500n });
    const result = await reconcileBankAccountHandler(ctx, { ...request, reportedBalance: 10500n });
    expect(result.adjustmentCreated).toBe(false);
  });

  it('rejects an adjustment when the displayed balance is stale', async () => {
    const { ctx, db } = setup();
    await expect(
      reconcileBankAccountHandler(ctx, {
        ...request,
        reportedBalance: 11000n,
        expectedBalance: 9999n,
        allowBalanceAdjustment: true,
      })
    ).rejects.toThrow('account balance changed');
    expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(10000n);
    expect(db.record('bankAccount', bankAccountId).lastReconciledAt).toBeUndefined();
  });

  it('derives missing cleared balances before applying the adjustment', async () => {
    const { ctx, db } = setup({ clearedBalance: undefined });
    const result = await reconcileBankAccountHandler(ctx, {
      ...request,
      includePending: false,
      reportedBalance: 13000n,
      allowBalanceAdjustment: true,
    });
    expect(result.balanceAdjustmentAmount).toBe(1000n);
    expect(db.record('bankAccount', bankAccountId).clearedBalance).toBe(13000n);
    expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(11000n);
  });

  it('handles negative liability balances and pending charges', async () => {
    const { ctx, db, runMutation } = setup({
      accountType: 'loan_other',
      currentBalance: -10000n,
      clearedBalance: -8000n,
    });
    const result = await reconcileBankAccountHandler(ctx, {
      ...request,
      includePending: false,
      reportedBalance: -8500n,
      allowBalanceAdjustment: true,
    });
    expect(result.balanceAdjustmentAmount).toBe(-500n);
    expect(db.record('bankAccount', bankAccountId).currentBalance).toBe(-10500n);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('preserves the legacy confirmation flow without a reported balance', async () => {
    const { ctx } = setup();
    const result = await reconcileBankAccountHandler(ctx, {
      workspaceId,
      bankAccountId,
      reconciliationDate: '2026-09-11',
    });
    expect(result.reportedBalance).toBe(12000n);
    expect(result.adjustmentCreated).toBe(false);
  });

  it.each([{ isClosed: true }, { isDeleted: true }, { workspaceId: 'other_workspace' }])(
    'rejects unavailable or foreign accounts: %j',
    async (account) => {
      const { ctx, db } = setup(account);
      await expect(reconcileBankAccountHandler(ctx, request)).rejects.toThrow();
      expect(db.record('bankAccount', bankAccountId).lastReconciledAt).toBeUndefined();
    }
  );

  it('rejects unauthenticated requests', async () => {
    const { ctx } = setup();
    ctx.auth.getUserIdentity = async () => null;
    await expect(reconcileBankAccountHandler(ctx, request)).rejects.toThrow();
  });

  it.each(['2026-02-30', 'invalid', '2026-9-1'])('rejects invalid dates: %s', async (reconciliationDate) => {
    const { ctx } = setup();
    await expect(reconcileBankAccountHandler(ctx, { ...request, reconciliationDate })).rejects.toThrow(
      'valid reconciliation date'
    );
  });

  it('rejects adjustments that overflow stored monetary values', async () => {
    const { ctx } = setup({ currentBalance: -(1n << 63n), clearedBalance: -(1n << 63n), pendingBalance: 0n });
    await expect(
      reconcileBankAccountHandler(ctx, {
        ...request,
        reportedBalance: (1n << 63n) - 1n,
        allowBalanceAdjustment: true,
      })
    ).rejects.toThrow('too large');
  });
});
