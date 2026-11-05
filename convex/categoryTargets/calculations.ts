/**
 * Pure calculation functions for category targets
 * No database dependencies - all functions accept plain objects/primitives
 */

import type { Frequency, TargetType } from './types';

export interface TargetInput {
  targetType: TargetType;
  amount: bigint;
  frequency?: Frequency; // Optional for one_time
  frequencyInterval?: number; // Optional for one_time
  dayOfWeek?: number;
  firstDueDate?: string; // ISO date (YYYY-MM-DD), optional for one_time
  targetDate?: string; // ISO date (YYYY-MM-DD), required for one_time
  monthlyContribution?: bigint; // For maintain_balance
  targetBalance?: bigint; // For maintain_balance
}

export interface TargetCalculationParams {
  target: TargetInput;
  yearMonth: number; // YYYYMM format
  currentYearMonth: number; // YYYYMM format (real current month)
  previousMonthCarryover: bigint; // From previous completed month
  currentBalance: bigint; // Current available balance in category
  assignedAmount: bigint; // Amount already assigned this month
  // For future month calculations
  previousMonthData?: {
    assignedAmount: bigint; // Amount already assigned in previous month
    targetAmount: bigint; // Target amount for previous month
    balance: bigint; // IMPORTANT: Balance at the START of the previous month (not current balance)
    // For maintain_balance targets, this should be the projected balance
    // accounting for all prior months being fully funded
  };
}

export interface TargetCalculationOutput {
  targetType: TargetType;
  baseTarget: bigint; // "Clean" target amount before adjustments
  monthlyAssignment: bigint; // Actual amount needed for the month
  remainingToAssign: bigint; // How much more needs to be assigned
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
}

/**
 * Count how many times a specific day of week occurs in a given month
 */
export function countDayOfWeekInMonth(yearMonth: number, dayOfWeek: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  let count = 0;
  const current = new Date(firstDay);

  while (current <= lastDay) {
    if (current.getDay() === dayOfWeek) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Convert ISO date string (YYYY-MM-DD) to yearMonth (YYYYMM)
 */
export function dateToYearMonth(isoDate: string): number {
  const parts = isoDate.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  return year * 100 + month;
}

/**
 * Calculate months between two yearMonth values
 */
export function getMonthsBetween(fromYearMonth: number, toYearMonth: number): number {
  const fromYear = Math.floor(fromYearMonth / 100);
  const fromMonth = fromYearMonth % 100;
  const toYear = Math.floor(toYearMonth / 100);
  const toMonth = toYearMonth % 100;

  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * Calculate the next due date for a recurring target
 */
export function getNextDueDateForRecurring(
  firstDueDate: string,
  frequency: Frequency,
  frequencyInterval: number,
  fromYearMonth: number
): number {
  const firstDueYearMonth = dateToYearMonth(firstDueDate);

  // If we haven't reached the first due date yet, that's the next due date
  if (fromYearMonth < firstDueYearMonth) {
    return firstDueYearMonth;
  }

  const firstYear = Math.floor(firstDueYearMonth / 100);
  const firstMonth = firstDueYearMonth % 100;
  const fromYear = Math.floor(fromYearMonth / 100);
  const fromMonth = fromYearMonth % 100;

  // Calculate total months from first due date to fromYearMonth
  const monthsSinceFirst = (fromYear - firstYear) * 12 + (fromMonth - firstMonth);

  // For monthly frequency: calculate next due based on interval
  if (frequency === 'monthly') {
    const intervalsPassed = Math.floor(monthsSinceFirst / frequencyInterval);

    // Check if we're exactly at a due date
    if (monthsSinceFirst % frequencyInterval === 0) {
      // We're at a due date - return the current month
      return fromYearMonth;
    }

    const monthsToNextDue = (intervalsPassed + 1) * frequencyInterval;

    let nextYear = firstYear;
    let nextMonth = firstMonth + monthsToNextDue;

    // Handle month overflow
    while (nextMonth > 12) {
      nextMonth -= 12;
      nextYear += 1;
    }

    return nextYear * 100 + nextMonth;
  }

  // For yearly frequency
  if (frequency === 'yearly') {
    // Check if we're exactly at a yearly due date
    if (monthsSinceFirst % (12 * frequencyInterval) === 0) {
      return fromYearMonth;
    }

    const yearsPassed = Math.floor(monthsSinceFirst / 12 / frequencyInterval);
    const nextDueYear = firstYear + (yearsPassed + 1) * frequencyInterval;
    return nextDueYear * 100 + firstMonth;
  }

  // For other frequencies (daily, weekly), default to monthly behavior
  return firstDueYearMonth;
}

/**
 * Calculate the base target amount for a given month
 * This is the "clean" target without any carryover adjustments
 */
export function calculateBaseTarget(
  target: TargetInput,
  yearMonth: number,
  currentBalance: bigint,
  currentYearMonth?: number
): bigint {
  if (target.targetType === 'maintain_balance') {
    return target.monthlyContribution ?? 0n;
  }

  // For recurring: interval-based (independent each month, balance doesn't matter)
  // This is for recurring expenses like monthly subscriptions, transit passes, etc.
  // You need the full amount each month regardless of what's carried over.
  if (target.targetType === 'recurring') {
    if (!target.firstDueDate || !target.frequency || !target.frequencyInterval) {
      return 0n;
    }
    const firstDueYearMonth = dateToYearMonth(target.firstDueDate);

    // Special case: AT the first due date AND it's the current month, need the full amount
    // This prevents the "fully funded" bug when you have carryover at the first due month
    if (yearMonth === firstDueYearMonth && yearMonth === currentYearMonth) {
      return target.amount;
    }

    // Find the next due date from the viewing month
    const nextDueDate = getNextDueDateForRecurring(
      target.firstDueDate,
      target.frequency,
      target.frequencyInterval,
      yearMonth
    );

    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // For simple recurring, NEVER use balance to reduce the target
    // Each month needs the full amount, regardless of carryover
    // Calculate interval months for consistent division
    let monthsInInterval: number;

    if (target.frequency === 'monthly') {
      monthsInInterval = target.frequencyInterval;
    } else if (target.frequency === 'yearly') {
      monthsInInterval = target.frequencyInterval * 12;
    } else if (target.frequency === 'weekly') {
      // For weekly, approximate as 4.33 weeks per month
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 4.33));
    } else if (target.frequency === 'daily') {
      // For daily, approximate as 30 days per month
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 30));
    } else {
      // Default to monthly behavior
      monthsInInterval = target.frequencyInterval;
    }

    const baseAmount = target.amount / BigInt(monthsInInterval);
    const remainder = target.amount % BigInt(monthsInInterval);

    // Add remainder to the due month to ensure total adds up exactly
    if (isAtDueDate && remainder > 0n) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  // For recurring_rollover: divide target evenly across months in interval
  // Spending within an interval does NOT increase assignment needed
  // Only carryover from a PREVIOUS COMPLETED interval reduces what's needed
  if (target.targetType === 'recurring_rollover') {
    if (!target.firstDueDate || !target.frequency || !target.frequencyInterval) {
      return 0n;
    }

    // Calculate interval length in months
    let monthsInInterval: number;
    if (target.frequency === 'monthly') {
      monthsInInterval = target.frequencyInterval;
    } else if (target.frequency === 'yearly') {
      monthsInInterval = target.frequencyInterval * 12;
    } else if (target.frequency === 'weekly') {
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 4.33));
    } else if (target.frequency === 'daily') {
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 30));
    } else {
      monthsInInterval = target.frequencyInterval;
    }

    const firstDueYearMonth = dateToYearMonth(target.firstDueDate);
    const monthsSinceFirstDue = getMonthsBetween(firstDueYearMonth, yearMonth);

    // Find the next due date to know if we're at a due month
    const nextDueDate = getNextDueDateForRecurring(
      target.firstDueDate,
      target.frequency,
      target.frequencyInterval,
      yearMonth
    );
    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // Handle months BEFORE the first due date (the initial saving period)
    // These months are part of the first interval, so divide target by months until first due
    if (monthsSinceFirstDue < 0) {
      // We're before the first due date
      // Calculate how many months until the first due date, INCLUDING the due month itself
      // e.g., November to December = 1 month difference, but we have 2 months to save (Nov + Dec)
      const monthsUntilFirstDue = -monthsSinceFirstDue + 1; // +1 to include the due month

      // But we shouldn't divide by more than the interval length
      // e.g., if interval is 2 months but we're 5 months before first due,
      // we should still only need to save over the last 2 months before due
      const effectiveMonthsToSave = Math.min(monthsUntilFirstDue, monthsInInterval);

      // Only start saving when we're within the interval period before the due date
      if (monthsUntilFirstDue > monthsInInterval) {
        // We're too far before the first due date - no need to save yet
        return 0n;
      }

      // Divide target by the number of months we have to save
      const baseAmount = target.amount / BigInt(effectiveMonthsToSave);
      const remainder = target.amount % BigInt(effectiveMonthsToSave);

      // Add remainder to the due month
      if (isAtDueDate && remainder > 0n) {
        return baseAmount + remainder;
      }

      return baseAmount;
    }

    // Determine if we're at the START of a new interval (first month after a due date)
    // This is when inter-interval carryover should be applied
    const isFirstMonthOfNewInterval = monthsSinceFirstDue > 0 && monthsSinceFirstDue % monthsInInterval === 1;

    // Calculate base monthly amount (target divided by months in interval)
    const baseAmount = target.amount / BigInt(monthsInInterval);
    const remainder = target.amount % BigInt(monthsInInterval);

    // If there's carryover from a previous interval that exceeds the target, nothing needed
    if (isFirstMonthOfNewInterval && currentBalance >= target.amount) {
      return 0n;
    }

    // If there's carryover from a previous interval, reduce the monthly amount proportionally
    // But only at the START of a new interval, not for intra-interval months
    if (isFirstMonthOfNewInterval && currentBalance > 0n) {
      const remaining = target.amount - currentBalance;
      if (remaining <= 0n) {
        return 0n;
      }
      // Divide remaining by months in interval (we're at month 1 of the new interval)
      const adjustedBaseAmount = remaining / BigInt(monthsInInterval);
      const adjustedRemainder = remaining % BigInt(monthsInInterval);

      // Add remainder to the due month
      if (isAtDueDate && adjustedRemainder > 0n) {
        return adjustedBaseAmount + adjustedRemainder;
      }
      return adjustedBaseAmount;
    }

    // For all other months (intra-interval), just return the fixed monthly amount
    // Add remainder to the due month to ensure total adds up exactly
    if (isAtDueDate && remainder > 0n) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  // For one_time: save for a specific amount by a specific date
  if (target.targetType === 'one_time') {
    if (!target.targetDate) {
      return 0n;
    }

    // Calculate months until due date
    const targetYearMonth = dateToYearMonth(target.targetDate);
    const monthsUntilDue = getMonthsBetween(yearMonth, targetYearMonth);

    // If due date has passed, target is complete
    if (monthsUntilDue < 0) {
      return 0n;
    }

    // If we've already reached the target amount, no need to save more
    if (currentBalance >= target.amount) {
      return 0n;
    }

    // Calculate remaining amount needed
    const remaining = target.amount - currentBalance;

    // If we're at the due date month, return the remaining amount
    if (monthsUntilDue === 0) {
      return remaining;
    }

    // Divide the remaining amount by the number of months until due
    // Add 1 to include both the current month and the due date month
    // Example: Nov to Jan = 2 months difference, but we need 3 months total (Nov, Dec, Jan)
    const totalMonths = monthsUntilDue + 1;
    const baseAmount = remaining / BigInt(totalMonths);
    const remainder = remaining % BigInt(totalMonths);

    // Add remainder to the due month to ensure total adds up exactly
    if (yearMonth === targetYearMonth) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  throw new Error(`Unexpected target type: ${target.targetType}`);
}

/**
 * Calculate the monthly assignment for the current month
 */
export function calculateCurrentMonthAssignment(
  target: TargetInput,
  baseTarget: bigint,
  previousMonthCarryover: bigint,
  currentBalance: bigint
): bigint {
  if (target.targetType === 'maintain_balance') {
    const targetBalance = target.targetBalance ?? target.amount;
    const monthlyContribution = target.monthlyContribution ?? 0n;

    if (currentBalance >= targetBalance) {
      // Already at or above target balance
      return 0n;
    }

    // If balance is negative, need to cover the negative PLUS the monthly contribution
    // Example: target $100, contribution $50, balance -$10 → need $50 + $10 = $60
    if (currentBalance < 0n) {
      return monthlyContribution + currentBalance * -1n;
    }

    // Normal case: just need the monthly contribution
    return monthlyContribution;
  }

  if (target.targetType === 'recurring_rollover') {
    // For recurring_rollover, the baseTarget is now correctly calculated to:
    // 1. Divide target by months in interval for fixed monthly amounts
    // 2. Only apply inter-interval carryover at the start of a new interval
    // 3. Ignore intra-interval spending (doesn't increase assignment needed)
    //
    // We only need to check for negative available balance (overspending beyond what's available)
    // If currentBalance is negative, we need to cover that deficit
    if (currentBalance < 0n) {
      // Need to cover the deficit plus the normal monthly assignment
      return baseTarget + currentBalance * -1n;
    }

    return baseTarget;
  }

  if (target.targetType === 'recurring') {
    // For recurring: baseTarget already accounts for current balance
    return baseTarget;
  }

  if (target.targetType === 'one_time') {
    // For one_time: if balance already meets or exceeds target, no assignment needed
    if (currentBalance >= target.amount) {
      return 0n;
    }
    // Otherwise, return the baseTarget (which already accounts for balance and months until due)
    return baseTarget;
  }

  throw new Error(`Unexpected target type: ${target.targetType}`);
}

/**
 * Calculate the monthly assignment for a future month
 *
 * For maintain_balance:
 *   - Checks if previous month's balance will meet the target when fully funded
 *   - CRITICAL: previousMonthData.balance must be the balance at the START of the previous month
 *   - For chaining multiple future months, each month's "balance" should be the projected
 *     balance from all prior months being fully funded
 *   - Example: If Nov needs $50, Dec needs $10, then Jan's previousMonthData should have:
 *     balance: $50 (Nov's starting balance after Oct was funded)
 *     targetAmount: $10 (Dec only needs $10)
 *     This will correctly calculate Jan as needing $0 since $50 + $10 = $60 (target met)
 *
 * For recurring_rollover:
 *   - Calculate like recurring (divide by interval) since we assume the current cycle's money will be spent
 *
 * For other types:
 *   - Returns the base target without adjustments
 */
export function calculateFutureMonthAssignment(
  target: TargetInput,
  baseTarget: bigint,
  yearMonth: number,
  previousMonthData?: {
    assignedAmount: bigint;
    targetAmount: bigint;
    balance: bigint;
  }
): bigint {
  if (target.targetType === 'maintain_balance' && previousMonthData) {
    // For maintain_balance: check if previous month will meet target when fully funded
    // We ASSUME the user will complete the target in the previous month
    const targetBalance = target.targetBalance ?? target.amount;

    // Calculate projected balance assuming previous month gets fully funded
    // We assume the FULL target will be met, not just the remaining amount
    // Example: If Nov has balance=$0, target=$50, assigned=$20
    //   We assume Nov will end at: $0 + $50 = $50 (not $0 + $30)
    const projectedBalance = previousMonthData.balance + previousMonthData.targetAmount;

    if (projectedBalance >= targetBalance) {
      // Previous month will reach target when fully funded
      return 0n;
    }

    // Calculate shortfall to reach target
    const shortfall = targetBalance - projectedBalance;
    // Return the lesser of the monthly contribution or the shortfall
    return shortfall < baseTarget ? shortfall : baseTarget;
  }

  if (target.targetType === 'recurring_rollover') {
    // For future months with recurring_rollover, calculate similar to regular recurring
    // We assume any money saved in the current cycle will be spent at the due date
    // So future months start fresh saving for the NEXT occurrence
    const nextDueDate = getNextDueDateForRecurring(
      target.firstDueDate!,
      target.frequency!,
      target.frequencyInterval!,
      yearMonth
    );

    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // Calculate interval months
    let monthsInInterval: number;
    if (target.frequency === 'monthly') {
      monthsInInterval = target.frequencyInterval!;
    } else if (target.frequency === 'yearly') {
      monthsInInterval = target.frequencyInterval! * 12;
    } else if (target.frequency === 'weekly') {
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval! / 4.33));
    } else if (target.frequency === 'daily') {
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval! / 30));
    } else {
      monthsInInterval = target.frequencyInterval!;
    }

    const baseAmount = target.amount / BigInt(monthsInInterval);
    const remainder = target.amount % BigInt(monthsInInterval);

    // Add remainder to the due month
    if (isAtDueDate && remainder > 0n) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  if (target.targetType === 'one_time' && previousMonthData) {
    // For one_time: check if previous month will meet target when fully funded
    // Similar to maintain_balance, we assume previous month gets fully funded
    const projectedBalance = previousMonthData.balance + previousMonthData.targetAmount;

    if (projectedBalance >= target.amount) {
      // Previous month will reach target when fully funded
      return 0n;
    }

    // Calculate remaining amount needed based on projected balance
    const remaining = target.amount - projectedBalance;

    // Calculate months until due date from this future month
    if (!target.targetDate) {
      return 0n;
    }
    const targetYearMonth = dateToYearMonth(target.targetDate);
    const monthsUntilDue = getMonthsBetween(yearMonth, targetYearMonth);

    // If due date has passed or we're at the due month, return remaining
    if (monthsUntilDue <= 0) {
      return remaining;
    }

    // Divide remaining by months until due
    // Add 1 to include both the current month and the due date month
    // Example: Dec to Jan = 1 month difference, but we need 2 months total (Dec and Jan)
    const totalMonths = monthsUntilDue + 1;
    const baseAmount = remaining / BigInt(totalMonths);
    const remainder = remaining % BigInt(totalMonths);

    // Add remainder to the due month to ensure total adds up exactly
    if (yearMonth === targetYearMonth) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  // For other target types, always show the clean base target
  return baseTarget;
}

/**
 * Main calculation function for category targets
 */
export function calculateTargetForMonth(params: TargetCalculationParams): TargetCalculationOutput {
  const {
    target,
    yearMonth,
    currentYearMonth,
    previousMonthCarryover,
    currentBalance,
    assignedAmount,
    previousMonthData,
  } = params;

  const isCurrentMonth = yearMonth === currentYearMonth;
  const isFutureMonth = yearMonth > currentYearMonth;

  // Determine which balance to use for target calculation
  let balanceForTargetCalculation: bigint;

  if (target.targetType === 'recurring') {
    // For recurring targets before first due, ALWAYS use previousMonthCarryover
    // for both current and future months to maintain consistent monthly targets
    const firstDueYearMonth = dateToYearMonth(target.firstDueDate!);
    const baseMonth = currentYearMonth ?? yearMonth;

    // If we're calculating before the first due date, use previousMonthCarryover
    if (baseMonth <= firstDueYearMonth) {
      balanceForTargetCalculation = previousMonthCarryover;
    } else {
      // After first due date, use appropriate balance
      balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
    }
  } else if (target.targetType === 'one_time') {
    // For one_time: use previousMonthCarryover for current month, currentBalance for future months
    balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
  } else {
    // For other target types, use previousMonthCarryover for current month only
    balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
  }

  const baseTarget = calculateBaseTarget(target, yearMonth, balanceForTargetCalculation, currentYearMonth);

  let monthlyAssignment: bigint;

  if (isCurrentMonth) {
    monthlyAssignment = calculateCurrentMonthAssignment(target, baseTarget, previousMonthCarryover, currentBalance);
  } else if (isFutureMonth) {
    monthlyAssignment = calculateFutureMonthAssignment(target, baseTarget, yearMonth, previousMonthData);
  } else {
    // Past month: historical data, show base target
    monthlyAssignment = baseTarget;
  }

  const remainingToAssign = monthlyAssignment > assignedAmount ? monthlyAssignment - assignedAmount : 0n;

  return {
    targetType: target.targetType,
    baseTarget,
    monthlyAssignment,
    remainingToAssign,
    isCurrentMonth,
    isFutureMonth,
  };
}
