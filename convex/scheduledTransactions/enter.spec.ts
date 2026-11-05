import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createRegularTransactionImpl } from '../transactions/mutations/createRegular';
import { createTransferTransactionImpl } from '../transactions/mutations/createTransfer';
import { enterScheduledTransaction } from './enter';

vi.mock('../transactions/mutations/createRegular', () => ({
  createRegularTransactionImpl: vi.fn(),
}));

vi.mock('../transactions/mutations/createTransfer', () => ({
  createTransferTransactionImpl: vi.fn(),
}));

const createRegularMock = vi.mocked(createRegularTransactionImpl);
const createTransferMock = vi.mocked(createTransferTransactionImpl);

const transactionId = 'transaction-1' as Id<'transaction'>;
const transferPairTransactionId = 'transaction-2' as Id<'transaction'>;

function scheduledRecord(overrides: Partial<Doc<'scheduledTransaction'>> = {}): Doc<'scheduledTransaction'> {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: 1,
    workspaceId: 'workspace-1' as Id<'workspace'>,
    transactionType: 'regular',
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    merchantId: 'merchant-1' as Id<'merchant'>,
    notes: 'Monthly bill',
    entryStatus: 'pending',
    entryMode: 'auto',
    movements: [
      {
        amount: -5000n,
        categoryId: 'category-1' as Id<'category'>,
        readyToAssign: false,
      },
    ],
    recurrence: 'monthly',
    anchorDate: '2026-05-15',
    nextDate: '2026-05-15',
    status: 'active',
    executionCount: 0,
    reminderEnabled: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function createContext(scheduled = scheduledRecord()) {
  const transfer = scheduled.transactionType === 'transfer';
  const records = new Map<string, Record<string, unknown>>([
    [scheduled._id, { ...scheduled }],
    [scheduled.workspaceId, { timezone: 'UTC' }],
    [
      transactionId,
      {
        _id: transactionId,
        workspaceId: scheduled.workspaceId,
        type: transfer ? 'transfer' : 'regular',
        totalAmount: -5000n,
        transferPairId: transfer ? transferPairTransactionId : undefined,
      },
    ],
    [
      transferPairTransactionId,
      {
        _id: transferPairTransactionId,
        workspaceId: scheduled.workspaceId,
        type: 'transfer',
        totalAmount: 5000n,
        transferPairId: transactionId,
      },
    ],
  ]);
  const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
    records.set(id, { ...records.get(id), ...value });
  });
  return {
    ctx: {
      db: {
        patch,
        get: async (id: string) => records.get(id) ?? null,
        query: (table: string) => queryRecords(records.values(), table),
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = `${table}-${records.size}`;
          records.set(id, { ...value, _id: id, _creationTime: 1 });
          return id;
        },
      },
    } as unknown as MutationCtx,
    patch,
    records,
  };
}

describe('enterScheduledTransaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'));
    vi.clearAllMocks();
    createRegularMock.mockResolvedValue(transactionId);
    createTransferMock.mockResolvedValue({
      fromTransactionId: transactionId,
      toTransactionId: transferPairTransactionId,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('materializes a one-time regular schedule and marks it completed', async () => {
    const scheduled = scheduledRecord({ recurrence: 'once' });
    const { ctx, records } = createContext(scheduled);

    const result = await enterScheduledTransaction(ctx, scheduled, {
      date: '2026-05-15',
      timezone: 'UTC',
      reviewStatus: 'reviewed',
      advance: 'single',
    });

    expect(createRegularMock).toHaveBeenCalledWith(ctx, {
      workspaceId: scheduled.workspaceId,
      bankAccountId: scheduled.bankAccountId,
      date: '2026-05-15',
      movements: scheduled.movements,
      merchantId: scheduled.merchantId,
      notes: scheduled.notes,
      status: 'pending',
      source: 'scheduled',
      reviewStatus: 'reviewed',
      scheduledTransactionId: scheduled._id,
    });
    expect(records.get(scheduled._id)).toMatchObject({
      executionCount: 1,
      lastEnteredAt: '2026-07-09T12:00:00.000Z',
      lastEnteredTransactionId: transactionId,
      status: 'completed',
      nextRunAt: undefined,
      nextReminderAt: undefined,
    });
    expect(result).toEqual({ transactionId, transferPairTransactionId: undefined, status: 'completed' });
  });

  it('records one overdue occurrence and preserves the next unpaid bill', async () => {
    const scheduled = scheduledRecord();
    const { ctx, records } = createContext(scheduled);

    const result = await enterScheduledTransaction(ctx, scheduled, {
      date: '2026-05-15',
      timezone: 'UTC',
      reviewStatus: 'reviewed',
      advance: 'past_today',
    });

    expect(result).toEqual({
      transactionId,
      transferPairTransactionId: undefined,
      status: 'active',
      nextDate: '2026-06-15',
    });
    expect(records.get(scheduled._id)).toMatchObject({
      executionCount: 1,
      nextDate: '2026-06-15',
      nextRunAt: expect.any(Number),
    });
  });

  it('enters a biweekly payment due today despite linked history before the reset anchor', async () => {
    const scheduled = scheduledRecord({
      recurrence: 'every_other_week',
      anchorDate: '2026-09-23',
      nextDate: '2026-09-23',
      entryMode: 'manual',
      executionCount: 8,
    });
    const { ctx, records } = createContext(scheduled);
    records.set('previous-payment', {
      _id: 'previous-payment',
      workspaceId: scheduled.workspaceId,
      scheduledTransactionId: scheduled._id,
      date: '2026-09-09',
      type: 'regular',
      totalAmount: -5000n,
      isDeleted: false,
    });

    const result = await enterScheduledTransaction(ctx, scheduled, {
      date: '2026-09-23',
      timezone: 'America/New_York',
      reviewStatus: 'reviewed',
      advance: 'past_today',
    });

    expect(result).toMatchObject({ transactionId, status: 'active', nextDate: '2026-10-07' });
    expect(records.get(transactionId)).toMatchObject({ scheduledOccurrenceDate: '2026-09-23' });
    expect(records.get(scheduled._id)).toMatchObject({ executionCount: 9 });
  });

  it('materializes a scheduled transfer with both transaction ids and movement metadata', async () => {
    const destinationAccountId = 'bank-2' as Id<'bankAccount'>;
    const categoryId = 'category-1' as Id<'category'>;
    const scheduled = scheduledRecord({
      transactionType: 'transfer',
      transferToAccountId: destinationAccountId,
      merchantId: undefined,
      movements: [{ amount: 7500n, categoryId, readyToAssign: true }],
      recurrence: 'once',
    });
    const { ctx } = createContext(scheduled);

    const result = await enterScheduledTransaction(ctx, scheduled, {
      date: '2026-05-15',
      timezone: 'UTC',
      reviewStatus: 'needs_review',
      advance: 'single',
    });

    expect(createTransferMock).toHaveBeenCalledWith(ctx, {
      workspaceId: scheduled.workspaceId,
      fromAccountId: scheduled.bankAccountId,
      toAccountId: destinationAccountId,
      amount: 7500n,
      date: '2026-05-15',
      notes: scheduled.notes,
      status: scheduled.entryStatus,
      categoryId,
      readyToAssign: true,
      source: 'scheduled',
      reviewStatus: 'needs_review',
      scheduledTransactionId: scheduled._id,
    });
    expect(result).toEqual({
      transactionId,
      transferPairTransactionId,
      status: 'completed',
    });
  });

  it('rejects inactive schedules and transfers without a destination before creating transactions', async () => {
    const { ctx, patch } = createContext();

    await expect(
      enterScheduledTransaction(ctx, scheduledRecord({ status: 'paused' }), {
        date: '2026-05-15',
        timezone: 'UTC',
        reviewStatus: 'reviewed',
        advance: 'single',
      })
    ).rejects.toThrow('Scheduled transaction is not active');

    await expect(
      enterScheduledTransaction(ctx, scheduledRecord({ transactionType: 'transfer', merchantId: undefined }), {
        date: '2026-05-15',
        timezone: 'UTC',
        reviewStatus: 'reviewed',
        advance: 'single',
      })
    ).rejects.toThrow('Destination account is required for scheduled transfers');

    expect(createRegularMock).not.toHaveBeenCalled();
    expect(createTransferMock).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});

function queryRecords(records: Iterable<object>, table: string) {
  const filters: { field: string; value: unknown }[] = [];
  const builder = {
    eq(field: string, value: unknown) {
      filters.push({ field, value });
      return builder;
    },
  };
  const matching = () =>
    [...records]
      .filter((value) => {
        const row = value as Record<string, unknown>;
        const belongs =
          table === 'scheduledTransactionOccurrence'
            ? row.scheduleRevision !== undefined && row.occurrenceDate !== undefined
            : table === 'transaction'
              ? row.date !== undefined && row.totalAmount !== undefined
              : false;
        return belongs && filters.every(({ field, value: expected }) => row[field] === expected);
      })
      .sort((a, b) =>
        String((a as Record<string, unknown>).occurrenceDate ?? '').localeCompare(
          String((b as Record<string, unknown>).occurrenceDate ?? '')
        )
      );
  const query = {
    withIndex(_name: string, callback: (index: typeof builder) => unknown) {
      callback(builder);
      return query;
    },
    order(_direction: 'asc' | 'desc') {
      return query;
    },
    unique: async () => matching()[0] ?? null,
    first: async () => matching()[0] ?? null,
    collect: async () => matching(),
    take: async (limit: number) => matching().slice(0, limit),
  };
  return query;
}
