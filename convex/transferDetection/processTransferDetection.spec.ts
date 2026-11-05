import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import type { DetectionResult } from './detectTransfer';
import type { TransferDetectionResult } from './processTransferDetection';
import {
  createPendingTransferMatch,
  isEligibleTransferDetectionSourceAccount,
  markPendingTransferMatchAsMatched,
  normalizeBatchTransferPair,
  reserveBatchTransferPair,
  resolveTransferImportDisposition,
  selectAvailableTransferCounterpart,
  shouldPromoteTransferCandidate,
} from './processTransferDetection';

describe('isEligibleTransferDetectionSourceAccount', () => {
  const workspaceId = 'workspace' as Id<'workspace'>;
  const account = {
    workspaceId,
    accountType: 'banking_checking',
    isDeleted: false,
  } as Pick<Doc<'bankAccount'>, 'accountType' | 'isDeleted' | 'workspaceId'>;

  it('excludes deleted, cross-workspace, and unsupported source accounts', () => {
    expect(isEligibleTransferDetectionSourceAccount(account, workspaceId)).toBe(true);
    expect(isEligibleTransferDetectionSourceAccount({ ...account, isDeleted: true }, workspaceId)).toBe(false);
    expect(
      isEligibleTransferDetectionSourceAccount(
        { ...account, workspaceId: 'other_workspace' as Id<'workspace'> },
        workspaceId
      )
    ).toBe(false);
    expect(isEligibleTransferDetectionSourceAccount({ ...account, accountType: 'loan_mortgage' }, workspaceId)).toBe(
      false
    );
  });
});

function detectorResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    isTransferCandidate: true,
    isLikelyTransfer: false,
    isStrongCreditCardPayment: false,
    requiresCounterpart: false,
    transferKind: 'account_transfer',
    transferConfidence: 45,
    detectionReason: 'Provider classification',
    matchedSignals: [],
    ...overrides,
  };
}

function processedResult(overrides: Partial<TransferDetectionResult> = {}): TransferDetectionResult {
  return {
    rawTransactionId: 'raw_transaction' as Id<'transactionImportRaw'>,
    isLikelyTransfer: true,
    transferConfidence: 90,
    detectionReason: 'Exact opposite-side match',
    matchType: 'batch_match',
    ...overrides,
  };
}

describe('shouldPromoteTransferCandidate', () => {
  it('requires a real counterpart for an ordinary account-transfer candidate', () => {
    const detection = detectorResult();

    expect(shouldPromoteTransferCandidate(detection, 'no_match')).toBe(false);
    expect(shouldPromoteTransferCandidate(detection, 'credit_card_inference')).toBe(false);
    expect(shouldPromoteTransferCandidate(detection, 'batch_match')).toBe(true);
    expect(shouldPromoteTransferCandidate(detection, 'existing_match')).toBe(true);
  });

  it('allows a strong credit-card payment without an imported counterpart', () => {
    const detection = detectorResult({
      isLikelyTransfer: true,
      isStrongCreditCardPayment: true,
      transferKind: 'credit_card_payment',
      transferConfidence: 70,
    });

    expect(shouldPromoteTransferCandidate(detection, 'credit_card_inference')).toBe(true);
    expect(shouldPromoteTransferCandidate(detection, 'no_match')).toBe(true);
  });

  it('still requires a counterpart when a strong provider label belongs to a payment app', () => {
    const detection = detectorResult({
      isLikelyTransfer: true,
      isStrongCreditCardPayment: true,
      requiresCounterpart: true,
      transferKind: 'credit_card_payment',
      transferConfidence: 70,
    });

    expect(shouldPromoteTransferCandidate(detection, 'no_match')).toBe(false);
    expect(shouldPromoteTransferCandidate(detection, 'batch_match')).toBe(true);
  });
});

describe('normalizeBatchTransferPair', () => {
  it('clears stale durable matches from the second half of a confirmed batch pair', () => {
    const first = processedResult({
      rawTransactionId: 'first_raw' as Id<'transactionImportRaw'>,
      matchedTransactionId: 'stale_first_match' as Id<'transaction'>,
      matchType: 'pending_match',
    });
    const second = processedResult({
      rawTransactionId: 'second_raw' as Id<'transactionImportRaw'>,
      matchedTransactionId: 'stale_second_match' as Id<'transaction'>,
      matchType: 'existing_match',
      accountConfidence: 95,
    });

    normalizeBatchTransferPair(
      first,
      second,
      'first_account' as Id<'bankAccount'>,
      'second_account' as Id<'bankAccount'>
    );

    expect(first.matchedTransactionId).toBeUndefined();
    expect(second.matchedTransactionId).toBeUndefined();
    expect(first.linkedRawTransactionId).toBe('second_raw');
    expect(second.linkedRawTransactionId).toBe('first_raw');
    expect(first.accountConfidence).toBe(90);
    expect(second.accountConfidence).toBe(90);
    expect(first.matchType).toBe('batch_match');
    expect(second.matchType).toBe('batch_match');
  });
});

describe('reserveBatchTransferPair', () => {
  it('keeps four same-amount rows in two disjoint pairs instead of an overlapping chain', () => {
    const reserved = new Set<string>();
    const rawA = 'raw_a' as Id<'transactionImportRaw'>;
    const rawB = 'raw_b' as Id<'transactionImportRaw'>;
    const rawC = 'raw_c' as Id<'transactionImportRaw'>;
    const rawD = 'raw_d' as Id<'transactionImportRaw'>;

    expect(reserveBatchTransferPair(reserved, rawA, rawB)).toBe(true);
    expect(reserveBatchTransferPair(reserved, rawB, rawC)).toBe(false);
    expect(reserveBatchTransferPair(reserved, rawC, rawD)).toBe(true);
    expect(reserved).toEqual(new Set(['raw_a', 'raw_b', 'raw_c', 'raw_d']));
  });
});

describe('selectAvailableTransferCounterpart', () => {
  it('falls through to the next durable match when the first one is already claimed', () => {
    const result = processedResult({
      matchedTransactionId: 'first_match' as Id<'transaction'>,
      matchType: 'existing_match',
      alternativeMatchedCounterparts: [
        {
          matchedTransactionId: 'second_match' as Id<'transaction'>,
          matchType: 'existing_match',
          transferConfidence: 85,
          detectionReason: 'Second exact match',
          suggestedCounterpartAccountId: 'second_account' as Id<'bankAccount'>,
          accountConfidence: 85,
        },
      ],
    });

    const selected = selectAvailableTransferCounterpart(result, new Set(['first_match']));

    expect(selected?.matchedTransactionId).toBe('second_match');
    expect(selected?.suggestedCounterpartAccountId).toBe('second_account');
    expect(selected?.detectionReason).toBe('Second exact match');
  });
});

describe('resolveTransferImportDisposition', () => {
  it('lets a high-confidence planned match preempt an otherwise actionable transfer', () => {
    const disposition = resolveTransferImportDisposition(processedResult(), true);

    expect(disposition).toEqual({
      shouldSuggestTransfer: false,
      shouldCreatePendingMatch: false,
      shouldConfirmPendingMatch: false,
    });
  });

  it('creates pending state only for an actionable unmatched suggestion', () => {
    expect(resolveTransferImportDisposition(processedResult({ matchType: 'no_match' }), false)).toEqual({
      shouldSuggestTransfer: true,
      shouldCreatePendingMatch: true,
      shouldConfirmPendingMatch: false,
    });

    expect(
      resolveTransferImportDisposition(processedResult({ isLikelyTransfer: false, matchType: 'no_match' }), false)
    ).toEqual({
      shouldSuggestTransfer: false,
      shouldCreatePendingMatch: false,
      shouldConfirmPendingMatch: false,
    });
  });

  it('confirms an existing pending match only after the suggestion survives planned matching', () => {
    expect(resolveTransferImportDisposition(processedResult({ matchType: 'pending_match' }), false)).toEqual({
      shouldSuggestTransfer: true,
      shouldCreatePendingMatch: false,
      shouldConfirmPendingMatch: true,
    });
  });

  it('does not let two imports claim the same durable counterpart', () => {
    expect(resolveTransferImportDisposition(processedResult({ matchType: 'existing_match' }), false, false)).toEqual({
      shouldSuggestTransfer: false,
      shouldCreatePendingMatch: false,
      shouldConfirmPendingMatch: false,
    });
  });
});

describe('createPendingTransferMatch', () => {
  it('does not persist a row for a non-actionable candidate', async () => {
    const insert = vi.fn();
    const ctx = { db: { insert } } as unknown as MutationCtx;

    const pendingId = await createPendingTransferMatch(
      ctx,
      'workspace' as Id<'workspace'>,
      'transaction' as Id<'transaction'>,
      'account' as Id<'bankAccount'>,
      -1_000n,
      '2026-08-30',
      processedResult({ isLikelyTransfer: false, matchType: 'no_match' })
    );

    expect(pendingId).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('markPendingTransferMatchAsMatched', () => {
  it('persists the actual imported counterpart transaction ID', async () => {
    const patch = vi.fn();
    const first = vi.fn().mockResolvedValue({
      _id: 'pending_match' as Id<'pendingTransferMatch'>,
      status: 'awaiting_counterpart',
    });
    const withIndex = vi.fn().mockReturnValue({ first });
    const query = vi.fn().mockReturnValue({ withIndex });
    const ctx = { db: { query, patch } } as unknown as MutationCtx;

    await markPendingTransferMatchAsMatched(
      ctx,
      'source_transaction' as Id<'transaction'>,
      'counterpart_transaction' as Id<'transaction'>,
      '2026-08-30T12:00:00.000Z'
    );

    expect(patch).toHaveBeenCalledWith('pending_match', {
      status: 'matched',
      matchedTransactionId: 'counterpart_transaction',
      matchedAt: '2026-08-30T12:00:00.000Z',
      updatedAt: '2026-08-30T12:00:00.000Z',
    });
  });
});
