import type { Id } from '../../_generated/dataModel';

/**
 * Captures all transaction state that side effects depend on.
 * Used by reconcileTransactionSideEffects to diff before/after states.
 */
export type TransactionSnapshot = {
  // Core identifiers
  workspaceId: Id<'workspace'>;
  transactionId: Id<'transaction'>;
  bankAccountId: Id<'bankAccount'>;

  scheduledTransactionId?: Id<'scheduledTransaction'>;
  scheduledOccurrenceDate?: string;
  scheduledOccurrenceRevision?: number;

  // Transaction metadata
  type: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';
  date: string; // ISO date (YYYY-MM-DD)
  status: 'pending' | 'cleared' | 'reconciled';

  // Amount (sum of all movements)
  totalAmount: bigint;

  // Bank account properties (denormalized for reconciliation)
  isCreditCardAccount: boolean;
  isExcludedFromRTA: boolean;
  creditCardCategoryId: Id<'category'> | null; // null if not a credit card

  // Merchant
  merchantId: Id<'merchant'> | undefined;

  // Embedded movements with credit card metadata
  movements: SnapshotMovement[];

  // Transfer metadata (only for transfer transactions)
  transferPairId: Id<'transaction'> | undefined;
  transferPairBankAccountId: Id<'bankAccount'> | undefined;
};

export type SnapshotMovement = {
  categoryId: Id<'category'> | undefined;
  readyToAssign: boolean;
  amount: bigint;
  creditCardTransfer?: {
    creditCardCategoryId: Id<'category'>;
    spendingCategoryId: Id<'category'>;
  };
};

export type ReconcileOptions = {
  /** Skip bank account balance updates (for paths that manage balance externally) */
  skipBankAccountBalance?: boolean;
};

export type BankAccountPropertiesCache = Map<
  Id<'bankAccount'>,
  {
    isCreditCardAccount: boolean;
    isExcludedFromRTA: boolean;
    creditCardCategoryId: Id<'category'> | null;
  }
>;
