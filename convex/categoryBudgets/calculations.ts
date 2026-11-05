/**
 * Pure calculation functions for category budgets
 * No database dependencies - all functions accept plain objects/primitives
 */

/**
 * Budget data for a single month's calculation
 */
export interface MonthBudgetInput {
  yearMonth: number;
  assignedAmount: bigint;
  inflowAmount: bigint; // Positive: money added to category
  outflowAmount: bigint; // Positive: money spent from category (stored as positive)
}

/**
 * Credit card spending data for a single month
 */
export interface CreditCardMonthInput {
  yearMonth: number;
  assignedAmount: bigint;
  priorBalance: bigint; // Starting balance from bank account
  spendingAmount: bigint; // Charges on card (negative values)
  paymentsAmount: bigint; // Payments to card (positive values)
  refundedSpending: bigint; // Refunds on card (positive values)
}

/**
 * Result of calculating a single month's budget
 */
export interface MonthBudgetResult {
  yearMonth: number;
  assignedAmount: bigint;
  spentAmount: bigint; // Computed: inflowAmount - outflowAmount
  carryover: bigint; // From previous month
  available: bigint; // assignedAmount + carryover + spentAmount
}

/**
 * Result of calculating a credit card month's budget
 */
export interface CreditCardMonthResult {
  yearMonth: number;
  assignedAmount: bigint;
  spentAmount: bigint; // budgetActivity: fundedSpending - payments
  carryover: bigint; // Budget carryover (excludes starting balance)
  available: bigint; // assignedAmount + carryover + budgetActivity
  // Credit card specific display fields
  priorBalance: bigint; // Display: balance at start (includes starting balance)
  currentBalance: bigint; // Display: current bank balance
  activityThisMonth: bigint; // Display: fundedSpending + payments
  budgetActivity: bigint; // Budget impact: fundedSpending - payments
}

/**
 * Helper function to convert ISO date string to YYYYMM integer
 * Parses manually to avoid timezone issues
 */
export function dateToYearMonth(isoDate: string): number {
  const parts = isoDate.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  return year * 100 + month;
}

/**
 * Helper function to convert YYYYMM integer to "YYYY-MM" string for display
 */
export function yearMonthToString(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  return `${year}-${month.toString().padStart(2, '0')}`;
}

/**
 * Helper function to convert "YYYY-MM" string back to YYYYMM integer
 * This is the inverse of yearMonthToString
 */
export function yearMonthStringToNumber(yearMonthStr: string): number {
  const parts = yearMonthStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  return year * 100 + month;
}

/**
 * Helper function to get the next month, handling year boundaries
 */
export function getNextYearMonth(yearMonth: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (month === 12) {
    return (year + 1) * 100 + 1;
  }
  return yearMonth + 1;
}

/**
 * Helper function to get the previous month, handling year boundaries
 */
export function getPreviousYearMonth(yearMonth: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (month === 1) {
    return (year - 1) * 100 + 12;
  }
  return yearMonth - 1;
}

/**
 * Calculate the available month range for budget navigation
 * Ensures:
 * - At least one month in the past (previous month)
 * - Current month is always included
 * - At least one month in the future is always available
 *
 * @param currentYearMonth - The current month (YYYYMM format)
 * @param earliestAssignedMonth - The earliest month with assigned budget, or null if none
 * @param latestAssignedMonth - The latest month with assigned budget, or null if none
 * @returns Object with minYearMonth and maxYearMonth
 */
export function calculateAvailableMonthRange(
  currentYearMonth: number,
  earliestAssignedMonth: number | null,
  latestAssignedMonth: number | null
): { minYearMonth: number; maxYearMonth: number } {
  let minYearMonth: number;
  let maxYearMonth: number;

  if (!earliestAssignedMonth || !latestAssignedMonth) {
    // New user: no assigned budgets yet, calculate 3 months centered on current
    minYearMonth = getPreviousYearMonth(currentYearMonth);
    maxYearMonth = getNextYearMonth(currentYearMonth);
  } else {
    // Use the min/max from assigned budgets
    // Add one month padding on each side
    minYearMonth = getPreviousYearMonth(earliestAssignedMonth);
    maxYearMonth = getNextYearMonth(latestAssignedMonth);

    // Always ensure current month is included (prevent user from getting stuck)
    if (currentYearMonth < minYearMonth) {
      minYearMonth = currentYearMonth;
    }
    if (currentYearMonth > maxYearMonth) {
      maxYearMonth = currentYearMonth;
    }

    // Always ensure previous month is included (users expect to navigate backwards)
    const previousMonth = getPreviousYearMonth(currentYearMonth);
    if (previousMonth < minYearMonth) {
      minYearMonth = previousMonth;
    }
  }

  // Always ensure at least one month in the future is available
  const nextMonth = getNextYearMonth(currentYearMonth);
  if (nextMonth > maxYearMonth) {
    maxYearMonth = nextMonth;
  }

  return { minYearMonth, maxYearMonth };
}

/**
 * Calculate a single month's budget given previous carryover
 * @param budget - Budget data for the month
 * @param previousCarryover - Carryover from previous month
 * @returns Calculated budget result
 */
export function calculateSingleMonthBudget(budget: MonthBudgetInput, previousCarryover: bigint): MonthBudgetResult {
  const spentAmount = budget.inflowAmount - budget.outflowAmount;
  const available = budget.assignedAmount + previousCarryover + spentAmount;

  return {
    yearMonth: budget.yearMonth,
    assignedAmount: budget.assignedAmount,
    spentAmount,
    carryover: previousCarryover,
    available,
  };
}

/**
 * Calculate budget carryover chain across multiple months
 * Processes months in order, with each month's available becoming next month's carryover
 *
 * @param budgets - Array of monthly budget data, in chronological order
 * @param initialCarryover - Starting carryover (default 0)
 * @returns Array of calculated monthly budgets
 */
export function calculateBudgetCarryoverChain(
  budgets: MonthBudgetInput[],
  initialCarryover: bigint = 0n
): MonthBudgetResult[] {
  const results: MonthBudgetResult[] = [];
  let carryover = initialCarryover;

  for (const budget of budgets) {
    const result = calculateSingleMonthBudget(budget, carryover);
    results.push(result);
    carryover = result.available;
  }

  return results;
}

/**
 * Calculate YNAB-style credit card activity display values
 * Returns the breakdown shown in YNAB for credit card categories
 *
 * @param spendingAmount - Charges on the card (positive values, stored as positive in DB)
 * @param paymentsAmount - Payments to the card (positive values)
 * @returns Display values for credit card activity
 */
export function calculateCreditCardActivityDisplay(spendingAmount: bigint, paymentsAmount: bigint) {
  // Spending breakdown (what was charged to the card)
  const spending = spendingAmount; // Positive: +$10.00 (stored as positive in DB)
  const returns = 0n; // Future: refunds (would be positive)
  const totalSpending = spending + returns;

  // Activity breakdown (movement in the CC category)
  // Funded Spending = money moved FROM regular categories TO CC category
  // spendingAmount is already stored as positive in the database
  const fundedSpending = spendingAmount; // Positive: +$10.00

  // Payments & Returns = actual payments made to the CC
  const paymentsAndReturns = paymentsAmount; // Positive: +$500.00

  // Total Activity = net change in CC category available balance
  const totalActivity = fundedSpending + paymentsAndReturns;

  return {
    // Spending section
    spending,
    returns,
    totalSpending,
    // Activity section
    fundedSpending,
    paymentsAndReturns,
    totalActivity,
  };
}

/**
 * Calculate category activity display values (for regular categories)
 * Returns inflow/outflow breakdown for a category
 *
 * @param inflowAmount - Positive transactions (money added to category)
 * @param outflowAmount - Positive transactions (money spent from category, stored as positive)
 * @returns Display values for category activity
 */
export function calculateCategoryActivityDisplay(inflowAmount: bigint, outflowAmount: bigint) {
  // Total inflows (positive transactions)
  const totalInflows = inflowAmount; // Positive: +$50.00

  // Total outflows (positive transactions, stored as positive)
  const totalOutflows = outflowAmount; // Positive: +$100.00

  // Net activity (total change in category)
  // Activity = inflows - outflows (since both are positive)
  const activity = totalInflows - totalOutflows; // -$50.00

  return {
    totalInflows,
    totalOutflows,
    activity,
  };
}

/**
 * Calculate a single credit card month's budget
 * @param budget - Credit card budget data for the month
 * @param previousBudgetBalance - Budget carryover from previous month (excludes starting balance)
 * @param previousDisplayBalance - Full display balance from previous month
 * @returns Calculated credit card budget result
 */
export function calculateSingleCreditCardBudget(
  budget: CreditCardMonthInput,
  previousBudgetBalance: bigint,
  previousDisplayBalance: bigint
): CreditCardMonthResult {
  // YNAB-style Activity = Spending - Payments - Refunds (net change in what you owe)
  // For display: activityThisMonth shows net spending activity
  // Positive = spent more than paid (owe more), Negative = paid more than spent (owe less)
  // Refunds reduce what you owe, so they decrease the amount you need to have available
  const activityThisMonth = budget.spendingAmount - budget.paymentsAmount - budget.refundedSpending;
  // For budget: budgetActivity is the same as activityThisMonth (spending - payments - refunds)
  // This increases available when spending occurs, decreases when payments are made or refunds are received
  const budgetActivity = budget.spendingAmount - budget.paymentsAmount - budget.refundedSpending;

  // Actual balance change (for display balance calculation)
  // Spending increases debt (positive), payments decrease debt (negative), refunds decrease debt (negative)
  const balanceChange = budget.spendingAmount - budget.paymentsAmount - budget.refundedSpending;

  // Display prior balance includes the starting balance
  const displayPriorBalance = previousDisplayBalance + budget.priorBalance;

  // Current balance = prior + actual balance change
  const currentBalance = displayPriorBalance + balanceChange;

  // Budget carryover does NOT include starting balance (priorBalance)
  const budgetCarryover = previousBudgetBalance;

  // Available = assigned + carryover + budgetActivity
  const available = budget.assignedAmount + budgetCarryover + budgetActivity;

  return {
    yearMonth: budget.yearMonth,
    assignedAmount: budget.assignedAmount,
    spentAmount: budgetActivity,
    carryover: budgetCarryover,
    available,
    priorBalance: displayPriorBalance,
    currentBalance,
    activityThisMonth,
    budgetActivity,
  };
}

/**
 * Calculate credit card budget carryover chain across multiple months
 * Similar to regular budget chain but tracks both budget and display balances separately
 *
 * @param budgets - Array of monthly credit card budget data, in chronological order
 * @param initialBudgetBalance - Starting budget balance (default 0)
 * @param initialDisplayBalance - Starting display balance (default 0)
 * @returns Array of calculated monthly credit card budgets
 */
export function calculateCreditCardCarryoverChain(
  budgets: CreditCardMonthInput[],
  initialBudgetBalance: bigint = 0n,
  initialDisplayBalance: bigint = 0n
): CreditCardMonthResult[] {
  const results: CreditCardMonthResult[] = [];
  let budgetBalance = initialBudgetBalance;
  let displayBalance = initialDisplayBalance;

  for (const budget of budgets) {
    const result = calculateSingleCreditCardBudget(budget, budgetBalance, displayBalance);
    results.push(result);

    // Update balances for next iteration
    // Next month's carryover is this month's available
    budgetBalance = result.available;
    displayBalance = result.currentBalance;
  }

  return results;
}
