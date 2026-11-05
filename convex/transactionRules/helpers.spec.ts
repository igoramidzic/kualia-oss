import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { applyRulesToTransaction } from './helpers';
import { applyRuleToExisting } from './update';

vi.mock('../lib/auth', () => ({
  requireWorkspaceAccess: async (_ctx: unknown, workspaceId: string) => ({
    workspaceId,
    user: { subject: 'user' },
  }),
}));
vi.mock('../activityLogs/helpers', () => ({
  buildActivityContext: vi.fn(),
  recordTransactionActivity: vi.fn(),
}));

describe('merchant rules reconcile planned occurrences', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-09-16T12:00:00Z')));
  afterEach(() => vi.useRealTimers());

  function setup(merchantId: string) {
    const workspaceId = 'workspace' as Id<'workspace'>;
    const transactionId = 'transaction' as Id<'transaction'>;
    const ruleId = 'rule' as Id<'transactionRule'>;
    const records = new Map<string, Record<string, unknown>>([
      [workspaceId, { _id: workspaceId, timezone: 'UTC' }],
      ['account', { _id: 'account', workspaceId, accountType: 'banking_checking', isDeleted: false }],
      ['merchant', { _id: 'merchant', workspaceId, name: 'Original merchant' }],
      [
        'schedule',
        {
          _id: 'schedule',
          workspaceId,
          bankAccountId: 'account',
          merchantId: 'merchant',
          transactionType: 'regular',
          entryStatus: 'cleared',
          entryMode: 'manual',
          movements: [{ amount: -5000n }],
          recurrence: 'monthly',
          anchorDate: '2026-09-16',
          nextDate: '2026-10-16',
          nextUnprocessedDate: '2026-10-16',
          status: 'active',
          executionCount: 1,
          reminderEnabled: false,
          isDeleted: false,
        },
      ],
      [
        'occurrence',
        {
          _id: 'occurrence',
          workspaceId,
          scheduledTransactionId: 'schedule',
          scheduleRevision: 0,
          occurrenceDate: '2026-09-16',
          status: 'paid',
          transactionId,
          expectedAmount: -5000n,
          isTransfer: false,
        },
      ],
      [
        transactionId,
        {
          _id: transactionId,
          workspaceId,
          bankAccountId: 'account',
          merchantId: 'merchant',
          type: 'regular',
          date: '2026-09-16',
          status: 'cleared',
          source: 'manual',
          isDeleted: false,
          totalAmount: -5000n,
          movements: [{ amount: -5000n, readyToAssign: false, sortOrder: 0 }],
          scheduledTransactionId: 'schedule',
          scheduledOccurrenceDate: '2026-09-16',
          scheduledOccurrenceRevision: 0,
        },
      ],
      [
        ruleId,
        {
          _id: ruleId,
          workspaceId,
          conditions: {},
          actions: { setMerchantId: merchantId },
          isActive: true,
          isDeleted: false,
          priority: 0,
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
          const tableIds: Record<string, string[]> = {
            transaction: [transactionId],
            transactionRule: [ruleId],
            scheduledTransactionOccurrence: ['occurrence'],
          };
          let rows = (tableIds[table] ?? []).map((id) => records.get(id)!);
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
            filter: () => query,
            unique: async () => rows[0] ?? null,
            first: async () => rows[0] ?? null,
            collect: async () => rows,
            take: async (count: number) => rows.slice(0, count),
          };
          return query;
        },
      },
      runMutation: vi.fn(),
    } as unknown as MutationCtx;
    return { ctx, records, workspaceId, transactionId, ruleId };
  }

  it.each(['automatic', 'existing'] as const)('reopens the bill after a merchant-only %s rule edit', async (mode) => {
    const { ctx, records, workspaceId, transactionId, ruleId } = setup('replacement');
    if (mode === 'automatic') {
      await applyRulesToTransaction(ctx, workspaceId, transactionId);
    } else {
      const handler = (
        applyRuleToExisting as unknown as {
          _handler: (
            ctx: MutationCtx,
            args: { workspaceId: Id<'workspace'>; id: Id<'transactionRule'> }
          ) => Promise<unknown>;
        }
      )._handler;
      await handler(ctx, { workspaceId, id: ruleId });
    }
    expect(records.get(transactionId)).toMatchObject({ merchantId: 'replacement', scheduledTransactionId: undefined });
    expect(records.get('occurrence')).toMatchObject({ status: 'pending', manualOnly: true, transactionId: undefined });
    expect(records.get('schedule')).toMatchObject({ nextDate: '2026-09-16', executionCount: 0 });
  });

  it('keeps a paid occurrence when the rule retains its existing merchant', async () => {
    const { ctx, records, workspaceId, transactionId } = setup('merchant');
    await applyRulesToTransaction(ctx, workspaceId, transactionId);
    expect(records.get(transactionId)?.scheduledTransactionId).toBe('schedule');
    expect(records.get('occurrence')?.status).toBe('paid');
    expect(records.get('schedule')?.nextDate).toBe('2026-10-16');
  });
});
