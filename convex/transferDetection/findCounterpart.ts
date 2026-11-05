import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * Counterpart Finding Algorithm
 *
 * After detecting a transaction is likely a transfer, this module attempts to identify
 * which account it's transferring to/from.
 */

export interface CounterpartResult {
  suggestedAccountId?: Id<'bankAccount'>;
  accountConfidence?: number; // 0-100, undefined if no suggestion
  matchedTransactionId?: Id<'transaction'>;
  matchType:
    | 'pending_match'
    | 'batch_match'
    | 'existing_match'
    | 'manual_transfer_match'
    | 'credit_card_inference'
    | 'no_match';
  matchReason?: string;
}

interface FindCounterpartInput {
  workspaceId: Id<'workspace'>;
  sourceBankAccountId: Id<'bankAccount'>;
  amount: bigint;
  date: string;
  rawTransactionId: Id<'transactionImportRaw'>;
  excludedMatchedTransactionIds?: ReadonlySet<string>;
}

export interface CounterpartCache {
  bankAccounts: Doc<'bankAccount'>[];
  pendingMatches: Doc<'pendingTransferMatch'>[];
  existingTransactions: Map<string, Doc<'transaction'>[]>; // keyed by bankAccountId
  manualTransferTransactions: Map<string, Doc<'transaction'>[]>; // keyed by bankAccountId - manually created transfer halves awaiting real imports
  batchTransactions: Map<string, TransactionInBatch>; // keyed by rawTransactionId
}

interface TransactionInBatch {
  rawTransactionId: Id<'transactionImportRaw'>;
  bankAccountId: Id<'bankAccount'>;
  amount: bigint;
  date: string;
  alreadyMatched: boolean;
}

// Confidence levels for different match types
const CONFIDENCE = {
  PENDING_MATCH: 95, // Found in pendingTransferMatch table
  BATCH_MATCH: 90, // Found opposite in same import batch
  EXISTING_MATCH: 85, // Found in existing transactions
  MANUAL_TRANSFER_MATCH: 92, // Found manually-created transfer awaiting real import
  CREDIT_CARD_INFERENCE: 65, // Inferred single credit card account
} as const;

// Account types that support transfers
// Investment and Loan accounts are excluded - functionality not yet implemented
const TRANSFER_ELIGIBLE_ACCOUNT_TYPES = [
  // Banking
  'banking_checking',
  'banking_savings',
  'banking_cash',
  'banking_cash_management',
  'banking_money_market',
  'banking_cd',
  'banking_other',
  // Credit
  'credit_credit_card',
  'credit_line_of_credit',
  'credit_other',
] as const;

type TransferEligibleAccountType = (typeof TRANSFER_ELIGIBLE_ACCOUNT_TYPES)[number];

/**
 * Check if an account type is eligible for transfers.
 * Only Banking and Credit accounts are currently supported.
 */
export function isTransferEligibleAccountType(accountType: string): accountType is TransferEligibleAccountType {
  return TRANSFER_ELIGIBLE_ACCOUNT_TYPES.includes(accountType as TransferEligibleAccountType);
}

export function hasRejectedTransferSuggestion(transaction: Pick<Doc<'transaction'>, 'suggestedTransfer'>): boolean {
  return transaction.suggestedTransfer?.status === 'rejected';
}

/**
 * Regular transactions can be offered as a counterpart only while they are
 * unclaimed. Linked and terminal suggestions already belong to another user
 * decision and must not be silently re-linked by a later import.
 */
export function isAvailableRegularTransferCounterpart(
  transaction: Pick<Doc<'transaction'>, 'suggestedTransfer' | 'transferPairBankAccountId' | 'transferPairId' | 'type'>
): boolean {
  const suggestionStatus = transaction.suggestedTransfer?.status;
  return (
    transaction.type === 'regular' &&
    !transaction.transferPairId &&
    !transaction.transferPairBankAccountId &&
    !transaction.suggestedTransfer?.matchedTransactionId &&
    (suggestionStatus === undefined || suggestionStatus === 'pending')
  );
}

export function isValidPendingTransferMatchSource(
  sourceTransaction: Pick<
    Doc<'transaction'>,
    | 'bankAccountId'
    | 'date'
    | 'isDeleted'
    | 'suggestedTransfer'
    | 'totalAmount'
    | 'transferPairBankAccountId'
    | 'transferPairId'
    | 'type'
    | 'workspaceId'
  > | null,
  pendingMatch: Pick<
    Doc<'pendingTransferMatch'>,
    'expectedAmount' | 'expectedDateMax' | 'expectedDateMin' | 'expiresAt' | 'sourceBankAccountId' | 'workspaceId'
  >,
  workspaceId: Id<'workspace'>,
  eligibleAccountIds: ReadonlySet<string>,
  timestamp: string
): boolean {
  if (!sourceTransaction) {
    return false;
  }
  const expectedDateRange = calculateExpectedDateRange(sourceTransaction.date);
  return Boolean(
    !sourceTransaction.isDeleted &&
      pendingMatch.workspaceId === workspaceId &&
      sourceTransaction.workspaceId === workspaceId &&
      sourceTransaction.bankAccountId === pendingMatch.sourceBankAccountId &&
      eligibleAccountIds.has(sourceTransaction.bankAccountId.toString()) &&
      sourceTransaction.totalAmount !== 0n &&
      pendingMatch.expectedAmount === -sourceTransaction.totalAmount &&
      pendingMatch.expectedDateMin === expectedDateRange.expectedDateMin &&
      pendingMatch.expectedDateMax === expectedDateRange.expectedDateMax &&
      pendingMatch.expiresAt > timestamp &&
      isAvailableRegularTransferCounterpart(sourceTransaction)
  );
}

type ManualTransferPlaceholder = Pick<
  Doc<'transaction'>,
  | '_id'
  | 'bankAccountId'
  | 'isDeleted'
  | 'source'
  | 'suggestedTransfer'
  | 'totalAmount'
  | 'transactionImportRawId'
  | 'transferPairBankAccountId'
  | 'transferPairId'
  | 'type'
  | 'workspaceId'
>;

export function isValidManualTransferPlaceholder(
  placeholder: ManualTransferPlaceholder,
  pairedTransaction: ManualTransferPlaceholder | null,
  workspaceId: Id<'workspace'>,
  eligibleAccountIds: ReadonlySet<string>
): boolean {
  return Boolean(
    !placeholder.isDeleted &&
      placeholder.workspaceId === workspaceId &&
      placeholder.source === 'manual' &&
      placeholder.type === 'transfer' &&
      !placeholder.transactionImportRawId &&
      !hasRejectedTransferSuggestion(placeholder) &&
      placeholder.transferPairId &&
      placeholder.transferPairBankAccountId &&
      placeholder.totalAmount !== 0n &&
      eligibleAccountIds.has(placeholder.bankAccountId.toString()) &&
      pairedTransaction &&
      pairedTransaction._id === placeholder.transferPairId &&
      pairedTransaction._id !== placeholder._id &&
      !pairedTransaction.isDeleted &&
      pairedTransaction.workspaceId === workspaceId &&
      pairedTransaction.type === 'transfer' &&
      !hasRejectedTransferSuggestion(pairedTransaction) &&
      eligibleAccountIds.has(pairedTransaction.bankAccountId.toString()) &&
      placeholder.transferPairBankAccountId === pairedTransaction.bankAccountId &&
      pairedTransaction.transferPairId === placeholder._id &&
      pairedTransaction.transferPairBankAccountId === placeholder.bankAccountId &&
      pairedTransaction.totalAmount === -placeholder.totalAmount
  );
}

// Date range for matching (days before and after)
const DATE_MATCH_RANGE_DAYS = 3;

// Date range for matching manual transfer placeholders (wider range due to bank processing delays)
const MANUAL_TRANSFER_DATE_RANGE_DAYS = 7;

/**
 * Initialize the counterpart cache with all necessary data for efficient matching.
 * Call this once before processing a batch of transactions.
 */
export async function initializeCounterpartCache(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>
): Promise<CounterpartCache> {
  // Load all bank accounts for this workspace
  const allBankAccounts = await ctx.db
    .query('bankAccount')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  // Filter to only transfer-eligible accounts (Banking and Credit)
  // Investment and Loan accounts are excluded - functionality not yet implemented
  const bankAccounts = allBankAccounts.filter((ba) => isTransferEligibleAccountType(ba.accountType));
  const eligibleAccountIds = new Set(bankAccounts.map((ba) => ba._id.toString()));

  // Load pending transfer matches that are awaiting counterparts
  const pendingMatchCandidates = await ctx.db
    .query('pendingTransferMatch')
    .withIndex('by_workspaceId_status', (q) => q.eq('workspaceId', workspaceId).eq('status', 'awaiting_counterpart'))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();
  const pendingMatchSources = await Promise.all(
    pendingMatchCandidates.map((pendingMatch) => ctx.db.get(pendingMatch.sourceTransactionId))
  );
  const timestamp = new Date().toISOString();
  const pendingMatches = pendingMatchCandidates.filter((_, index) => {
    const sourceTransaction = pendingMatchSources[index];
    return isValidPendingTransferMatchSource(
      sourceTransaction,
      pendingMatchCandidates[index],
      workspaceId,
      eligibleAccountIds,
      timestamp
    );
  });

  // Load existing transactions grouped by bank account for efficient matching
  // Only load recent transactions (last 30 days) to keep memory reasonable
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const existingTransactions = new Map<string, Doc<'transaction'>[]>();

  // Query transactions by workspace
  const recentTransactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) =>
      q.and(
        q.eq(q.field('isDeleted'), false),
        q.gte(q.field('date'), thirtyDaysAgoStr),
        q.eq(q.field('type'), 'regular') // Don't match with existing transfers
      )
    )
    .collect();

  // Group by bank account, only including transactions from transfer-eligible accounts
  for (const txn of recentTransactions) {
    if (!isAvailableRegularTransferCounterpart(txn)) {
      continue;
    }
    const accountId = txn.bankAccountId.toString();
    // Skip transactions from non-eligible accounts (Investment, Loan)
    if (!eligibleAccountIds.has(accountId)) {
      continue;
    }
    const existing = existingTransactions.get(accountId) ?? [];
    existing.push(txn);
    existingTransactions.set(accountId, existing);
  }

  // Load manually-created transfer transactions that are awaiting real bank imports
  // These are the "placeholder" halves created when a user approves a single-sided transfer
  // They have:
  // - type: 'transfer' (already approved as transfer)
  // - source: 'manual' (created by system, not imported from bank)
  // - transferPairId set (linked to the imported side)
  // - NO transactionImportRawId (no real bank data yet)
  const manualTransferTransactions = new Map<string, Doc<'transaction'>[]>();

  const manualTransfers = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) =>
      q.and(
        q.eq(q.field('isDeleted'), false),
        q.gte(q.field('date'), thirtyDaysAgoStr),
        q.eq(q.field('type'), 'transfer'),
        q.eq(q.field('source'), 'manual'),
        q.neq(q.field('transferPairId'), undefined) // Must be linked to another transfer
      )
    )
    .collect();
  const manualTransferPairs = await Promise.all(
    manualTransfers.map((transaction) =>
      transaction.transferPairId ? ctx.db.get(transaction.transferPairId) : Promise.resolve(null)
    )
  );

  // Filter to only those without transactionImportRawId (not yet linked to a real import)
  // and from transfer-eligible accounts
  for (const [index, txn] of manualTransfers.entries()) {
    if (!isValidManualTransferPlaceholder(txn, manualTransferPairs[index], workspaceId, eligibleAccountIds)) {
      continue;
    }
    const accountId = txn.bankAccountId.toString();
    const existing = manualTransferTransactions.get(accountId) ?? [];
    existing.push(txn);
    manualTransferTransactions.set(accountId, existing);
  }

  // Supplement manual transfer cache via user_approved pending matches.
  // This catches cases where the standard 30-day query missed the manual counterpart
  // (e.g., transaction created > 30 days ago but still awaiting its real bank import).
  const userApprovedPendingMatches = await ctx.db
    .query('pendingTransferMatch')
    .withIndex('by_workspaceId_status', (q) => q.eq('workspaceId', workspaceId).eq('status', 'user_approved'))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  for (const pm of userApprovedPendingMatches) {
    const sourceTxn = await ctx.db.get(pm.sourceTransactionId);
    if (!sourceTxn || sourceTxn.isDeleted || !sourceTxn.transferPairId) continue;

    const counterpart = await ctx.db.get(sourceTxn.transferPairId);
    if (!counterpart) continue;
    if (!isValidManualTransferPlaceholder(counterpart, sourceTxn, workspaceId, eligibleAccountIds)) continue;

    const accountId = counterpart.bankAccountId.toString();

    const existing = manualTransferTransactions.get(accountId) ?? [];
    if (!existing.some((t) => t._id === counterpart._id)) {
      existing.push(counterpart);
      manualTransferTransactions.set(accountId, existing);
    }
  }

  return {
    bankAccounts,
    pendingMatches,
    existingTransactions,
    manualTransferTransactions,
    batchTransactions: new Map(), // Will be populated as we process the batch
  };
}

/**
 * Register a transaction in the batch for potential same-batch matching.
 */
export function registerBatchTransaction(
  cache: CounterpartCache,
  rawTransactionId: Id<'transactionImportRaw'>,
  bankAccountId: Id<'bankAccount'>,
  amount: bigint,
  date: string
): void {
  cache.batchTransactions.set(rawTransactionId.toString(), {
    rawTransactionId,
    bankAccountId,
    amount,
    date,
    alreadyMatched: false,
  });
}

/**
 * Mark a batch transaction as matched to prevent double-matching.
 */
export function markBatchTransactionMatched(
  cache: CounterpartCache,
  rawTransactionId: Id<'transactionImportRaw'>
): void {
  const txn = cache.batchTransactions.get(rawTransactionId.toString());
  if (txn) {
    txn.alreadyMatched = true;
  }
}

/**
 * Find a potential counterpart account for a transfer.
 *
 * Priority order:
 * 1. Check pendingTransferMatch table for matching amount/date range (95% confidence)
 * 2. Check manually-created transfer placeholders awaiting real bank imports (92% confidence)
 * 3. Check other raw transactions in same batch with opposite amount (90% confidence)
 * 4. Check existing transactions with opposite amount in date range (85% confidence)
 * 5. For credit card payments: suggest the only credit card account if just one exists (65% confidence)
 * 6. No match found: accountConfidence = undefined
 */
export function findCounterpart(input: FindCounterpartInput, cache: CounterpartCache): CounterpartResult {
  const expectedAmount = -input.amount; // Opposite sign for counterpart
  const inputDate = new Date(input.date);
  const minDate = new Date(inputDate);
  minDate.setDate(minDate.getDate() - DATE_MATCH_RANGE_DAYS);
  const maxDate = new Date(inputDate);
  maxDate.setDate(maxDate.getDate() + DATE_MATCH_RANGE_DAYS);
  const minDateStr = minDate.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

  // Strategy 1: Check pendingTransferMatch table
  for (let i = 0; i < cache.pendingMatches.length; i++) {
    const pending = cache.pendingMatches[i];
    if (
      !input.excludedMatchedTransactionIds?.has(pending.sourceTransactionId.toString()) &&
      pending.expectedAmount === input.amount &&
      input.date >= pending.expectedDateMin &&
      input.date <= pending.expectedDateMax &&
      pending.sourceBankAccountId.toString() !== input.sourceBankAccountId.toString()
    ) {
      return {
        suggestedAccountId: pending.sourceBankAccountId,
        accountConfidence: CONFIDENCE.PENDING_MATCH,
        matchedTransactionId: pending.sourceTransactionId,
        matchType: 'pending_match',
        matchReason: 'Matched with previously detected transfer awaiting counterpart',
      };
    }
  }

  // Strategy 2: Check for manually-created transfer halves awaiting real bank imports
  // These are "placeholder" transactions created when user approves a single-sided transfer
  // with a destination account selected. We want to link the real bank import to this
  // placeholder rather than creating a duplicate.
  // This must run BEFORE batch matching so that when both sides of a transfer arrive in the
  // same batch, each side links to its existing manual placeholder instead of batch-matching
  // with each other (which would create duplicate transactions).
  // Use wider date range for manual transfers due to bank processing delays
  const manualMinDate = new Date(inputDate);
  manualMinDate.setDate(manualMinDate.getDate() - MANUAL_TRANSFER_DATE_RANGE_DAYS);
  const manualMaxDate = new Date(inputDate);
  manualMaxDate.setDate(manualMaxDate.getDate() + MANUAL_TRANSFER_DATE_RANGE_DAYS);
  const manualMinDateStr = manualMinDate.toISOString().split('T')[0];
  const manualMaxDateStr = manualMaxDate.toISOString().split('T')[0];

  for (const [accountIdStr, transactions] of cache.manualTransferTransactions) {
    // Skip same account - the manual transfer should be on THIS account, not the source
    if (accountIdStr !== input.sourceBankAccountId.toString()) {
      continue;
    }

    for (const txn of transactions) {
      if (input.excludedMatchedTransactionIds?.has(txn._id.toString())) {
        continue;
      }
      if (hasRejectedTransferSuggestion(txn)) {
        continue;
      }
      // Check for same amount (not opposite - this is the same side of the transfer)
      // and within date range (using wider range for manual transfers)
      if (txn.totalAmount === input.amount && txn.date >= manualMinDateStr && txn.date <= manualMaxDateStr) {
        // Get the paired transaction's account to suggest as the counterpart
        return {
          suggestedAccountId: txn.transferPairBankAccountId,
          accountConfidence: CONFIDENCE.MANUAL_TRANSFER_MATCH,
          matchedTransactionId: txn._id,
          matchType: 'manual_transfer_match',
          matchReason: 'Found manually-created transfer placeholder awaiting real bank import',
        };
      }
    }
  }

  // Strategy 3: Check same-batch transactions for opposite amount (only if no manual transfer placeholder found)
  for (const [, batchTxn] of cache.batchTransactions) {
    // Skip if same transaction, already matched, or same account
    if (
      batchTxn.rawTransactionId.toString() === input.rawTransactionId.toString() ||
      batchTxn.alreadyMatched ||
      batchTxn.bankAccountId.toString() === input.sourceBankAccountId.toString()
    ) {
      continue;
    }

    // Check for opposite amount within date range
    if (batchTxn.amount === expectedAmount && batchTxn.date >= minDateStr && batchTxn.date <= maxDateStr) {
      return {
        suggestedAccountId: batchTxn.bankAccountId,
        accountConfidence: CONFIDENCE.BATCH_MATCH,
        matchType: 'batch_match',
        matchReason: 'Found matching opposite transaction in same import batch',
      };
    }
  }

  // Strategy 4: Check existing transactions for opposite amount
  for (const [accountIdStr, transactions] of cache.existingTransactions) {
    // Skip same account
    if (accountIdStr === input.sourceBankAccountId.toString()) {
      continue;
    }

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      if (input.excludedMatchedTransactionIds?.has(txn._id.toString())) {
        continue;
      }
      if (!isAvailableRegularTransferCounterpart(txn)) {
        continue;
      }
      // Check for opposite amount within date range, not already a transfer
      if (txn.totalAmount === expectedAmount && txn.date >= minDateStr && txn.date <= maxDateStr) {
        return {
          suggestedAccountId: txn.bankAccountId,
          accountConfidence: CONFIDENCE.EXISTING_MATCH,
          matchedTransactionId: txn._id,
          matchType: 'existing_match',
          matchReason: 'Found matching opposite transaction in existing data',
        };
      }
    }
  }

  // Strategy 6: For credit card payments (negative amount going out of checking),
  // suggest the only credit card if there's just one
  if (input.amount < 0n) {
    const creditCardAccounts = cache.bankAccounts.filter(
      (ba) =>
        ba.accountType === 'credit_credit_card' &&
        ba._id.toString() !== input.sourceBankAccountId.toString() &&
        !ba.isClosed
    );

    if (creditCardAccounts.length === 1) {
      return {
        suggestedAccountId: creditCardAccounts[0]._id,
        accountConfidence: CONFIDENCE.CREDIT_CARD_INFERENCE,
        matchType: 'credit_card_inference',
        matchReason: 'Inferred destination from single linked credit card account',
      };
    }
  }

  // No match found
  return {
    matchType: 'no_match',
  };
}

/**
 * Calculate expected date range for a pending transfer match record.
 */
export function calculateExpectedDateRange(date: string): { expectedDateMin: string; expectedDateMax: string } {
  const txnDate = new Date(date);
  const minDate = new Date(txnDate);
  minDate.setDate(minDate.getDate() - DATE_MATCH_RANGE_DAYS);
  const maxDate = new Date(txnDate);
  maxDate.setDate(maxDate.getDate() + DATE_MATCH_RANGE_DAYS);

  return {
    expectedDateMin: minDate.toISOString().split('T')[0],
    expectedDateMax: maxDate.toISOString().split('T')[0],
  };
}

export { DATE_MATCH_RANGE_DAYS };
