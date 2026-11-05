import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { dateAtHourInTimezoneMs } from '../lib/dates';
import {
  advanceScheduledReminder,
  computeNextUnresolvedReminderAt,
  listDueScheduledReminders,
  processScheduledReminders,
} from './reminders';

type FakeRecord = Record<string, unknown> & { _id: string };

class FakeIndexBuilder {
  lowerExclusive = Number.NEGATIVE_INFINITY;
  upperInclusive = Number.POSITIVE_INFINITY;
  readonly filters: { field: string; value: unknown }[] = [];
  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }

  gt(_field: string, value: number): FakeIndexBuilder {
    this.lowerExclusive = value;
    return this;
  }

  lte(_field: string, value: number): FakeIndexBuilder {
    this.upperInclusive = value;
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly lowerExclusive = Number.NEGATIVE_INFINITY,
    private readonly upperInclusive = Number.POSITIVE_INFINITY,
    private readonly filters: { field: string; value: unknown }[] = []
  ) {}

  withIndex(_indexName: string, callback: (builder: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = callback(new FakeIndexBuilder());
    return new FakeQuery(this.records, builder.lowerExclusive, builder.upperInclusive, builder.filters);
  }

  async take(limit: number): Promise<FakeRecord[]> {
    return this.records
      .filter((record) => {
        const timestamp = record.nextReminderAt;
        return (
          this.filters.every(({ field, value }) => record[field] === value) &&
          (this.lowerExclusive === Number.NEGATIVE_INFINITY ||
            (typeof timestamp === 'number' && timestamp > this.lowerExclusive)) &&
          (this.upperInclusive === Number.POSITIVE_INFINITY ||
            (typeof timestamp === 'number' && timestamp <= this.upperInclusive))
        );
      })
      .slice(0, limit);
  }

  async unique(): Promise<FakeRecord | null> {
    return (await this.take(1))[0] ?? null;
  }
}

class FakeDb {
  constructor(
    private readonly schedules: FakeRecord[],
    private readonly recordsById: Map<string, FakeRecord>
  ) {}

  query(tableName: string): FakeQuery {
    return new FakeQuery(
      tableName === 'scheduledTransaction'
        ? this.schedules
        : [...this.recordsById.values()].filter((record) => record.occurrenceDate !== undefined)
    );
  }

  readonly patch = vi.fn(async (id: string, values: Record<string, unknown>) => {
    const record = await this.get(id);
    if (record) Object.assign(record, values);
  });

  async get(id: string): Promise<FakeRecord | null> {
    return this.recordsById.get(id) ?? this.schedules.find((record) => record._id === id) ?? null;
  }
}

describe('listDueScheduledReminders', () => {
  it('keeps reminders older than one hour eligible while excluding future reminders', async () => {
    const now = Date.parse('2026-07-09T12:00:00.000Z');
    const workspace = { _id: 'workspace-1', isArchived: false };
    const merchant = { _id: 'merchant-1', name: 'Rent' };
    const baseSchedule = {
      _id: 'scheduled-overdue',
      workspaceId: workspace._id,
      merchantId: merchant._id,
      isDeleted: false,
      status: 'active',
      reminderEnabled: true,
      reminderOffset: 'on_due_date',
      movements: [{ amount: -10000n }],
      nextDate: '2026-07-09',
    };
    const schedules = [
      { ...baseSchedule, nextReminderAt: now - 2 * 60 * 60 * 1000 },
      { ...baseSchedule, _id: 'scheduled-future', nextReminderAt: now + 1 },
    ];
    const ctx = {
      db: new FakeDb(
        schedules,
        new Map<string, FakeRecord>([
          [workspace._id, workspace],
          [merchant._id, merchant],
        ])
      ),
    } as unknown as QueryCtx;

    const result = await listDueScheduledReminders(ctx, { asOf: now, limit: 200 });

    expect(result).toEqual([
      {
        scheduledTransactionId: 'scheduled-overdue',
        workspaceId: workspace._id,
        displayName: 'Rent',
        amount: -10000n,
        nextDate: '2026-07-09',
        reminderOffset: 'on_due_date',
        reminderAt: now - 2 * 60 * 60 * 1000,
        sendReminder: true,
      },
    ]);
  });
});

describe('reminders for specific planned occurrences', () => {
  const reminderAt = (date: string, timezone = 'America/New_York') => dateAtHourInTimezoneMs(date, 9, timezone);
  function setup(
    options: { paid?: string[]; skipped?: string[]; pending?: string[]; overrides?: Record<string, unknown> } = {}
  ) {
    const scheduled: FakeRecord = {
      _id: 'schedule',
      workspaceId: 'workspace',
      isDeleted: false,
      status: 'active',
      nextDate: '2026-09-16',
      anchorDate: '2026-09-16',
      recurrence: 'monthly',
      scheduleRevision: 0,
      reminderEnabled: true,
      reminderOffset: '1_day_before',
      movements: [{ amount: -12000n }],
      nextReminderAt: reminderAt('2026-10-15'),
      ...options.overrides,
    };
    const records = new Map<string, FakeRecord>([['workspace', { _id: 'workspace', timezone: 'America/New_York' }]]);
    for (const [status, dates] of [
      ['paid', options.paid],
      ['skipped', options.skipped],
      ['pending', options.pending],
    ] as const) {
      for (const date of dates ?? [])
        records.set(`${status}-${date}`, {
          _id: `${status}-${date}`,
          workspaceId: 'workspace',
          scheduledTransactionId: 'schedule',
          scheduleRevision: 0,
          occurrenceDate: date,
          status,
          manualOnly: status === 'pending',
        });
    }
    const db = new FakeDb([scheduled], records);
    return {
      ctx: { db } as unknown as MutationCtx,
      db,
      scheduled: scheduled as unknown as Doc<'scheduledTransaction'>,
    };
  }
  afterEach(() => vi.useRealTimers());

  it('reports the bill date represented by the reminder instead of an older reopened bill', async () => {
    const { ctx } = setup({ pending: ['2026-09-16'] });
    const results = await listDueScheduledReminders(ctx, { asOf: reminderAt('2026-10-15'), limit: 200 });
    expect(results).toMatchObject([{ nextDate: '2026-10-16', sendReminder: true }]);
  });

  it.each(['paid', 'skipped'] as const)(
    'suppresses %s occurrences while keeping their reminders eligible for advancement',
    async (status) => {
      const { ctx } = setup({ [status]: ['2026-10-16'] });
      const results = await listDueScheduledReminders(ctx, { asOf: reminderAt('2026-10-15'), limit: 200 });
      expect(results).toMatchObject([{ nextDate: '2026-10-16', sendReminder: false }]);
    }
  );

  it('finds the next unpaid reminder beyond already paid and skipped future occurrences', async () => {
    const { ctx, scheduled } = setup({ paid: ['2026-10-16'], skipped: ['2026-11-16'], pending: ['2026-09-16'] });
    expect(await computeNextUnresolvedReminderAt(ctx, scheduled, 'America/New_York', reminderAt('2026-09-17'))).toBe(
      reminderAt('2026-12-15')
    );
  });

  it('derives reminder dates in the workspace timezone across UTC date boundaries', async () => {
    const { ctx } = setup({
      overrides: {
        reminderOffset: '1_week_before',
        nextReminderAt: reminderAt('2026-10-09', 'Pacific/Auckland'),
      },
    });
    const workspace = await ctx.db.get('workspace' as Id<'workspace'>);
    if (!workspace) throw new Error('Missing workspace');
    await ctx.db.patch(workspace._id, { timezone: 'Pacific/Auckland' });
    const results = await listDueScheduledReminders(ctx, { asOf: reminderAt('2026-10-10'), limit: 200 });
    expect(results).toMatchObject([{ nextDate: '2026-10-16' }]);
  });

  it('advances suppression-only reminders without sending a notification', async () => {
    const { ctx } = setup({ paid: ['2026-10-16'] });
    const reminders = await listDueScheduledReminders(ctx, { asOf: reminderAt('2026-10-15'), limit: 200 });
    const runAction = vi.fn(async () => null);
    const runMutation = vi.fn(async () => null);
    const handler = (
      processScheduledReminders as unknown as { _handler: (context: ActionCtx, args: object) => Promise<void> }
    )._handler;
    await handler({ runQuery: async () => reminders, runAction, runMutation } as unknown as ActionCtx, {});
    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      scheduledTransactionId: 'schedule',
      expectedReminderAt: reminderAt('2026-10-15'),
    });
  });

  it('advances only the reminder without changing a reopened bill or its automatic-entry cursor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(reminderAt('2026-10-15'));
    const { ctx, db, scheduled } = setup({
      skipped: ['2026-11-16'],
      pending: ['2026-09-16'],
      overrides: {
        nextUnprocessedDate: '2026-11-16',
        nextRunAt: 123,
      },
    });
    const handler = (
      advanceScheduledReminder as unknown as {
        _handler: (
          context: MutationCtx,
          args: { scheduledTransactionId: Id<'scheduledTransaction'>; expectedReminderAt: number }
        ) => Promise<void>;
      }
    )._handler;
    await handler(ctx, { scheduledTransactionId: scheduled._id, expectedReminderAt: reminderAt('2026-10-15') });
    expect(db.patch).toHaveBeenCalledExactlyOnceWith(scheduled._id, { nextReminderAt: reminderAt('2026-12-15') });
    expect(scheduled).toMatchObject({ nextDate: '2026-09-16', nextUnprocessedDate: '2026-11-16', nextRunAt: 123 });
    db.patch.mockClear();
    await handler(ctx, { scheduledTransactionId: scheduled._id, expectedReminderAt: reminderAt('2026-10-15') });
    expect(db.patch).not.toHaveBeenCalled();
  });
});
