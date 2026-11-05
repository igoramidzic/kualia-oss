import type { Id } from '../_generated/dataModel';

/**
 * Target and assignment information for a category
 * Always present for every category - provides unified view of target and assignment needs
 *
 * Note: The target indicator UI should only show when targetAmount is defined.
 * When there's overspending but no explicit target, the user can see the negative
 * available amount (shown in red), so no need to show a target indicator.
 */
export type CategoryTargetInfo = {
  dueDate?: string; // YYYY-MM-DD deadline for this budget month; omitted for inactive or undated targets.
  targetAmount?: bigint; // The full recurring target amount (e.g., $200 for yearly target). Only present if category has an explicit active target.
  assignmentNeeded: bigint; // Amount that needs to be assigned this month. For explicit targets: includes target + overspending adjustments. For overspending only: amount to cover negative available.
  remainingToAssign: bigint; // How much more needs to be assigned now (assignmentNeeded - assignedAmount, min 0)
  overfundedByAmount: bigint; // Amount by which the category is overfunded. For recurring_rollover: available - targetAmount (if available > targetAmount). For other targets: assignedAmount - assignmentNeeded (if positive). 0 if not overfunded.
  underfundedAmount: bigint; // Amount by which the category is underfunded. For categories with targets: remainingToAssign. For categories without targets: overspent amount (if negative available). 0 if not underfunded.
  fundedRatio: number; // Progress bar ratio (0.0 to 1.0). For single-month targets: assigned/targetNeeded. For multi-month: cumulativeAssigned/targetAmount. 1.0 when fully funded via carryover.
  spentRatio: number; // Spent portion of the funded bar (0.0 to 1.0). Base = assigned + min(carryover, 0) so negative rollover from a prior overspend is subtracted; falls back to targetAmount when there's no assignment.
  isSnoozed?: boolean; // True when the target is snoozed for this month. Only sent as true to save bytes.
  // Multi-month interval tracking (for progress bar display)
  currentMonthInInterval?: number; // 1-indexed position in the interval (e.g., 2 means "month 2 of 3")
  totalMonthsInInterval?: number; // Total months in saving interval (e.g., 3 for quarterly)
  cumulativeAssigned?: bigint; // Total assigned across all months in current interval
  cumulativeTargetNeeded?: bigint; // Total target needed for current interval progress
};

/**
 * Category summary with only essential fields
 */
export type CategorySummary = {
  _id: Id<'category'>;
  _creationTime: number;
  name: string;
  iconName: string | undefined;
  type: 'expense' | 'credit_card' | undefined;
  updatedAt: string | undefined;
};

/**
 * Category budget response type that includes the category object
 * as a separate property
 */
export type CategoryBudgetWithCategory = {
  categoryId: Id<'category'>;
  workspaceId: Id<'workspace'>;
  yearMonth: number;
  assignedAmount: bigint;
  totalSpent: bigint;
  carryoverFromPrevious: bigint;
  available: bigint;
  category: CategorySummary;
  // Activity breakdown for regular categories
  inflowAmount?: bigint; // Positive transactions (money added to category)
  outflowAmount?: bigint; // Positive transactions (money spent from category, stored as positive)
  activity?: bigint; // Computed: inflowAmount - outflowAmount
  // Credit card specific fields (only present for credit card categories)
  priorBalance?: bigint;
  currentBalance?: bigint;
  spendingAmount?: bigint; // Charges on the card (negative)
  paymentsAmount?: bigint; // Payments to the card (positive)
  fundedSpending?: bigint; // Computed: spendingAmount * -1 (positive)
  paymentsAndReturns?: bigint; // Same as paymentsAmount
  totalActivity?: bigint; // Computed: fundedSpending + paymentsAmount
  // Deprecated field (kept for backward compatibility)
  activityThisMonth?: bigint;
};

/**
 * Budget totals type for aggregation
 */
export type BudgetTotals = {
  assignedAmount: bigint;
  totalSpent: bigint;
  carryoverFromPrevious: bigint;
  available: bigint;
};

/**
 * Category group summary with only essential fields
 */
export type CategoryGroupSummary = {
  _id: Id<'categoryGroup'>;
  _creationTime: number;
  name: string;
  type: 'expense' | 'credit_card';
  sortOrder: number;
  updatedAt: string | undefined;
};

/**
 * Category group with budgets and totals
 */
export type CategoryGroupWithBudgets = {
  categoryGroup: CategoryGroupSummary;
  totals: BudgetTotals;
  categoryBudgets: CategoryBudgetWithCategory[];
};

/**
 * Category group with categories (structure only, no budget data)
 */
export type CategoryGroupWithCategories = {
  categoryGroup: CategoryGroupSummary;
  categories: CategorySummary[];
};

/**
 * Budget data for a single category
 */
export type CategoryBudgetData = {
  assignedAmount: bigint;
  totalSpent: bigint;
  carryoverFromPrevious: bigint;
  available: bigint;
  // Activity breakdown for regular categories
  inflowAmount?: bigint;
  outflowAmount?: bigint;
  activity?: bigint;
  // Credit card specific fields (only present for credit card categories)
  priorBalance?: bigint;
  currentBalance?: bigint;
  spendingAmount?: bigint;
  paymentsAmount?: bigint;
  fundedSpending?: bigint;
  paymentsAndReturns?: bigint;
  totalActivity?: bigint;
  // Deprecated field (kept for backward compatibility)
  activityThisMonth?: bigint;
  // Target and assignment information (always present for all categories)
  target: CategoryTargetInfo;
  // Transaction count for the category
  transactionCount: bigint;
};

/**
 * Budget data for a single month
 */
export type BudgetMonthData = {
  yearMonth: number;
  yearMonthString: string;
  budgetData: Record<string, CategoryBudgetData>; // keyed by categoryId
  summary: BudgetMonthSummary;
};

/**
 * Available range for month navigation
 */
export type AvailableMonthRange = {
  minYearMonth: number;
  maxYearMonth: number;
};

/**
 * Summary statistics for a budget month
 * Provides aggregate metrics for the month's budget status
 */
export type BudgetMonthSummary = {
  /** Percentage of target funding achieved (0-100+). Calculated as (totalFunded / totalTargetAmount) * 100 */
  percentageFunded: number;
  /** Total of all target amounts for categories that have targets */
  totalTargetAmount: bigint;
  /** Total amount funded towards categories with targets */
  totalFunded: bigint;
  /** Total remaining to hit all targets (sum of remainingToAssign for categories with targets) */
  totalRemainingToFund: bigint;
  /** Total overspent amount (sum of negative available amounts, as positive value) */
  totalOverspent: bigint;
  /** Number of categories with negative available balance (includes archived) */
  overspentCategoryCount: number;
  /** Extra funding assigned to categories without targets (doesn't count towards target progress) */
  extraFunding: bigint;
  /** Extra funding assigned to categories WITH targets to cover overspending (overfundedByAmount) */
  coverOverspending: bigint;
};

/**
 * Budget data for all months with navigation range
 */
export type BudgetDataAllMonths = {
  months: BudgetMonthData[];
  availableRange: AvailableMonthRange;
  readyToAssign: bigint; // Workspace-level value, same for all months
};
