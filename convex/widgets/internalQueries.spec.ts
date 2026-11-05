import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getUpcomingRecurringForWidget } from './internalQueries';

const { plannedData } = vi.hoisted(() => ({ plannedData: vi.fn<() => Promise<unknown>>() }));
vi.mock('../scheduledTransactions/plannedData', () => ({ listPlannedTransactionsDataCore: plannedData }));

const upcomingQuery = getUpcomingRecurringForWidget as unknown as {
  _handler: (
    ctx: QueryCtx,
    args: { workspaceId: Id<'workspace'>; today: string; expensesOnly?: boolean }
  ) => Promise<{ recurringTransactionId: string; amount: number; isIncome: boolean; isOverdue: boolean }[]>;
};

function occurrence(id: string, expectedAmount: bigint, date = '2026-09-08', isTransfer = false) {
  return {
    scheduledTransactionId: id,
    occurrenceDate: date,
    isTransfer,
    coverage: { expectedAmount, status: 'upcoming' },
  };
}

describe('upcoming widget compatibility', () => {
  beforeEach(() => plannedData.mockReset());

  it('preserves positive legacy amounts and income entries while adding direction', async () => {
    plannedData.mockResolvedValue({
      allPlannedTransactions: [],
      plannedByMonth: {
        202609: [
          occurrence('income', 50_000n),
          occurrence('bill', -10_000n),
          occurrence('transfer', -5_000n, undefined, true),
        ],
      },
    });
    await expect(
      upcomingQuery._handler({} as QueryCtx, { workspaceId: 'workspace_1' as Id<'workspace'>, today: '2026-09-07' })
    ).resolves.toEqual([
      {
        recurringTransactionId: 'income',
        merchantName: 'Unknown',
        amount: 50_000,
        isIncome: true,
        dueDate: '2026-09-08',
        isOverdue: false,
      },
      {
        recurringTransactionId: 'bill',
        merchantName: 'Unknown',
        amount: 10_000,
        isIncome: false,
        dueDate: '2026-09-08',
        isOverdue: false,
      },
    ]);
  });

  it('filters income before applying the six-row limit and continues to future months for bills', async () => {
    plannedData.mockResolvedValue({
      allPlannedTransactions: [],
      plannedByMonth: {
        202609: Array.from({ length: 8 }, (_, index) => occurrence(`income_${index}`, 50_000n)),
        202610: [occurrence('next_month_bill', -10_000n, '2026-10-01')],
      },
    });
    const result = await upcomingQuery._handler({} as QueryCtx, {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      today: '2026-09-07',
      expensesOnly: true,
    });
    expect(result).toEqual([
      {
        recurringTransactionId: 'next_month_bill',
        merchantName: 'Unknown',
        amount: 10_000,
        isIncome: false,
        dueDate: '2026-10-01',
        isOverdue: false,
      },
    ]);
  });
});
