import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { automaticOccurrenceDate, inferLegacyOccurrenceDate } from '../scheduledTransactions/occurrences';
import {
  backfillDeletedPayment,
  backfillPayment,
  backfillSkip,
  preview,
  refreshBackfilledSchedule,
  repairLegacyPayment,
} from './backfillPlannedOccurrences';

const workspaceId = 'workspace' as Id<'workspace'>;
const scheduleId = 'schedule' as Id<'scheduledTransaction'>;

function schedule(overrides: Partial<Doc<'scheduledTransaction'>> = {}): Doc<'scheduledTransaction'> {
  return {
    _id: scheduleId,
    _creationTime: 1,
    workspaceId,
    bankAccountId: 'account' as Id<'bankAccount'>,
    transactionType: 'regular',
    entryStatus: 'pending',
    entryMode: 'manual',
    movements: [{ amount: -10000n }],
    recurrence: 'monthly',
    anchorDate: '2026-08-16',
    nextDate: '2026-10-16',
    status: 'active',
    executionCount: 2,
    updatedAt: '2026-09-16T00:00:00Z',
    isDeleted: false,
    ...overrides,
  };
}

function payment(id = 'payment', overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: 'account' as Id<'bankAccount'>,
    date: '2026-09-18',
    dateYearMonth: 202609,
    type: 'regular',
    status: 'cleared',
    reviewStatus: 'reviewed',
    movements: [{ amount: -10000n, readyToAssign: false, sortOrder: 0 }],
    totalAmount: -10000n,
    hasUncategorized: true,
    hasMissingPayee: false,
    searchText: '',
    isDeleted: false,
    source: 'scheduled',
    scheduledTransactionId: scheduleId,
    ...overrides,
  };
}

function skip(overrides: Partial<Doc<'scheduledTransactionSkip'>> = {}): Doc<'scheduledTransactionSkip'> {
  return {
    _id: 'skip' as Id<'scheduledTransactionSkip'>,
    _creationTime: 1,
    workspaceId,
    scheduledTransactionId: scheduleId,
    occurrenceDate: '2026-09-16',
    expectedAmount: -9000n,
    isTransfer: false,
    updatedAt: '2026-09-16T00:00:00Z',
    isDeleted: false,
    ...overrides,
  };
}

function setup(plan = schedule(), transactions = [payment()]) {
  const rows = new Map<string, Record<string, unknown>>();
  rows.set(plan._id, { ...plan, _table: 'scheduledTransaction' });
  rows.set(workspaceId, { _id: workspaceId, timezone: 'America/New_York', _table: 'workspace' });
  for (const transaction of transactions) rows.set(transaction._id, { ...transaction, _table: 'transaction' });
  let counter = 0;
  const db = {
    get: async (id: string) => rows.get(id) ?? null,
    patch: async (id: string, fields: Record<string, unknown>) => {
      const before = rows.get(id);
      if (!before) throw new Error(`Missing ${id}`);
      rows.set(id, { ...before, ...fields });
    },
    insert: async (table: string, fields: Record<string, unknown>) => {
      const id = `${table}-${++counter}`;
      rows.set(id, { ...fields, _id: id, _table: table, _creationTime: counter });
      return id;
    },
    query: (table: string) => ({
      withIndex: (_name: string, apply?: (query: unknown) => unknown) => {
        const constraints: [string, unknown][] = [];
        const index = {
          eq: (field: string, value: unknown) => {
            constraints.push([field, value]);
            return index;
          },
        };
        apply?.(index);
        const matches = () =>
          [...rows.values()]
            .filter((row) => row._table === table && constraints.every(([field, value]) => row[field] === value))
            .sort((a, b) => String(a.occurrenceDate).localeCompare(String(b.occurrenceDate)));
        return {
          unique: async () => {
            const found = matches();
            if (found.length > 1) throw new Error('Not unique');
            return found[0] ?? null;
          },
          first: async () => matches()[0] ?? null,
          take: async (count: number) => matches().slice(0, count),
          paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
            const start = Number(cursor ?? 0);
            const found = matches();
            return {
              page: found.slice(start, start + numItems),
              isDone: start + numItems >= found.length,
              continueCursor: String(start + numItems),
            };
          },
        };
      },
    }),
  };
  const ctx = { db } as unknown as MutationCtx;
  const getPlan = () => rows.get(scheduleId) as unknown as Doc<'scheduledTransaction'>;
  const tx = (id = 'payment') => rows.get(id) as unknown as Doc<'transaction'>;
  const occurrences = () => [...rows.values()].filter((row) => row._table === 'scheduledTransactionOccurrence');
  const run = async (skips: Doc<'scheduledTransactionSkip'>[] = []) => {
    for (const row of transactions) await backfillPayment(ctx, tx(row._id));
    for (const row of skips) await backfillSkip(ctx, row);
    for (const row of transactions) await backfillDeletedPayment(ctx, tx(row._id));
    await refreshBackfilledSchedule(ctx, getPlan());
  };
  return { ctx, db, rows, plan: getPlan, tx, occurrences, run };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:00:00Z'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('planned occurrence history backfill', () => {
  it('repairs reset-anchor history across workspaces without changing bills, amounts, or balances', async () => {
    const plan = schedule({ recurrence: 'every_other_week', anchorDate: '2026-09-23', nextDate: '2026-09-23' });
    const s = setup(plan, [payment('previous', { date: '2026-09-09' }), payment('older', { date: '2026-08-26' })]);
    const otherWorkspaceId = 'other-workspace' as Id<'workspace'>;
    const otherPlan = schedule({
      _id: 'other-plan' as Id<'scheduledTransaction'>,
      workspaceId: otherWorkspaceId,
      anchorDate: '2026-09-30',
      nextDate: '2026-09-30',
      status: 'paused',
    });
    const otherPayment = payment('other-payment', {
      workspaceId: otherWorkspaceId,
      scheduledTransactionId: otherPlan._id,
      date: '2026-08-29',
    });
    s.rows.set(otherPlan._id, { ...otherPlan, _table: 'scheduledTransaction' });
    s.rows.set(otherPayment._id, { ...otherPayment, _table: 'transaction' });
    const beforePlans = [structuredClone(s.plan()), structuredClone(s.rows.get(otherPlan._id))];

    for (const id of ['previous', 'older', 'other-payment']) await repairLegacyPayment(s.ctx, s.tx(id));

    expect(s.tx('previous')).toMatchObject({
      scheduledOccurrenceDate: '2026-09-09',
      date: '2026-09-09',
      totalAmount: -10000n,
    });
    expect(s.tx('older').scheduledOccurrenceDate).toBe('2026-08-26');
    expect(s.tx('other-payment').scheduledOccurrenceDate).toBe('2026-08-30');
    expect(s.occurrences()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId, occurrenceDate: '2026-09-09', status: 'paid' }),
        expect.objectContaining({ workspaceId: otherWorkspaceId, occurrenceDate: '2026-08-30', status: 'paid' }),
      ])
    );
    expect([s.plan(), s.rows.get(otherPlan._id)]).toEqual(beforePlans);
    const repaired = structuredClone([...s.rows]);
    vi.setSystemTime(new Date('2026-09-24T14:00:00Z'));
    for (const id of ['previous', 'older', 'other-payment']) await repairLegacyPayment(s.ctx, s.tx(id));
    expect([...s.rows]).toEqual(repaired);
  });

  it('preserves explicit identities and does not reopen deleted history during the targeted repair', async () => {
    const s = setup(schedule(), [
      payment('explicit', { scheduledOccurrenceDate: '2026-08-16', scheduledOccurrenceRevision: 0 }),
      payment('unlinked', { scheduledTransactionId: undefined }),
      payment('deleted', { isDeleted: true }),
    ]);
    const beforePlan = structuredClone(s.plan());
    const explicit = structuredClone(s.tx('explicit'));
    const unlinked = structuredClone(s.tx('unlinked'));
    for (const id of ['explicit', 'unlinked', 'deleted']) await repairLegacyPayment(s.ctx, s.tx(id));
    expect(s.tx('explicit')).toEqual(explicit);
    expect(s.tx('unlinked')).toEqual(unlinked);
    expect(s.tx('deleted')).toMatchObject({ scheduledOccurrenceDate: '2026-09-16', isDeleted: true });
    expect(s.occurrences()).toEqual([]);
    expect(s.plan()).toEqual(beforePlan);
  });

  it('stores inferred dates once without changing amounts, balances, or advancing the next bill', async () => {
    const s = setup();
    await s.run();
    expect(s.tx()).toMatchObject({
      scheduledOccurrenceDate: '2026-09-16',
      scheduledOccurrenceRevision: 0,
      originScheduledTransactionId: scheduleId,
      date: '2026-09-18',
      totalAmount: -10000n,
    });
    expect(s.occurrences()).toMatchObject([{ status: 'paid', occurrenceDate: '2026-09-16', transactionId: 'payment' }]);
    expect(s.plan()).toMatchObject({ nextDate: '2026-10-16', executionCount: 2 });
    expect(inferLegacyOccurrenceDate(schedule({ anchorDate: '2026-01-03', nextDate: '2027-01-03' }), s.tx())).toBe(
      '2026-09-16'
    );
  });

  it('prefers captured entry dates over proximity for very late payments', async () => {
    const s = setup(schedule(), [
      payment('payment', {
        date: '2026-10-12',
        scheduledEntryUndo: {
          nextDate: '2026-08-16',
          executionCount: 1,
          scheduleUpdatedAt: '2026-09-01T00:00:00Z',
          expiresAt: 0,
        },
      }),
    ]);
    await s.run();
    expect(s.tx().scheduledOccurrenceDate).toBe('2026-08-16');
  });

  it('preserves exact dates and historical revisions after a schedule changes', async () => {
    const s = setup(schedule({ scheduleRevision: 1, anchorDate: '2026-09-23', nextDate: '2026-10-23' }), [
      payment('payment', { scheduledOccurrenceDate: '2026-09-16', scheduledOccurrenceRevision: 0 }),
    ]);
    await s.run();
    expect(s.occurrences()[0]).toMatchObject({ occurrenceDate: '2026-09-16', scheduleRevision: 0 });
    expect(s.plan().nextDate).toBe('2026-10-23');
  });

  it('is idempotent, including deleted history, and does not increment execution counters', async () => {
    const s = setup(schedule(), [payment(), payment('deleted', { date: '2026-08-16', isDeleted: true })]);
    await s.run();
    const before = structuredClone([...s.rows]);
    await s.run();
    expect([...s.rows]).toEqual(before);
    expect(s.plan().executionCount).toBe(2);
  });

  it('reopens a deleted legacy bill without recreating its transaction automatically', async () => {
    const s = setup(schedule({ entryMode: 'auto' }), [payment('payment', { isDeleted: true })]);
    await s.run();
    expect(s.plan()).toMatchObject({ nextDate: '2026-09-16', nextUnprocessedDate: '2026-10-16' });
    expect(s.occurrences()[0]).toMatchObject({ status: 'pending', manualOnly: true });
    expect(await automaticOccurrenceDate(s.ctx, s.plan())).toBe('2026-10-16');
    expect(s.tx().isDeleted).toBe(true);
  });

  it('does not reopen a deleted duplicate when a replacement payment still exists', async () => {
    const s = setup(schedule(), [payment('deleted', { isDeleted: true }), payment('replacement')]);
    await s.run();
    expect(s.occurrences()).toMatchObject([{ status: 'paid', transactionId: 'replacement' }]);
    expect(s.plan().nextDate).toBe('2026-10-16');
  });

  it('retains duplicate legacy links and reports them without manufacturing another due date', async () => {
    const s = setup(schedule(), [payment('first'), payment('second')]);
    await s.run();
    expect(s.occurrences()).toHaveLength(1);
    expect(s.tx('first').scheduledOccurrenceDate).toBe('2026-09-16');
    expect(s.tx('second').scheduledOccurrenceDate).toBe('2026-09-16');
    expect(console.warn).toHaveBeenCalledWith(
      'Multiple legacy payments share a planned occurrence',
      expect.any(Object)
    );
  });

  it('preserves explicit skips instead of reopening deleted payments', async () => {
    const s = setup(schedule(), [payment('payment', { isDeleted: true })]);
    await s.run([skip()]);
    expect(s.occurrences()).toMatchObject([{ status: 'skipped', expectedAmount: -9000n }]);
    expect(s.plan().nextDate).toBe('2026-10-16');
  });

  it('never lets old skip history overwrite a newer paid or reopened occurrence', async () => {
    const s = setup();
    await s.run([skip()]);
    expect(s.occurrences()[0].status).toBe('paid');
    const occurrence = s.occurrences()[0];
    await s.db.patch(String(occurrence._id), { status: 'pending', transactionId: undefined });
    await backfillSkip(s.ctx, skip());
    expect(s.occurrences()[0].status).toBe('pending');
  });

  it('does not invent skipped, paid, or unpaid entries for historical gaps', async () => {
    const s = setup(schedule({ anchorDate: '2020-01-16' }), []);
    const before = structuredClone(s.plan());
    await s.run();
    expect(s.occurrences()).toEqual([]);
    expect(s.plan()).toEqual(before);
  });

  it('can reopen a completed one-time bill when its only surviving payment was deleted', async () => {
    const s = setup(
      schedule({ recurrence: 'once', status: 'completed', anchorDate: '2026-09-16', nextDate: '2026-09-16' }),
      [payment('payment', { isDeleted: true })]
    );
    await s.run();
    expect(s.plan()).toMatchObject({ status: 'active', nextDate: '2026-09-16' });
  });

  it('does not revive deleted schedules or old-revision debts', async () => {
    for (const plan of [schedule({ isDeleted: true }), schedule({ scheduleRevision: 1 })]) {
      const s = setup(plan, [
        payment('payment', { isDeleted: true, scheduledOccurrenceDate: '2026-09-16', scheduledOccurrenceRevision: 0 }),
      ]);
      await s.run();
      expect(s.occurrences()).toEqual([]);
      expect(s.plan().nextDate).toBe('2026-10-16');
    }
  });

  it('does not infer a replacement date after a known schedule revision', async () => {
    const s = setup(schedule({ scheduleRevision: 1 }));
    await expect(s.run()).rejects.toThrow('schedule changed');
    expect(s.tx().scheduledOccurrenceDate).toBeUndefined();
  });

  it('refuses cross-workspace links before writing anything', async () => {
    const s = setup(schedule({ workspaceId: 'other' as Id<'workspace'> }));
    const before = structuredClone([...s.rows]);
    await expect(s.run()).rejects.toThrow('another workspace');
    expect([...s.rows]).toEqual(before);
    await expect(backfillSkip(s.ctx, skip())).rejects.toThrow('needs review');
  });

  it('refuses conflicting modern occurrence state instead of overwriting it', async () => {
    const s = setup();
    await backfillSkip(s.ctx, skip());
    await expect(s.run()).rejects.toThrow('conflicts with a pending or skipped occurrence');
    expect(s.occurrences()[0].status).toBe('skipped');
  });

  it('freezes both halves of transfers and records a single settlement even when the inflow is visited first', async () => {
    const outgoing = payment('outgoing', { type: 'transfer', transferPairId: 'incoming' as Id<'transaction'> });
    const incoming = payment('incoming', { type: 'transfer', totalAmount: 10000n, transferPairId: outgoing._id });
    const s = setup(schedule({ transactionType: 'transfer' }), [incoming, outgoing]);
    await s.run();
    expect(s.tx('incoming').scheduledOccurrenceDate).toBe('2026-09-16');
    expect(s.tx('outgoing').scheduledOccurrenceDate).toBe('2026-09-16');
    expect(s.occurrences()).toMatchObject([{ transactionId: outgoing._id, isTransfer: true, expectedAmount: -10000n }]);
  });

  it('rejects inconsistent transfer pairs before capturing either half', async () => {
    const s = setup(schedule(), [payment('payment', { type: 'transfer' })]);
    await expect(s.run()).rejects.toThrow('transfer pair');
    expect(s.tx().scheduledOccurrenceDate).toBeUndefined();
  });

  it('provides a read-only preview with inference evidence and review errors', async () => {
    const s = setup(schedule(), [payment(), payment('bad', { date: 'not-a-date' })]);
    const before = structuredClone([...s.rows]);
    const handler = (
      preview as unknown as {
        _handler: (
          ctx: QueryCtx,
          args: { scheduledTransactionId?: Id<'scheduledTransaction'>; cursor?: string | null; legacyOnly?: boolean }
        ) => Promise<unknown>;
      }
    )._handler;
    const result = await handler(s.ctx, { scheduledTransactionId: scheduleId });
    expect(result).toMatchObject({
      isDone: true,
      transactions: [
        { transactionId: 'payment', occurrenceDate: '2026-09-16', evidence: 'inferred', error: null },
        { transactionId: 'bad', occurrenceDate: null, error: expect.stringContaining('invalid calendar date') },
      ],
    });
    expect([...s.rows]).toEqual(before);
    await s.db.patch('payment', { scheduledOccurrenceDate: '2026-09-16' });
    expect(await handler(s.ctx, { legacyOnly: true })).toMatchObject({
      transactions: [
        { transactionId: 'bad', workspaceId, scheduledTransactionId: scheduleId, transactionDate: 'not-a-date' },
      ],
    });
  });
});
