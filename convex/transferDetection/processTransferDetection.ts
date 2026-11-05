import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { type DetectionResult, detectTransferFromRaw, TRANSFER_CONFIDENCE_THRESHOLD } from './detectTransfer';
import {
  type CounterpartCache,
  calculateExpectedDateRange,
  findCounterpart,
  initializeCounterpartCache,
  isTransferEligibleAccountType,
  markBatchTransactionMatched,
  registerBatchTransaction,
} from './findCounterpart';

/**
 * Transfer Detection Processing
 *
 * Main entry point for processing transfer detection on a batch of raw transactions.
 * Integrates detection and counterpart finding algorithms.
 */

export interface TransferDetectionResult {
  rawTransactionId: Id<'transactionImportRaw'>;
  isLikelyTransfer: boolean;
  transferConfidence: number;
  detectionReason: string;
  accountConfidence?: number;
  suggestedCounterpartAccountId?: Id<'bankAccount'>;
  matchedTransactionId?: Id<'transaction'>;
  linkedRawTransactionId?: Id<'transactionImportRaw'>; // If matched in same batch
  matchType?: TransferMatchType;
  alternativeMatchedCounterparts?: TransferMatchedCounterpart[];
}

export type TransferMatchType =
  | 'pending_match'
  | 'batch_match'
  | 'existing_match'
  | 'manual_transfer_match'
  | 'credit_card_inference'
  | 'no_match';

export type DurableTransferMatchType = 'pending_match' | 'existing_match' | 'manual_transfer_match';

export type TransferMatchedCounterpart = {
  matchedTransactionId: Id<'transaction'>;
  matchType: DurableTransferMatchType;
  transferConfidence: number;
  detectionReason: string;
  accountConfidence?: number;
  suggestedCounterpartAccountId?: Id<'bankAccount'>;
};

const CONFIRMED_COUNTERPART_MATCH_TYPES: ReadonlySet<TransferMatchType> = new Set([
  'pending_match',
  'batch_match',
  'existing_match',
  'manual_transfer_match',
]);

export function hasConfirmedTransferCounterpart(matchType: TransferMatchType | undefined): boolean {
  return matchType !== undefined && CONFIRMED_COUNTERPART_MATCH_TYPES.has(matchType);
}

function isDurableTransferMatchType(matchType: TransferMatchType): matchType is DurableTransferMatchType {
  return matchType === 'pending_match' || matchType === 'existing_match' || matchType === 'manual_transfer_match';
}

export function selectAvailableTransferCounterpart(
  detectionResult: TransferDetectionResult | undefined,
  claimedMatchedTransactionIds: ReadonlySet<string>
): TransferDetectionResult | undefined {
  if (
    !detectionResult?.matchedTransactionId ||
    !claimedMatchedTransactionIds.has(detectionResult.matchedTransactionId.toString())
  ) {
    return detectionResult;
  }

  const alternative = detectionResult.alternativeMatchedCounterparts?.find(
    (candidate) => !claimedMatchedTransactionIds.has(candidate.matchedTransactionId.toString())
  );
  if (!alternative) {
    return detectionResult;
  }

  return {
    ...detectionResult,
    ...alternative,
  };
}

/**
 * Precision-first promotion: account transfers need an exact opposite-side
 * counterpart. A strong provider classification can stand alone only for a
 * credit-card payment, and payment-app transactions always need a counterpart.
 */
export function shouldPromoteTransferCandidate(
  detection: Pick<DetectionResult, 'isTransferCandidate' | 'isStrongCreditCardPayment' | 'requiresCounterpart'>,
  matchType: TransferMatchType | undefined
): boolean {
  if (!detection.isTransferCandidate) {
    return false;
  }
  if (hasConfirmedTransferCounterpart(matchType)) {
    return true;
  }
  return detection.isStrongCreditCardPayment && !detection.requiresCounterpart;
}

export type TransferImportDisposition = {
  shouldSuggestTransfer: boolean;
  shouldCreatePendingMatch: boolean;
  shouldConfirmPendingMatch: boolean;
};

/**
 * A high-confidence planned match or existing manual regular match represents
 * explicit user intent and takes precedence over an automated transfer
 * suggestion. Counterpart claims are resolved after that veto so a rejected
 * candidate cannot consume a match that a later actionable import needs.
 */
export function resolveTransferImportDisposition(
  detectionResult: TransferDetectionResult | undefined,
  hasExplicitRegularMatch: boolean,
  isMatchedCounterpartAvailable = true
): TransferImportDisposition {
  const shouldSuggestTransfer =
    Boolean(detectionResult?.isLikelyTransfer) && !hasExplicitRegularMatch && isMatchedCounterpartAvailable;

  return {
    shouldSuggestTransfer,
    shouldCreatePendingMatch:
      shouldSuggestTransfer &&
      (detectionResult?.matchType === 'no_match' || detectionResult?.matchType === 'credit_card_inference'),
    shouldConfirmPendingMatch: shouldSuggestTransfer && detectionResult?.matchType === 'pending_match',
  };
}

export function normalizeBatchTransferPair(
  first: TransferDetectionResult,
  second: TransferDetectionResult,
  firstAccountId: Id<'bankAccount'>,
  secondAccountId: Id<'bankAccount'>
): void {
  first.linkedRawTransactionId = second.rawTransactionId;
  second.linkedRawTransactionId = first.rawTransactionId;
  first.isLikelyTransfer = true;
  second.isLikelyTransfer = true;
  first.matchType = 'batch_match';
  second.matchType = 'batch_match';
  first.matchedTransactionId = undefined;
  second.matchedTransactionId = undefined;
  first.alternativeMatchedCounterparts = undefined;
  second.alternativeMatchedCounterparts = undefined;
  first.accountConfidence = 90;
  second.accountConfidence = 90;
  first.transferConfidence = Math.max(first.transferConfidence, 90);
  second.transferConfidence = Math.max(second.transferConfidence, 90);
  first.suggestedCounterpartAccountId = secondAccountId;
  second.suggestedCounterpartAccountId = firstAccountId;
  first.detectionReason = 'Exact opposite-side transaction found in another linked account';
  second.detectionReason = 'Exact opposite-side transaction found in another linked account';
}

export function reserveBatchTransferPair(
  reservedRawTransactionIds: Set<string>,
  firstRawTransactionId: Id<'transactionImportRaw'>,
  secondRawTransactionId: Id<'transactionImportRaw'>
): boolean {
  const firstId = firstRawTransactionId.toString();
  const secondId = secondRawTransactionId.toString();
  if (reservedRawTransactionIds.has(firstId) || reservedRawTransactionIds.has(secondId)) {
    return false;
  }
  reservedRawTransactionIds.add(firstId);
  reservedRawTransactionIds.add(secondId);
  return true;
}

function toMatchedCounterpart(
  detection: DetectionResult,
  counterpart: ReturnType<typeof findCounterpart>
): TransferMatchedCounterpart | null {
  if (!counterpart.matchedTransactionId || !isDurableTransferMatchType(counterpart.matchType)) {
    return null;
  }

  return {
    matchedTransactionId: counterpart.matchedTransactionId,
    matchType: counterpart.matchType,
    transferConfidence: Math.max(detection.transferConfidence, counterpart.accountConfidence ?? 0),
    detectionReason: counterpart.matchReason
      ? `${detection.detectionReason}; ${counterpart.matchReason}`
      : detection.detectionReason,
    accountConfidence: counterpart.accountConfidence,
    suggestedCounterpartAccountId: counterpart.suggestedAccountId,
  };
}

interface ProcessingContext {
  workspaceId: Id<'workspace'>;
  rawTransactions: Doc<'transactionImportRaw'>[];
  bankAccountMap: Map<string, Doc<'bankAccount'>>; // plaidAccountId -> bankAccount
  bankLinkAccountMap: Map<string, { _id: Id<'bankLinkAccount'>; plaidAccountId: string }>; // plaidAccountId -> bankLinkAccount
}

export function isEligibleTransferDetectionSourceAccount(
  account: Pick<Doc<'bankAccount'>, 'accountType' | 'isDeleted' | 'workspaceId'>,
  workspaceId: Id<'workspace'>
): boolean {
  return (
    !account.isDeleted && account.workspaceId === workspaceId && isTransferEligibleAccountType(account.accountType)
  );
}

/**
 * Process transfer detection for a batch of raw transactions.
 * Returns detection results for each transaction that should be flagged as a potential transfer.
 */
export async function processTransferDetection(
  ctx: MutationCtx,
  processingContext: ProcessingContext
): Promise<Map<string, TransferDetectionResult>> {
  const results = new Map<string, TransferDetectionResult>();

  // Initialize counterpart cache
  const cache = await initializeCounterpartCache(ctx, processingContext.workspaceId);

  // First pass: Run detection on all transactions and register them in batch cache
  const detectionResults = new Map<
    string,
    {
      rawTxn: Doc<'transactionImportRaw'>;
      bankAccountId: Id<'bankAccount'>;
      detection: ReturnType<typeof detectTransferFromRaw>;
    }
  >();

  for (const rawTxn of processingContext.rawTransactions) {
    // Get bank account for this raw transaction
    const bankLinkAccount = processingContext.bankLinkAccountMap.get(rawTxn.plaidAccountId);
    if (!bankLinkAccount) continue;

    const bankAccount = processingContext.bankAccountMap.get(bankLinkAccount._id.toString());
    if (!bankAccount) continue;
    if (!isEligibleTransferDetectionSourceAccount(bankAccount, processingContext.workspaceId)) continue;

    // Run detection algorithm
    const detection = detectTransferFromRaw(rawTxn);

    // Store detection result
    detectionResults.set(rawTxn._id.toString(), {
      rawTxn,
      bankAccountId: bankAccount._id,
      detection,
    });

    // Register low-confidence candidates too. They never reach the UI on their
    // own, but an exact opposite-side transaction can confirm them.
    if (detection.isTransferCandidate) {
      registerBatchTransaction(cache, rawTxn._id, bankAccount._id, rawTxn.amount, rawTxn.date);
    }
  }

  // Second pass: find exact counterparts and decide which candidates are
  // actionable. Pending rows are deliberately deferred until import-time
  // planned matching has had a chance to veto the suggestion.
  const reservedBatchRawTransactionIds = new Set<string>();

  for (const [rawTxnIdStr, { rawTxn, bankAccountId, detection }] of detectionResults) {
    if (!detection.isTransferCandidate) {
      continue;
    }
    if (reservedBatchRawTransactionIds.has(rawTxnIdStr)) {
      continue;
    }

    const counterpartInput = {
      workspaceId: processingContext.workspaceId,
      sourceBankAccountId: bankAccountId,
      amount: rawTxn.amount,
      date: rawTxn.date,
      rawTransactionId: rawTxn._id,
    };
    const counterpartResult = findCounterpart(counterpartInput, cache);

    const alternativeMatchedCounterparts: TransferMatchedCounterpart[] = [];
    if (counterpartResult.matchedTransactionId) {
      const excludedMatchedTransactionIds = new Set([counterpartResult.matchedTransactionId.toString()]);
      const maximumAlternatives = Math.max(0, processingContext.rawTransactions.length - 1);

      while (alternativeMatchedCounterparts.length < maximumAlternatives) {
        const alternativeResult = findCounterpart(
          {
            ...counterpartInput,
            excludedMatchedTransactionIds,
          },
          cache
        );
        const alternative = toMatchedCounterpart(detection, alternativeResult);
        if (!alternative) {
          break;
        }
        alternativeMatchedCounterparts.push(alternative);
        excludedMatchedTransactionIds.add(alternative.matchedTransactionId.toString());
      }
    }

    const isLikelyTransfer = shouldPromoteTransferCandidate(detection, counterpartResult.matchType);
    const accountConfidence = counterpartResult.accountConfidence;
    const transferConfidence = hasConfirmedTransferCounterpart(counterpartResult.matchType)
      ? Math.max(detection.transferConfidence, accountConfidence ?? 0)
      : detection.transferConfidence;
    const detectionReason = counterpartResult.matchReason
      ? `${detection.detectionReason}; ${counterpartResult.matchReason}`
      : detection.detectionReason;

    const result: TransferDetectionResult = {
      rawTransactionId: rawTxn._id,
      isLikelyTransfer,
      transferConfidence,
      detectionReason,
      accountConfidence,
      suggestedCounterpartAccountId: counterpartResult.suggestedAccountId,
      matchedTransactionId: counterpartResult.matchedTransactionId,
      matchType: counterpartResult.matchType,
      alternativeMatchedCounterparts:
        alternativeMatchedCounterparts.length > 0 ? alternativeMatchedCounterparts : undefined,
    };

    // Handle different match types
    if (counterpartResult.matchType === 'batch_match') {
      // Find the matching raw transaction in the batch
      const matchingBatchTxn = findMatchingBatchTransaction(cache, rawTxn, bankAccountId);
      const matchingDetection = matchingBatchTxn
        ? detectionResults.get(matchingBatchTxn.rawTransactionId.toString())
        : undefined;
      if (
        matchingBatchTxn &&
        matchingDetection &&
        reserveBatchTransferPair(reservedBatchRawTransactionIds, rawTxn._id, matchingBatchTxn.rawTransactionId)
      ) {
        const pairedResult: TransferDetectionResult = {
          rawTransactionId: matchingBatchTxn.rawTransactionId,
          isLikelyTransfer: false,
          transferConfidence: matchingDetection.detection.transferConfidence,
          detectionReason: matchingDetection.detection.detectionReason,
          matchType: 'no_match',
        };
        normalizeBatchTransferPair(result, pairedResult, bankAccountId, matchingBatchTxn.bankAccountId);

        // Mark both as matched to prevent double-matching
        markBatchTransactionMatched(cache, rawTxn._id);
        markBatchTransactionMatched(cache, matchingBatchTxn.rawTransactionId);
        results.set(matchingBatchTxn.rawTransactionId.toString(), pairedResult);
      }
    } else if (counterpartResult.matchType === 'manual_transfer_match' && counterpartResult.matchedTransactionId) {
      // Found a manually-created transfer placeholder - no pending match needed
      // The transaction will be linked to the existing manual transfer in processRawTransactionImports
      // matchedTransactionId is already set in the result
      // Mark this import's batch entry as matched to prevent other imports from batch-matching with it
      markBatchTransactionMatched(cache, rawTxn._id);
      console.log(
        `[TRANSFER] Found manual transfer match: raw ${rawTxn._id} -> existing txn ${counterpartResult.matchedTransactionId}`
      );
    } else if (counterpartResult.matchType === 'existing_match' && counterpartResult.matchedTransactionId) {
      // Found existing transaction match - no pending match needed, counterpart already identified
      console.log(
        `[TRANSFER] Found existing transaction match: raw ${rawTxn._id} -> existing txn ${counterpartResult.matchedTransactionId}`
      );
    }

    results.set(rawTxnIdStr, result);
  }

  return results;
}

/**
 * Find a matching transaction in the batch with opposite amount.
 */
function findMatchingBatchTransaction(
  cache: CounterpartCache,
  rawTxn: Doc<'transactionImportRaw'>,
  sourceBankAccountId: Id<'bankAccount'>
): { rawTransactionId: Id<'transactionImportRaw'>; bankAccountId: Id<'bankAccount'> } | null {
  const expectedAmount = -rawTxn.amount;
  const inputDate = new Date(rawTxn.date);
  const minDate = new Date(inputDate);
  minDate.setDate(minDate.getDate() - 3);
  const maxDate = new Date(inputDate);
  maxDate.setDate(maxDate.getDate() + 3);
  const minDateStr = minDate.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

  for (const [, batchTxn] of cache.batchTransactions) {
    if (
      batchTxn.rawTransactionId.toString() === rawTxn._id.toString() ||
      batchTxn.alreadyMatched ||
      batchTxn.bankAccountId.toString() === sourceBankAccountId.toString()
    ) {
      continue;
    }

    if (batchTxn.amount === expectedAmount && batchTxn.date >= minDateStr && batchTxn.date <= maxDateStr) {
      return {
        rawTransactionId: batchTxn.rawTransactionId,
        bankAccountId: batchTxn.bankAccountId,
      };
    }
  }

  return null;
}

/**
 * Update an existing pending match record when the counterpart is found.
 */
export async function markPendingTransferMatchAsMatched(
  ctx: MutationCtx,
  sourceTransactionId: Id<'transaction'>,
  counterpartTransactionId: Id<'transaction'>,
  timestamp: string
): Promise<void> {
  // Find the pending match for this transaction
  const pendingMatch = await ctx.db
    .query('pendingTransferMatch')
    .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', sourceTransactionId))
    .first();

  if (pendingMatch && pendingMatch.status === 'awaiting_counterpart') {
    await ctx.db.patch(pendingMatch._id, {
      status: 'matched',
      matchedTransactionId: counterpartTransactionId,
      matchedAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

/**
 * Create a pending transfer match record.
 * Called after a transaction is created to track pending transfers.
 */
export async function createPendingTransferMatch(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionId: Id<'transaction'>,
  bankAccountId: Id<'bankAccount'>,
  amount: bigint,
  date: string,
  detectionResult: TransferDetectionResult
): Promise<Id<'pendingTransferMatch'> | null> {
  // Pending rows are only useful for actionable, currently unmatched
  // suggestions. Exact matches and planned-vetoed candidates must not create
  // durable transfer state.
  if (
    !detectionResult.isLikelyTransfer ||
    (detectionResult.matchType !== 'no_match' && detectionResult.matchType !== 'credit_card_inference') ||
    detectionResult.linkedRawTransactionId ||
    detectionResult.matchedTransactionId
  ) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const { expectedDateMin, expectedDateMax } = calculateExpectedDateRange(date);

  // Expire after 30 days
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const pendingMatchId = await ctx.db.insert('pendingTransferMatch', {
    workspaceId,
    sourceTransactionId: transactionId,
    sourceBankAccountId: bankAccountId,
    expectedAmount: -amount, // Opposite sign for counterpart
    expectedDateMin,
    expectedDateMax,
    suggestedCounterpartAccountId: detectionResult.suggestedCounterpartAccountId,
    transferConfidence: detectionResult.transferConfidence,
    accountConfidence: detectionResult.accountConfidence,
    detectionReason: detectionResult.detectionReason,
    status: 'awaiting_counterpart',
    createdAt: timestamp,
    expiresAt: expiresAt.toISOString(),
    updatedAt: timestamp,
    isDeleted: false,
  });

  return pendingMatchId;
}

/**
 * Build the suggestedTransfer object for a transaction.
 */
export function buildSuggestedTransferObject(
  detectionResult: TransferDetectionResult,
  linkedTransactionId?: Id<'transaction'>
): {
  transferConfidence: number;
  accountConfidence?: number;
  suggestedCounterpartAccountId?: Id<'bankAccount'>;
  matchedTransactionId?: Id<'transaction'>;
  detectionReason: string;
  status: 'pending' | 'linked_pending_approval';
} {
  const isLinked = !!linkedTransactionId || !!detectionResult.matchedTransactionId;

  return {
    transferConfidence: detectionResult.transferConfidence,
    accountConfidence: detectionResult.accountConfidence,
    suggestedCounterpartAccountId: detectionResult.suggestedCounterpartAccountId,
    matchedTransactionId: linkedTransactionId ?? detectionResult.matchedTransactionId,
    detectionReason: detectionResult.detectionReason,
    status: isLinked ? 'linked_pending_approval' : 'pending',
  };
}

export { TRANSFER_CONFIDENCE_THRESHOLD };
