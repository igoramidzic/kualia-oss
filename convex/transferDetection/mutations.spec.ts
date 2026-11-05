import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import { isValidManualTransferPlaceholder } from './findCounterpart';
import {
  canFinalizePendingTransferMatch,
  validateLinkedTransferApprovalPair,
  validateSingleTransferApprovalTransaction,
  validateTransferApprovalAccountEligibility,
} from './mutations';

type SuggestedTransferStatus = NonNullable<Doc<'transaction'>['suggestedTransfer']>['status'];

function suggestion(
  status: SuggestedTransferStatus,
  matchedTransactionId?: Id<'transaction'>,
  suggestedCounterpartAccountId?: Id<'bankAccount'>
): NonNullable<Doc<'transaction'>['suggestedTransfer']> {
  return {
    transferConfidence: 90,
    accountConfidence: 90,
    suggestedCounterpartAccountId,
    matchedTransactionId,
    detectionReason: 'Exact opposite-side match',
    status,
  };
}

function transaction(
  id: string,
  bankAccountId: string,
  totalAmount: bigint,
  matchedTransactionId?: string,
  overrides: Partial<Doc<'transaction'>> = {}
): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    workspaceId: 'workspace' as Id<'workspace'>,
    bankAccountId: bankAccountId as Id<'bankAccount'>,
    isDeleted: false,
    type: 'regular',
    totalAmount,
    suggestedTransfer: suggestion('linked_pending_approval', matchedTransactionId as Id<'transaction'> | undefined),
    ...overrides,
  } as unknown as Doc<'transaction'>;
}

describe('validateSingleTransferApprovalTransaction', () => {
  it('accepts only an unlinked regular pending suggestion', () => {
    const pending = transaction('transaction', 'source_account', -10_000n, undefined, {
      suggestedTransfer: suggestion('pending'),
    });

    expect(validateSingleTransferApprovalTransaction(pending, true).status).toBe('pending');
    expect(() =>
      validateSingleTransferApprovalTransaction(
        {
          ...pending,
          suggestedTransfer: suggestion('pending', 'unexpected_match' as Id<'transaction'>),
        },
        true
      )
    ).toThrow('unlinked regular transaction');
  });

  it('allows an unpaired approved-no-destination transfer to be completed only with an account', () => {
    const approvedWithoutDestination = transaction('transaction', 'source_account', -10_000n, undefined, {
      type: 'transfer',
      suggestedTransfer: suggestion('approved_no_destination'),
    });

    expect(validateSingleTransferApprovalTransaction(approvedWithoutDestination, true).status).toBe(
      'approved_no_destination'
    );
    expect(() => validateSingleTransferApprovalTransaction(approvedWithoutDestination, false)).toThrow('not pending');
  });
});

describe('validateLinkedTransferApprovalPair', () => {
  const workspaceId = 'workspace' as Id<'workspace'>;

  function validPair(): [Doc<'transaction'>, Doc<'transaction'>] {
    const first = transaction('first', 'checking', -10_000n, 'second', {
      suggestedTransfer: suggestion(
        'linked_pending_approval',
        'second' as Id<'transaction'>,
        'credit_card' as Id<'bankAccount'>
      ),
    });
    const second = transaction('second', 'credit_card', 10_000n, 'first', {
      suggestedTransfer: suggestion(
        'linked_pending_approval',
        'first' as Id<'transaction'>,
        'checking' as Id<'bankAccount'>
      ),
    });
    return [first, second];
  }

  it('accepts a reciprocal actionable exact opposite-side pair', () => {
    const [first, second] = validPair();
    expect(validateLinkedTransferApprovalPair(first, second, workspaceId).pairedSuggestion.status).toBe(
      'linked_pending_approval'
    );
  });

  it('rejects cross-workspace, same-account, and nonreciprocal pairs', () => {
    const [first, second] = validPair();

    expect(() =>
      validateLinkedTransferApprovalPair(
        first,
        { ...second, workspaceId: 'other_workspace' as Id<'workspace'> },
        workspaceId
      )
    ).toThrow('this workspace');
    expect(() =>
      validateLinkedTransferApprovalPair(first, { ...second, bankAccountId: first.bankAccountId }, workspaceId)
    ).toThrow('different accounts');
    expect(() =>
      validateLinkedTransferApprovalPair(
        first,
        {
          ...second,
          suggestedTransfer: suggestion('linked_pending_approval', 'third' as Id<'transaction'>),
        },
        workspaceId
      )
    ).toThrow('reference each other');
  });

  it.each([
    [0n, 0n],
    [-10_000n, -10_000n],
    [-10_000n, 9_999n],
  ])('rejects invalid linked amounts %s and %s', (firstAmount, secondAmount) => {
    const [first, second] = validPair();
    expect(() =>
      validateLinkedTransferApprovalPair(
        { ...first, totalAmount: firstAmount },
        { ...second, totalAmount: secondAmount },
        workspaceId
      )
    ).toThrow('exact opposite non-zero amounts');
  });

  it('rejects a terminal or already-converted paired transaction', () => {
    const [first, second] = validPair();
    expect(() =>
      validateLinkedTransferApprovalPair(first, { ...second, suggestedTransfer: suggestion('rejected') }, workspaceId)
    ).toThrow('reference each other');
    expect(() =>
      validateLinkedTransferApprovalPair(first, { ...second, type: 'transfer', transferPairId: first._id }, workspaceId)
    ).toThrow('unpaired regular transactions');
  });
});

describe('approval helper invariants', () => {
  const workspaceId = 'workspace' as Id<'workspace'>;

  it('requires an open transfer-eligible destination account', () => {
    const destination = {
      _id: 'destination' as Id<'bankAccount'>,
      workspaceId,
      accountType: 'banking_checking',
      isDeleted: false,
      isClosed: false,
    } as const;

    expect(() => validateTransferApprovalAccountEligibility(destination, 'destination', true)).not.toThrow();
    expect(() =>
      validateTransferApprovalAccountEligibility({ ...destination, isClosed: true }, 'destination', true)
    ).toThrow('closed');
    expect(() =>
      validateTransferApprovalAccountEligibility({ ...destination, accountType: 'loan_mortgage' }, 'destination', true)
    ).toThrow('Investment and Loan');
  });

  it('requires a reciprocal placeholder before deduplication', () => {
    const placeholder = transaction('placeholder', 'checking', 10_000n, undefined, {
      source: 'manual',
      type: 'transfer',
      transferPairId: 'pair' as Id<'transaction'>,
      transferPairBankAccountId: 'savings' as Id<'bankAccount'>,
    });
    const pair = transaction('pair', 'savings', -10_000n, undefined, {
      type: 'transfer',
      transferPairId: 'placeholder' as Id<'transaction'>,
      transferPairBankAccountId: 'checking' as Id<'bankAccount'>,
    });

    expect(isValidManualTransferPlaceholder(placeholder, pair, workspaceId, new Set(['checking', 'savings']))).toBe(
      true
    );
    expect(
      isValidManualTransferPlaceholder(
        placeholder,
        { ...pair, transferPairId: 'other' as Id<'transaction'> },
        workspaceId,
        new Set(['checking', 'savings'])
      )
    ).toBe(false);
  });

  it('does not revive rejected, expired, deleted, or cross-workspace pending rows', () => {
    const pending = {
      workspaceId,
      status: 'awaiting_counterpart',
      isDeleted: false,
    } as const;
    expect(canFinalizePendingTransferMatch(pending, workspaceId, 'approved')).toBe(true);
    expect(canFinalizePendingTransferMatch({ ...pending, status: 'user_rejected' }, workspaceId, 'approved')).toBe(
      false
    );
    expect(canFinalizePendingTransferMatch({ ...pending, status: 'expired' }, workspaceId, 'rejected')).toBe(false);
    expect(canFinalizePendingTransferMatch({ ...pending, isDeleted: true }, workspaceId, 'approved')).toBe(false);
    expect(
      canFinalizePendingTransferMatch(
        { ...pending, workspaceId: 'other_workspace' as Id<'workspace'> },
        workspaceId,
        'approved'
      )
    ).toBe(false);
  });
});
