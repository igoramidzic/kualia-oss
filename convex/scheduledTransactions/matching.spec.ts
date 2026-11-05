import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';

import {
  calculateScheduledMatchScore,
  findAutoLinkScheduledMatch,
  removeScheduledMatchingCandidate,
  type ScheduledMatchingCache,
} from './helpers';

const workspaceId = 'workspace-1' as Id<'workspace'>;
const accountId = 'bank-1' as Id<'bankAccount'>;
const merchantId = 'merchant-1' as Id<'merchant'>;
const categoryId = 'category-1' as Id<'category'>;

function scheduledRecord(overrides: Partial<Doc<'scheduledTransaction'>> = {}): Doc<'scheduledTransaction'> {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: 1,
    workspaceId,
    transactionType: 'regular',
    bankAccountId: accountId,
    merchantId,
    entryStatus: 'pending',
    entryMode: 'manual',
    movements: [{ amount: -5000n, categoryId, readyToAssign: false }],
    recurrence: 'monthly',
    anchorDate: '2026-07-15',
    nextDate: '2026-07-15',
    status: 'active',
    executionCount: 0,
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function cache(...scheduledTransactions: Doc<'scheduledTransaction'>[]): ScheduledMatchingCache {
  return {
    scheduledTransactionsByAccount: new Map([[accountId, scheduledTransactions]]),
  };
}

describe('planned transaction import matching', () => {
  it('auto-matches a high-confidence imported transaction', () => {
    const scheduled = scheduledRecord();
    const match = findAutoLinkScheduledMatch(
      {
        bankAccountId: accountId,
        merchantId,
        categoryId,
        amount: -5000n,
        date: '2026-07-17',
      },
      cache(scheduled)
    );

    expect(match).toMatchObject({
      scheduledTransaction: scheduled,
      confidence: 96,
      daysFromDue: 2,
    });
  });

  it('requires the same account and amount direction', () => {
    const scheduled = scheduledRecord();

    expect(
      calculateScheduledMatchScore(
        {
          bankAccountId: 'bank-2' as Id<'bankAccount'>,
          merchantId,
          categoryId,
          amount: -5000n,
          date: '2026-07-15',
        },
        scheduled
      )
    ).toBeNull();

    expect(
      calculateScheduledMatchScore(
        {
          bankAccountId: accountId,
          merchantId,
          categoryId,
          amount: 5000n,
          date: '2026-07-15',
        },
        scheduled
      )
    ).toBeNull();
  });

  it('does not auto-link a weak match or a transaction outside the due-date window', () => {
    const scheduled = scheduledRecord();

    expect(
      findAutoLinkScheduledMatch(
        {
          bankAccountId: accountId,
          merchantId: 'merchant-2' as Id<'merchant'>,
          categoryId: 'category-2' as Id<'category'>,
          amount: -5000n,
          date: '2026-07-15',
        },
        cache(scheduled)
      )
    ).toBeNull();

    expect(
      findAutoLinkScheduledMatch(
        {
          bankAccountId: accountId,
          merchantId,
          categoryId,
          amount: -5000n,
          date: '2026-07-21',
        },
        cache(scheduled)
      )
    ).toBeNull();
  });

  it('excludes auto-entry schedules and removes a consumed candidate from the batch cache', () => {
    const automatic = scheduledRecord({ entryMode: 'auto' });
    const manual = scheduledRecord({ _id: 'scheduled-2' as Id<'scheduledTransaction'> });
    const matchingCache = cache(automatic, manual);

    const match = findAutoLinkScheduledMatch(
      {
        bankAccountId: accountId,
        merchantId,
        categoryId,
        amount: -5000n,
        date: '2026-07-15',
      },
      matchingCache
    );

    expect(match?.scheduledTransaction._id).toBe(manual._id);

    removeScheduledMatchingCandidate(matchingCache, manual._id);

    expect(
      findAutoLinkScheduledMatch(
        {
          bankAccountId: accountId,
          merchantId,
          categoryId,
          amount: -5000n,
          date: '2026-07-15',
        },
        matchingCache
      )
    ).toBeNull();
  });
});
