import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { TransactionSnapshot } from '../transactions/reconciliation/types';
import { updateLinkedScheduledTransaction } from '../transactions/update';
import {
  automaticOccurrenceDate,
  captureLegacyOccurrenceDates,
  inferLegacyOccurrenceDate,
  nearestOccurrenceDate,
  reconcileScheduledOccurrence,
  refreshSchedule,
  releaseOccurrence,
  settleOccurrence,
  skipOccurrence,
} from './occurrences';

const workspaceId = 'workspace' as Id<'workspace'>;
const scheduleId = 'schedule' as Id<'scheduledTransaction'>;
const accountId = 'account' as Id<'bankAccount'>;
function schedule(overrides: Partial<Doc<'scheduledTransaction'>> = {}): Doc<'scheduledTransaction'> {
  return {
    _id: scheduleId,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    transactionType: 'regular',
    merchantId: 'merchant' as Id<'merchant'>,
    entryStatus: 'pending',
    entryMode: 'manual',
    movements: [{ amount: -10000n }],
    recurrence: 'monthly',
    anchorDate: '2026-09-16',
    nextDate: '2026-09-16',
    status: 'active',
    executionCount: 0,
    updatedAt: '2026-09-16T00:00:00Z',
    isDeleted: false,
    ...overrides,
  };
}
function transaction(id = 'payment', overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    merchantId: 'merchant' as Id<'merchant'>,
    date: '2026-09-16',
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
    source: 'manual',
    ...overrides,
  };
}
function snapshot(t: Doc<'transaction'>): TransactionSnapshot {
  return {
    workspaceId: t.workspaceId,
    transactionId: t._id,
    bankAccountId: t.bankAccountId,
    scheduledTransactionId: t.scheduledTransactionId,
    scheduledOccurrenceDate: t.scheduledOccurrenceDate,
    scheduledOccurrenceRevision: t.scheduledOccurrenceRevision,
    type: t.type,
    date: t.date,
    status: t.status,
    totalAmount: t.totalAmount,
    merchantId: t.merchantId,
    movements: t.movements.map((m) => ({ ...m, categoryId: m.categoryId })),
    isCreditCardAccount: false,
    isExcludedFromRTA: false,
    creditCardCategoryId: null,
    transferPairId: t.transferPairId,
    transferPairBankAccountId: t.transferPairBankAccountId,
  };
}
function setup(planned = schedule(), transactions = [transaction()]) {
  const rows = new Map<string, Record<string, unknown>>();
  rows.set(planned._id, { ...planned, _table: 'scheduledTransaction' });
  rows.set(workspaceId, { _id: workspaceId, timezone: 'America/New_York', _table: 'workspace' });
  for (const t of transactions) rows.set(t._id, { ...t, _table: 'transaction' });
  let counter = 0;
  const db = {
    get: async (id: string) => rows.get(id) ?? null,
    patch: async (id: string, fields: Record<string, unknown>) => {
      const current = rows.get(id);
      if (!current) throw new Error(`Missing ${id}`);
      rows.set(id, { ...current, ...fields });
    },
    insert: async (table: string, fields: Record<string, unknown>) => {
      const id = `${table}-${++counter}`;
      rows.set(id, { ...fields, _id: id, _table: table, _creationTime: counter });
      return id;
    },
    query: (table: string) => ({
      withIndex: (_index: string, apply: (q: unknown) => unknown) => {
        const constraints: [string, unknown][] = [];
        const index = {
          eq: (field: string, value: unknown) => {
            constraints.push([field, value]);
            return index;
          },
        };
        apply(index);
        const matches = () =>
          [...rows.values()]
            .filter((r) => r._table === table && constraints.every(([k, v]) => r[k] === v))
            .sort((a, b) => String(a.occurrenceDate).localeCompare(String(b.occurrenceDate)));
        return {
          unique: async () => {
            const values = matches();
            if (values.length > 1) throw new Error('not unique');
            return values[0] ?? null;
          },
          first: async () => matches()[0] ?? null,
          take: async (n: number) => matches().slice(0, n),
        };
      },
    }),
  };
  const ctx = { db } as unknown as MutationCtx;
  const plan = () => rows.get(scheduleId) as unknown as Doc<'scheduledTransaction'>;
  const tx = (id = 'payment') => rows.get(id) as unknown as Doc<'transaction'>;
  const occurrences = () => [...rows.values()].filter((r) => r._table === 'scheduledTransactionOccurrence');
  return { ctx, db, rows, plan, tx, occurrences };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('planned occurrence lifecycle', () => {
  it('reopens September after deletion and settles the same bill on restore', async () => {
    const { ctx, db, plan, tx } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    expect(plan().nextDate).toBe('2026-10-16');
    const before = snapshot(tx());
    await db.patch('payment', { isDeleted: true });
    await reconcileScheduledOccurrence(ctx, before, null);
    expect(plan()).toMatchObject({ nextDate: '2026-09-16', nextUnprocessedDate: '2026-10-16', executionCount: 0 });
    await db.patch('payment', { isDeleted: false });
    await reconcileScheduledOccurrence(ctx, null, snapshot(tx()));
    expect(plan()).toMatchObject({ nextDate: '2026-10-16', executionCount: 1 });
  });

  it('keeps a later paid month settled while an older bill is reopened and paid again', async () => {
    const { ctx, db, plan, tx } = setup(schedule(), [transaction(), transaction('october', { date: '2026-10-16' })]);
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await settleOccurrence(ctx, plan(), tx('october'), '2026-10-16');
    await releaseOccurrence(ctx, tx(), true);
    expect(plan().nextDate).toBe('2026-09-16');
    await db.patch('payment', { date: '2026-09-18' });
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    expect(plan().nextDate).toBe('2026-11-16');
  });

  it('never automatically recreates deliberately deleted payments, but keeps future automatic entries', async () => {
    const { ctx, plan, tx } = setup(schedule({ entryMode: 'auto' }));
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await releaseOccurrence(ctx, tx(), true);
    expect(plan().nextDate).toBe('2026-09-16');
    expect(await automaticOccurrenceDate(ctx, plan())).toBe('2026-10-16');
    expect(new Date(plan().nextRunAt ?? 0).toISOString()).toBe('2026-10-16T11:00:00.000Z');
  });

  it('preserves exact due date for an early payment and clamps month ends without drifting', async () => {
    const { ctx, plan, tx } = setup(schedule({ anchorDate: '2026-01-31', nextDate: '2026-02-28' }), [
      transaction('payment', { date: '2026-02-24' }),
    ]);
    await settleOccurrence(ctx, plan(), tx(), '2026-02-28', { provenance: true });
    expect(tx()).toMatchObject({
      date: '2026-02-24',
      scheduledOccurrenceDate: '2026-02-28',
      originScheduledTransactionId: scheduleId,
    });
    expect(plan().nextDate).toBe('2026-03-31');
    await releaseOccurrence(ctx, tx(), true);
    expect(tx().scheduledTransactionId).toBeUndefined();
    expect(tx().originScheduledTransactionId).toBe(scheduleId);
  });

  it('rejects a second payment for an already settled occurrence without advancing another month', async () => {
    const { ctx, plan, tx } = setup(schedule(), [transaction(), transaction('duplicate')]);
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await expect(settleOccurrence(ctx, plan(), tx('duplicate'), '2026-09-16')).rejects.toThrow(
      'already has a transaction'
    );
    expect(plan().nextDate).toBe('2026-10-16');
  });

  it('does not create a second payment over a legacy settlement without an occurrence row', async () => {
    const { ctx, plan, tx } = setup(schedule({ nextDate: '2026-10-16', executionCount: 1 }), [
      transaction('payment', { scheduledTransactionId: scheduleId }),
      transaction('duplicate'),
    ]);
    await expect(settleOccurrence(ctx, plan(), tx('duplicate'), '2026-09-16')).rejects.toThrow(
      'already has a transaction'
    );
    expect(plan().executionCount).toBe(1);
  });

  it('records a due biweekly occurrence when legacy payments predate a reset anchor', async () => {
    const { ctx, plan, tx, occurrences } = setup(
      schedule({
        recurrence: 'every_other_week',
        anchorDate: '2026-09-23',
        nextDate: '2026-09-23',
        executionCount: 8,
      }),
      [
        transaction('payment', { date: '2026-09-23' }),
        transaction('previous', { date: '2026-09-09', scheduledTransactionId: scheduleId }),
        transaction('older', { date: '2026-08-26', scheduledTransactionId: scheduleId }),
      ]
    );

    expect(inferLegacyOccurrenceDate(plan(), tx('previous'))).toBe('2026-09-09');
    expect(inferLegacyOccurrenceDate(plan(), tx('older'))).toBe('2026-08-26');
    await settleOccurrence(ctx, plan(), tx(), '2026-09-23');

    expect(plan()).toMatchObject({ nextDate: '2026-10-07', executionCount: 9 });
    expect(occurrences()).toEqual([expect.objectContaining({ occurrenceDate: '2026-09-23', status: 'paid' })]);
  });

  it('allows a historical occurrence before a reset anchor to be reopened and recorded again', async () => {
    const { ctx, plan, tx } = setup(
      schedule({ recurrence: 'every_other_week', anchorDate: '2026-09-23', nextDate: '2026-09-23', executionCount: 8 }),
      [transaction('payment', { date: '2026-09-09', scheduledTransactionId: scheduleId }), transaction('replacement')]
    );

    await releaseOccurrence(ctx, tx(), true);
    expect(plan().nextDate).toBe('2026-09-09');
    await settleOccurrence(ctx, plan(), tx('replacement'), '2026-09-09');
    expect(plan()).toMatchObject({ nextDate: '2026-09-23', executionCount: 8 });
  });

  it('captures a legacy payment on re-save and preserves its identity during posting-date corrections', async () => {
    const { ctx, db, plan, tx } = setup(
      schedule({ recurrence: 'every_other_week', anchorDate: '2026-09-23', nextDate: '2026-09-23', executionCount: 8 }),
      [transaction('payment', { date: '2026-09-09', scheduledTransactionId: scheduleId })]
    );
    await updateLinkedScheduledTransaction(ctx, tx(), workspaceId, scheduleId);
    expect(tx().scheduledOccurrenceDate).toBe('2026-09-09');
    const before = snapshot(tx());
    await db.patch('payment', { date: '2026-09-10' });
    await reconcileScheduledOccurrence(ctx, before, snapshot(tx()));
    expect(tx().scheduledOccurrenceDate).toBe('2026-09-09');
    expect(plan()).toMatchObject({ nextDate: '2026-09-23', executionCount: 8 });
  });

  it('does not let a new payment invent an occurrence before the start of a plan', async () => {
    const { ctx, plan, tx } = setup();
    await expect(settleOccurrence(ctx, plan(), tx(), '2026-08-16')).rejects.toThrow('Choose a valid due date');
  });

  it('settles a future occurrence without hiding an earlier unpaid bill', async () => {
    const { ctx, plan, tx } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-10-16');
    expect(plan().nextDate).toBe('2026-09-16');
  });

  it('advances just one overdue occurrence for explicit entry or skipping', async () => {
    const { ctx, plan, tx } = setup(schedule({ anchorDate: '2026-07-16', nextDate: '2026-07-16' }));
    await settleOccurrence(ctx, plan(), tx(), '2026-07-16');
    expect(plan().nextDate).toBe('2026-08-16');
    await skipOccurrence(ctx, plan());
    expect(plan().nextDate).toBe('2026-09-16');
  });

  it('reopens completed one-time plans and respects a subsequent explicit skip on restore', async () => {
    const { ctx, db, plan, tx } = setup(schedule({ recurrence: 'once' }));
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    expect(plan().status).toBe('completed');
    await releaseOccurrence(ctx, tx(), false);
    expect(plan().status).toBe('active');
    await skipOccurrence(ctx, plan());
    await db.patch('payment', { isDeleted: false });
    await reconcileScheduledOccurrence(ctx, null, snapshot(tx()));
    expect(plan().status).toBe('completed');
    expect(tx().scheduledTransactionId).toBeUndefined();
  });

  it("does not let a restored old payment take a replacement payment's occurrence", async () => {
    const { ctx, db, plan, tx } = setup(schedule(), [transaction(), transaction('replacement')]);
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await db.patch('payment', { isDeleted: true });
    await releaseOccurrence(ctx, tx(), false);
    await settleOccurrence(ctx, plan(), tx('replacement'), '2026-09-16');
    await db.patch('payment', { isDeleted: false });
    await reconcileScheduledOccurrence(ctx, null, snapshot(tx()));
    expect(tx().scheduledTransactionId).toBeUndefined();
    expect(tx('replacement').scheduledOccurrenceDate).toBe('2026-09-16');
    expect(plan().nextDate).toBe('2026-10-16');
  });

  it('keeps newer legacy payment identities stable after reopening the oldest payment', async () => {
    const { ctx, db, plan, tx } = setup(
      schedule({ anchorDate: '2026-01-16', nextDate: '2026-10-16', executionCount: 2 }),
      [
        transaction('payment', { date: '2026-01-16', scheduledTransactionId: scheduleId }),
        transaction('september', { date: '2026-09-16', scheduledTransactionId: scheduleId }),
      ]
    );
    await db.patch('payment', { isDeleted: true });
    await releaseOccurrence(ctx, tx(), false);
    expect(plan().nextDate).toBe('2026-01-16');
    expect(inferLegacyOccurrenceDate(plan(), tx('september'))).toBe('2026-09-16');
  });

  it('keeps historical re-saves valid after the future template changes accounts or direction', async () => {
    const { ctx, db, plan, tx } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await db.patch(scheduleId, { bankAccountId: 'different-account', movements: [{ amount: 10000n }] });
    await updateLinkedScheduledTransaction(ctx, tx(), workspaceId, scheduleId);
    expect(tx().scheduledOccurrenceDate).toBe('2026-09-16');
    expect(plan().nextDate).toBe('2026-10-16');
  });

  it('keeps unpaid backlog visible when automatic creation starts prospectively', async () => {
    const { ctx, plan } = setup(schedule({ entryMode: 'auto', automaticEntryStartDate: '2026-10-16' }));
    await refreshSchedule(ctx, scheduleId);
    expect(plan().nextDate).toBe('2026-09-16');
    expect(await automaticOccurrenceDate(ctx, plan())).toBe('2026-10-16');
  });

  it('freezes legacy due dates before changing the recurrence anchor', async () => {
    const { ctx, db, plan, tx } = setup(schedule({ nextDate: '2026-10-16', executionCount: 1 }), [
      transaction('payment', { scheduledTransactionId: scheduleId }),
    ]);
    await captureLegacyOccurrenceDates(ctx, plan());
    await db.patch(scheduleId, {
      scheduleRevision: 1,
      anchorDate: '2026-10-20',
      nextDate: '2026-10-20',
      nextUnprocessedDate: '2026-10-20',
    });
    expect(tx().scheduledOccurrenceDate).toBe('2026-09-16');
    await releaseOccurrence(ctx, tx(), true);
    expect(plan().nextDate).toBe('2026-10-20');
  });

  it('does not rewind a deliberately redated series when an old payment is deleted', async () => {
    const { ctx, db, plan, tx } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    await db.patch(scheduleId, {
      scheduleRevision: 1,
      anchorDate: '2026-11-20',
      nextDate: '2026-11-20',
      nextUnprocessedDate: '2026-11-20',
    });
    await releaseOccurrence(ctx, tx(), true);
    expect(plan().nextDate).toBe('2026-11-20');
  });

  it('repairs legacy links on deletion and keeps other legacy payments covering the same occurrence', async () => {
    const { ctx, db, plan, tx, occurrences } = setup(schedule({ nextDate: '2026-10-16', executionCount: 1 }), [
      transaction('payment', { scheduledTransactionId: scheduleId }),
      transaction('duplicate', { scheduledTransactionId: scheduleId }),
    ]);
    await db.patch('payment', { isDeleted: true });
    await releaseOccurrence(ctx, tx(), false);
    expect(plan().nextDate).toBe('2026-10-16');
    expect(occurrences()[0]?.transactionId).toBe('duplicate');
    await db.patch('duplicate', { isDeleted: true });
    await releaseOccurrence(ctx, tx('duplicate'), false);
    expect(plan().nextDate).toBe('2026-09-16');
  });

  it('counts and releases a transfer pair once, including deletion from its receiving side', async () => {
    const to = 'destination' as Id<'bankAccount'>;
    const { ctx, db, plan, tx } = setup(
      schedule({ transactionType: 'transfer', transferToAccountId: to, movements: [{ amount: 10000n }] }),
      [
        transaction('payment', {
          type: 'transfer',
          transferPairId: 'pair' as Id<'transaction'>,
          transferPairBankAccountId: to,
        }),
        transaction('pair', {
          type: 'transfer',
          bankAccountId: to,
          totalAmount: 10000n,
          transferPairId: 'payment' as Id<'transaction'>,
          transferPairBankAccountId: accountId,
        }),
      ]
    );
    await updateLinkedScheduledTransaction(ctx, tx('pair'), workspaceId, scheduleId, '2026-09-16');
    expect(plan().executionCount).toBe(1);
    expect(tx('pair').scheduledOccurrenceDate).toBe('2026-09-16');
    const source = snapshot(tx());
    const receiver = snapshot(tx('pair'));
    await db.patch('payment', { isDeleted: true });
    await reconcileScheduledOccurrence(ctx, source, null);
    await db.patch('pair', { isDeleted: true });
    await reconcileScheduledOccurrence(ctx, receiver, null);
    expect(plan()).toMatchObject({ executionCount: 0, nextDate: '2026-09-16' });
  });
});

describe('editing a settled transaction', () => {
  it.each([
    ['payee', { merchantId: 'other' as Id<'merchant'> }],
    ['account', { bankAccountId: 'other' as Id<'bankAccount'> }],
    ['direction', { totalAmount: 10000n }],
    ['type', { type: 'starting_balance' as const }],
    ['another month', { date: '2026-10-16' }],
  ])('detaches and reopens when changing %s', async (_name, patch) => {
    const { ctx, db, plan, tx } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    const before = snapshot(tx());
    await db.patch('payment', patch);
    await reconcileScheduledOccurrence(ctx, before, snapshot(tx()));
    expect(tx().scheduledTransactionId).toBeUndefined();
    expect(plan().nextDate).toBe('2026-09-16');
  });

  it.each([{ totalAmount: -12000n }, { date: '2026-09-19' }, { status: 'reconciled' }, { notes: 'Corrected' }])(
    'keeps an occurrence for an ordinary correction %#',
    async (patch) => {
      const { ctx, db, plan, tx } = setup();
      await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
      const before = snapshot(tx());
      await db.patch('payment', patch);
      await reconcileScheduledOccurrence(ctx, before, snapshot(tx()));
      expect(tx().scheduledOccurrenceDate).toBe('2026-09-16');
      expect(plan().nextDate).toBe('2026-10-16');
    }
  );

  it('preserves an explicit same-plan reassignment after editing the posting date', async () => {
    const { ctx, db, plan, tx, occurrences } = setup();
    await settleOccurrence(ctx, plan(), tx(), '2026-09-16');
    const before = snapshot(tx());
    await db.patch('payment', { date: '2026-10-16' });
    await updateLinkedScheduledTransaction(ctx, tx(), workspaceId, scheduleId, '2026-10-16');
    await reconcileScheduledOccurrence(ctx, before, snapshot(tx()));
    expect(tx().scheduledOccurrenceDate).toBe('2026-10-16');
    expect(plan().nextDate).toBe('2026-09-16');
    expect(occurrences().find((o) => o.occurrenceDate === '2026-10-16')?.status).toBe('paid');
  });

  it('rejects cross-workspace linking and wrong account/direction without changing the schedule', async () => {
    const { ctx, plan, tx } = setup(schedule({ workspaceId: 'other' as Id<'workspace'> }));
    await expect(updateLinkedScheduledTransaction(ctx, tx(), workspaceId, scheduleId)).rejects.toThrow('access denied');
    expect(plan().executionCount).toBe(0);
  });

  it('keeps occurrence identity inference deterministic across late/early payments and leap years', () => {
    expect(nearestOccurrenceDate(schedule(), '2026-09-13')).toBe('2026-09-16');
    expect(nearestOccurrenceDate(schedule(), '2026-10-13')).toBe('2026-10-16');
    expect(
      inferLegacyOccurrenceDate(
        schedule({ nextDate: '2026-10-16', executionCount: 1 }),
        transaction('payment', { date: '2026-09-18' })
      )
    ).toBe('2026-09-16');
    expect(nearestOccurrenceDate(schedule({ recurrence: 'yearly', anchorDate: '2024-02-29' }), '2025-03-01')).toBe(
      '2025-02-28'
    );
  });

  it.each([
    ['every_other_week', '2026-09-23', '2026-09-10', '2026-09-09'],
    ['every_other_week', '2026-09-23', '2026-09-08', '2026-09-09'],
    ['every_other_week', '2026-09-23', '2026-09-16', '2026-09-09'],
    ['daily', '2026-09-23', '2020-01-01', '2020-01-01'],
    ['monthly', '2026-03-31', '2026-02-27', '2026-02-28'],
    ['quarterly', '2026-07-31', '2026-04-29', '2026-04-30'],
    ['twice_a_month', '2026-09-30', '2026-08-16', '2026-08-15'],
    ['yearly', '2028-02-29', '2025-03-01', '2025-02-28'],
  ] as const)('infers %s legacy history before the anchor %s', (recurrence, anchorDate, date, expected) => {
    const planned = schedule({ recurrence, anchorDate, nextDate: anchorDate, executionCount: 8 });
    expect(inferLegacyOccurrenceDate(planned, transaction('legacy', { date }))).toBe(expected);
    // A newly linked early payment still targets the first occurrence of a new plan.
    expect(nearestOccurrenceDate(planned, date)).toBe(anchorDate);
  });

  it('refreshes multiple reopened automatic occurrences without scheduling any of them', async () => {
    const { ctx, db, plan } = setup(schedule({ entryMode: 'auto', nextUnprocessedDate: '2026-09-16' }));
    for (const date of ['2026-09-16', '2026-10-16']) {
      await db.insert('scheduledTransactionOccurrence', {
        workspaceId,
        scheduledTransactionId: scheduleId,
        scheduleRevision: 0,
        occurrenceDate: date,
        status: 'pending',
        manualOnly: true,
        expectedAmount: -10000n,
        isTransfer: false,
        updatedAt: new Date().toISOString(),
      });
    }
    await refreshSchedule(ctx, scheduleId);
    expect(await automaticOccurrenceDate(ctx, plan())).toBe('2026-11-16');
    expect(new Date(plan().nextRunAt ?? 0).toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });
});
