import { type FunctionArgs, type FunctionReturnType, getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { dateAtHourInTimezoneMs } from '../lib/dates';
import { enterScheduledTransaction } from './enter';
import {
  buildScheduledTransactionRestorePatch,
  enterScheduledTransactionNow,
  skipScheduledTransaction,
  undoScheduledTransactionEntry,
  updateScheduledTransaction,
} from './mutations';
import { releaseOccurrence } from './occurrences';

vi.mock('../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));

import { SCHEDULED_ENTRY_HOUR, SCHEDULED_REMINDER_HOUR } from './recurrence';

vi.mock('./enter', () => ({ enterScheduledTransaction: vi.fn() }));
vi.mock('../activityLogs/helpers', () => ({ buildActivityContext: vi.fn() }));

vi.mock('../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));

describe('buildScheduledTransactionRestorePatch', () => {
  it('rebuilds cron and reminder fields for an active automatic schedule', () => {
    const now = Date.parse('2026-08-03T12:00:00.000Z');

    const patch = buildScheduledTransactionRestorePatch(
      {
        status: 'active',
        entryMode: 'auto',
        nextDate: '2026-08-15',
        recurrence: 'monthly',
        anchorDate: '2026-08-15',
        reminderEnabled: true,
        reminderOffset: '1_day_before',
      },
      'America/New_York',
      now
    );

    expect(patch).toMatchObject({
      isDeleted: false,
      deletedAt: undefined,
      nextRunAt: dateAtHourInTimezoneMs('2026-08-15', SCHEDULED_ENTRY_HOUR, 'America/New_York'),
      nextReminderAt: dateAtHourInTimezoneMs('2026-08-14', SCHEDULED_REMINDER_HOUR, 'America/New_York'),
      updatedAt: '2026-08-03T12:00:00.000Z',
    });
  });

  it('keeps cron and reminder fields cleared for a paused manual schedule', () => {
    const patch = buildScheduledTransactionRestorePatch(
      {
        status: 'paused',
        entryMode: 'manual',
        nextDate: '2026-08-15',
        recurrence: 'monthly',
        anchorDate: '2026-08-15',
        reminderEnabled: true,
        reminderOffset: 'on_due_date',
      },
      'UTC',
      Date.parse('2026-08-03T12:00:00.000Z')
    );

    expect(patch.nextRunAt).toBeUndefined();
    expect(patch.nextReminderAt).toBeUndefined();
  });
});

type SkipArgs = FunctionArgs<typeof api.scheduledTransactions.skipScheduledTransaction>;
const skipHandler = (
  skipScheduledTransaction as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: SkipArgs
    ) => Promise<FunctionReturnType<typeof api.scheduledTransactions.skipScheduledTransaction>>;
  }
)._handler;
const enterHandler = (
  enterScheduledTransactionNow as unknown as {
    _handler: (ctx: MutationCtx, args: SkipArgs) => Promise<unknown>;
  }
)._handler;

describe('planned occurrence actions', () => {
  beforeEach(() => vi.resetAllMocks());

  function setup(recurrence: 'once' | 'monthly' = 'once') {
    const workspaceId = 'workspace' as Id<'workspace'>;
    const schedule = {
      _id: 'plan' as Id<'scheduledTransaction'>,
      _creationTime: 1,
      workspaceId,
      bankAccountId: 'bank' as Id<'bankAccount'>,
      transactionType: 'regular',
      entryStatus: 'pending',
      entryMode: 'manual',
      movements: [{ amount: -12000n }],
      recurrence,
      anchorDate: '2099-01-31',
      nextDate: '2099-01-31',
      status: 'active',
      executionCount: 0,
      updatedAt: '2026-09-01T00:00:00.000Z',
      isDeleted: false,
    } satisfies Doc<'scheduledTransaction'>;
    const records = new Map<string, Record<string, unknown>>([
      [schedule._id, schedule],
      [workspaceId, { timezone: 'UTC' }],
    ]);
    const db = {
      get: vi.fn(async (id: string) => records.get(id) ?? null),
      query: (table: string) => queryRecords(records.values(), table),
      insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${records.size}`;
        records.set(id, { ...value, _id: id, _creationTime: 1 });
        return id;
      }),
      patch: vi.fn(async (id: string, value: Record<string, unknown>) => {
        const record = records.get(id);
        if (record) Object.assign(record, value);
      }),
    };
    vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId } as Awaited<
      ReturnType<typeof requireWorkspaceAccess>
    >);
    const ctx = { db } as unknown as MutationCtx;
    return {
      db,
      ctx,
      records,
      schedule,
      args: { workspaceId, scheduledTransactionId: schedule._id, expectedNextDate: schedule.nextDate },
    };
  }

  it('can enter the preserved next date after changing only the recurrence', async () => {
    const { ctx, db, records, schedule, args } = setup('monthly');
    records.set(schedule._id, { ...schedule, anchorDate: '2099-08-16', nextDate: '2099-09-16' });
    records.set(schedule.bankAccountId, {
      _id: schedule.bankAccountId,
      workspaceId: schedule.workspaceId,
      name: 'Checking',
      accountType: 'banking_checking',
      isDeleted: false,
      currentBalance: 0n,
      clearedBalance: 0n,
      pendingBalance: 0n,
    });
    const updateHandler = (
      updateScheduledTransaction as unknown as {
        _handler: (
          ctx: MutationCtx,
          args: FunctionArgs<typeof api.scheduledTransactions.updateScheduledTransaction>
        ) => Promise<unknown>;
      }
    )._handler;
    await updateHandler(ctx, {
      workspaceId: args.workspaceId,
      scheduledTransactionId: schedule._id,
      recurrence: 'weekly',
    });
    expect(records.get(schedule._id)).toMatchObject({
      anchorDate: '2099-09-16',
      nextDate: '2099-09-16',
      recurrence: 'weekly',
      scheduleRevision: 1,
    });
    const updated = await ctx.db.get(schedule._id);
    if (!updated) throw new Error('Schedule missing');
    const actual = await vi.importActual<typeof import('./enter')>('./enter');
    const entryContext = { ...ctx, runMutation: vi.fn() } as unknown as MutationCtx;
    const result = await actual.enterScheduledTransaction(entryContext, updated, {
      date: '2099-09-16',
      timezone: 'UTC',
      reviewStatus: 'reviewed',
      advance: 'single',
    });
    expect(result).toMatchObject({ status: 'active', nextDate: '2099-09-23' });
    expect(records.get(result.transactionId)).toMatchObject({
      scheduledTransactionId: schedule._id,
      scheduledOccurrenceDate: '2099-09-16',
      scheduledOccurrenceRevision: 1,
    });
    expect(db.insert).toHaveBeenCalledWith(
      'scheduledTransactionOccurrence',
      expect.objectContaining({
        occurrenceDate: '2099-09-16',
        scheduleRevision: 1,
        status: 'paid',
      })
    );
  });

  it('captures the prior occurrence and the newly recorded entry for Undo', async () => {
    const { db, ctx, schedule, args } = setup('monthly');
    const transactionId = 'recorded' as Id<'transaction'>;
    const entryTime = '2026-09-06T12:00:00.000Z';
    let didEnter = false;
    vi.mocked(requireWorkspaceAccess).mockResolvedValue({
      workspaceId: args.workspaceId,
      user: { subject: 'user' },
    } as Awaited<ReturnType<typeof requireWorkspaceAccess>>);
    db.get.mockImplementation(async (id) => {
      if (id === transactionId) return { _id: transactionId, updatedAt: entryTime } as unknown as typeof schedule;
      if (id === schedule._id) return didEnter ? { ...schedule, updatedAt: entryTime, executionCount: 1 } : schedule;
      return { timezone: 'UTC' };
    });
    vi.mocked(enterScheduledTransaction).mockImplementation(async () => {
      didEnter = true;
      return { transactionId, status: 'active', nextDate: '2099-02-28' };
    });
    const before = Date.now();
    expect(await enterHandler(ctx, args)).toMatchObject({ transactionId, nextDate: '2099-02-28' });
    expect(db.patch).toHaveBeenCalledWith(transactionId, {
      scheduledEntryUndo: {
        nextDate: '2099-01-31',
        executionCount: 0,
        lastEnteredAt: undefined,
        lastEnteredTransactionId: undefined,
        scheduleUpdatedAt: entryTime,
        transactionUpdatedAt: entryTime,
        pairUpdatedAt: undefined,
        expiresAt: expect.any(Number),
      },
    });
    const captured = db.patch.mock.calls[0] as unknown as [string, { scheduledEntryUndo: { expiresAt: number } }];
    expect(captured[1].scheduledEntryUndo.expiresAt).toBeGreaterThanOrEqual(before + 60000);
    expect(captured[1].scheduledEntryUndo.expiresAt).toBeLessThanOrEqual(Date.now() + 60000);
  });

  it('persists the skipped amount/date before completing a one-time schedule', async () => {
    const { db, ctx, schedule, args } = setup();
    const result = await skipHandler(ctx, args);
    expect(db.insert).toHaveBeenCalledWith(
      'scheduledTransactionSkip',
      expect.objectContaining({
        workspaceId: args.workspaceId,
        scheduledTransactionId: schedule._id,
        occurrenceDate: '2099-01-31',
        expectedAmount: -12000n,
        isTransfer: false,
        isDeleted: false,
      })
    );
    expect(result.status).toBe('completed');
    expect(db.patch).toHaveBeenCalledWith(schedule._id, expect.objectContaining({ status: 'completed' }));
  });

  it('advances a monthly plan using its original month-end anchor', async () => {
    const { db, ctx, args } = setup('monthly');
    const result = await skipHandler(ctx, args);
    expect(result).toMatchObject({ status: 'active', nextDate: '2099-02-28' });
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledWith(
      'scheduledTransactionOccurrence',
      expect.objectContaining({ occurrenceDate: '2099-01-31', status: 'skipped' })
    );
  });

  it('rejects stale skip and record commands before writing anything', async () => {
    const { db, ctx, args } = setup('monthly');
    const stale = { ...args, expectedNextDate: '2098-12-31' };
    await expect(skipHandler(ctx, stale)).rejects.toThrow('This plan has changed');
    await expect(enterHandler(ctx, stale)).rejects.toThrow('This plan has changed');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.patch).not.toHaveBeenCalled();
  });

  it('rejects a schedule owned by another workspace', async () => {
    const { db, ctx, args } = setup();
    vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId: 'other' } as Awaited<
      ReturnType<typeof requireWorkspaceAccess>
    >);
    await expect(skipHandler(ctx, args)).rejects.toThrow('Access denied');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not read or mutate when workspace authorization fails', async () => {
    const { db, ctx, args } = setup();
    vi.mocked(requireWorkspaceAccess).mockRejectedValue(new Error('Not signed in'));
    await expect(skipHandler(ctx, args)).rejects.toThrow('Not signed in');
    expect(db.get).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

type UndoArgs = FunctionArgs<typeof api.scheduledTransactions.undoScheduledTransactionEntry>;
const undoHandler = (
  undoScheduledTransactionEntry as unknown as {
    _handler: (ctx: MutationCtx, args: UndoArgs) => Promise<{ success: boolean }>;
  }
)._handler;

describe('undo recorded planned entry', () => {
  beforeEach(() => vi.resetAllMocks());
  function setup(transfer = false) {
    const workspaceId = 'workspace' as Id<'workspace'>;
    const scheduledTransactionId = 'plan' as Id<'scheduledTransaction'>;
    const transactionId = 'recorded' as Id<'transaction'>;
    const timestamp = '2026-09-06T12:00:00.000Z';
    const schedule: Doc<'scheduledTransaction'> = {
      _id: scheduledTransactionId,
      _creationTime: 1,
      workspaceId,
      bankAccountId: 'bank' as Id<'bankAccount'>,
      transactionType: transfer ? 'transfer' : 'regular',
      entryStatus: 'pending',
      entryMode: 'auto',
      movements: [{ amount: transfer ? 12000n : -12000n }],
      recurrence: 'monthly',
      anchorDate: '2026-08-31',
      nextDate: '2026-09-30',
      status: 'active',
      executionCount: 5,
      lastEnteredAt: timestamp,
      lastEnteredTransactionId: transactionId,
      updatedAt: timestamp,
      isDeleted: false,
    };
    const entry: Doc<'transaction'> = {
      _id: transactionId,
      _creationTime: 1,
      workspaceId,
      bankAccountId: schedule.bankAccountId,
      type: transfer ? 'transfer' : 'regular',
      date: '2026-09-06',
      dateYearMonth: 202609,
      movements: [],
      totalAmount: -12000n,
      status: 'pending',
      reviewStatus: 'reviewed',
      source: 'scheduled',
      searchText: '',
      hasMissingPayee: false,
      hasUncategorized: false,
      isDeleted: false,
      scheduledTransactionId,
      updatedAt: timestamp,
      transferPairId: transfer ? ('pair' as Id<'transaction'>) : undefined,
      scheduledEntryUndo: {
        nextDate: '2026-08-31',
        executionCount: 4,
        scheduleUpdatedAt: timestamp,
        transactionUpdatedAt: timestamp,
        pairUpdatedAt: transfer ? timestamp : undefined,
        expiresAt: Date.now() + 60000,
      },
    };
    const pair = { ...entry, _id: 'pair' as Id<'transaction'>, totalAmount: 12000n, transferPairId: transactionId };
    const records = new Map<string, object>([
      [transactionId, entry],
      [scheduledTransactionId, schedule],
      [pair._id, pair],
      [workspaceId, { timezone: 'America/New_York' }],
    ]);
    const get = vi.fn(async (id: string) => records.get(id) ?? null);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      const record = records.get(id);
      if (record) Object.assign(record, value);
    });
    const runMutation = vi.fn(async (): Promise<null> => {
      await releaseOccurrence(ctx, entry, false);
      entry.isDeleted = true;
      if (transfer) pair.isDeleted = true;
      return null;
    });
    const ctx = {
      db: {
        get,
        patch,
        query: (table: string) => queryRecords(records.values(), table),
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = `${table}-${records.size}`;
          records.set(id, { ...value, _id: id, _creationTime: 1 });
          return id;
        },
      },
      runMutation,
    } as unknown as MutationCtx;
    vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId } as Awaited<
      ReturnType<typeof requireWorkspaceAccess>
    >);
    return { ctx, get, patch, runMutation, schedule, entry, pair, args: { workspaceId, transactionId } };
  }

  it.each([false, true])(
    'reverses the ledger through the existing deletion path, then restores the schedule (transfer %s)',
    async (transfer) => {
      const { ctx, patch, runMutation, schedule, args } = setup(transfer);
      expect(await undoHandler(ctx, args)).toEqual({ success: true });
      const [reference, deletionArgs] = runMutation.mock.calls[0] as unknown as [
        Parameters<MutationCtx['runMutation']>[0],
        UndoArgs,
      ];
      expect(getFunctionName(reference)).toBe('transactions:deleteTransaction');
      expect(deletionArgs).toEqual(args);
      expect(runMutation).toHaveBeenCalledTimes(1);
      expect(patch).toHaveBeenCalledWith(
        schedule._id,
        expect.objectContaining({
          nextDate: '2026-08-31',
          executionCount: 4,
          status: 'active',
          lastEnteredAt: undefined,
          lastEnteredTransactionId: undefined,
          nextRunAt: dateAtHourInTimezoneMs('2026-08-31', SCHEDULED_ENTRY_HOUR, 'America/New_York'),
        })
      );
      expect(patch).toHaveBeenCalledWith(args.transactionId, { scheduledEntryUndo: undefined });
    }
  );

  it.each(['expired', 'edited', 'linked', 'reconciled', 'deleted', 'foreign', 'no-receipt'] as const)(
    'rejects an %s entry before any ledger or schedule mutation',
    async (kind) => {
      const { ctx, entry, runMutation, patch, args } = setup();
      if (kind === 'expired' && entry.scheduledEntryUndo) entry.scheduledEntryUndo.expiresAt = 0;
      if (kind === 'edited') entry.updatedAt = 'later';
      if (kind === 'linked') entry.linkedRawTransactionId = 'raw' as Id<'transactionImportRaw'>;
      if (kind === 'reconciled') entry.status = 'reconciled';
      if (kind === 'deleted') entry.isDeleted = true;
      if (kind === 'foreign') entry.workspaceId = 'other' as Id<'workspace'>;
      if (kind === 'no-receipt') entry.scheduledEntryUndo = undefined;
      await expect(undoHandler(ctx, args)).rejects.toThrow('can no longer be undone');
      expect(runMutation).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it.each(['edited', 'advanced', 'foreign'] as const)('rejects a %s schedule', async (kind) => {
    const { ctx, schedule, runMutation, patch, args } = setup();
    if (kind === 'edited') schedule.updatedAt = 'later';
    if (kind === 'advanced') schedule.executionCount += 1;
    if (kind === 'foreign') schedule.workspaceId = 'other' as Id<'workspace'>;
    await expect(undoHandler(ctx, args)).rejects.toThrow();
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each(['edited', 'linked', 'foreign'] as const)('rejects a %s transfer counterpart', async (kind) => {
    const { ctx, pair, runMutation, patch, args } = setup(true);
    if (kind === 'edited') pair.updatedAt = 'later';
    if (kind === 'linked') pair.linkedRawTransactionId = 'raw' as Id<'transactionImportRaw'>;
    if (kind === 'foreign') pair.workspaceId = 'other' as Id<'workspace'>;
    await expect(undoHandler(ctx, args)).rejects.toThrow('transfer has changed');
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not restore a plan if reversing the transaction fails', async () => {
    const { ctx, runMutation, patch, args } = setup();
    runMutation.mockRejectedValue(new Error('Cannot delete transaction'));
    await expect(undoHandler(ctx, args)).rejects.toThrow('Cannot delete');
    expect(patch).not.toHaveBeenCalled();
  });

  it('checks workspace access before reading any entry', async () => {
    const { ctx, get, runMutation, args } = setup();
    vi.mocked(requireWorkspaceAccess).mockRejectedValue(new Error('Not signed in'));
    await expect(undoHandler(ctx, args)).rejects.toThrow('Not signed in');
    expect(get).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
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
            ? row.scheduleRevision !== undefined && row.occurrenceDate !== undefined && row.status !== undefined
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
