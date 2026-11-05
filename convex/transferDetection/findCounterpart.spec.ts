import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';

import type { CounterpartCache } from './findCounterpart';
import {
  findCounterpart,
  isAvailableRegularTransferCounterpart,
  isValidPendingTransferMatchSource,
} from './findCounterpart';

type SuggestedTransferStatus = NonNullable<Doc<'transaction'>['suggestedTransfer']>['status'];

function existingTransaction(id: string, suggestedTransferStatus?: SuggestedTransferStatus): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    bankAccountId: 'destination_account' as Id<'bankAccount'>,
    totalAmount: 10_000n,
    date: '2026-08-30',
    type: 'regular',
    transferPairId: undefined,
    suggestedTransfer: suggestedTransferStatus ? { status: suggestedTransferStatus } : undefined,
  } as unknown as Doc<'transaction'>;
}

describe('findCounterpart', () => {
  it('selects the next exact durable match without consuming either cache entry', () => {
    const first = existingTransaction('first_match');
    const second = existingTransaction('second_match');
    const cache: CounterpartCache = {
      bankAccounts: [],
      pendingMatches: [],
      existingTransactions: new Map([['destination_account', [first, second]]]),
      manualTransferTransactions: new Map(),
      batchTransactions: new Map(),
    };

    const result = findCounterpart(
      {
        workspaceId: 'workspace' as Id<'workspace'>,
        sourceBankAccountId: 'source_account' as Id<'bankAccount'>,
        amount: -10_000n,
        date: '2026-08-30',
        rawTransactionId: 'raw_transaction' as Id<'transactionImportRaw'>,
        excludedMatchedTransactionIds: new Set(['first_match']),
      },
      cache
    );

    expect(result.matchType).toBe('existing_match');
    expect(result.matchedTransactionId).toBe('second_match');
    expect(cache.existingTransactions.get('destination_account')).toEqual([first, second]);
  });

  it('never reuses a transaction after the user rejected its transfer suggestion', () => {
    const rejected = existingTransaction('rejected_match', 'rejected');
    const available = existingTransaction('available_match');
    const cache: CounterpartCache = {
      bankAccounts: [],
      pendingMatches: [],
      existingTransactions: new Map([['destination_account', [rejected, available]]]),
      manualTransferTransactions: new Map(),
      batchTransactions: new Map(),
    };

    const result = findCounterpart(
      {
        workspaceId: 'workspace' as Id<'workspace'>,
        sourceBankAccountId: 'source_account' as Id<'bankAccount'>,
        amount: -10_000n,
        date: '2026-08-30',
        rawTransactionId: 'raw_transaction' as Id<'transactionImportRaw'>,
      },
      cache
    );

    expect(result.matchType).toBe('existing_match');
    expect(result.matchedTransactionId).toBe('available_match');
  });

  it('returns no match when the only exact counterpart was rejected', () => {
    const cache: CounterpartCache = {
      bankAccounts: [],
      pendingMatches: [],
      existingTransactions: new Map([['destination_account', [existingTransaction('rejected_match', 'rejected')]]]),
      manualTransferTransactions: new Map(),
      batchTransactions: new Map(),
    };

    const result = findCounterpart(
      {
        workspaceId: 'workspace' as Id<'workspace'>,
        sourceBankAccountId: 'source_account' as Id<'bankAccount'>,
        amount: -10_000n,
        date: '2026-08-30',
        rawTransactionId: 'raw_transaction' as Id<'transactionImportRaw'>,
      },
      cache
    );

    expect(result.matchType).toBe('no_match');
  });

  it('skips a counterpart already reserved by another linked suggestion', () => {
    const reserved = existingTransaction('reserved_match', 'linked_pending_approval');
    const available = existingTransaction('available_match', 'pending');
    const cache: CounterpartCache = {
      bankAccounts: [],
      pendingMatches: [],
      existingTransactions: new Map([['destination_account', [reserved, available]]]),
      manualTransferTransactions: new Map(),
      batchTransactions: new Map(),
    };

    const result = findCounterpart(
      {
        workspaceId: 'workspace' as Id<'workspace'>,
        sourceBankAccountId: 'source_account' as Id<'bankAccount'>,
        amount: -10_000n,
        date: '2026-08-30',
        rawTransactionId: 'raw_transaction' as Id<'transactionImportRaw'>,
      },
      cache
    );

    expect(result.matchType).toBe('existing_match');
    expect(result.matchedTransactionId).toBe('available_match');
  });

  it('keeps an unlinked pending suggestion eligible as a counterpart', () => {
    expect(isAvailableRegularTransferCounterpart(existingTransaction('pending_match', 'pending'))).toBe(true);
    expect(
      isAvailableRegularTransferCounterpart({
        ...existingTransaction('reserved_pending', 'pending'),
        suggestedTransfer: {
          status: 'pending',
          matchedTransactionId: 'other_transaction' as Id<'transaction'>,
        },
      } as Doc<'transaction'>)
    ).toBe(false);
    expect(
      isAvailableRegularTransferCounterpart({
        ...existingTransaction('partial_pair'),
        transferPairBankAccountId: 'other_account' as Id<'bankAccount'>,
      })
    ).toBe(false);
  });

  it('accepts pending rows only when their source ownership and account metadata agree', () => {
    const workspaceId = 'workspace' as Id<'workspace'>;
    const accountId = 'destination_account' as Id<'bankAccount'>;
    const source = {
      ...existingTransaction('pending_match', 'pending'),
      workspaceId,
      bankAccountId: accountId,
      isDeleted: false,
    };
    const pending = {
      workspaceId,
      sourceBankAccountId: accountId,
      expectedAmount: -10_000n,
      expectedDateMin: '2026-08-27',
      expectedDateMax: '2026-09-02',
      expiresAt: '2026-09-30T00:00:00.000Z',
    };
    const timestamp = '2026-08-30T00:00:00.000Z';

    expect(isValidPendingTransferMatchSource(source, pending, workspaceId, new Set([accountId]), timestamp)).toBe(true);
    expect(
      isValidPendingTransferMatchSource(
        { ...source, workspaceId: 'other_workspace' as Id<'workspace'> },
        pending,
        workspaceId,
        new Set([accountId]),
        timestamp
      )
    ).toBe(false);
    expect(
      isValidPendingTransferMatchSource(
        source,
        { ...pending, sourceBankAccountId: 'other_account' as Id<'bankAccount'> },
        workspaceId,
        new Set([accountId]),
        timestamp
      )
    ).toBe(false);
    expect(
      isValidPendingTransferMatchSource(
        source,
        { ...pending, expectedAmount: -9_999n },
        workspaceId,
        new Set([accountId]),
        timestamp
      )
    ).toBe(false);
    expect(
      isValidPendingTransferMatchSource(
        source,
        { ...pending, expiresAt: timestamp },
        workspaceId,
        new Set([accountId]),
        timestamp
      )
    ).toBe(false);
  });
});
