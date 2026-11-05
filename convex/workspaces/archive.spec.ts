import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { scheduledScanFieldsForArchiveState, syncScheduledTransactionScanFields } from './archive';
import { updateWorkspaceTimezone } from './update';

vi.mock('../lib/auth', () => ({ requireWorkspaceManagementAccess: vi.fn() }));

function scheduledRecord(overrides: Partial<Doc<'scheduledTransaction'>> = {}): Doc<'scheduledTransaction'> {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: 1,
    workspaceId: 'workspace-1' as Id<'workspace'>,
    transactionType: 'regular',
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    entryStatus: 'pending',
    entryMode: 'auto',
    movements: [{ amount: -5000n }],
    recurrence: 'monthly',
    anchorDate: '2026-07-15',
    nextDate: '2026-07-15',
    nextRunAt: 1,
    status: 'active',
    executionCount: 0,
    reminderEnabled: true,
    reminderOffset: 'on_due_date',
    nextReminderAt: 2,
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

describe('scheduledScanFieldsForArchiveState', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z');

  it('removes archived schedules from entry and reminder indexes', () => {
    expect(scheduledScanFieldsForArchiveState(scheduledRecord(), { isArchived: true, timezone: 'UTC', now })).toEqual({
      nextRunAt: undefined,
      nextReminderAt: undefined,
      updatedAt: '2026-07-09T12:00:00.000Z',
    });
  });

  it('recomputes scan timestamps when an active workspace is restored', () => {
    const fields = scheduledScanFieldsForArchiveState(scheduledRecord(), {
      isArchived: false,
      timezone: 'UTC',
      now,
    });

    expect(fields.nextRunAt).toBe(Date.parse('2026-07-15T07:00:00.000Z'));
    expect(fields.nextReminderAt).toBe(Date.parse('2026-07-15T09:00:00.000Z'));
  });
});

describe('workspace changes preserve reopened planned occurrences', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-09-16T12:00:00Z')));
  afterEach(() => vi.useRealTimers());

  function setup() {
    const schedule = scheduledRecord({
      anchorDate: '2026-09-16',
      nextDate: '2026-09-16',
      nextUnprocessedDate: '2026-10-16',
      reminderEnabled: false,
    });
    const records = new Map<string, Record<string, unknown>>([
      [schedule._id, schedule],
      [schedule.workspaceId, { _id: schedule.workspaceId, timezone: 'UTC', isArchived: false }],
      [
        'occurrence',
        {
          _id: 'occurrence',
          workspaceId: schedule.workspaceId,
          scheduledTransactionId: schedule._id,
          scheduleRevision: 0,
          occurrenceDate: '2026-09-16',
          status: 'pending',
          manualOnly: true,
          expectedAmount: -5000n,
          isTransfer: false,
        },
      ],
    ]);
    const ctx = {
      db: {
        get: async (id: string) => records.get(id) ?? null,
        patch: async (id: string, fields: Record<string, unknown>) => {
          records.set(id, { ...records.get(id), ...fields });
        },
        query: (table: string) => {
          let rows = [...records.values()].filter((row) =>
            table === 'scheduledTransaction' ? row._id === schedule._id : row._id === 'occurrence'
          );
          const query = {
            withIndex: (
              _name: string,
              callback: (builder: { eq: (field: string, value: unknown) => object }) => unknown
            ) => {
              const builder = {
                eq: (field: string, value: unknown) => {
                  rows = rows.filter((row) => row[field] === value);
                  return builder;
                },
              };
              callback(builder);
              return query;
            },
            unique: async () => rows[0] ?? null,
            first: async () => rows[0] ?? null,
            collect: async () => rows,
            paginate: async () => ({ page: rows, isDone: true, continueCursor: '' }),
          };
          return query;
        },
      },
    } as unknown as MutationCtx;
    return { ctx, records, schedule };
  }

  it('updates the automatic cursor in the new timezone without scheduling the reopened bill', async () => {
    const { ctx, records, schedule } = setup();
    const handler = (
      updateWorkspaceTimezone as unknown as {
        _handler: (ctx: MutationCtx, args: { workspaceId: Id<'workspace'>; timezone: string }) => Promise<unknown>;
      }
    )._handler;
    await handler(ctx, { workspaceId: schedule.workspaceId, timezone: 'America/New_York' });
    expect(records.get(schedule._id)).toMatchObject({
      nextDate: '2026-09-16',
      nextUnprocessedDate: '2026-10-16',
      nextRunAt: Date.parse('2026-10-16T11:00:00Z'),
    });
  });

  it('unarchives the future automatic cursor while preserving a reopened bill', async () => {
    const { ctx, records, schedule } = setup();
    const handler = (
      syncScheduledTransactionScanFields as unknown as {
        _handler: (
          ctx: MutationCtx,
          args: {
            workspaceId: Id<'workspace'>;
            isArchived: boolean;
            cursor: string | null;
          }
        ) => Promise<unknown>;
      }
    )._handler;
    await handler(ctx, { workspaceId: schedule.workspaceId, isArchived: false, cursor: null });
    expect(records.get(schedule._id)).toMatchObject({
      nextDate: '2026-09-16',
      nextUnprocessedDate: '2026-10-16',
      nextRunAt: Date.parse('2026-10-16T07:00:00Z'),
    });
  });
});
