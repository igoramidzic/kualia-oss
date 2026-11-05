import type { Doc, Id } from '../_generated/dataModel';

/**
 * Resolved merchant type with overrides applied
 */
export type ResolvedMerchant = Doc<'merchant'> & {
  name: string;
  logoUrl?: string;
  visualIdentityMode: 'logo' | 'icon';
  iconName?: string;
  iconColorId?: string;
};

/**
 * Embedded movement type from the transaction schema
 */
export type EmbeddedMovement = {
  categoryId?: Id<'category'>;
  categoryName?: string;
  readyToAssign: boolean;
  amount: bigint;
  notes?: string;
  sortOrder: number;
  creditCardTransfer?: {
    creditCardCategoryId: Id<'category'>;
    spendingCategoryId: Id<'category'>;
  };
};

/**
 * Transaction movement with populated category (for backward compatibility)
 */
export type TransactionMovementWithRelations = EmbeddedMovement & {
  category: Doc<'category'> | null;
};

/**
 * Raw transaction with embedded movements - returned by list queries.
 * Frontend handles population using cached service data.
 */
export type RawTransactionWithMovements = Doc<'transaction'>;

/**
 * Reusable transaction type with all relations populated
 */
export type TransactionWithRelations = Doc<'transaction'> & {
  bankAccount:
    | (Doc<'bankAccount'> & {
        bankLinkAccount:
          | (Doc<'bankLinkAccount'> & {
              bankLink: Doc<'bankLink'> | null;
            })
          | null;
        institution: Doc<'globalInstitution'> | null;
      })
    | null;
  merchant: ResolvedMerchant | null;
  merchantName: string | null;
  merchantLogo: string | null;
  merchantVisualIdentityMode: 'logo' | 'icon' | null;
  merchantIconName: string | null;
  merchantIconColorId: string | null;
  movements: TransactionMovementWithRelations[];
  // For transfer transactions, the bank account name of the paired transaction
  transferPairAccountName: string | null;
  transferPairAccountVisualIdentityMode: 'logo' | 'icon' | null;
  transferPairAccountIconName: string | null;
  transferPairAccountIconColorId: string | null;
  // Calculated field: sum of all movement amounts
  amount: bigint;
  // For transfer transactions, indicates if this is a credit card payment
  // (transfer between a banking account and a credit account)
  isCreditCardPayment: boolean;
  // For transfer transactions, indicates if this crosses the budget boundary
  // (one on-budget account and one off-budget account)
  isCrossBudgetTransfer: boolean;
};
