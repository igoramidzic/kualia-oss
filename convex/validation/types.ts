import type { Id } from '../_generated/dataModel';

// ============================================================================
// Issue Severity
// ============================================================================

export type IssueSeverity = 'error' | 'warning';

// ============================================================================
// Base Issue Interface
// ============================================================================

export interface BaseValidationIssue {
  type: string;
  severity: IssueSeverity;
  description: string;
}

// ============================================================================
// Category Spending Issues
// ============================================================================

export interface CategorySpendingIssue extends BaseValidationIssue {
  type: 'category_spending_mismatch';
  categoryId: Id<'category'>;
  categoryName: string;
  yearMonth: number;
  field: 'inflowAmount' | 'outflowAmount';
  stored: bigint;
  expected: bigint;
}

// ============================================================================
// Credit Card Spending Issues
// ============================================================================

export interface CreditSpendingIssue extends BaseValidationIssue {
  type: 'credit_spending_mismatch';
  categoryId: Id<'category'>;
  categoryName: string;
  bankAccountId: Id<'bankAccount'>;
  yearMonth: number;
  field: 'spendingAmount' | 'paymentsAmount' | 'priorBalance' | 'refundedSpending';
  stored: bigint;
  expected: bigint;
}

// ============================================================================
// Credit Card Transfer Mismatch Issues
// ============================================================================

export interface CreditCardTransferMismatchIssue extends BaseValidationIssue {
  type: 'credit_card_transfer_mismatch';
  transactionId: Id<'transaction'>;
  movementIndex: number;
  currentCreditCardCategoryId: Id<'category'>;
  expectedCreditCardCategoryId: Id<'category'>;
  bankAccountId: Id<'bankAccount'>;
}

// ============================================================================
// Merchant Stats Issues
// ============================================================================

export interface MerchantStatsIssue extends BaseValidationIssue {
  type: 'merchant_stats_mismatch';
  merchantId: Id<'merchant'>;
  merchantName: string;
  yearMonth: number;
  field: 'totalAmount' | 'transactionCount' | 'inflowAmount' | 'outflowAmount' | 'inflowCount' | 'outflowCount';
  stored: bigint;
  expected: bigint;
}

// ============================================================================
// Ready-to-Assign Issues
// ============================================================================

export interface RTAIssue extends BaseValidationIssue {
  type: 'ready_to_assign_mismatch';
  stored: bigint;
  expected: bigint;
  breakdown: {
    uncategorizedInflows: bigint;
    uncategorizedOutflows: bigint;
    budgetAssignments: bigint;
    netUncategorized: bigint;
  };
}

// ============================================================================
// Monthly Income Activity Issues
// ============================================================================

export interface MonthlyIncomeActivityIssue extends BaseValidationIssue {
  type: 'monthly_income_activity_mismatch';
  yearMonth: string;
  field: 'inflowAmount' | 'outflowAmount';
  stored: bigint;
  expected: bigint;
}

// ============================================================================
// Transaction Flag Issues
// ============================================================================

export interface TransactionFlagIssue extends BaseValidationIssue {
  type: 'transaction_flag_incorrect';
  transactionId: Id<'transaction'>;
  flag: 'hasUncategorized' | 'hasMissingPayee';
  stored: boolean;
  expected: boolean;
}

// ============================================================================
// Movement Total Issues
// ============================================================================

export interface MovementTotalIssue extends BaseValidationIssue {
  type: 'movement_total_mismatch';
  transactionId: Id<'transaction'>;
  storedTotal: bigint;
  calculatedSum: bigint;
}

// ============================================================================
// Transfer Pair Issues
// ============================================================================

export interface TransferPairIssue extends BaseValidationIssue {
  type: 'transfer_pair_issue';
  transactionId: Id<'transaction'>;
  issueType: 'missing_pair' | 'broken_pair' | 'amount_mismatch' | 'no_back_reference';
  details: string;
}

// ============================================================================
// Bank Account Balance Issues
// ============================================================================

export interface BankAccountBalanceIssue extends BaseValidationIssue {
  type: 'bank_account_balance_mismatch';
  bankAccountId: Id<'bankAccount'>;
  accountName: string;
  stored: bigint;
  expected: bigint;
  transactionCount: number;
}

// ============================================================================
// Starting Balance RTA Issues
// ============================================================================

export interface StartingBalanceRTAIssue extends BaseValidationIssue {
  type: 'starting_balance_rta_missing';
  accountId: Id<'bankAccount'>;
  accountName: string;
  transactionId: Id<'transaction'>;
  missingAmount: bigint;
}

// ============================================================================
// Credit Card Debt Mismatch Issues
// ============================================================================

export interface CreditCardDebtMismatchIssue extends BaseValidationIssue {
  type: 'credit_card_debt_mismatch';
  creditCardCategoryId: Id<'category'>;
  creditCardCategoryName: string;
  bankAccountId: Id<'bankAccount'>;
  bankAccountName: string;
  categoryAvailable: bigint;
  accountDebt: bigint; // Absolute value of negative balance
  discrepancy: bigint; // categoryAvailable - accountDebt
}

// ============================================================================
// Bank Account Pending/Cleared Balance Issues
// ============================================================================

export interface BankAccountPendingClearedIssue extends BaseValidationIssue {
  type: 'bank_account_pending_cleared_mismatch';
  bankAccountId: Id<'bankAccount'>;
  accountName: string;
  field: 'invariant' | 'pendingBalance' | 'clearedBalance';
  stored: bigint;
  expected: bigint;
}

// ============================================================================
// Union of All Issues
// ============================================================================

export type ValidationIssue =
  | CategorySpendingIssue
  | CreditSpendingIssue
  | CreditCardTransferMismatchIssue
  | MerchantStatsIssue
  | RTAIssue
  | MonthlyIncomeActivityIssue
  | TransactionFlagIssue
  | MovementTotalIssue
  | TransferPairIssue
  | BankAccountBalanceIssue
  | BankAccountPendingClearedIssue
  | StartingBalanceRTAIssue
  | CreditCardDebtMismatchIssue;

// ============================================================================
// Validation Results
// ============================================================================

export interface ValidationSummary {
  categorySpendingIssues: number;
  creditSpendingIssues: number;
  creditCardTransferMismatchIssues: number;
  merchantStatsIssues: number;
  rtaIssues: number;
  monthlyIncomeIssues: number;
  transactionFlagIssues: number;
  movementTotalIssues: number;
  transferPairIssues: number;
  bankAccountBalanceIssues: number;
  pendingClearedIssues: number;
  startingBalanceRTAIssues: number;
  creditCardDebtIssues: number;
  totalIssues: number;
}

export interface WorkspaceValidationResult {
  workspaceId: Id<'workspace'>;
  workspaceName: string;
  isValid: boolean;
  issues: ValidationIssue[];
  summary: ValidationSummary;
  validatedAt: string;
}

// ============================================================================
// Batch Validation Types
// ============================================================================

export interface WorkspaceIssuesSummary {
  workspaceId: Id<'workspace'>;
  workspaceName: string;
  issueCount: number;
  issueTypes: string[];
}

export interface BatchValidationResult {
  runId: string;
  batchNumber: number;
  processedCount: number;
  hasMore: boolean;
  lastCursor: Id<'workspace'> | null;
  workspacesWithIssues: WorkspaceIssuesSummary[];
}

export interface ValidationRunReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalWorkspacesProcessed: number;
  workspacesWithIssues: number;
  totalIssuesFound: number;
  issuesByWorkspace: WorkspaceIssuesSummary[];
}

// ============================================================================
// Fix Result Types
// ============================================================================

export interface FixResult {
  fixed: number;
  errors: string[];
}

export interface WorkspaceFixResult {
  workspaceId: Id<'workspace'>;
  fixResults: Record<string, FixResult>;
  fixedAt: string;
}
