// Re-export all types
export type {
  ResolvedMerchant,
  TransactionMovementWithRelations,
  TransactionWithRelations,
} from './transactions/types';

// Re-export all queries
export {
  getTransaction,
  getTransactionStats,
  getTransactionStatusCounts,
  listAllTransactions,
  listAllTransactionsRaw,
  listArchivedTransactions,
  listMovementsByCategory,
  listRecentTransactions,
  listTransactionFeed,
  listTransactions,
  listTransactionsByMonth,
  watchTransactionsByIds,
} from './transactions/queries';

// Re-export all mutations

// Type-specific transaction creation mutations
export { createBalanceAdjustmentTransaction } from './transactions/mutations/createBalanceAdjustment';
export { createRegularTransaction } from './transactions/mutations/createRegular';
export { createTransactionFromEditor, createTransferFromEditor } from './transactions/mutations/createFromEditor';
export { createStartingBalanceTransaction } from './transactions/mutations/createStartingBalance';
export { createTransferForMcp, createTransferTransaction } from './transactions/mutations/createTransfer';

// Type conversion mutations
export { convertToBalanceAdjustment, convertToStartingBalance } from './transactions/mutations/convertToSystemType';

// Legacy mutation (deprecated, kept for backward compatibility)
export { createTransaction } from './transactions/create';

export {
  deleteTransaction,
  deleteTransactions,
  permanentlyDeleteTransaction,
  restoreTransaction,
  restoreTransactions,
  restoreTransactionsForMcp,
  softDeleteTransactionsForMcp,
} from './transactions/delete';
export { convertFromTransfer, convertToTransfer, updateTransfer } from './transactions/transfer';
export {
  approveTransactions,
  updateTransaction,
  updateTransactionFromEditor,
  updateTransactions,
  updateTransactionsForMcp,
  updateTransactionsStatus,
} from './transactions/update';

// Re-export helpers that might be used elsewhere
export {
  getCreditCardCategoryForAccount,
  isCreditCardAccount,
  populateTransaction,
  validateMovements,
} from './transactions/helpers';
