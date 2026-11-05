import type { Id } from '../_generated/dataModel';
import type { DatabaseWriter, QueryCtx } from '../_generated/server';
import {
  calculateBudgetCarryoverChain,
  calculateCreditCardCarryoverChain,
  dateToYearMonth as dateToYearMonthPure,
  getNextYearMonth as getNextYearMonthPure,
  getPreviousYearMonth as getPreviousYearMonthPure,
  type CreditCardMonthInput,
  type MonthBudgetInput,
} from './calculations';

/**
 * Calculate carryover from the most recent budget before the given month
 * @param ctx - Database context (QueryCtx or MutationCtx)
 * @param workspaceId - Workspace ID
 * @param categoryId - Category ID
 * @param yearMonth - Target yearMonth to calculate carryover for
 * @returns The available amount from the most recent previous budget, or 0n if none exists
 */
/**
 * @deprecated Use calculateCategoryBudgetsForMonths instead
 * Calculate carryover from the most recent budget before the given month
 * Updated to use new calculation approach (no longer reads legacy fields)
 */
export async function calculateCarryoverFromPrevious(
  ctx: { db: DatabaseWriter | QueryCtx['db'] },
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  yearMonth: number
): Promise<bigint> {
  // Use the new calculation approach
  const previousYearMonth = getPreviousYearMonthPure(yearMonth);
  const calculated = await calculateCategoryBudgetsForMonths(
    ctx,
    workspaceId,
    categoryId,
    previousYearMonth,
    1 // Only need 1 month back
  );

  if (calculated.length === 0) {
    return 0n;
  }

  // Return the available amount from the previous month (which becomes carryover)
  return calculated[calculated.length - 1].available;
}

/**
 * Result type for calculated budget data
 */
export interface CalculatedBudget {
  yearMonth: number;
  assignedAmount: bigint;
  spentAmount: bigint;
  carryover: bigint;
  available: bigint;
  // Credit card specific fields (only present for credit card categories)
  priorBalance?: bigint; // Balance at start of month (from bank account)
  currentBalance?: bigint; // Current bank account balance
  activityThisMonth?: bigint; // Display value: fundedSpending + payments (both positive)
  budgetActivity?: bigint; // Budget impact: fundedSpending - payments (for available calc)
}

/**
 * Optimized batch calculation of category budgets with carryover
 *
 * This function:
 * 1. Fetches all budgets and spending for a category in 2 queries (instead of N queries)
 * 2. Calculates carryover chain using pure calculation function
 * 3. Returns computed available/carryover for requested month range
 *
 * @param ctx - Database context
 * @param workspaceId - Workspace ID
 * @param categoryId - Category ID
 * @param targetYearMonth - The month we want to calculate up to
 * @param monthsBack - How many months back to calculate (default 24)
 * @returns Calculated budget data for all months from startMonth to targetMonth
 */
export async function calculateCategoryBudgetsForMonths(
  ctx: { db: DatabaseWriter | QueryCtx['db'] },
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  targetYearMonth: number,
  monthsBack: number = 24
): Promise<CalculatedBudget[]> {
  // Calculate the start month (go back N months from target)
  let startYearMonth = targetYearMonth;
  for (let i = 0; i < monthsBack; i++) {
    startYearMonth = getPreviousYearMonthPure(startYearMonth);
  }

  // Fetch the single budget row for this category
  const budget = await ctx.db
    .query('categoryBudget')
    .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
    .first();

  // Extract monthly amounts from map
  const monthlyAmounts = budget?.monthlyAssignedAmounts ?? {};
  const budgetMap = new Map<number, bigint>();
  for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
    const yearMonth = parseInt(yearMonthStr, 10);
    if (yearMonth >= startYearMonth && yearMonth <= targetYearMonth) {
      budgetMap.set(yearMonth, amount);
    }
  }

  // Get the category directly to read monthlySpending (no longer from separate table)
  const category = await ctx.db.get(categoryId);

  // Extract monthlySpending map and filter months in range
  // Note: monthlySpending keys are in YYYYMM format (e.g., "202401")
  const monthlySpending = category?.monthlySpending ?? {};
  const spendingMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();

  for (const [yearMonthStr, spending] of Object.entries(monthlySpending)) {
    const yearMonth = parseInt(yearMonthStr, 10);
    if (yearMonth >= startYearMonth && yearMonth <= targetYearMonth) {
      spendingMap.set(yearMonth, spending);
    }
  }

  // Build input array for pure calculation function
  const monthInputs: MonthBudgetInput[] = [];
  let currentMonth = startYearMonth;
  while (currentMonth <= targetYearMonth) {
    const assignedAmount = budgetMap.get(currentMonth) ?? 0n;
    const spending = spendingMap.get(currentMonth);

    monthInputs.push({
      yearMonth: currentMonth,
      assignedAmount,
      inflowAmount: spending?.inflowAmount ?? 0n,
      outflowAmount: spending?.outflowAmount ?? 0n,
    });

    currentMonth = getNextYearMonthPure(currentMonth);
  }

  // Use pure calculation function for carryover chain
  const calculatedResults = calculateBudgetCarryoverChain(monthInputs);

  // Convert to CalculatedBudget format
  return calculatedResults;
}

/**
 * Get calculated budget for a specific month
 * Convenience wrapper that routes to the appropriate calculation function
 * based on whether the category is a credit card category or regular category
 *
 * @param ctx - Database context
 * @param workspaceId - Workspace ID
 * @param categoryId - Category ID
 * @param yearMonth - The specific month to get
 * @returns Calculated budget data for the requested month
 */
export async function getCalculatedBudgetForMonth(
  ctx: { db: DatabaseWriter | QueryCtx['db'] },
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  yearMonth: number
): Promise<CalculatedBudget> {
  // Check if this is a credit card category
  const category = await ctx.db.get(categoryId);
  const isCreditCardCategory = category?.categoryType === 'credit_card';

  let results: CalculatedBudget[];

  if (isCreditCardCategory) {
    // Use credit card budget calculation
    results = await calculateCreditCategoryBudgetsForMonths(ctx, categoryId, yearMonth);
  } else {
    // Use regular category budget calculation
    results = await calculateCategoryBudgetsForMonths(ctx, workspaceId, categoryId, yearMonth);
  }

  // Return the last result (which is the target month)
  const targetMonthBudget = results[results.length - 1];

  // For credit card categories, ensure assignedAmount is set correctly from map
  if (isCreditCardCategory) {
    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
      .first();

    const monthlyAmounts = budget?.monthlyAssignedAmounts ?? {};
    const assignedAmount = monthlyAmounts[yearMonth.toString()] ?? 0n;
    targetMonthBudget.assignedAmount = assignedAmount;
    // For credit cards: available = assignedAmount + carryover + budgetActivity
    // - carryover: money available from previous months
    // - budgetActivity: funded spending (increases) - payments (decreases)
    // This represents the total money available to pay the credit card
    targetMonthBudget.available =
      targetMonthBudget.assignedAmount + targetMonthBudget.carryover + (targetMonthBudget.budgetActivity ?? 0n);
  }

  return targetMonthBudget;
}

/**
 * Update a category's monthlySpending and transactionCount fields
 *
 * @param ctx - Database context with mutation capability
 * @param workspaceId - Workspace ID (unused, kept for API compatibility)
 * @param categoryId - Category ID
 * @param yearMonth - Month to update (YYYYMM format)
 * @param amountDelta - Amount to add (positive) or subtract (negative) from spending
 * @returns The category ID
 */
export async function updateCategorySpending(
  ctx: { db: DatabaseWriter },
  _workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  yearMonth: number,
  amountDelta: bigint,
  transactionCountDelta: bigint = 0n
): Promise<Id<'category'>> {
  // Get the category directly
  const category = await ctx.db.get(categoryId);
  if (!category) {
    throw new Error(`Category ${categoryId} not found`);
  }

  const now = new Date().toISOString();
  const yearMonthStr = yearMonth.toString();

  // Update the category's monthlySpending map
  const monthlySpending = { ...(category.monthlySpending ?? {}) };
  const currentMonthData = monthlySpending[yearMonthStr] ?? {
    inflowAmount: 0n,
    outflowAmount: 0n,
  };

  // Get current values (outflows are stored as positive)
  const currentInflow = currentMonthData.inflowAmount;
  const currentOutflow = currentMonthData.outflowAmount;

  let newInflow = currentInflow;
  let newOutflow = currentOutflow;

  // Use transactionCountDelta to determine the operation type:
  // - transactionCountDelta > 0: Creating a transaction
  // - transactionCountDelta < 0: Deleting a transaction
  // - transactionCountDelta = 0: Updating amount only (treat as creation semantics)
  const isDeleting = transactionCountDelta < 0n;

  if (isDeleting) {
    // When deleting, amountDelta is the negated original amount:
    // - Original was negative (outflow): amountDelta is positive, subtract from outflows
    // - Original was positive (inflow): amountDelta is negative, subtract from inflows
    if (amountDelta > 0n) {
      // Deleting an outflow: subtract from outflows
      newOutflow = currentOutflow - amountDelta;
    } else if (amountDelta < 0n) {
      // Deleting an inflow: subtract from inflows
      newInflow = currentInflow - -amountDelta;
    }
  } else {
    // When creating (or updating), amountDelta is the actual amount:
    // - Positive: inflow (money coming in)
    // - Negative: outflow (money going out)
    if (amountDelta > 0n) {
      // Creating an inflow: add to inflows
      newInflow = currentInflow + amountDelta;
    } else if (amountDelta < 0n) {
      // Creating an outflow: add to outflows (stored as positive)
      newOutflow = currentOutflow + -amountDelta;
    }
  }

  // Update the map entry
  monthlySpending[yearMonthStr] = {
    inflowAmount: newInflow,
    outflowAmount: newOutflow,
  };

  // Update transaction count
  const newTransactionCount = (category.transactionCount ?? 0n) + transactionCountDelta;

  await ctx.db.patch(categoryId, {
    monthlySpending,
    transactionCount: newTransactionCount,
    updatedAt: now,
  });

  return categoryId;
}

/**
 * Updates credit category spending for a specific category/month
 * Similar to updateCategorySpending but tracks spending vs payments separately
 *
 * @param ctx - Database context
 * @param _workspaceId - Workspace ID (unused, kept for API compatibility)
 * @param categoryId - Credit card category ID
 * @param _bankAccountId - Credit card bank account ID (unused, kept for API compatibility)
 * @param yearMonth - Year and month (YYYYMM format)
 * @param amountDelta - Amount to add (positive) or subtract (negative)
 * @param isPayment - true for payments, false for spending
 * @returns The category ID
 */
export async function updateCreditCategorySpending(
  ctx: { db: DatabaseWriter },
  _workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  _bankAccountId: Id<'bankAccount'>,
  yearMonth: number,
  amountDelta: bigint,
  isPayment: boolean,
  isRefund: boolean = false
): Promise<Id<'category'>> {
  // Get the category directly
  const category = await ctx.db.get(categoryId);
  if (!category) {
    throw new Error(`Category ${categoryId} not found`);
  }

  const now = new Date().toISOString();
  const yearMonthStr = yearMonth.toString();

  // Update the category's creditMonthlySpending map
  const creditMonthlySpending = { ...(category.creditMonthlySpending ?? {}) };
  const currentMonthData = creditMonthlySpending[yearMonthStr] ?? {
    priorBalance: 0n,
    spendingAmount: 0n,
    paymentsAmount: 0n,
    refundedSpending: 0n,
  };

  // Update the appropriate field
  if (isPayment) {
    creditMonthlySpending[yearMonthStr] = {
      ...currentMonthData,
      paymentsAmount: currentMonthData.paymentsAmount + amountDelta,
    };
  } else if (isRefund) {
    creditMonthlySpending[yearMonthStr] = {
      ...currentMonthData,
      refundedSpending: (currentMonthData.refundedSpending ?? 0n) + amountDelta,
    };
  } else {
    creditMonthlySpending[yearMonthStr] = {
      ...currentMonthData,
      spendingAmount: currentMonthData.spendingAmount + amountDelta,
    };
  }

  await ctx.db.patch(categoryId, {
    creditMonthlySpending,
    updatedAt: now,
  });

  return categoryId;
}

/**
 * Calculate credit card category budgets with on-the-fly prior balance calculation
 * Similar to calculateCategoryBudgetsForMonths but for credit card categories
 *
 * This function:
 * 1. Reads creditMonthlySpending directly from the category
 * 2. Uses pure calculation function for carryover chain
 * 3. Returns display values: prior balance, activity, current balance
 *
 * @param ctx - Database context
 * @param categoryId - Credit card category ID
 * @param targetYearMonth - The month we want to calculate up to
 * @param monthsBack - How many months back to calculate (default 24)
 * @returns Calculated budget data with credit card specific fields
 */
export async function calculateCreditCategoryBudgetsForMonths(
  ctx: { db: DatabaseWriter | QueryCtx['db'] },
  categoryId: Id<'category'>,
  targetYearMonth: number,
  monthsBack: number = 24
): Promise<CalculatedBudget[]> {
  // Calculate the start month (go back N months from target)
  let startYearMonth = targetYearMonth;
  for (let i = 0; i < monthsBack; i++) {
    startYearMonth = getPreviousYearMonthPure(startYearMonth);
  }

  // Get the category to find its workspaceId and creditMonthlySpending
  const category = await ctx.db.get(categoryId);
  if (!category || !category.workspaceId) {
    throw new Error(`Category ${categoryId} not found or missing workspaceId`);
  }
  const workspaceId = category.workspaceId;

  // Read creditMonthlySpending directly from the category (no longer a separate table)
  // Note: creditMonthlySpending keys are in YYYYMM format (e.g., "202401")
  const monthlySpending = category.creditMonthlySpending ?? {};
  const spendingMap = new Map<
    number,
    { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }
  >();

  for (const [yearMonthStr, spending] of Object.entries(monthlySpending)) {
    const yearMonth = parseInt(yearMonthStr, 10);
    if (yearMonth >= startYearMonth && yearMonth <= targetYearMonth) {
      spendingMap.set(yearMonth, spending);
    }
  }

  // Get all months from creditMonthlySpending for initial balance calculation
  const allMonths = Object.entries(monthlySpending).map(([yearMonthStr]) => parseInt(yearMonthStr, 10));
  allMonths.sort((a, b) => a - b);

  // Fetch the single budget row for this category
  const budget = await ctx.db
    .query('categoryBudget')
    .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
    .first();

  // Extract monthly amounts from map and create lookup map for budget assignments
  const monthlyAmounts = budget?.monthlyAssignedAmounts ?? {};
  const budgetMap = new Map<number, bigint>();
  for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
    const yearMonth = parseInt(yearMonthStr, 10);
    budgetMap.set(yearMonth, amount);
  }

  // Calculate initial balances from all activity before the display range
  let initialBudgetBalance = 0n;
  let initialDisplayBalance = 0n;

  // First, accumulate all budget assignments before the display range
  for (const [yearMonth, assignedAmount] of budgetMap.entries()) {
    if (yearMonth < startYearMonth) {
      initialBudgetBalance += assignedAmount;
    }
  }

  // Then, accumulate all spending activity before the display range
  for (const yearMonth of allMonths) {
    if (yearMonth < startYearMonth) {
      const record = monthlySpending[yearMonth.toString()];
      if (record) {
        const fundedSpending = record.spendingAmount * -1n;
        const refundedSpending = record.refundedSpending ?? 0n;
        initialBudgetBalance += fundedSpending - record.paymentsAmount + refundedSpending;
        initialDisplayBalance += record.priorBalance + record.spendingAmount + record.paymentsAmount + refundedSpending;
      }
    }
  }

  // Build input array for pure calculation function
  const monthInputs: CreditCardMonthInput[] = [];
  let currentMonth = startYearMonth;
  while (currentMonth <= targetYearMonth) {
    const record = spendingMap.get(currentMonth);
    const assignedAmount = budgetMap.get(currentMonth) ?? 0n;

    monthInputs.push({
      yearMonth: currentMonth,
      assignedAmount,
      priorBalance: record?.priorBalance ?? 0n,
      spendingAmount: record?.spendingAmount ?? 0n,
      paymentsAmount: record?.paymentsAmount ?? 0n,
      refundedSpending: record?.refundedSpending ?? 0n,
    });

    currentMonth = getNextYearMonthPure(currentMonth);
  }

  // Use pure calculation function for carryover chain
  const calculatedResults = calculateCreditCardCarryoverChain(monthInputs, initialBudgetBalance, initialDisplayBalance);

  // Convert to CalculatedBudget format
  return calculatedResults;
}

/**
 * Calculate the overfunded amount for a category based on its target type
 * @param target - The target object (if exists)
 * @param targetAmount - The target amount (if exists)
 * @param assignedAmount - The assigned amount for the month
 * @param assignmentNeeded - The amount needed to be assigned
 * @param available - The available amount (assigned + carryover + activity)
 * @param isFutureMonth - Whether this calculation is for a future month (optional, defaults to false)
 * @param totalSpent - The total spent amount (negative for spending, used for maintain_balance)
 * @returns The amount by which the category is overfunded (0 if not overfunded)
 */
export function calculateOverfundedByAmount(
  target: { targetType?: string },
  targetAmount: bigint | undefined,
  assignedAmount: bigint,
  assignmentNeeded: bigint,
  available: bigint,
  isFutureMonth: boolean = false,
  totalSpent: bigint = 0n
): bigint {
  // Can't be overfunded if available is not positive
  // (no actual extra money if available is 0 or negative)
  if (available <= 0n) {
    return 0n;
  }

  const capOverfundedToAvailable = (overfunded: bigint): bigint => {
    if (overfunded <= 0n) {
      return 0n;
    }

    return overfunded < available ? overfunded : available;
  };

  if (!target.targetType || targetAmount === undefined) {
    return 0n;
  }

  if (target.targetType === 'recurring_rollover') {
    // For recurring_rollover, overfunding logic differs by month context:
    //
    // Future months: Check if assigned exceeds assignmentNeeded
    //   - We ignore carryover because it will be consumed in the current/previous months
    //   - User is overfunded if they assigned more than the monthly target amount
    //
    // Current month BEFORE due date (saving up): Check if assigned exceeds assignmentNeeded
    //   - When assignmentNeeded < targetAmount, we're in a saving period before the due date
    //   - User only needs to assign the monthly portion, not the full target
    //   - If they assigned more than assignmentNeeded, they're overfunded for this month
    //
    // Current month AT/AFTER due date: Check if available exceeds targetAmount
    //   - available = assigned + carryover, which is the actual money in the envelope
    //   - If available > target for this month, excess money can be moved elsewhere
    if (isFutureMonth) {
      const overfunded = assignedAmount - assignmentNeeded;
      return capOverfundedToAvailable(overfunded);
    } else {
      // Current month: determine if we're actively saving up (before due date) or at the due date
      // When saving up, assignmentNeeded is the monthly portion (e.g., $80/month for $400 yearly)
      // When at due date, assignmentNeeded equals targetAmount (need full amount)
      // When carryover covers everything, assignmentNeeded = 0
      //
      // We're "actively saving" if we need to assign something AND it's less than the full target
      // If assignmentNeeded = 0, either we're overfunded or carryover covers it - check available vs target
      const isActivelySaving = assignmentNeeded > 0n && assignmentNeeded < targetAmount;

      if (isActivelySaving) {
        // Before due date, still need to save: check if assigned exceeds the monthly portion needed
        const overfunded = assignedAmount - assignmentNeeded;
        return capOverfundedToAvailable(overfunded);
      } else {
        // At/after due date: check for overfunding from two sources:
        // 1. Carryover causing available to exceed target (e.g., $150 carryover, $125 target)
        // 2. Assignment exceeding what's needed (e.g., assigned $56 when only $28 was needed)
        //
        // For "Fill up to" targets, we need to detect BOTH scenarios:
        // - If carryover alone exceeds target, that's excess money that could be moved elsewhere
        // - If you assigned more than needed, that's also overfunding (regardless of spending)
        const overfundedFromAvailable = available - targetAmount;
        const overfundedFromAssignment = assignedAmount - assignmentNeeded;

        // Return the larger of the two - both are valid forms of overfunding
        const overfunded =
          overfundedFromAvailable > overfundedFromAssignment ? overfundedFromAvailable : overfundedFromAssignment;

        return capOverfundedToAvailable(overfunded);
      }
    }
  } else if (target.targetType === 'maintain_balance') {
    // For FUTURE months: assume overfunding is corrected, show 0
    if (isFutureMonth) {
      return 0n;
    }

    // For CURRENT/PAST months: overfunding is purely how much the balance exceeds
    // the target. Use (available + abs(totalSpent)) so mid-month spending doesn't
    // mask overfunding (e.g. had $14k, spent $1k → still $4k over a $10k target).
    //
    // We do NOT also compare assignedAmount vs assignmentNeeded here: assignmentNeeded
    // is the gap-to-target (capped at the monthly contribution), which collapses to $0
    // as soon as the balance reaches target. Including it would flag a normal top-up
    // (e.g. assigning the $96.86 needed to reach $10k) as overfunded. The effective
    // balance already captures every real over-assignment, including assign-then-spend.
    const spentAbs = totalSpent < 0n ? totalSpent * -1n : totalSpent;
    const effectiveBalance = available + spentAbs;
    const overfunded = effectiveBalance - targetAmount;

    return capOverfundedToAvailable(overfunded);
  } else {
    // For other target types: check if assigned amount exceeds what's needed
    const overfunded = assignedAmount - assignmentNeeded;
    return capOverfundedToAvailable(overfunded);
  }
}

/**
 * Calculate multi-month interval tracking for a category's progress bar display.
 * Determines position within a saving interval and cumulative progress.
 *
 * @param yearMonth - The month to calculate for (YYYYMM)
 * @param firstDueDate - ISO date string of the first due date
 * @param intervalMonths - Total months in the saving interval (must be > 1)
 * @param assignedAmountsByMonth - Map of yearMonth -> assigned amount for this category
 * @param monthlyTarget - The monthly assignment target (assignmentNeeded)
 * @returns Multi-month interval tracking fields, or undefined if not applicable
 */
export function calculateMultiMonthInterval(
  yearMonth: number,
  firstDueDate: string,
  intervalMonths: number,
  assignedAmountsByMonth: Map<number, bigint>,
  monthlyTarget: bigint
):
  | {
      currentMonthInInterval: number;
      totalMonthsInInterval: number;
      cumulativeAssigned: bigint;
      cumulativeTargetNeeded: bigint;
    }
  | undefined {
  if (intervalMonths <= 1) return undefined;

  const firstDueYearMonth = dateToYearMonthPure(firstDueDate);

  // Calculate position in interval
  const fromYear = Math.floor(yearMonth / 100);
  const fromMonth = yearMonth % 100;
  const firstYear = Math.floor(firstDueYearMonth / 100);
  const firstMonth = firstDueYearMonth % 100;
  const monthsSinceFirstDue = (fromYear - firstYear) * 12 + (fromMonth - firstMonth);

  let positionInInterval: number;
  if (monthsSinceFirstDue < 0) {
    const monthsBeforeFirstDue = -monthsSinceFirstDue;
    if (monthsBeforeFirstDue < intervalMonths) {
      positionInInterval = intervalMonths - monthsBeforeFirstDue;
    } else {
      const remainderMonths = monthsBeforeFirstDue % intervalMonths;
      positionInInterval = remainderMonths === 0 ? intervalMonths : intervalMonths - remainderMonths;
    }
  } else if (monthsSinceFirstDue === 0) {
    positionInInterval = intervalMonths;
  } else {
    const positionFromDue = monthsSinceFirstDue % intervalMonths;
    positionInInterval = positionFromDue === 0 ? intervalMonths : positionFromDue;
  }

  // Calculate interval start and cumulative assigned
  let intervalStartYearMonth = yearMonth;
  for (let i = 0; i < positionInInterval - 1; i++) {
    intervalStartYearMonth = getPreviousYearMonthPure(intervalStartYearMonth);
  }

  let cumulativeSum = 0n;
  let sumMonth = intervalStartYearMonth;
  for (let i = 0; i < positionInInterval; i++) {
    const assigned = assignedAmountsByMonth.get(sumMonth) ?? 0n;
    cumulativeSum += assigned;
    sumMonth = getNextYearMonthPure(sumMonth);
  }

  const cumulativeTargetNeeded = monthlyTarget > 0n ? monthlyTarget * BigInt(positionInInterval) : 0n;

  return {
    currentMonthInInterval: positionInInterval,
    totalMonthsInInterval: intervalMonths,
    cumulativeAssigned: cumulativeSum,
    cumulativeTargetNeeded,
  };
}
