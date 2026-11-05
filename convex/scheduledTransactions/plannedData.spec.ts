import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { listPlannedTransactionsDataCore, populatePlannedBase, populatePlannedBases } from './plannedData';

type TableName =
  | 'scheduledTransactionSkip'
  | 'scheduledTransactionOccurrence'
  | 'scheduledTransaction'
  | 'transaction'
  | 'merchant'
  | 'globalMerchant'
  | 'bankAccount'
  | 'category';
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

  withIndex(_indexName: string, callback: (builder: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  order(_direction: 'asc' | 'desc'): FakeQuery {
    return this;
  }

  async take(limit: number): Promise<FakeRecord[]> {
    return (await this.collect()).slice(0, limit);
  }

  async collect(): Promise<FakeRecord[]> {
    return this.records.filter((record) => this.filters.every(({ field, value }) => record[field] === value));
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
    return new FakeQuery(Array.from(this.recordsByTable.get(tableName)?.values() ?? []));
  }
}

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): QueryCtx {
  const tables = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of [
    'scheduledTransactionSkip',
    'scheduledTransactionOccurrence',
    'scheduledTransaction',
    'transaction',
    'merchant',
    'globalMerchant',
    'bankAccount',
    'category',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tables.set(tableName, new Map(records.map((record) => [record._id, record])));
  }
  return { db: new FakeDb(tables) } as unknown as QueryCtx;
}

const workspaceId = 'workspace-1' as Id<'workspace'>;
const scheduledTransactionId = 'scheduled-1' as Id<'scheduledTransaction'>;
const bankAccountId = 'bank-1' as Id<'bankAccount'>;

function scheduledRecord(overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: scheduledTransactionId,
    _creationTime: 1,
    workspaceId,
    bankAccountId,
    merchantId: 'merchant-1' as Id<'merchant'>,
    entryStatus: 'pending',
    entryMode: 'manual',
    movements: [
      {
        amount: -10000n,
        categoryId: 'category-1' as Id<'category'>,
        readyToAssign: false,
      },
    ],
    recurrence: 'monthly',
    anchorDate: '2026-05-15',
    nextDate: '2026-05-15',
    status: 'active',
    executionCount: 0,
    updatedAt: '2026-07-09T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function transactionRecord(
  id: string,
  totalAmount: bigint,
  date: string,
  overrides: Partial<FakeRecord> = {}
): FakeRecord {
  return {
    _id: id as Id<'transaction'>,
    _creationTime: 2,
    scheduledTransactionId,
    workspaceId,
    scheduledOccurrenceDate: date,
    type: 'regular',
    totalAmount,
    date,
    isDeleted: false,
    ...overrides,
  };
}

function relatedRecords(): Pick<Partial<Record<TableName, FakeRecord[]>>, 'merchant' | 'bankAccount' | 'category'> {
  return {
    merchant: [{ _id: 'merchant-1', _creationTime: 3, workspaceId, name: 'Rent' }],
    bankAccount: [{ _id: bankAccountId, _creationTime: 4, workspaceId, name: 'Checking' }],
    category: [{ _id: 'category-1', _creationTime: 5, workspaceId, name: 'Housing' }],
  };
}

describe('listPlannedTransactionsDataCore', () => {
  it('resolves merchant artwork and respects explicit logo removal and icon preferences', async () => {
    for (const [overrides, expected] of [
      [{}, 'https://example.com/global.png'],
      [{ logoUrl: 'https://example.com/custom.png' }, 'https://example.com/custom.png'],
      [{ logoUrl: null }, null],
      [{ visualIdentityMode: 'icon' }, null],
    ] as const) {
      const ctx = createTestContext({
        ...relatedRecords(),
        scheduledTransaction: [scheduledRecord()],
        merchant: [{ _id: 'merchant-1', _creationTime: 3, workspaceId, globalMerchantId: 'global-1', ...overrides }],
        globalMerchant: [
          { _id: 'global-1', _creationTime: 4, name: 'Merchant', logoUrl: 'https://example.com/global.png' },
        ],
      });
      const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);
      expect(result.allPlannedTransactions[0]).toMatchObject({ merchantName: 'Merchant', merchantLogoUrl: expected });
    }
  });

  it('classifies past and future occurrences and builds populated monthly summaries', async () => {
    const ctx = createTestContext({
      scheduledTransaction: [scheduledRecord()],
      ...relatedRecords(),
    });

    const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);

    expect(result.availableRange).toEqual({ minYearMonth: 202605, maxYearMonth: 202608 });
    expect(result.plannedByMonth[202605]?.map((entry) => entry.coverage.status)).toEqual(['overdue']);
    expect(result.plannedByMonth[202606]?.map((entry) => entry.coverage.status)).toEqual(['overdue']);
    expect(result.plannedByMonth[202607]?.map((entry) => entry.coverage.status)).toEqual(['upcoming']);
    expect(result.plannedByMonth[202608]?.map((entry) => entry.coverage.status)).toEqual(['upcoming']);

    expect(result.allPlannedTransactions[0]).toMatchObject({
      merchantName: 'Rent',
      bankAccountName: 'Checking',
      totalAmount: -10000n,
      movements: [{ categoryName: 'Housing' }],
    });
    expect(result.monthlySummaries[202607]?.outflow).toEqual({
      totalExpected: 10000n,
      totalPaid: 0n,
      totalRemaining: 10000n,
      percentPaid: 0,
      count: 1,
      paidCount: 0,
    });
  });

  it('shows linked history for paused schedules without synthesizing unentered occurrences', async () => {
    const ctx = createTestContext({
      scheduledTransaction: [scheduledRecord({ status: 'paused' })],
      transaction: [
        transactionRecord('transaction-paid', -12000n, '2026-07-03'),
        transactionRecord('transaction-deleted', -13000n, '2026-07-04', { isDeleted: true }),
      ],
      ...relatedRecords(),
    });

    const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);

    expect(result.plannedByMonth[202605]).toBeUndefined();
    expect(result.plannedByMonth[202606]).toBeUndefined();
    expect(result.plannedByMonth[202607]).toHaveLength(1);
    expect(result.plannedByMonth[202607]?.[0]).toMatchObject({
      occurrenceDate: '2026-07-03',
      displayDate: '2026-07-03',
      coverage: {
        status: 'paid',
        expectedAmount: -12000n,
        paidAmount: 12000n,
        linkedTransactions: [{ transactionId: 'transaction-paid', amount: -12000n, date: '2026-07-03' }],
      },
    });
    expect(result.monthlySummaries[202607]?.outflow).toMatchObject({
      totalExpected: 12000n,
      totalPaid: 12000n,
      totalRemaining: 0n,
      percentPaid: 100,
      count: 1,
      paidCount: 1,
    });
  });

  it('keeps one source-side history row for transfers and excludes it from cash-flow summaries', async () => {
    const destinationAccountId = 'bank-2' as Id<'bankAccount'>;
    const ctx = createTestContext({
      scheduledTransaction: [
        scheduledRecord({
          transactionType: 'transfer',
          transferToAccountId: destinationAccountId,
          merchantId: undefined,
          movements: [{ amount: 25000n }],
          recurrence: 'once',
          anchorDate: '2026-07-03',
          nextDate: '2026-07-03',
          status: 'completed',
        }),
      ],
      transaction: [
        transactionRecord('transfer-source', -25000n, '2026-07-03', { type: 'transfer' }),
        transactionRecord('transfer-destination', 25000n, '2026-07-03', { type: 'transfer' }),
      ],
      bankAccount: [
        { _id: bankAccountId, _creationTime: 4, workspaceId, name: 'Checking' },
        { _id: destinationAccountId, workspaceId, _creationTime: 5, name: 'Savings' },
      ],
    });

    const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 0);

    expect(result.plannedByMonth[202607]).toHaveLength(1);
    expect(result.plannedByMonth[202607]?.[0]).toMatchObject({
      isTransfer: true,
      coverage: {
        status: 'paid',
        paidAmount: 25000n,
        linkedTransactions: [{ transactionId: 'transfer-source' }],
      },
    });
    expect(result.allPlannedTransactions[0]).toMatchObject({
      transferToAccountName: 'Savings',
      totalAmount: 25000n,
    });
    expect(result.monthlySummaries[202607]).toMatchObject({
      inflow: { totalExpected: 0n, totalPaid: 0n, count: 0 },
      outflow: { totalExpected: 0n, totalPaid: 0n, count: 0 },
    });
  });
});

describe('explicit skip history', () => {
  it('retains a skipped one-time plan after completion without counting it as due', async () => {
    const ctx = createTestContext({
      scheduledTransaction: [scheduledRecord({ recurrence: 'once', status: 'completed' })],
      scheduledTransactionSkip: [
        {
          _id: 'skip-1',
          _creationTime: 1,
          workspaceId,
          scheduledTransactionId,
          occurrenceDate: '2026-07-10',
          expectedAmount: -10000n,
          isTransfer: false,
          isDeleted: false,
        },
      ],
      ...relatedRecords(),
    });
    const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);
    expect(result.plannedByMonth[202607]).toMatchObject([
      { displayDate: '2026-07-10', coverage: { status: 'skipped', expectedAmount: -10000n } },
    ]);
    expect(result.monthlySummaries[202607].outflow.totalRemaining).toBe(0n);
    expect(result.skippedHistoryTruncated).toBe(false);
  });

  it('scopes skips to the workspace and excludes deleted parents and skip records', async () => {
    const skip = {
      _id: 'skip-1',
      _creationTime: 1,
      workspaceId,
      scheduledTransactionId,
      occurrenceDate: '2026-07-10',
      expectedAmount: -10000n,
      isTransfer: false,
      isDeleted: false,
    };
    for (const overrides of [
      { workspaceId: 'other-workspace' },
      { scheduledTransactionId: 'deleted-plan' },
      { isDeleted: true },
    ]) {
      const ctx = createTestContext({
        scheduledTransaction: [scheduledRecord({ status: 'completed' })],
        scheduledTransactionSkip: [{ ...skip, ...overrides }],
      });
      const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);
      expect(result.plannedByMonth[202607]).toBeUndefined();
    }
  });

  it("keeps an explicit skip alongside a repeating schedule's next occurrence", async () => {
    const ctx = createTestContext({
      scheduledTransaction: [scheduledRecord({ nextDate: '2026-08-15' })],
      scheduledTransactionSkip: [
        {
          _id: 'skip-1',
          _creationTime: 1,
          workspaceId,
          scheduledTransactionId,
          occurrenceDate: '2026-07-15',
          expectedAmount: -10000n,
          isTransfer: false,
          isDeleted: false,
        },
      ],
    });
    const result = await listPlannedTransactionsDataCore(ctx, workspaceId, '2026-07-09', 1);
    expect(result.plannedByMonth[202607][0].coverage.status).toBe('skipped');
    expect(result.plannedByMonth[202608][0].coverage.status).toBe('upcoming');
  });
});

describe('planned schedule relations', () => {
  it('reads shared schedule relations once across plans and split movements', async () => {
    const merchantId = 'merchant' as Id<'merchant'>;
    const categoryId = 'category' as Id<'category'>;
    const records = new Map<string, unknown>([
      [bankAccountId, { _id: bankAccountId, workspaceId, name: 'Checking' }],
      ['merchant', { _id: 'merchant', workspaceId, globalMerchantId: 'global' }],
      ['global', { _id: 'global', name: 'Global merchant', logoUrl: 'https://example.com/logo.png' }],
      ['category', { _id: 'category', workspaceId, name: 'Food' }],
    ]);
    const get = vi.fn(async (id: string) => records.get(id) ?? null);
    const schedules = Array.from({ length: 100 }, (_, index) =>
      scheduledRecord({
        _id: `plan-${index}` as Id<'scheduledTransaction'>,
        merchantId,
        movements: [
          { amount: -100n, categoryId },
          { amount: -200n, categoryId },
        ],
      })
    );
    const result = await populatePlannedBases(
      { db: { get } } as unknown as QueryCtx,
      schedules as unknown as Doc<'scheduledTransaction'>[]
    );
    expect(get).toHaveBeenCalledTimes(4);
    expect(result.map((plan) => plan._id)).toEqual(schedules.map((plan) => plan._id));
    expect(result[0]).toMatchObject({
      bankAccountName: 'Checking',
      merchantName: 'Global merchant',
      merchantLogoUrl: 'https://example.com/logo.png',
      totalAmount: -300n,
      movements: [
        { categoryName: 'Food', amount: -100n },
        { categoryName: 'Food', amount: -200n },
      ],
    });
  });

  it('does not expose related names or logos from a foreign workspace', async () => {
    const foreign = {
      workspaceId: 'foreign',
      name: 'Private name',
      logoUrl: 'https://private.example/logo.png',
      globalMerchantId: 'global',
    };
    const get = vi.fn(async () => foreign);
    const result = await populatePlannedBase(
      { db: { get } } as unknown as QueryCtx,
      scheduledRecord({
        merchantId: 'merchant' as Id<'merchant'>,
        transferToAccountId: 'other' as Id<'bankAccount'>,
        movements: [{ amount: -100n, categoryId: 'category' as Id<'category'> }],
      }) as unknown as Doc<'scheduledTransaction'>
    );
    expect(result.merchantName).toBeUndefined();
    expect(result.merchantLogoUrl).toBeNull();
    expect(result.bankAccountName).toBeUndefined();
    expect(result.transferToAccountName).toBeUndefined();
    expect(result.movements[0].categoryName).toBeUndefined();
    expect(get).not.toHaveBeenCalledWith('global');
  });
});

describe('planned-only calendar data', () => {
  it('reads transaction history only by schedule link and ignores ordinary transaction edits', async () => {
    const paid = transactionRecord('paid', -10000n, '2026-07-08');
    const records = { scheduledTransaction: [scheduledRecord({ nextDate: '2026-07-15' })], ...relatedRecords() };
    const index = vi.spyOn(FakeQuery.prototype, 'withIndex');
    try {
      const before = await listPlannedTransactionsDataCore(
        createTestContext({ ...records, transaction: [paid] }),
        workspaceId,
        '2026-07-09',
        1
      );
      const after = await listPlannedTransactionsDataCore(
        createTestContext({
          ...records,
          transaction: [
            paid,
            transactionRecord('ordinary', -999n, '2026-07-09', { scheduledTransactionId: undefined }),
          ],
        }),
        workspaceId,
        '2026-07-09',
        1
      );
      expect(after).toEqual(before);
      expect(before.plannedByMonth[202607].map((entry) => entry.coverage.status)).toEqual(['paid', 'upcoming']);
      const indexes = index.mock.calls.map(([name]) => name);
      expect(indexes.filter((name) => name === 'by_scheduledTransactionId')).toHaveLength(2);
      expect(indexes).not.toContain('by_workspaceId_isDeleted_date');
    } finally {
      index.mockRestore();
    }
  });

  it('updates paid history after a linked transaction is edited or deleted', async () => {
    const read = (transaction: FakeRecord) =>
      listPlannedTransactionsDataCore(
        createTestContext({
          scheduledTransaction: [scheduledRecord({ nextDate: '2026-07-15' })],
          transaction: [transaction],
          ...relatedRecords(),
        }),
        workspaceId,
        '2026-07-09',
        1
      );
    const edited = await read(transactionRecord('paid', -12500n, '2026-07-07'));
    expect(edited.plannedByMonth[202607][0]).toMatchObject({
      displayDate: '2026-07-07',
      coverage: { status: 'paid', paidAmount: 12500n },
    });
    const deleted = await read(transactionRecord('paid', -12500n, '2026-07-07', { isDeleted: true }));
    expect(deleted.plannedByMonth[202607].map((entry) => entry.coverage.status)).toEqual(['upcoming']);
  });
});

describe('planned occurrence identity', () => {
  const dueDate = '2026-09-16';
  const schedule = (overrides: Partial<FakeRecord> = {}) =>
    scheduledRecord({
      anchorDate: dueDate,
      nextDate: '2026-10-16',
      nextUnprocessedDate: '2026-10-16',
      scheduleRevision: 0,
      executionCount: 1,
      ...overrides,
    });
  const occurrence = (date: string, overrides: Partial<FakeRecord> = {}): FakeRecord => ({
    _id: `occurrence-${date}`,
    _creationTime: 1,
    workspaceId,
    scheduledTransactionId,
    scheduleRevision: 0,
    occurrenceDate: date,
    expectedAmount: -10000n,
    isTransfer: false,
    status: 'paid',
    updatedAt: '2026-09-16T12:00:00.000Z',
    ...overrides,
  });
  const read = (records: Partial<Record<TableName, FakeRecord[]>>, today = dueDate) =>
    listPlannedTransactionsDataCore(createTestContext(records), workspaceId, today, 2);

  it('keeps early and edited payments on their original due date across month boundaries', async () => {
    const result = await read({
      scheduledTransaction: [schedule()],
      scheduledTransactionOccurrence: [occurrence(dueDate)],
      transaction: [transactionRecord('early', -12000n, '2026-08-30', { scheduledOccurrenceDate: dueDate })],
    });
    expect(result.plannedByMonth[202608]).toBeUndefined();
    expect(result.plannedByMonth[202609]).toMatchObject([
      {
        occurrenceDate: dueDate,
        displayDate: dueDate,
        coverage: {
          expectedAmount: -10000n,
          paidAmount: 12000n,
          linkedTransactions: [{ date: '2026-08-30' }],
        },
      },
    ]);
    expect(result.plannedByMonth[202610]).toMatchObject([
      { occurrenceDate: '2026-10-16', coverage: { status: 'upcoming' } },
    ]);
  });

  it('counts multiple payments once and excludes deleted and foreign transactions', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ nextDate: dueDate, nextUnprocessedDate: dueDate })],
      transaction: [
        transactionRecord('first', -3000n, dueDate),
        transactionRecord('second', -7000n, '2026-09-17', { scheduledOccurrenceDate: dueDate }),
        transactionRecord('deleted', -10000n, dueDate, { isDeleted: true }),
        transactionRecord('foreign', -10000n, dueDate, { workspaceId: 'foreign' }),
      ],
    });
    expect(result.plannedByMonth[202609]).toHaveLength(1);
    expect(result.plannedByMonth[202609][0].coverage).toMatchObject({ status: 'paid', paidAmount: 10000n });
    expect(result.plannedByMonth[202609][0].coverage.linkedTransactions).toHaveLength(2);
    expect(result.monthlySummaries[202609].outflow).toMatchObject({ paidCount: 1, count: 1, totalPaid: 10000n });
  });

  it('keeps historical expense direction when the current template becomes income', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ movements: [{ amount: 10000n }] })],
      scheduledTransactionOccurrence: [occurrence(dueDate)],
      transaction: [transactionRecord('payment', -10000n, dueDate)],
    });
    expect(result.monthlySummaries[202609].outflow.totalPaid).toBe(10000n);
    expect(result.monthlySummaries[202609].inflow.totalPaid).toBe(0n);
    expect(result.monthlySummaries[202610].inflow.totalExpected).toBe(10000n);
  });

  it('keeps legacy income history when the template becomes a transfer', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ transactionType: 'transfer', movements: [{ amount: 10000n }] })],
      transaction: [transactionRecord('income', 12000n, dueDate, { scheduledOccurrenceDate: undefined })],
    });

    expect(result.plannedByMonth[202609]).toMatchObject([
      { isTransfer: false, coverage: { status: 'paid', paidAmount: 12000n } },
    ]);
    expect(result.monthlySummaries[202609].inflow.totalPaid).toBe(12000n);
  });

  it.each([undefined, 0])(
    're-dating onto a retired skipped date makes the new occurrence due (skip revision %s)',
    async (skipRevision) => {
      const newDate = '2026-10-16';
      const result = await read({
        scheduledTransaction: [schedule({ anchorDate: newDate, scheduleRevision: 1 })],
        scheduledTransactionOccurrence: [occurrence(newDate, { status: 'skipped' })],
        scheduledTransactionSkip: [{ ...occurrence(newDate), scheduleRevision: skipRevision, isDeleted: false }],
      });

      expect(result.plannedByMonth[202610]).toMatchObject([
        { occurrenceDate: newDate, coverage: { status: 'upcoming' } },
      ]);
      expect(result.plannedByMonth[202610]).toHaveLength(1);
      expect(result.monthlySummaries[202610].outflow.totalRemaining).toBe(10000n);
    }
  );

  it('keeps paid history before the revised series and leaves its reused due date unpaid', async () => {
    const newDate = '2026-10-16';
    const result = await read({
      scheduledTransaction: [schedule({ anchorDate: newDate, scheduleRevision: 1 })],
      scheduledTransactionOccurrence: [occurrence(dueDate), occurrence(newDate)],
      transaction: [
        transactionRecord('september', -10000n, dueDate, { scheduledOccurrenceRevision: 0 }),
        transactionRecord('old-october', -10000n, newDate, { scheduledOccurrenceRevision: 0 }),
      ],
    });

    expect(result.plannedByMonth[202609]).toMatchObject([{ coverage: { status: 'paid' } }]);
    expect(result.plannedByMonth[202610]).toMatchObject([{ coverage: { status: 'upcoming' } }]);
    expect(result.plannedByMonth[202610]).toHaveLength(1);
    expect(result.monthlySummaries[202610].outflow.totalPaid).toBe(0n);
  });

  it('counts only the current revision payment when both series have the same due date', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ scheduleRevision: 1 })],
      scheduledTransactionOccurrence: [
        occurrence(dueDate),
        occurrence(dueDate, { _id: 'new-occurrence', scheduleRevision: 1 }),
      ],
      transaction: [
        transactionRecord('old-payment', -10000n, dueDate, { scheduledOccurrenceRevision: 0 }),
        transactionRecord('new-payment', -12000n, dueDate, { scheduledOccurrenceRevision: 1 }),
      ],
    });

    expect(result.plannedByMonth[202609]).toHaveLength(1);
    expect(result.plannedByMonth[202609][0].coverage).toMatchObject({
      status: 'paid',
      paidAmount: 12000n,
      linkedTransactions: [{ transactionId: 'new-payment' }],
    });
  });

  it('retains explicit skip history from the current revision', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ scheduleRevision: 1 })],
      scheduledTransactionSkip: [{ ...occurrence(dueDate), scheduleRevision: 1, isDeleted: false }],
      transaction: [transactionRecord('old-payment', -10000n, dueDate, { scheduledOccurrenceRevision: 0 })],
    });

    expect(result.plannedByMonth[202609]).toMatchObject([{ coverage: { status: 'skipped' } }]);
    expect(result.plannedByMonth[202609]).toHaveLength(1);
  });

  it('reopens the deleted occurrence without duplicating a later paid occurrence', async () => {
    const result = await read(
      {
        scheduledTransaction: [schedule({ nextDate: dueDate, nextUnprocessedDate: '2026-11-16' })],
        scheduledTransactionOccurrence: [
          occurrence(dueDate, { status: 'pending', manualOnly: true }),
          occurrence('2026-10-16'),
        ],
        transaction: [
          transactionRecord('deleted', -10000n, dueDate, { isDeleted: true }),
          transactionRecord('october', -10000n, '2026-10-16'),
        ],
      },
      '2026-10-17'
    );
    expect(result.plannedByMonth[202609]).toMatchObject([{ occurrenceDate: dueDate, coverage: { status: 'overdue' } }]);
    expect(result.plannedByMonth[202610]).toMatchObject([
      { occurrenceDate: '2026-10-16', coverage: { status: 'paid' } },
    ]);
    expect(result.plannedByMonth[202611]).toMatchObject([
      { occurrenceDate: '2026-11-16', coverage: { status: 'upcoming' } },
    ]);
  });

  it('preserves reopened history outside the synthesis window and ignores prior-revision pending bills', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ scheduleRevision: 1 })],
      scheduledTransactionOccurrence: [
        occurrence('2020-09-16', { status: 'pending', scheduleRevision: 1 }),
        occurrence('2020-08-16', { status: 'pending' }),
        occurrence('2020-07-16', { status: 'skipped' }),
      ],
    });
    expect(result.plannedByMonth[202009]).toMatchObject([{ coverage: { status: 'overdue' } }]);
    expect(result.plannedByMonth[202008]).toBeUndefined();
    expect(result.plannedByMonth[202007]).toMatchObject([{ coverage: { status: 'skipped' } }]);
  });

  it('shows an explicitly skipped instance once and never synthesizes it as unpaid', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ nextDate: dueDate, nextUnprocessedDate: dueDate })],
      scheduledTransactionOccurrence: [occurrence(dueDate, { status: 'skipped' })],
      scheduledTransactionSkip: [{ ...occurrence(dueDate), isDeleted: false }],
    });
    expect(result.plannedByMonth[202609]).toHaveLength(1);
    expect(result.plannedByMonth[202609][0].coverage.status).toBe('skipped');
    expect(result.monthlySummaries[202609].outflow.totalRemaining).toBe(0n);
  });

  it('infers an old transaction occurrence without using its payment date as the due date', async () => {
    const result = await read({
      scheduledTransaction: [schedule({ anchorDate: '2026-01-16' })],
      transaction: [transactionRecord('legacy', -10000n, '2026-09-14', { scheduledOccurrenceDate: undefined })],
    });
    expect(result.plannedByMonth[202609]).toMatchObject([{ occurrenceDate: dueDate, coverage: { status: 'paid' } }]);
  });

  it('reaches today and future dates for a daily schedule ignored for years', async () => {
    const result = await read({
      scheduledTransaction: [
        schedule({
          recurrence: 'daily',
          anchorDate: '2020-01-01',
          nextDate: '2020-01-01',
          nextUnprocessedDate: undefined,
        }),
      ],
    });
    expect(result.unenteredHistoryTruncated).toBe(true);
    const entries = Object.values(result.plannedByMonth).flat();
    expect(entries.find((entry) => entry.occurrenceDate === dueDate)?.coverage.status).toBe('upcoming');
    expect(entries.find((entry) => entry.occurrenceDate === '2026-09-15')?.coverage.status).toBe('overdue');
    expect(entries.some((entry) => entry.coverage.status === 'skipped')).toBe(false);
    expect(entries.every((entry) => entry.coverage.status !== 'upcoming' || entry.occurrenceDate >= dueDate)).toBe(
      true
    );
    expect(result.plannedByMonth[202611]).toHaveLength(30);
  });

  it('retains a one-time unpaid bill older than the synthesis window', async () => {
    const result = await read({
      scheduledTransaction: [
        schedule({
          recurrence: 'once',
          anchorDate: '2020-01-01',
          nextDate: '2020-01-01',
          nextUnprocessedDate: undefined,
        }),
      ],
    });
    expect(result.plannedByMonth[202001]).toMatchObject([
      { occurrenceDate: '2020-01-01', coverage: { status: 'overdue' } },
    ]);
  });
});
