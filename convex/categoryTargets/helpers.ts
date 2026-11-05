import type { CategoryTarget, TargetCalculationInput, TargetCalculationResult, ValidCategoryTarget } from './types';

/**
 * Count how many times a specific day of week occurs in a given month
 * @param yearMonth - YYYYMM format (e.g., 202401)
 * @param dayOfWeek - 0-6 (Sunday-Saturday)
 */
export function countDayOfWeekInMonth(yearMonth: number, dayOfWeek: number): number {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;

  // Get first and last day of month
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
 * Count how many actual occurrences of a recurring weekly target fall in a given month,
 * respecting the frequency interval (e.g., every 2 weeks).
 *
 * @param yearMonth - YYYYMM format (e.g., 202603)
 * @param dayOfWeek - 0-6 (Sunday-Saturday)
 * @param frequencyInterval - How many weeks between occurrences (e.g., 2 for bi-weekly)
 * @param firstDueDate - ISO date string (YYYY-MM-DD) of the first occurrence
 * @returns Number of actual occurrences in the month
 */
export function countRecurringWeeklyOccurrencesInMonth(
  yearMonth: number,
  dayOfWeek: number,
  frequencyInterval: number,
  firstDueDate: string | undefined
): number {
  // If interval is 1, every occurrence of that day counts
  if (frequencyInterval === 1 || !firstDueDate) {
    return countDayOfWeekInMonth(yearMonth, dayOfWeek);
  }

  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month

  // Parse the first due date
  const [fdYear, fdMonth, fdDay] = firstDueDate.split('-').map(Number);
  const firstDue = new Date(fdYear, fdMonth - 1, fdDay);

  // Calculate the interval in days
  const intervalDays = frequencyInterval * 7;

  // Find all occurrences of the target day in this month
  const targetDaysInMonth: Date[] = [];
  const current = new Date(monthStart);
  while (current <= monthEnd) {
    if (current.getDay() === dayOfWeek) {
      targetDaysInMonth.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  // Count which of those days are actual occurrences based on the recurring schedule
  let count = 0;
  for (const day of targetDaysInMonth) {
    // Calculate the difference in days from firstDueDate
    const diffTime = day.getTime() - firstDue.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    // An occurrence happens if the difference is a non-negative multiple of intervalDays
    // Also include dates before firstDueDate that are NOT on the schedule
    if (diffDays >= 0 && diffDays % intervalDays === 0) {
      count++;
    }
  }

  return count;
}

/**
 * Calculate the base target amount for a given month
 * This is the "clean" target without any carryover adjustments
 * All recurring targets now use date-based calculation with firstDueDate
 * @param target - The category target
 * @param yearMonth - The month to calculate the target for (YYYYMM format)
 * @param currentBalance - The current available balance in the category
 * @param currentYearMonth - The actual current month (for calculating consistent targets)
 */
export function calculateBaseTarget(
  target: ValidCategoryTarget,
  yearMonth: number,
  currentBalance: bigint,
  currentYearMonth?: number
): bigint {
  if (target.targetType === 'maintain_balance') {
    // For maintain_balance, the base target is the monthly contribution
    return target.monthlyContribution ?? 0n;
  }

  // For recurring: interval-based (independent each month, balance doesn't matter)
  // This is for recurring expenses like monthly subscriptions, transit passes, etc.
  // You need the full amount each month regardless of what's carried over.
  if (target.targetType === 'recurring') {
    if (!target.frequency || !target.frequencyInterval) {
      return 0n;
    }

    // WEEKLY FREQUENCY with dayOfWeek: Special handling - calculate per-week target × occurrences in month
    // This is for expenses that happen every week on a specific day (e.g., groceries every Sunday)
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      const occurrencesInMonth = countRecurringWeeklyOccurrencesInMonth(
        yearMonth,
        target.dayOfWeek,
        target.frequencyInterval,
        target.firstDueDate
      );
      // Total needed for this month = per-occurrence amount × number of occurrences
      const totalNeededForMonth = target.amount * BigInt(occurrencesInMonth);
      return totalNeededForMonth;
    }

    const dueDate =
      target.firstDueDate || ('startDate' in target ? (target.startDate as string | undefined) : undefined);

    if (!dueDate) {
      // Fallback to current month if no date specified
      const year = Math.floor(yearMonth / 100);
      const month = yearMonth % 100;
      const fallbackDate = `${year}-${month.toString().padStart(2, '0')}-01`;
      const fallbackYearMonth = dateToYearMonth(fallbackDate);

      // If we're at the first due date (fallback = current month), return full amount
      if (yearMonth === fallbackYearMonth) {
        return target.amount;
      }

      const nextDueDate = getNextDueDateForRecurring(
        fallbackDate,
        target.frequency,
        target.frequencyInterval,
        yearMonth
      );

      const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
      const isAtDueDate = monthsUntilDue === 0;

      // Divide by total interval for consistent monthly savings
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

      const baseAmount = target.amount / BigInt(monthsInInterval);
      const remainder = target.amount % BigInt(monthsInInterval);

      // Add remainder to the due month to ensure total adds up exactly
      if (isAtDueDate && remainder > 0n) {
        return baseAmount + remainder;
      }

      return baseAmount;
    }

    // Convert first due date to yearMonth for comparison
    const firstDueYearMonth = dateToYearMonth(dueDate);

    // Special case: AT the first due date AND it's the current month, need the full amount
    // This prevents the "fully funded" bug when you have carryover at the first due month
    if (yearMonth === firstDueYearMonth && yearMonth === currentYearMonth) {
      return target.amount;
    }

    // Check if we're in the INITIAL interval (before or at the first due date)
    // This requires special handling: divide by months remaining and consider the balance
    const monthsSinceFirstDue = getMonthsBetween(firstDueYearMonth, yearMonth);
    if (monthsSinceFirstDue <= 0) {
      // We're BEFORE or AT the first due date - initial interval
      // Calculate months remaining from the VIEWING month to the due date
      // Example: Dec 2025 viewing with Feb 2026 due = 3 months (Dec, Jan, Feb)
      const monthsRemainingInInterval = -monthsSinceFirstDue + 1; // +1 to include due month

      // For PAST months, don't use balance - just calculate pure monthly target
      // because the "current balance" might include assignments from future months
      // (e.g., viewing January after assigning in February)
      const isPastMonth = currentYearMonth !== undefined && yearMonth < currentYearMonth;

      if (isPastMonth) {
        // Pure calculation: divide total by months remaining at that time
        const baseAmount = target.amount / BigInt(monthsRemainingInInterval);
        const remainder = target.amount % BigInt(monthsRemainingInInterval);

        // Add remainder to the due month to ensure total adds up exactly
        if (monthsRemainingInInterval === 1 && remainder > 0n) {
          return baseAmount + remainder;
        }

        return baseAmount;
      }

      // For current/future months, consider the balance
      // This allows carryover from previous months to reduce what's needed
      const effectiveBalance = currentBalance > 0n ? currentBalance : 0n;
      const remainingNeeded = target.amount - effectiveBalance;

      if (remainingNeeded <= 0n) {
        return 0n; // Already have enough saved
      }

      const baseAmount = remainingNeeded / BigInt(monthsRemainingInInterval);
      const remainder = remainingNeeded % BigInt(monthsRemainingInInterval);

      // Add remainder to the due month to ensure total adds up exactly
      if (monthsRemainingInInterval === 1 && remainder > 0n) {
        return baseAmount + remainder;
      }

      return baseAmount;
    }

    // Find the next due date from the viewing month
    const nextDueDate = getNextDueDateForRecurring(dueDate, target.frequency, target.frequencyInterval, yearMonth);

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
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 4.33));
    } else if (target.frequency === 'daily') {
      monthsInInterval = Math.max(1, Math.round(target.frequencyInterval / 30));
    } else {
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

  // For recurring_rollover: balance carries over and reduces what's needed
  if (target.targetType === 'recurring_rollover') {
    if (!target.frequency || !target.frequencyInterval) {
      return 0n;
    }

    // WEEKLY FREQUENCY: Special handling - calculate per-week target × occurrences in month
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      const occurrencesInMonth = countRecurringWeeklyOccurrencesInMonth(
        yearMonth,
        target.dayOfWeek,
        target.frequencyInterval,
        target.firstDueDate
      );
      // Total needed for this month = per-occurrence amount × number of occurrences
      const totalNeededForMonth = target.amount * BigInt(occurrencesInMonth);
      // Only positive balance (carryover) reduces the target; negative balance doesn't inflate it
      // If you overspent, you still only need to fund up to the target amount
      const effectiveBalance = currentBalance > 0n ? currentBalance : 0n;
      const remaining = totalNeededForMonth > effectiveBalance ? totalNeededForMonth - effectiveBalance : 0n;

      return remaining;
    }

    // Get firstDueDate - support both new and legacy fields during migration
    const dueDate =
      target.firstDueDate || ('startDate' in target ? (target.startDate as string | undefined) : undefined);

    if (!dueDate) {
      // Fallback to current month if no date specified
      const year = Math.floor(yearMonth / 100);
      const month = yearMonth % 100;
      const fallbackDate = `${year}-${month.toString().padStart(2, '0')}-01`;

      const nextDueDate = getNextDueDateForRecurring(
        fallbackDate,
        target.frequency,
        target.frequencyInterval,
        yearMonth
      );

      const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
      // Only positive balance reduces the target; negative balance doesn't inflate it
      const effectiveBalance = currentBalance > 0n ? currentBalance : 0n;
      const remaining = target.amount > effectiveBalance ? target.amount - effectiveBalance : 0n;

      if (monthsUntilDue === 0) return remaining;
      if (remaining <= 0n) return 0n;

      return remaining / BigInt(monthsUntilDue);
    }

    // Find the next due date from the viewing month
    const nextDueDate = getNextDueDateForRecurring(dueDate, target.frequency, target.frequencyInterval, yearMonth);

    // Calculate months from viewing month to the due date
    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // Calculate interval length in months
    let monthsInInterval: number;
    if (target.frequency === 'monthly') {
      monthsInInterval = target.frequencyInterval;
    } else if (target.frequency === 'yearly') {
      monthsInInterval = target.frequencyInterval * 12;
    } else {
      monthsInInterval = target.frequencyInterval;
    }

    const firstDueYearMonth = dateToYearMonth(dueDate);
    const monthsSinceFirstDue = getMonthsBetween(firstDueYearMonth, yearMonth);

    // Check if we're in the INITIAL interval (before or at the first due date)
    // This is a special case because there's no "previous interval" to carry over FROM
    // Instead, we use currentBalance as savings toward the target
    const isInInitialInterval = monthsSinceFirstDue <= 0;

    if (isInInitialInterval) {
      // INITIAL INTERVAL: Before or at the first due date
      // The interval starts at (frequencyInterval - 1) months before the first due date
      // Example: 6-month interval with first due December -> starts in July
      //
      // We calculate months remaining based on where we are relative to the due date
      // If we're at the due date (monthsSinceFirstDue === 0), we have 1 month remaining
      // If we're 1 month before (monthsSinceFirstDue === -1), we have 2 months remaining
      // etc.
      const monthsRemainingInInterval = -monthsSinceFirstDue + 1; // +1 to include the due month

      // For recurring_rollover, the currentBalance is previousMonthCarryover (see line ~885),
      // representing what was available at the START of the month. This carryover should
      // ALWAYS count toward the target, even for past months, because it accurately represents
      // what was there at the start of that month (not affected by future assignments).
      //
      // This is different from other target types where the "current balance" for past months
      // might be polluted by assignments from future months.
      //
      // Only positive balance reduces what's needed (no negative balance inflation)
      const effectiveBalance = currentBalance > 0n ? currentBalance : 0n;

      // For initial interval: balance ALREADY includes all previous assignments
      // So we only subtract the balance, NOT the cumulative assignments (that would double-count)
      // Example: You've assigned $250/month for 5 months = $1,250 total
      //   Your balance is now $1,250 (or less if you spent some)
      //   Remaining needed = $1,500 - $1,250 = $250, NOT $1,500 - $1,250 - $1,250
      const remainingNeeded = target.amount - effectiveBalance;

      if (remainingNeeded <= 0n) {
        return 0n;
      }

      // Divide remaining by months left
      const baseAmount = remainingNeeded / BigInt(monthsRemainingInInterval);
      const remainder = remainingNeeded % BigInt(monthsRemainingInInterval);

      // Add remainder to the due month to ensure total adds up exactly
      if (isAtDueDate && remainder > 0n) {
        return baseAmount + remainder;
      }

      return baseAmount;
    }

    // SUBSEQUENT INTERVALS: After the first due date
    // Determine if we're at the start of a NEW interval
    // For interval=1: every month is both a due date AND the start of a new interval
    // For interval>1: first month after a due date is the start of a new interval
    let isFirstMonthOfNewInterval: boolean;
    if (monthsInInterval === 1) {
      // Every due date for interval=1
      isFirstMonthOfNewInterval = isAtDueDate;
    } else {
      // For interval>1, first month AFTER a due date is the start of a new interval
      // monthsSinceFirstDue % monthsInInterval === 1 means we're 1 month after a due date
      isFirstMonthOfNewInterval = monthsSinceFirstDue % monthsInInterval === 1;
    }

    // Calculate how many months are left in the current interval (including this month)
    let monthsRemainingInInterval: number;
    if (monthsUntilDue <= 0) {
      monthsRemainingInInterval = 1; // At or past due date, this is the last month
    } else if (monthsUntilDue < monthsInInterval) {
      monthsRemainingInInterval = monthsUntilDue + 1; // +1 to include current month
    } else {
      monthsRemainingInInterval = monthsInInterval;
    }

    // Safety check - ensure we never divide by zero
    if (monthsRemainingInInterval <= 0) {
      monthsRemainingInInterval = 1;
    }

    // For recurring_rollover: if current balance already covers the target, nothing needed
    // This applies regardless of interval position - the balance represents accumulated savings
    if (currentBalance >= target.amount) {
      return 0n;
    }

    // Calculate what's still needed for this interval
    // For recurring_rollover, balance represents the accumulated savings toward this target
    // The balance already reflects all prior assignments in the interval, so no separate
    // cumulative assignment tracking is needed
    const effectiveBalance = currentBalance > 0n ? currentBalance : 0n;
    const remainingNeeded = target.amount - effectiveBalance;

    if (remainingNeeded <= 0n) {
      return 0n;
    }

    // Divide remaining by months left in interval
    const baseAmount = remainingNeeded / BigInt(monthsRemainingInInterval);
    const remainder = remainingNeeded % BigInt(monthsRemainingInInterval);

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

  // Fallback for any unexpected target type
  throw new Error(`Unexpected target type: ${target.targetType}`);
}

/**
 * Calculate the monthly assignment for the current month
 * Takes into account carryover from previous month
 */
function calculateCurrentMonthAssignment(
  target: ValidCategoryTarget,
  baseTarget: bigint,
  previousMonthCarryover: bigint,
  currentBalance: bigint,
  totalSpent?: bigint
): bigint {
  if (target.targetType === 'maintain_balance') {
    // For maintain_balance: assign monthly contribution unless already at target
    const targetBalance = target.targetBalance ?? target.amount;
    const monthlyContribution = target.monthlyContribution ?? 0n;

    // Use effective balance = available + abs(totalSpent) to prevent mid-month changes
    // Example: Had $14k, spent $1k (now $13k available), effective balance is still $14k
    // This prevents the "more needed" amount from changing based on spending
    const spentAbs = totalSpent !== undefined && totalSpent < 0n ? totalSpent * -1n : 0n;
    const effectiveBalance = currentBalance + spentAbs;

    if (effectiveBalance >= targetBalance) {
      // Already at or above target balance (including money spent this month)
      return 0n;
    }

    // If effective balance is negative, need to cover the negative PLUS the monthly contribution
    // Example: target $100, contribution $50, balance -$10 → need $50 + $10 = $60
    if (effectiveBalance < 0n) {
      return monthlyContribution + effectiveBalance * -1n;
    }

    // Normal case: assign the monthly contribution, but never more than what's
    // needed to reach the target balance. Example: $10k target, $500/mo, $9,903.14
    // available → only $96.86 needed, not the full $500.
    // (Mirrors the cap in calculateFutureMonthAssignment for maintain_balance.)
    const remainingToTarget = targetBalance - effectiveBalance;
    return monthlyContribution < remainingToTarget ? monthlyContribution : remainingToTarget;
  }

  if (target.targetType === 'recurring_rollover') {
    // When previousMonthCarryover is negative, user needs to cover that deficit
    // IN ADDITION to the base target for this month.
    // Example: Target $125, carryover -$125 → need $250 ($125 deficit + $125 target)
    // The baseTarget (from calculateBaseTarget) clamps negative balances to 0,
    // so it only calculates the clean target amount, ignoring the debt.
    const deficit = previousMonthCarryover < 0n ? previousMonthCarryover * -1n : 0n;

    // For weekly targets, the "target amount" for the month is per-occurrence × occurrences
    // So we need to check against that total, not just target.amount (which is per-occurrence)
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      return baseTarget + deficit;
    }

    return baseTarget + deficit;
  }

  if (target.targetType === 'recurring') {
    // For recurring: the baseTarget already accounts for current balance
    // and divides remaining by months until due, so just return it
    // This is the date-based calculation that works for all recurring targets
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

  // Fallback for any unexpected target type
  throw new Error(`Unexpected target type: ${target.targetType}`);
}

/**
 * Calculate the monthly assignment for a future month
 * For maintain_balance, check if previous month's balance already meets the target
 * For recurring_rollover, calculate like recurring (divide by interval) since we assume the current cycle's money will be spent
 * For other types, returns the base target without adjustments
 */
function calculateFutureMonthAssignment(
  target: ValidCategoryTarget,
  baseTarget: bigint,
  yearMonth: number,
  currentYearMonth: number,
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
    if (!target.frequency || !target.frequencyInterval) {
      return baseTarget;
    }

    // WEEKLY FREQUENCY: For future months, calculate per-week target × occurrences in that month
    // We assume the current month's budget will be spent, so future months start fresh
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      const occurrencesInMonth = countDayOfWeekInMonth(yearMonth, target.dayOfWeek);
      const totalNeededForMonth = target.amount * BigInt(occurrencesInMonth);

      return totalNeededForMonth;
    }

    // MONTHLY with interval=1: assume current month's budget will be spent,
    // so future months start fresh and need the full target amount.
    if (target.frequency === 'monthly' && target.frequencyInterval === 1) {
      return target.amount;
    }

    const dueDate =
      target.firstDueDate || ('startDate' in target ? (target.startDate as string | undefined) : undefined);

    if (!dueDate) {
      return baseTarget;
    }

    // Check if the future month is still in the INITIAL interval (before/at first due date)
    const firstDueYearMonth = dateToYearMonth(dueDate);
    const monthsSinceFirstDue = getMonthsBetween(firstDueYearMonth, yearMonth);

    if (monthsSinceFirstDue <= 0) {
      // Future month is in the initial interval - we're still saving for the first occurrence
      // Project balance forward and calculate remaining/months properly (same as subsequent intervals)

      const monthsRemainingInInterval = -monthsSinceFirstDue + 1;

      // Project balance forward: previous balance + previous month's target
      let projectedBalance = 0n;
      if (previousMonthData) {
        projectedBalance = previousMonthData.balance + previousMonthData.targetAmount;
      }
      const effectiveBalance = projectedBalance > 0n ? projectedBalance : 0n;

      // Calculate remaining needed to reach target
      const remainingNeeded = target.amount - effectiveBalance;
      if (remainingNeeded <= 0n) {
        return 0n; // Already have enough saved
      }

      const baseAmount = remainingNeeded / BigInt(monthsRemainingInInterval);
      const remainder = remainingNeeded % BigInt(monthsRemainingInInterval);

      // At the due month (monthsRemainingInInterval === 1), return the actual remaining needed
      // This accounts for any remainder from previous months
      if (monthsRemainingInInterval === 1 && remainder > 0n) {
        return baseAmount + remainder;
      }

      return baseAmount;
    }

    // SUBSEQUENT INTERVALS: After the first due date
    // Project balance forward based on previous month data and calculate remaining/months properly
    const nextDueDate = getNextDueDateForRecurring(dueDate, target.frequency, target.frequencyInterval, yearMonth);

    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // Project balance forward: previous balance + previous month's target
    let projectedBalance = 0n;
    if (previousMonthData) {
      projectedBalance = previousMonthData.balance + previousMonthData.targetAmount;
    }
    const effectiveBalance = projectedBalance > 0n ? projectedBalance : 0n;

    // Calculate remaining needed to reach target
    const remainingNeeded = target.amount - effectiveBalance;
    if (remainingNeeded <= 0n) {
      return 0n; // Already have enough saved
    }

    // Calculate months remaining in interval (including this month)
    // Guard: if monthsUntilDue is negative (past due), treat as 1 month remaining
    // to avoid division by zero and return the full remaining amount
    const monthsRemaining = Math.max(monthsUntilDue + 1, 1);

    const baseAmount = remainingNeeded / BigInt(monthsRemaining);
    const remainder = remainingNeeded % BigInt(monthsRemaining);

    // Add remainder to the due month to ensure total adds up exactly
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

    // Calculate remaining amount needed
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
    const totalMonths = monthsUntilDue + 1;
    const baseAmount = remaining / BigInt(totalMonths);
    const remainder = remaining % BigInt(totalMonths);

    // Add remainder to the due month to ensure total adds up exactly
    if (yearMonth === targetYearMonth) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  // For recurring targets in the initial interval, project balance based on expected
  // contributions rather than actual over-funding. This ensures future months still
  // show their target amount even if previous months were over-funded.
  if (target.targetType === 'recurring') {
    if (!target.frequency || !target.frequencyInterval) {
      return baseTarget;
    }

    // WEEKLY FREQUENCY: For future months, return the base target calculated for that month
    // Weekly targets with dayOfWeek are already calculated correctly in calculateBaseTarget
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      return baseTarget;
    }

    const dueDate =
      target.firstDueDate || ('startDate' in target ? (target.startDate as string | undefined) : undefined);

    if (!dueDate) {
      return baseTarget;
    }

    // Check if the future month is still in the INITIAL interval (before/at first due date)
    const firstDueYearMonth = dateToYearMonth(dueDate);
    const monthsSinceFirstDue = getMonthsBetween(firstDueYearMonth, yearMonth);

    if (monthsSinceFirstDue <= 0) {
      // Future month is in the initial interval - we're still saving for the first occurrence
      // Calculate a consistent monthly contribution based on the interval from currentYearMonth to the due date
      // This ensures all months in the initial interval show the same monthly target

      // Calculate the total months in the initial interval from currentYearMonth
      const currentMonthsFromFirstDue = getMonthsBetween(firstDueYearMonth, currentYearMonth);
      const totalMonthsInInitialInterval = -currentMonthsFromFirstDue + 1; // from current month to due date

      // Calculate the consistent monthly contribution for this initial interval
      const monthlyContribution = target.amount / BigInt(totalMonthsInInitialInterval);

      // Calculate how many months of contributions we expect before this future month
      // (months from currentYearMonth to yearMonth, not including yearMonth)
      const monthsBeforeFutureMonth = getMonthsBetween(currentYearMonth, yearMonth);

      // For recurring targets (not recurring_rollover), we calculate the EXPECTED balance
      // based on TARGET contributions, NOT actual assignments. This is the key difference:
      // - recurring: Assumes money will be spent at due date, so each month gets its portion
      //   regardless of how much was actually assigned in previous months (over-funding ignored)
      // - recurring_rollover: Uses actual balance because leftover money rolls over
      //
      // By using target amounts instead of actual assignments, over-funding in previous
      // months doesn't reduce future months' targets
      let projectedBalance: bigint;
      if (previousMonthData) {
        // Use previous month's starting balance + previous month's TARGET amount
        // NOT the actual assigned amount - this ignores over-funding
        projectedBalance = previousMonthData.balance + previousMonthData.targetAmount;
      } else {
        // Calculate expected contributions from currentYearMonth to yearMonth
        projectedBalance = monthlyContribution * BigInt(monthsBeforeFutureMonth);
      }

      const effectiveBalance = projectedBalance > 0n ? projectedBalance : 0n;
      const remainingNeeded = target.amount - effectiveBalance;

      if (remainingNeeded <= 0n) {
        return 0n; // Already have enough saved (based on expected contributions)
      }

      const monthsRemainingInInterval = -monthsSinceFirstDue + 1;

      // At the due month (monthsRemainingInInterval === 1), return the actual remaining needed
      // This accounts for expected carryover from previous months
      if (monthsRemainingInInterval === 1) {
        return remainingNeeded;
      }

      // For non-due months in the interval, return consistent monthly contribution
      // so users see predictable amounts across months
      return monthlyContribution;
    }

    // SUBSEQUENT INTERVALS: After the first due date
    // For recurring (not recurring_rollover), we assume money will be spent at due date
    // and each month needs its portion of the next interval
    const nextDueDate = getNextDueDateForRecurring(dueDate, target.frequency, target.frequencyInterval, yearMonth);

    const monthsUntilDue = getMonthsBetween(yearMonth, nextDueDate);
    const isAtDueDate = monthsUntilDue === 0;

    // Calculate interval months
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

    const baseAmount = target.amount / BigInt(monthsInInterval);
    const remainder = target.amount % BigInt(monthsInInterval);

    // Add remainder to the due month
    if (isAtDueDate && remainder > 0n) {
      return baseAmount + remainder;
    }

    return baseAmount;
  }

  // For other target types, always show the clean base target
  return baseTarget;
}

/**
 * Main calculation function for category targets
 * Determines if month is current or future and calculates accordingly
 */
export function calculateTargetForMonth(input: TargetCalculationInput): TargetCalculationResult {
  const {
    target,
    yearMonth,
    currentYearMonth,
    previousMonthCarryover,
    currentBalance,
    assignedAmount,
    totalSpent,
    previousMonthData,
  } = input;

  const isCurrentMonth = yearMonth === currentYearMonth;
  const isFutureMonth = yearMonth > currentYearMonth;

  // Determine which balance to use for target calculation
  let balanceForTargetCalculation: bigint;

  if (target.targetType === 'recurring') {
    // For recurring targets before first due, ALWAYS use previousMonthCarryover
    // for both current and future months to maintain consistent monthly targets
    const dueDate =
      target.firstDueDate || ('startDate' in target ? (target.startDate as string | undefined) : undefined);

    if (dueDate) {
      const firstDueYearMonth = dateToYearMonth(dueDate);
      const baseMonth = currentYearMonth ?? yearMonth;

      // If we're calculating before the first due date, use previousMonthCarryover
      if (baseMonth <= firstDueYearMonth) {
        balanceForTargetCalculation = previousMonthCarryover;
      } else {
        // After first due date, use appropriate balance
        balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
      }
    } else {
      balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
    }
  } else if (target.targetType === 'one_time') {
    // For one_time: use previousMonthCarryover for current month, currentBalance for future months
    balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
  } else if (target.targetType === 'recurring_rollover') {
    // For recurring_rollover: ALWAYS use start-of-month carryover
    // The rollover from previous month counts toward this month's target
    // regardless of whether we're viewing current, past, or future months
    balanceForTargetCalculation = previousMonthCarryover;
  } else {
    // For other target types, use previousMonthCarryover for current month only
    balanceForTargetCalculation = isCurrentMonth ? previousMonthCarryover : currentBalance;
  }

  const baseTarget = calculateBaseTarget(target, yearMonth, balanceForTargetCalculation, currentYearMonth);

  let monthlyAssignment: bigint;

  if (isCurrentMonth) {
    // Current month: use carryover from previous month
    monthlyAssignment = calculateCurrentMonthAssignment(
      target,
      baseTarget,
      previousMonthCarryover,
      currentBalance,
      totalSpent
    );
  } else if (isFutureMonth) {
    // Future month: show clean target, unless maintain_balance with previous data
    monthlyAssignment = calculateFutureMonthAssignment(
      target,
      baseTarget,
      yearMonth,
      currentYearMonth,
      previousMonthData
    );
  } else {
    // Past month: historical data, show base target
    monthlyAssignment = baseTarget;
  }

  // Calculate how much more needs to be assigned to reach the target
  // Ensure assignedAmount is treated as 0n if it's falsy (undefined, null, or 0)
  const safeAssignedAmount = assignedAmount ?? 0n;
  const remainingToAssign = monthlyAssignment > safeAssignedAmount ? monthlyAssignment - safeAssignedAmount : 0n;

  return {
    targetType: target.targetType,
    baseTarget,
    monthlyAssignment,
    remainingToAssign,
    isCurrentMonth,
    isFutureMonth,
  };
}

/**
 * Get current year-month in YYYYMM format from current date
 */
export function getCurrentYearMonth(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 0-indexed to 1-indexed
  return year * 100 + month;
}

/**
 * Convert ISO date string (YYYY-MM-DD) to yearMonth (YYYYMM)
 */
function dateToYearMonth(isoDate: string): number {
  const parts = isoDate.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  return year * 100 + month;
}

/**
 * Calculate the next due date for a recurring target
 * @param firstDueDate - ISO date string (YYYY-MM-DD) of the first due date
 * @param frequency - The frequency type (monthly, yearly, etc.)
 * @param frequencyInterval - How many periods between occurrences
 * @param fromYearMonth - Calculate next due date from this month
 * @returns The yearMonth (YYYYMM) of the next due date
 */
function getNextDueDateForRecurring(
  firstDueDate: string,
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  frequencyInterval: number,
  fromYearMonth: number
): number {
  const firstDueYearMonth = dateToYearMonth(firstDueDate);

  // If we haven't reached the first due date yet, that's the next due date
  if (fromYearMonth < firstDueYearMonth) {
    return firstDueYearMonth;
  }

  // Calculate how many periods have passed since the first due date
  const firstYear = Math.floor(firstDueYearMonth / 100);
  const firstMonth = firstDueYearMonth % 100;
  const fromYear = Math.floor(fromYearMonth / 100);
  const fromMonth = fromYearMonth % 100;

  // Calculate total months from first due date to fromYearMonth
  const monthsSinceFirst = (fromYear - firstYear) * 12 + (fromMonth - firstMonth);

  // For monthly frequency: calculate next due based on interval
  if (frequency === 'monthly') {
    // How many intervals have passed?
    const intervalsPassed = Math.floor(monthsSinceFirst / frequencyInterval);

    // Check if we're exactly at a due date
    if (monthsSinceFirst % frequencyInterval === 0) {
      // We're at a due date - return the current month
      return fromYearMonth;
    }

    // Next due is after the next complete interval
    const monthsToNextDue = (intervalsPassed + 1) * frequencyInterval;

    // Add those months to the first due date
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

  // For other frequencies, treat current month as a due date
  // to avoid returning a past date that could cause division by zero
  return fromYearMonth;
}

/**
 * Calculate months between two yearMonth values (inclusive of from, exclusive of to)
 * @param fromYearMonth - Starting month (YYYYMM)
 * @param toYearMonth - Ending month (YYYYMM)
 * @returns Number of months between them
 */
function getMonthsBetween(fromYearMonth: number, toYearMonth: number): number {
  const fromYear = Math.floor(fromYearMonth / 100);
  const fromMonth = fromYearMonth % 100;
  const toYear = Math.floor(toYearMonth / 100);
  const toMonth = toYearMonth % 100;

  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Earliest due date in or after a budget month. Overdue one-time targets keep their deadline.
 * Calendar-only UTC math makes priority independent of server timezone and daylight saving.
 */
export function targetDueDateForMonth(target: CategoryTarget, yearMonth: number): string | undefined {
  if (target.targetType === 'one_time') return parseTargetDate(target.targetDate)?.toISOString().slice(0, 10);
  if (target.targetType !== 'recurring' && target.targetType !== 'recurring_rollover') return undefined;
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (!Number.isInteger(yearMonth) || year < 100 || year > 9999 || month < 1 || month > 12) return undefined;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const firstDue = parseTargetDate(target.firstDueDate);
  const interval = target.frequencyInterval ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1) return undefined;

  if (target.frequency === 'daily' || target.frequency === 'weekly') {
    let anchor = firstDue ?? start;
    if (target.frequency === 'weekly' && target.dayOfWeek !== undefined) {
      if (!Number.isInteger(target.dayOfWeek) || target.dayOfWeek < 0 || target.dayOfWeek > 6) return undefined;
      // Match the selected weekday, including older targets whose anchor used another day.
      anchor = new Date(anchor);
      anchor.setUTCDate(anchor.getUTCDate() + ((target.dayOfWeek - anchor.getUTCDay() + 7) % 7));
    }
    const period = interval * (target.frequency === 'weekly' ? 7 : 1) * 86_400_000;
    const occurrences = Math.max(0, Math.ceil((start.getTime() - anchor.getTime()) / period));
    const due = new Date(anchor.getTime() + occurrences * period);
    return Number.isFinite(due.getTime()) && due.getUTCFullYear() <= 9999 ? due.toISOString().slice(0, 10) : undefined;
  }

  if (target.frequency !== 'monthly' && target.frequency !== 'yearly') return undefined;
  if (!firstDue && (target.frequency === 'yearly' || target.dueDay === undefined)) return undefined;
  const firstMonth = firstDue ? firstDue.getUTCFullYear() * 12 + firstDue.getUTCMonth() : year * 12 + month - 1;
  const intervalMonths = interval * (target.frequency === 'yearly' ? 12 : 1);
  const periods = Math.max(0, Math.ceil((year * 12 + month - 1 - firstMonth) / intervalMonths));
  const dueMonthIndex = firstMonth + periods * intervalMonths;
  const dueYear = Math.floor(dueMonthIndex / 12);
  const dueMonth = dueMonthIndex % 12;
  if (dueYear > 9999) return undefined;
  const lastDay = new Date(Date.UTC(dueYear, dueMonth + 1, 0)).getUTCDate();
  const day = target.frequency === 'monthly' ? (target.dueDay ?? firstDue?.getUTCDate()) : firstDue?.getUTCDate();
  if (day === undefined || !Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31))) return undefined;
  return new Date(Date.UTC(dueYear, dueMonth, day === -1 ? lastDay : Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function parseTargetDate(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
}
