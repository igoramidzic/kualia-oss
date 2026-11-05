import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { deleteMerchantImpl } from './delete';

type FakeRecord = Record<string, unknown> & { _id: string };
type TableName = 'transaction' | 'scheduledTransaction';
type FakeFilter = { field: string; value: unknown };
type MerchantStats = Record<string, { totalAmount: bigint; transactionCount: bigint }>;
type MerchantDirectionalStats = Record<
  string,
  { inflowAmount: bigint; outflowAmount: bigint; inflowCount: bigint; outflowCount: bigint }
>;

const workspaceId = 'workspace_1' as Id<'workspace'>;
const otherWorkspaceId = 'workspace_2' as Id<'workspace'>;
const sourceMerchantId = 'merchant_source' as Id<'merchant'>;
const targetMerchantId = 'merchant_target' as Id<'merchant'>;

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeFilterBuilder {
  readonly filters: FakeFilter[] = [];

  field(fieldName: string): string {
    return fieldName;
  }

  eq(field: string, value: unknown): FakeFilterBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  private readonly filters: FakeFilter[];

  constructor(
    private readonly records: FakeRecord[],
    filters: FakeFilter[]
  ) {
    this.filters = [...filters];
  }

  filter(callback: (q: FakeFilterBuilder) => FakeFilterBuilder): FakeQuery {
    const builder = new FakeFilterBuilder();
    callback(builder);
    this.filters.push(...builder.filters);
    return this;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.records.filter((record) => this.filters.every((filter) => record[filter.field] === filter.value));
  }
}

class FakeDb {
  constructor(
    private readonly merchants: Map<string, FakeRecord>,
    private readonly transactions: Map<string, FakeRecord>,
    private readonly scheduledTransactions: Map<string, FakeRecord>
  ) {}

  async get(id: string): Promise<FakeRecord | null> {
    return this.merchants.get(id) ?? this.transactions.get(id) ?? this.scheduledTransactions.get(id) ?? null;
  }

  query(tableName: TableName): {
    withIndex: (indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder) => FakeQuery;
  } {
    const records =
      tableName === 'transaction'
        ? Array.from(this.transactions.values())
        : Array.from(this.scheduledTransactions.values());

    return {
      withIndex: (_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery => {
        const builder = new FakeIndexBuilder();
        callback(builder);
        return new FakeQuery(records, builder.filters);
      },
    };
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Missing fake record: ${id}`);
    }

    Object.assign(record, updates);
  }

  record(id: string): FakeRecord {
    const record = this.merchants.get(id) ?? this.transactions.get(id) ?? this.scheduledTransactions.get(id);
    if (!record) {
      throw new Error(`Missing fake record: ${id}`);
    }
    return record;
  }
}

function createTestContext({
  merchants,
  transactions = [],
  scheduledTransactions = [],
}: {
  merchants: FakeRecord[];
  transactions?: FakeRecord[];
  scheduledTransactions?: FakeRecord[];
}): { ctx: MutationCtx; db: FakeDb } {
  const db = new FakeDb(
    new Map(merchants.map((merchant) => [merchant._id, merchant])),
    new Map(transactions.map((transaction) => [transaction._id, transaction])),
    new Map(scheduledTransactions.map((scheduledTransaction) => [scheduledTransaction._id, scheduledTransaction]))
  );

  return { ctx: { db } as unknown as MutationCtx, db };
}

function merchantRecord(
  id: Id<'merchant'>,
  merchantWorkspaceId: Id<'workspace'>,
  overrides: Partial<FakeRecord> = {}
): FakeRecord {
  return {
    _id: id,
    workspaceId: merchantWorkspaceId,
    name: id === targetMerchantId ? 'Target Coffee' : 'Source Coffee',
    isDeleted: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function transactionRecord(id: string, merchantId: Id<'merchant'>, isDeleted = false): FakeRecord {
  return {
    _id: id,
    workspaceId,
    merchantId,
    isDeleted,
    movements: [{ categoryName: 'Dining' }],
    totalAmount: -1250n,
    type: 'regular',
    notes: 'Latte',
    searchText: 'sourcecoffee dining 1250 latte',
  };
}

function scheduledTransactionRecord(id: string, merchantId: Id<'merchant'>, isDeleted = false): FakeRecord {
  return {
    _id: id,
    workspaceId,
    merchantId,
    isDeleted,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('deleteMerchantImpl', () => {
  it('directly soft deletes a merchant with no active references', async () => {
    const { ctx, db } = createTestContext({
      merchants: [merchantRecord(sourceMerchantId, workspaceId)],
    });

    const result = await deleteMerchantImpl(ctx, { workspaceId, merchantId: sourceMerchantId });

    expect(result).toEqual({
      success: true,
      movedTransactionCount: 0,
      updatedRecurringTransactionCount: 0,
    });
    expect(db.record(sourceMerchantId).isDeleted).toBe(true);
    expect(typeof db.record(sourceMerchantId).deletedAt).toBe('string');
  });

  it('requires a target merchant when active transactions exist', async () => {
    const { ctx } = createTestContext({
      merchants: [merchantRecord(sourceMerchantId, workspaceId)],
      transactions: [transactionRecord('transaction_1', sourceMerchantId)],
    });

    await expect(deleteMerchantImpl(ctx, { workspaceId, merchantId: sourceMerchantId })).rejects.toThrow(
      'choose another merchant'
    );
  });

  it('requires a target merchant when active planned templates exist', async () => {
    const { ctx } = createTestContext({
      merchants: [merchantRecord(sourceMerchantId, workspaceId)],
      scheduledTransactions: [scheduledTransactionRecord('scheduled_1', sourceMerchantId)],
    });

    await expect(deleteMerchantImpl(ctx, { workspaceId, merchantId: sourceMerchantId })).rejects.toThrow(
      'choose another merchant'
    );
  });

  it('moves active references, merges stats, and soft deletes the source merchant', async () => {
    const { ctx, db } = createTestContext({
      merchants: [
        merchantRecord(sourceMerchantId, workspaceId, {
          monthlyStats: {
            '202601': { totalAmount: -1250n, transactionCount: 1n },
          },
          monthlyDirectionalStats: {
            '202601': { inflowAmount: 0n, outflowAmount: 1250n, inflowCount: 0n, outflowCount: 1n },
          },
        }),
        merchantRecord(targetMerchantId, workspaceId, {
          monthlyStats: {
            '202601': { totalAmount: -500n, transactionCount: 2n },
            '202602': { totalAmount: -750n, transactionCount: 1n },
          },
          monthlyDirectionalStats: {
            '202601': { inflowAmount: 200n, outflowAmount: 700n, inflowCount: 1n, outflowCount: 2n },
            '202602': { inflowAmount: 0n, outflowAmount: 750n, inflowCount: 0n, outflowCount: 1n },
          },
        }),
      ],
      transactions: [transactionRecord('transaction_1', sourceMerchantId)],
      scheduledTransactions: [scheduledTransactionRecord('scheduled_1', sourceMerchantId)],
    });

    const result = await deleteMerchantImpl(ctx, {
      workspaceId,
      merchantId: sourceMerchantId,
      targetMerchantId,
    });

    expect(result).toEqual({
      success: true,
      movedTransactionCount: 1,
      updatedRecurringTransactionCount: 1,
    });
    expect(db.record('transaction_1').merchantId).toBe(targetMerchantId);
    expect(db.record('transaction_1').searchText).toContain('targetcoffee');
    expect(db.record('scheduled_1').merchantId).toBe(targetMerchantId);
    expect(db.record(sourceMerchantId).isDeleted).toBe(true);

    const targetStats = db.record(targetMerchantId).monthlyStats as MerchantStats;
    expect(targetStats['202601']).toEqual({ totalAmount: -1750n, transactionCount: 3n });
    expect(targetStats['202602']).toEqual({ totalAmount: -750n, transactionCount: 1n });
    const targetDirectionalStats = db.record(targetMerchantId).monthlyDirectionalStats as MerchantDirectionalStats;
    expect(targetDirectionalStats['202601']).toEqual({
      inflowAmount: 200n,
      outflowAmount: 1950n,
      inflowCount: 1n,
      outflowCount: 3n,
    });
    expect(targetDirectionalStats['202602']).toEqual({
      inflowAmount: 0n,
      outflowAmount: 750n,
      inflowCount: 0n,
      outflowCount: 1n,
    });
  });

  it('rejects a target merchant from another workspace', async () => {
    const { ctx } = createTestContext({
      merchants: [merchantRecord(sourceMerchantId, workspaceId), merchantRecord(targetMerchantId, otherWorkspaceId)],
      transactions: [transactionRecord('transaction_1', sourceMerchantId)],
    });

    await expect(
      deleteMerchantImpl(ctx, {
        workspaceId,
        merchantId: sourceMerchantId,
        targetMerchantId,
      })
    ).rejects.toThrow('Target merchant not found');
  });

  it('rejects a deleted target merchant', async () => {
    const { ctx } = createTestContext({
      merchants: [
        merchantRecord(sourceMerchantId, workspaceId),
        merchantRecord(targetMerchantId, workspaceId, { isDeleted: true }),
      ],
      transactions: [transactionRecord('transaction_1', sourceMerchantId)],
    });

    await expect(
      deleteMerchantImpl(ctx, {
        workspaceId,
        merchantId: sourceMerchantId,
        targetMerchantId,
      })
    ).rejects.toThrow('Target merchant not found');
  });

  it('rejects using the source merchant as the target', async () => {
    const { ctx } = createTestContext({
      merchants: [merchantRecord(sourceMerchantId, workspaceId)],
    });

    await expect(
      deleteMerchantImpl(ctx, {
        workspaceId,
        merchantId: sourceMerchantId,
        targetMerchantId: sourceMerchantId,
      })
    ).rejects.toThrow('itself');
  });
});
