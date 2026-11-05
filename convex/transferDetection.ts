/**
 * Transfer Detection Module
 *
 * Automatic detection of transfers between accounts when importing transactions.
 * Detects transfers, suggests counterpart accounts, and manages pending matches.
 */

// Detection algorithm
export {
  detectTransfer,
  detectTransferFromRaw,
  TRANSFER_CONFIDENCE_THRESHOLD,
} from './transferDetection/detectTransfer';

// Counterpart finding
export {
  type CounterpartCache,
  calculateExpectedDateRange,
  DATE_MATCH_RANGE_DAYS,
  findCounterpart,
  initializeCounterpartCache,
  isTransferEligibleAccountType,
  isValidManualTransferPlaceholder,
  markBatchTransactionMatched,
  registerBatchTransaction,
} from './transferDetection/findCounterpart';

// Mutations
export {
  approveLinkedTransfer,
  approveTransferSuggestion,
  rejectTransferSuggestion,
} from './transferDetection/mutations';

// Main processing
export {
  buildSuggestedTransferObject,
  createPendingTransferMatch,
  type DurableTransferMatchType,
  isEligibleTransferDetectionSourceAccount,
  markPendingTransferMatchAsMatched,
  normalizeBatchTransferPair,
  processTransferDetection,
  reserveBatchTransferPair,
  resolveTransferImportDisposition,
  selectAvailableTransferCounterpart,
  shouldPromoteTransferCandidate,
  type TransferDetectionResult,
  type TransferImportDisposition,
  type TransferMatchedCounterpart,
  type TransferMatchType,
} from './transferDetection/processTransferDetection';

// Queries
export {
  getPendingTransferCount,
  getPendingTransferSuggestions,
  getTransferSuggestionDetails,
} from './transferDetection/queries';
