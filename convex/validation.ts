/**
 * Data Integrity Validation System
 *
 * This module provides comprehensive validation of data consistency across workspaces,
 * with scheduled batch processing and Discord reporting.
 *
 * Usage:
 * - Scheduled validation runs daily at 3 AM UTC via cron job
 * - Manual validation can be triggered via validateWorkspacePublic query
 * - Fixes can be applied via fixWorkspacePublic mutation
 *
 * Validations performed:
 * - Category spending (category.monthlySpending)
 * - Credit card spending (category.creditMonthlySpending)
 * - Merchant stats (merchant.monthlyStats)
 * - Ready-to-assign (workspace.readyToAssign)
 * - Monthly income activity (workspace.monthlyIncomeActivity)
 * - Transaction flags (hasUncategorized, hasMissingPayee)
 * - Movement totals (transaction.totalAmount)
 * - Bank account balances (bankAccount.currentBalance)
 */

// Re-export types
export type {
  BatchValidationResult,
  FixResult,
  ValidationIssue,
  ValidationRunReport,
  ValidationSummary,
  WorkspaceFixResult,
  WorkspaceIssuesSummary,
  WorkspaceValidationResult,
} from './validation/types';

// Re-export single workspace validators
export { getValidationSummary, validateWorkspacePublic } from './validation/singleWorkspace';

// Re-export fix functions
export { cleanupLoanCreditCardCategoriesPublic, fixWorkspacePublic } from './validation/fixes';

// Note: Internal functions (batch orchestrator, individual validators) are accessed via
// internal.validation.* and are not re-exported here
