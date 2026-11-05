/**
 * Unit tests for category target calculations
 * These test the pure calculation functions from convex/categoryTargets/helpers.ts
 * and convex/categoryBudgets/helpers.ts
 */
import { describe, expect, it } from 'vitest';

import { calculateOverfundedByAmount } from '../categoryBudgets/helpers';
import { calculateBaseTarget, calculateTargetForMonth, countDayOfWeekInMonth, targetDueDateForMonth } from './helpers';
import type { ValidCategoryTarget } from './types';

describe('countDayOfWeekInMonth', () => {
  it('should count Sundays in December 2025 (4 Sundays)', () => {
    // December 2025: Sundays are Dec 7, 14, 21, 28
    const count = countDayOfWeekInMonth(202512, 0); // 0 = Sunday
    expect(count).toBe(4);
  });

  it('should count Sundays in January 2026 (4 Sundays)', () => {
    // January 2026: Sundays are Jan 4, 11, 18, 25
    const count = countDayOfWeekInMonth(202601, 0);
    expect(count).toBe(4);
  });

  it('should count Sundays in March 2026 (5 Sundays)', () => {
    // March 2026: Sundays are Mar 1, 8, 15, 22, 29
    const count = countDayOfWeekInMonth(202603, 0);
    expect(count).toBe(5);
  });

  it('should count Mondays in December 2025 (5 Mondays)', () => {
    // December 2025: Mondays are Dec 1, 8, 15, 22, 29
    const count = countDayOfWeekInMonth(202512, 1); // 1 = Monday
    expect(count).toBe(5);
  });

  it('should count Saturdays in February 2026 (4 Saturdays)', () => {
    // February 2026: Saturdays are Feb 7, 14, 21, 28
    const count = countDayOfWeekInMonth(202602, 6); // 6 = Saturday
    expect(count).toBe(4);
  });
});

describe('calculateBaseTarget for weekly recurring_rollover', () => {
  const createWeeklyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 12500n, // $125.00 in cents
    frequency: 'weekly',
    frequencyInterval: 1,
    dayOfWeek: 0, // Sunday
    firstDueDate: '2025-12-01',
    ...overrides,
  });

  it('should calculate total needed for month with 4 occurrences and no carryover', () => {
    const target = createWeeklyTarget();
    // December 2025 has 4 Sundays, so total needed = $125 × 4 = $500
    const result = calculateBaseTarget(target, 202512, 0n);
    expect(result).toBe(50000n); // $500.00
  });

  it('should calculate total needed for month with 5 occurrences', () => {
    const target = createWeeklyTarget();
    // March 2026 has 5 Sundays, so total needed = $125 × 5 = $625
    const result = calculateBaseTarget(target, 202603, 0n);
    expect(result).toBe(62500n); // $625.00
  });

  it('should subtract carryover from total needed', () => {
    const target = createWeeklyTarget();
    // December 2025 has 4 Sundays = $500 needed, with $100 carryover = $400 remaining
    const result = calculateBaseTarget(target, 202512, 10000n); // $100 carryover
    expect(result).toBe(40000n); // $400.00
  });

  it('should return 0 when carryover exceeds total needed', () => {
    const target = createWeeklyTarget();
    // December 2025 has 4 Sundays = $500 needed, with $600 carryover = $0 remaining
    const result = calculateBaseTarget(target, 202512, 60000n); // $600 carryover
    expect(result).toBe(0n);
  });

  it('should return 0 when carryover equals total needed', () => {
    const target = createWeeklyTarget();
    // December 2025 has 4 Sundays = $500 needed, with $500 carryover = $0 remaining
    const result = calculateBaseTarget(target, 202512, 50000n); // $500 carryover
    expect(result).toBe(0n);
  });

  it('should handle different day of week (Monday)', () => {
    const target = createWeeklyTarget({ dayOfWeek: 1 }); // Monday
    // December 2025 has 5 Mondays, so total needed = $125 × 5 = $625
    const result = calculateBaseTarget(target, 202512, 0n);
    expect(result).toBe(62500n); // $625.00
  });
});

describe('calculateTargetForMonth for weekly recurring_rollover', () => {
  const createWeeklyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 12500n, // $125.00 in cents
    frequency: 'weekly',
    frequencyInterval: 1,
    dayOfWeek: 0, // Sunday
    firstDueDate: '2025-12-01',
    ...overrides,
  });

  describe('current month calculations', () => {
    it('should calculate full monthly assignment needed with no carryover', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512,
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      // December 2025 has 4 Sundays = $500 needed
      expect(result.monthlyAssignment).toBe(50000n);
      expect(result.remainingToAssign).toBe(50000n);
      expect(result.isCurrentMonth).toBe(true);
    });

    it('should calculate remaining assignment needed with partial carryover', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512,
        currentYearMonth: 202512,
        previousMonthCarryover: 800n, // $8.00 carryover
        currentBalance: 800n,
        assignedAmount: 0n,
      });

      // December 2025 has 4 Sundays = $500 needed, $8 carryover = $492 remaining
      expect(result.monthlyAssignment).toBe(49200n);
      expect(result.remainingToAssign).toBe(49200n);
    });

    it('should show 0 remaining when fully funded', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512,
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 50000n,
        assignedAmount: 50000n,
      });

      // December 2025 has 4 Sundays = $500 needed, $500 assigned = $0 remaining
      expect(result.monthlyAssignment).toBe(50000n);
      expect(result.remainingToAssign).toBe(0n);
    });

    it('should NOT show overfunded when assigned equals total needed for month', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512,
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 50000n, // $500 available
        assignedAmount: 50000n, // $500 assigned
      });

      // Monthly assignment should be $500 (4 Sundays × $125)
      // remainingToAssign should be $0 (fully funded)
      expect(result.monthlyAssignment).toBe(50000n);
      expect(result.remainingToAssign).toBe(0n);
      // The overfundedByAmount is calculated separately in calculateOverfundedByAmount
      // but the target calculation should NOT indicate overfunding here
    });
  });

  describe('future month calculations', () => {
    it('should calculate full monthly assignment for future month', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January 2026 (future)
        currentYearMonth: 202512, // December 2025 (current)
        previousMonthCarryover: 50000n, // Current month's balance
        currentBalance: 50000n,
        assignedAmount: 0n,
      });

      // January 2026 has 4 Sundays = $500 needed
      // For future months, we assume current month's balance will be spent
      expect(result.monthlyAssignment).toBe(50000n);
      expect(result.remainingToAssign).toBe(50000n);
      expect(result.isFutureMonth).toBe(true);
    });

    it('should calculate different amounts for months with different occurrence counts', () => {
      const target = createWeeklyTarget();

      // January 2026 has 4 Sundays
      const janResult = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      // March 2026 has 5 Sundays
      const marResult = calculateTargetForMonth({
        target,
        yearMonth: 202603,
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      expect(janResult.monthlyAssignment).toBe(50000n); // $500 for 4 Sundays
      expect(marResult.monthlyAssignment).toBe(62500n); // $625 for 5 Sundays
    });
  });
});

describe('calculateBaseTarget for yearly recurring_rollover', () => {
  const createYearlyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 5000n, // $50.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2024-07-31', // First due July 31, 2024
    ...overrides,
  });

  describe('when balance already covers target (bug fix scenario)', () => {
    it('should return 0 when balance exceeds target in middle of interval', () => {
      // User scenario: January 2026 (month 6 of 12 in interval), $193.29 balance, $50 target
      // Previously this incorrectly returned $7.14 ($50 / 7 months remaining)
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202601, 19329n); // $193.29 balance
      expect(result).toBe(0n); // Should be $0, not $7.14
    });

    it('should return 0 when balance equals target exactly', () => {
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202601, 5000n); // $50 balance = $50 target
      expect(result).toBe(0n);
    });

    it('should return 0 when balance exceeds target at start of interval', () => {
      // August 2025 is first month of new interval (after July 2025 due date)
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202508, 16776n); // $167.76 balance
      expect(result).toBe(0n);
    });

    it('should return 0 when balance exceeds target at due date', () => {
      // July 2025 is a due date
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202507, 10000n); // $100 balance, $50 target
      expect(result).toBe(0n);
    });
  });

  describe('when balance is less than target', () => {
    it('should calculate monthly portion when balance is 0', () => {
      // January 2026, 7 months remaining (Jan, Feb, Mar, Apr, May, Jun, Jul)
      // $50 target / 7 months = ~$7.14/month
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202601, 0n);
      expect(result).toBe(714n); // $7.14
    });

    it('should calculate remaining needed minus balance', () => {
      // January 2026, $50 target, $20 balance
      // Remaining = $50 - $20 = $30
      // $30 / 7 months = ~$4.28/month
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202601, 2000n); // $20 balance
      expect(result).toBe(428n); // $4.28
    });

    it('should calculate correctly at start of interval with partial carryover', () => {
      // August 2025 (first month of new interval), $30 balance, $50 target
      // Remaining = $50 - $30 = $20
      // 12 months in interval, $20 / 12 = ~$1.66/month
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202508, 3000n); // $30 balance
      expect(result).toBe(166n); // $1.66
    });
  });

  describe('initial interval (before first due date)', () => {
    it('should calculate monthly portion for initial saving period', () => {
      // June 2024 is 1 month before first due (July 2024)
      // 2 months remaining (Jun, Jul)
      // $50 target / 2 = $25/month
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202406, 0n);
      expect(result).toBe(2500n); // $25
    });

    it('should return 0 when balance covers target in initial interval', () => {
      const target = createYearlyTarget();
      const result = calculateBaseTarget(target, 202406, 6000n); // $60 balance
      expect(result).toBe(0n);
    });
  });
});

describe('calculateTargetForMonth for yearly recurring_rollover', () => {
  const createYearlyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 5000n, // $50.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2024-07-31',
    ...overrides,
  });

  describe('current month with high carryover (bug fix scenario)', () => {
    it('should show 0 remaining when carryover exceeds target', () => {
      // User scenario: January 2026, $193.29 carried over, $50 target
      const target = createYearlyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 19329n, // $193.29
        currentBalance: 19329n,
        assignedAmount: 0n,
      });

      expect(result.baseTarget).toBe(0n);
      expect(result.monthlyAssignment).toBe(0n);
      expect(result.remainingToAssign).toBe(0n);
    });

    it('should show 0 remaining when carryover equals target', () => {
      const target = createYearlyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 5000n, // $50
        currentBalance: 5000n,
        assignedAmount: 0n,
      });

      expect(result.baseTarget).toBe(0n);
      expect(result.remainingToAssign).toBe(0n);
    });
  });

  describe('current month with insufficient carryover', () => {
    it('should calculate monthly portion when carryover is 0', () => {
      const target = createYearlyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      // $50 / 7 months remaining = $7.14
      expect(result.baseTarget).toBe(714n);
      expect(result.remainingToAssign).toBe(714n);
    });

    it('should calculate remaining after partial assignment', () => {
      const target = createYearlyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 0n, // Started month with $0
        currentBalance: 500n, // $5 assigned this month
        assignedAmount: 500n,
      });

      // Base target is calculated from previousMonthCarryover ($0)
      // $50 / 7 months = $7.14
      expect(result.baseTarget).toBe(714n);
      // remainingToAssign = monthlyAssignment - assignedAmount = $7.14 - $5 = $2.14
      expect(result.remainingToAssign).toBe(214n);
    });

    it('should calculate reduced target when starting with partial carryover', () => {
      const target = createYearlyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 2000n, // Started month with $20
        currentBalance: 2000n,
        assignedAmount: 0n,
      });

      // Base target calculated with $20 carryover
      // ($50 - $20) / 7 months = $30 / 7 = $4.28
      expect(result.baseTarget).toBe(428n);
      expect(result.remainingToAssign).toBe(428n);
    });
  });
});

describe('edge cases for weekly recurring_rollover', () => {
  const createWeeklyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 12500n,
    frequency: 'weekly',
    frequencyInterval: 1,
    dayOfWeek: 0,
    firstDueDate: '2025-12-01',
    ...overrides,
  });

  it('should handle bi-weekly frequency', () => {
    // For bi-weekly (every 2 weeks), only count occurrences that align with the schedule
    // Dec 2025 Sundays: 7, 14, 21, 28. With firstDueDate Dec 7 and interval 2: Dec 7, 21 = 2 occurrences
    const target = createWeeklyTarget({ frequencyInterval: 2, firstDueDate: '2025-12-07' });
    const result = calculateBaseTarget(target, 202512, 0n);
    // 2 bi-weekly occurrences × 12500 = 25000
    expect(result).toBe(25000n);
  });

  it('should handle missing dayOfWeek gracefully', () => {
    const target = createWeeklyTarget({ dayOfWeek: undefined });
    // When dayOfWeek is undefined, it should fall back to non-weekly calculation
    const result = calculateBaseTarget(target, 202512, 0n);
    // This should use the fallback logic, not the weekly-specific logic
    expect(result).toBeGreaterThanOrEqual(0n);
  });
});

describe('calculateBaseTarget for yearly recurring (initial interval bug fix)', () => {
  // This test suite specifically tests the bug fix for KUAL-1086
  // where yearly recurring targets in the initial interval (before first due date)
  // were incorrectly dividing by the full 12-month interval instead of months remaining
  const createYearlyRecurringTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring', // NOT recurring_rollover
    amount: 400000n, // $4,000.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2026-02-26', // February 26, 2026
    ...overrides,
  });

  describe('initial interval (before first due date) - bug fix', () => {
    it('should calculate monthly portion based on months until due date, not full interval', () => {
      // User scenario: January 2026, due February 2026, no carryover
      // Should be $4000 / 2 months (Jan + Feb) = $2000, NOT $4000 / 12 = $333.33
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202601, 0n, 202601);
      expect(result).toBe(200000n); // $2,000.00
    });

    it('should calculate correctly when 3 months before due date', () => {
      // December 2025, due February 2026 = 3 months (Dec, Jan, Feb), no carryover
      // $4000 / 3 = $1333.33
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202512, 0n, 202512);
      expect(result).toBe(133333n); // $1,333.33
    });

    it('should calculate correctly when 6 months before due date', () => {
      // September 2025, due February 2026 = 6 months, no carryover
      // $4000 / 6 = $666.66
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202509, 0n, 202509);
      expect(result).toBe(66666n); // $666.66
    });

    it('should consider carryover balance in initial interval', () => {
      // January 2026, due February 2026, $2000 carryover from December
      // Remaining needed: $4000 - $2000 = $2000
      // Months remaining: 2 (Jan + Feb)
      // Monthly target: $2000 / 2 = $1000
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202601, 200000n, 202601); // $2000 carryover
      expect(result).toBe(100000n); // $1,000.00
    });

    it('should return 0 when balance already covers target', () => {
      // January 2026, $4500 balance already covers $4000 target
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202601, 450000n, 202601);
      expect(result).toBe(0n);
    });

    it('should calculate based on viewing month, not current month', () => {
      // Viewing December 2025 from January 2026, no carryover
      // December has 3 months remaining (Dec, Jan, Feb)
      // $4000 / 3 = $1333.33
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202512, 0n, 202601); // viewing Dec from Jan
      expect(result).toBe(133333n); // $1,333.33
    });

    it('should return full amount when due month equals current month', () => {
      // AT the due month AND current month - special case returns full amount
      // This handles the case where user is currently in the due month
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202602, 0n, 202602);
      expect(result).toBe(400000n); // $4,000.00
    });

    it('should calculate remaining when at due month with carryover', () => {
      // Viewing February 2026 (due month), $3000 carryover
      // Remaining: $4000 - $3000 = $1000
      // 1 month remaining (Feb only)
      // Monthly target: $1000 / 1 = $1000
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202602, 300000n, 202601); // viewing Feb from Jan
      expect(result).toBe(100000n); // $1,000.00
    });
  });

  describe('after first due date (subsequent intervals)', () => {
    it('should use full 12-month interval calculation after first due date', () => {
      // March 2026 (after February due date)
      // Should use 12-month interval: $4000 / 12 = $333.33
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202603, 0n, 202603);
      expect(result).toBe(33333n); // $333.33
    });

    it('should use full interval calculation mid-year after due date', () => {
      // August 2026 (6 months after February due date)
      // Still uses 12-month interval: $4000 / 12 = $333.33
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202608, 0n, 202608);
      expect(result).toBe(33333n); // $333.33
    });

    it('should return monthly portion plus remainder at subsequent due dates', () => {
      // February 2027 (next due date after Feb 2026)
      // After first due date, uses full 12-month interval: $4000 / 12 = $333.33
      // At due date, adds remainder: $4000 % 12 = 4 cents
      // So: 33333 + 4 = 33337 cents ($333.37)
      const target = createYearlyRecurringTarget();
      const result = calculateBaseTarget(target, 202702, 0n, 202702);
      expect(result).toBe(33337n); // $333.37 (base + remainder)
    });
  });

  describe('edge cases', () => {
    it('should handle remainder correctly with uneven division', () => {
      // $1000 / 3 months = $333.33 per month
      const target = createYearlyRecurringTarget({
        amount: 100000n, // $1,000.00
        firstDueDate: '2026-03-15', // March 2026
      });
      // January 2026, 3 months until March
      const result = calculateBaseTarget(target, 202601, 0n, 202601);
      expect(result).toBe(33333n); // $333.33
    });

    it('should handle monthly recurring targets (baseline - not affected by fix)', () => {
      // Monthly targets already work correctly because monthsInInterval = 1
      const target: ValidCategoryTarget = {
        categoryId: 'test-category-id',
        targetType: 'recurring',
        amount: 10000n, // $100.00
        frequency: 'monthly',
        frequencyInterval: 1,
        firstDueDate: '2026-02-15',
      };
      const result = calculateBaseTarget(target, 202601, 0n, 202601);
      // Monthly recurring: 2 months until due = $100 / 2 = $50
      expect(result).toBe(5000n); // $50.00
    });

    it('should handle bi-yearly recurring targets', () => {
      // Every 2 years = 24 month interval normally
      // But in initial interval before first due, should divide by months remaining
      const target = createYearlyRecurringTarget({
        amount: 240000n, // $2,400.00
        frequencyInterval: 2, // every 2 years
        firstDueDate: '2026-06-15', // June 2026
      });
      // January 2026, 6 months until June
      // $2400 / 6 = $400/month
      const result = calculateBaseTarget(target, 202601, 0n, 202601);
      expect(result).toBe(40000n); // $400.00
    });
  });
});

describe('calculateBaseTarget for yearly recurring_rollover (initial interval bug fix KUAL-1086)', () => {
  // This test suite specifically tests the bug fix for KUAL-1086
  // where yearly recurring_rollover targets in the initial interval were incorrectly showing $0 underfunded
  // when viewing a past month after assigning in a future month
  const createYearlyRecurringRolloverTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 400000n, // $4,000.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2026-02-26', // February 26, 2026
    ...overrides,
  });

  describe('past months in initial interval - considers carryover (KUAL-1167 fix)', () => {
    // KUAL-1167 fix: For recurring_rollover, the `currentBalance` parameter is actually
    // `previousMonthCarryover` (the carryover at the START of that past month), not the
    // "current balance" that might include future assignments. So we SHOULD consider it.
    // This is the key difference from other target types.

    it('should consider carryover for past month calculation (KUAL-1167)', () => {
      // Scenario: Viewing January from current month February
      // January started with $2000 carryover from December
      // For recurring_rollover, this carryover counts toward the target
      const target = createYearlyRecurringRolloverTarget();
      // currentBalance = previousMonthCarryover = $2000 at start of January
      const result = calculateBaseTarget(target, 202601, 200000n, 202602); // Jan viewed from Feb
      // Remaining: $4000 - $2000 = $2000
      // Months remaining: 2 (Jan, Feb)
      // Monthly: $2000 / 2 = $1000
      expect(result).toBe(100000n); // $1,000.00
    });

    it('should calculate pure monthly portion for December when viewed from January (no carryover)', () => {
      const target = createYearlyRecurringRolloverTarget();
      // December has 3 months remaining (Dec, Jan, Feb), no carryover
      // $4000 / 3 = $1333.33
      const result = calculateBaseTarget(target, 202512, 0n, 202601); // Dec viewed from Jan
      expect(result).toBe(133333n); // $1,333.33
    });

    it('should consider carryover for December when viewed from February (KUAL-1167)', () => {
      const target = createYearlyRecurringRolloverTarget();
      // December viewed from February
      // December started with $2000 carryover (previousMonthCarryover)
      // Remaining: $4000 - $2000 = $2000
      // Months remaining from December: 3 (Dec, Jan, Feb)
      // Monthly: $2000 / 3 = $666.66
      const result = calculateBaseTarget(target, 202512, 200000n, 202602); // Dec viewed from Feb, $2000 carryover
      expect(result).toBe(66666n); // $666.66
    });

    it('should calculate correctly for a month 6 months before due date (no carryover)', () => {
      const target = createYearlyRecurringRolloverTarget();
      // September 2025, 6 months until February 2026 (Sep, Oct, Nov, Dec, Jan, Feb)
      // No carryover, so $4000 / 6 = $666.66
      const result = calculateBaseTarget(target, 202509, 0n, 202601); // Sep viewed from Jan
      expect(result).toBe(66666n); // $666.66
    });
  });

  describe('current month in initial interval - considers balance', () => {
    it('should consider balance for current month calculation', () => {
      const target = createYearlyRecurringRolloverTarget();
      // January is current month, $2000 already saved (from December)
      // Remaining: $4000 - $2000 = $2000
      // Months remaining: 2 (Jan, Feb)
      // Monthly: $2000 / 2 = $1000
      const result = calculateBaseTarget(target, 202601, 200000n, 202601);
      expect(result).toBe(100000n); // $1,000.00
    });

    it('should return 0 when balance covers target in current month', () => {
      const target = createYearlyRecurringRolloverTarget();
      // January is current month, $4500 already saved
      const result = calculateBaseTarget(target, 202601, 450000n, 202601);
      expect(result).toBe(0n);
    });

    it('should calculate full amount when balance is 0', () => {
      const target = createYearlyRecurringRolloverTarget();
      // January is current month, no balance
      // $4000 / 2 months = $2000
      const result = calculateBaseTarget(target, 202601, 0n, 202601);
      expect(result).toBe(200000n); // $2,000.00
    });
  });
});

describe('calculateTargetForMonth for yearly recurring_rollover (initial interval bug fix KUAL-1086)', () => {
  // Tests the full flow including past, current, and future month calculations
  const createYearlyRecurringRolloverTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 400000n, // $4,000.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2026-02-26', // February 26, 2026
    ...overrides,
  });

  describe('Bug fix scenario: January shows $0 after assigning in February', () => {
    it('should show $2000 underfunded in January even when February has $2000 assigned', () => {
      // The core bug: User assigns $2000 in February, goes back to January
      // January should still show $2000 underfunded (not $0)
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (past month)
        currentYearMonth: 202602, // Viewing from February
        previousMonthCarryover: 0n, // January started with $0 (we didn't assign in Dec)
        currentBalance: 0n, // January's balance at start of month
        assignedAmount: 0n, // Nothing assigned in January
      });

      // January has 2 months remaining (Jan, Feb), so $4000 / 2 = $2000
      expect(result.baseTarget).toBe(200000n); // $2,000.00
      expect(result.monthlyAssignment).toBe(200000n);
      expect(result.remainingToAssign).toBe(200000n);
      expect(result.isFutureMonth).toBe(false);
      expect(result.isCurrentMonth).toBe(false);
    });

    it('should show $1333.33 underfunded in December when viewed from January', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512, // December (past month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 0n, // December started with $0
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      // December has 3 months remaining (Dec, Jan, Feb), so $4000 / 3 = $1333.33
      expect(result.baseTarget).toBe(133333n);
      expect(result.monthlyAssignment).toBe(133333n);
      expect(result.remainingToAssign).toBe(133333n);
    });
  });

  describe('Full flow: December -> January -> February carryover', () => {
    it('December should show $1333.33 needed (3 months to save)', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512, // December (current month)
        currentYearMonth: 202512,
        previousMonthCarryover: 0n, // Started with nothing
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      expect(result.baseTarget).toBe(133333n); // $1,333.33
      expect(result.remainingToAssign).toBe(133333n);
    });

    it('January should show $1333.33 needed after December was funded', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current month)
        currentYearMonth: 202601,
        previousMonthCarryover: 133333n, // $1333.33 carried from December
        currentBalance: 133333n, // December's assignment
        assignedAmount: 0n, // Nothing assigned in January yet
      });

      // Remaining: $4000 - $1333.33 = $2666.67
      // Months: 2 (Jan, Feb)
      // Monthly: $2666.67 / 2 = $1333.33 (rounded)
      expect(result.baseTarget).toBe(133333n); // $1,333.33
      expect(result.remainingToAssign).toBe(133333n);
    });

    it('February (due month) should show ~$1333.34 needed after Dec and Jan funded', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future month, due date)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 133333n, // January balance
        currentBalance: 133333n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 133333n, // January's expected assignment
          targetAmount: 133333n,
          balance: 133333n,
        },
      });

      // After Dec ($1333.33) + Jan ($1333.33) = $2666.66 saved
      // Remaining: $4000 - $2666.66 = $1333.34
      expect(result.isFutureMonth).toBe(true);
      // At the due month, we should need the remainder
      expect(result.monthlyAssignment).toBe(133334n); // $1,333.34 (remainder goes to due month)
    });
  });

  describe('Edge cases for recurring_rollover initial interval', () => {
    it('should handle partial assignment in past month', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (past month)
        currentYearMonth: 202602,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 100000n, // User assigned $1000 in January
      });

      // Pure calculation for past month: $4000 / 2 = $2000
      // Remaining to assign: $2000 - $1000 = $1000
      expect(result.baseTarget).toBe(200000n);
      expect(result.monthlyAssignment).toBe(200000n);
      expect(result.remainingToAssign).toBe(100000n); // $1,000 remaining
    });

    it('should show 0 remaining when past month was fully funded', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (past month)
        currentYearMonth: 202602,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 200000n, // User assigned exactly $2000 in January
      });

      expect(result.baseTarget).toBe(200000n);
      expect(result.remainingToAssign).toBe(0n);
    });

    it('should handle over-assignment in past month', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (past month)
        currentYearMonth: 202602,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 250000n, // User assigned $2500 (more than needed)
      });

      expect(result.baseTarget).toBe(200000n);
      expect(result.remainingToAssign).toBe(0n); // Can't be negative
    });
  });
});

describe('calculateTargetForMonth for yearly recurring (over-funding bug fix)', () => {
  // This test suite tests the bug fix where over-funding a recurring target in one month
  // incorrectly showed $0 underfunded in future months
  const createYearlyRecurringTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring', // NOT recurring_rollover
    amount: 400000n, // $4,000.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1,
    firstDueDate: '2026-02-26', // February 26, 2026
    ...overrides,
  });

  describe('Bug fix scenario: Over-funding in current month should not reduce future months', () => {
    it('should show $1333.34 underfunded in February even when January is over-funded', () => {
      // The core bug: User over-funds January with $3000 instead of $1333.33
      // February should still show $1333.34 underfunded (not $0)
      // Because for recurring targets, we use TARGET amounts, not actual assignments
      //
      // Timeline:
      // - December: $1333.33 assigned (normal) - target from 3-month perspective
      // - January: User over-funds with $3000 instead of $1333.33
      // - February (due): Should show $1333.34 needed (based on targets, not actual balance)
      //
      // Key: previousMonthData.targetAmount should be the CORRECT target ($1333.33),
      // not recalculated from January's perspective. The query layer passes this value.
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future month, due date)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 133333n, // January started with December's contribution
        currentBalance: 433333n, // $1333.33 + $3000 over-funding = $4333.33
        assignedAmount: 0n,
        previousMonthData: {
          // January's data - the query layer passes the CORRECT target, not recalculated
          assignedAmount: 300000n, // January was over-funded with $3000
          targetAmount: 133333n, // The CORRECT target based on original 3-month interval
          balance: 133333n, // January STARTED with $1333.33 from December
        },
      });

      // February should use: previousMonthData.balance + previousMonthData.targetAmount
      // = $1333.33 + $1333.33 = $2666.66 projected balance
      // Remaining needed = $4000 - $2666.66 = $1333.34
      // This ignores the over-funding because we use targetAmount, not assignedAmount
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133334n); // $1,333.34 (remainder goes to due month)
    });

    it('should show consistent monthly target when previous month has normal funding', () => {
      // Normal scenario: Viewing January from December (3 months: Dec, Jan, Feb)
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (future month)
        currentYearMonth: 202512, // Viewing from December
        previousMonthCarryover: 0n, // December starts with $0
        currentBalance: 133333n, // December has assigned $1333.33
        assignedAmount: 0n,
        previousMonthData: {
          // December's data (the month before January)
          assignedAmount: 133333n,
          targetAmount: 133333n, // From Dec's perspective (3 months), monthly is $1333.33
          balance: 0n, // December started with $0
        },
      });

      // January should show $1333.33 needed (consistent monthly portion)
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133333n); // $1,333.33
    });

    it('should show correct due month amount after normal funding in previous months', () => {
      // December: $1333.33, January: $1333.33, viewing February (due month)
      // previousMonthData represents January (the month before February)
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (due month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 133333n, // January started with December's contribution
        currentBalance: 133333n, // Currently January has $1333.33
        assignedAmount: 0n,
        previousMonthData: {
          // January's data - targetAmount is the correct target from 3-month interval
          assignedAmount: 133333n, // January's expected/actual assignment
          targetAmount: 133333n, // The CORRECT target based on original 3-month interval
          balance: 133333n, // January started with $1333.33 from December
        },
      });

      // February uses: balance ($1333.33) + targetAmount ($1333.33) = $2666.66 projected
      // Remaining: $4000 - $2666.66 = $1333.34
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133334n); // $1,333.34
    });
  });

  describe('Full flow: December -> January -> February with over-funding', () => {
    it('December should show $1333.33 needed (3 months to save)', () => {
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202512, // December (current month)
        currentYearMonth: 202512,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
      });

      expect(result.baseTarget).toBe(133333n); // $1,333.33
      expect(result.remainingToAssign).toBe(133333n);
      expect(result.isCurrentMonth).toBe(true);
    });

    it('January should show $1333.33 underfunded when viewed from December with normal funding', () => {
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (future month)
        currentYearMonth: 202512, // Viewing from December
        previousMonthCarryover: 0n,
        currentBalance: 133333n, // December assigned normally
        assignedAmount: 0n,
        previousMonthData: {
          // December's data
          assignedAmount: 133333n,
          targetAmount: 133333n, // Target from 3-month interval
          balance: 0n, // December STARTED with $0
        },
      });

      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133333n); // $1,333.33
    });

    it('February should show $1333.34 even when January is over-funded with $3000', () => {
      // This is the KEY BUG FIX TEST
      // User over-funds January: assigns $3000 instead of $1333.33
      // February should NOT show $0 - it should still show $1333.34 needed
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future month, due date)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 133333n, // December's funding (January's starting balance)
        currentBalance: 433333n, // December ($1333.33) + January over-fund ($3000) = $4333.33
        assignedAmount: 0n,
        previousMonthData: {
          // January's data
          assignedAmount: 300000n, // January was over-funded with $3000
          targetAmount: 133333n, // The CORRECT target (not recalculated, from original interval)
          balance: 133333n, // January STARTED with $1333.33 from December
        },
      });

      // February should use target-based projection:
      // projectedBalance = previousMonthData.balance + previousMonthData.targetAmount
      //                  = $1333.33 + $1333.33 = $2666.66
      // remainingNeeded = $4000 - $2666.66 = $1333.34
      // This ignores the $3000 over-funding because we use targetAmount, not assignedAmount
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133334n); // $1,333.34
    });
  });

  describe('Edge cases for recurring over-funding', () => {
    it('should handle extreme over-funding (assigning full target amount in first month)', () => {
      // User assigns entire $4000 in December instead of $1333.33
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (future month)
        currentYearMonth: 202512, // Viewing from December
        previousMonthCarryover: 0n,
        currentBalance: 400000n, // Full $4000 assigned in December
        assignedAmount: 0n,
        previousMonthData: {
          // December's data
          assignedAmount: 400000n, // Full amount assigned (extreme over-funding)
          targetAmount: 133333n, // The CORRECT target from 3-month interval
          balance: 0n, // December STARTED with $0
        },
      });

      // January should use: balance ($0) + targetAmount ($1333.33) = $1333.33 projected
      // This is the expected balance after December contributes its TARGET (not actual)
      // January still needs its portion: $1333.33
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133333n); // $1,333.33
    });

    it('should handle multiple months ahead with over-funding in between', () => {
      // Viewing February from December (no previousMonthData - 2 months ahead)
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (2 months ahead, due date)
        currentYearMonth: 202512, // December
        previousMonthCarryover: 0n,
        currentBalance: 133333n, // December has assigned normally
        assignedAmount: 0n,
        // No previousMonthData - we're looking 2 months ahead
      });

      // Without previousMonthData, uses projection based on monthly contribution:
      // monthlyContribution = $4000 / 3 = $1333.33
      // monthsBeforeFutureMonth = 2 (Dec, Jan before Feb)
      // projectedBalance = $1333.33 * 2 = $2666.66
      // remainingNeeded = $4000 - $2666.66 = $1333.34
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(133334n); // $1,333.34
    });

    it('should work correctly after first due date (subsequent intervals)', () => {
      // March 2026 is after the February due date
      const target = createYearlyRecurringTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202603, // March (after first due date)
        currentYearMonth: 202602, // February
        previousMonthCarryover: 0n,
        currentBalance: 400000n, // Full target available
        assignedAmount: 0n,
      });

      // After first due date, uses 12-month interval: $4000 / 12 = $333.33
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(33333n); // $333.33
    });
  });
});

describe('calculateOverfundedByAmount', () => {
  describe('recurring_rollover target type', () => {
    describe('current month - saving up before due date (assignmentNeeded < targetAmount)', () => {
      it('should detect overfunding when assigned exceeds monthly portion needed', () => {
        // Scenario: Yearly target $400, first due April 2026, current month December 2025
        // User needs to save $80/month ($400 / 5 months = Dec, Jan, Feb, Mar, Apr)
        // User assigned $81 when only $80 is needed this month
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          40000n, // $400 target (yearly)
          8100n, // $81 assigned
          8000n, // $80 assignment needed (monthly portion)
          8100n, // $81 available
          false // current month
        );
        expect(result).toBe(100n); // $1 overfunded
      });

      it('should return 0 when assigned equals monthly portion needed', () => {
        // User assigned exactly $80 when $80 is needed
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          40000n, // $400 target
          8000n, // $80 assigned
          8000n, // $80 assignment needed
          8000n, // $80 available
          false
        );
        expect(result).toBe(0n);
      });

      it('should return 0 when assigned is less than monthly portion needed', () => {
        // User assigned $60 when $80 is needed
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          40000n, // $400 target
          6000n, // $60 assigned
          8000n, // $80 assignment needed
          6000n, // $60 available
          false
        );
        expect(result).toBe(0n);
      });

      it('should detect overfunding for a 12-month savings period', () => {
        // Scenario: $1200 yearly target, 12 months to save, need $100/month
        // User assigned $150 when only $100 is needed
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          120000n, // $1200 target
          15000n, // $150 assigned
          10000n, // $100 assignment needed
          15000n, // $150 available
          false
        );
        expect(result).toBe(5000n); // $50 overfunded
      });
    });

    describe('current month - at due date (assignmentNeeded >= targetAmount)', () => {
      it('should return overfunded amount when available exceeds target (no isFutureMonth flag)', () => {
        // Scenario: Target $125, available $150 (assigned $125 + carryover $25)
        // Available exceeds target, so overfunded by $25
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned
          12500n, // $125 assignment needed
          15000n // $150 available (includes carryover)
        );
        expect(result).toBe(2500n); // $25 overfunded
      });

      it('should return overfunded amount when available exceeds target (isFutureMonth = false)', () => {
        // Scenario: Target $125, available $150 (assigned $125 + carryover $25)
        // Current month should check available vs target
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned
          12500n, // $125 assignment needed
          15000n, // $150 available
          false // current month
        );
        expect(result).toBe(2500n); // $25 overfunded
      });

      it('should return 0 when available equals target', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned
          12500n, // $125 assignment needed
          12500n, // $125 available (exactly target)
          false
        );
        expect(result).toBe(0n);
      });

      it('should return 0 when available is less than target', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          10000n, // $100 assigned
          12500n, // $125 assignment needed
          10000n, // $100 available
          false
        );
        expect(result).toBe(0n);
      });

      it('should detect overfunding from carryover even with no assignment', () => {
        // Scenario: Target $125, carryover $150, no assignment
        // Available ($150) exceeds target ($125) due to carryover alone
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          0n, // $0 assigned
          0n, // $0 assignment needed (carryover covers it)
          15000n, // $150 available (all from carryover)
          false
        );
        expect(result).toBe(2500n); // $25 overfunded
      });
    });

    describe('current month - spending affects available but not overfunding from assignment', () => {
      it('should detect overfunding when assigned exceeds needed, even after spending reduces available', () => {
        // BUG FIX SCENARIO (KUAL-XXX):
        // Netflix category: $28.35 "Fill up to" target
        // User assigns $28.35, then spends $28.35, then assigns another $28.35
        // available = $56.70 assigned + (-$28.35 spent) = $28.35
        // But assigned ($56.70) exceeds assignmentNeeded ($28.35) by $28.35
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          2835n, // $28.35 target
          5670n, // $56.70 assigned (double the target)
          2835n, // $28.35 assignment needed
          2835n, // $28.35 available (assigned - spent = $56.70 - $28.35)
          false
        );
        expect(result).toBe(2835n); // $28.35 overfunded (from over-assignment)
      });

      it('should detect overfunding from assignment even when available equals target after spending', () => {
        // Same scenario: assigned more than needed, but spending brought available back to target
        // This tests that we check BOTH available vs target AND assigned vs assignmentNeeded
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          15000n, // $150 assigned (more than needed)
          12500n, // $125 assignment needed
          12500n, // $125 available (spending reduced it to exactly target)
          false
        );
        expect(result).toBe(2500n); // $25 overfunded (from over-assignment)
      });

      it('should return larger overfunding when carryover overfunding exceeds assignment overfunding', () => {
        // Scenario: Both carryover AND over-assignment cause overfunding
        // Carryover causes available to exceed target by more than the over-assignment
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          13000n, // $130 assigned ($5 over assignment needed)
          12500n, // $125 assignment needed
          17500n, // $175 available ($50 over target due to carryover)
          false
        );
        expect(result).toBe(5000n); // $50 overfunded (from carryover, which is larger)
      });

      it('should return larger overfunding when assignment overfunding exceeds carryover overfunding', () => {
        // Scenario: Both carryover AND over-assignment cause overfunding
        // Over-assignment is larger than carryover overfunding
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          20000n, // $200 assigned ($75 over assignment needed)
          12500n, // $125 assignment needed
          15000n, // $150 available ($25 over target)
          false
        );
        expect(result).toBe(7500n); // $75 overfunded (from over-assignment, which is larger)
      });

      it('should return 0 when neither available nor assignment exceeds their thresholds', () => {
        // Scenario: Some spending occurred, available is below target, assignment is at needed
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned (exactly needed)
          12500n, // $125 assignment needed
          5000n, // $50 available (spending reduced it)
          false
        );
        expect(result).toBe(0n); // Not overfunded
      });

      it('should return 0 when available is negative (overspent category)', () => {
        // Scenario: User overspent the category, available is negative
        // Even if they assigned more than needed, available <= 0 means not overfunded
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          15000n, // $150 assigned
          12500n, // $125 assignment needed
          -5000n, // -$50 available (overspent)
          false
        );
        expect(result).toBe(0n); // Can't be overfunded with negative available
      });
    });

    describe('future month calculations', () => {
      it('should NOT flag as overfunded when available exceeds target due to carryover', () => {
        // This is the main bug fix scenario:
        // User funds future month with $125, carryover from current month is $125
        // Available = $250, but this should NOT be flagged as overfunded
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned (exactly what's needed)
          12500n, // $125 assignment needed
          25000n, // $250 available (assigned + carryover)
          true // future month - carryover should be ignored
        );
        expect(result).toBe(0n); // NOT overfunded
      });

      it('should return 0 when assigned equals assignment needed', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned
          12500n, // $125 assignment needed
          12500n, // $125 available
          true
        );
        expect(result).toBe(0n);
      });

      it('should return overfunded amount when assigned exceeds assignment needed', () => {
        // User assigns $150 when only $125 is needed
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          15000n, // $150 assigned (more than needed)
          12500n, // $125 assignment needed
          15000n, // $150 available
          true
        );
        expect(result).toBe(2500n); // $25 overfunded
      });

      it('should return 0 when assigned is less than assignment needed', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          10000n, // $100 assigned
          12500n, // $125 assignment needed
          10000n, // $100 available
          true
        );
        expect(result).toBe(0n);
      });

      it('should handle large carryover without flagging overfunding', () => {
        // Even with $1000 carryover, if we only assign exactly what's needed,
        // it should NOT be flagged as overfunded for future months
        const result = calculateOverfundedByAmount(
          { targetType: 'recurring_rollover' },
          12500n, // $125 target
          12500n, // $125 assigned
          12500n, // $125 assignment needed
          112500n, // $1,125 available (huge carryover)
          true
        );
        expect(result).toBe(0n); // NOT overfunded
      });
    });
  });

  describe('other target types', () => {
    it('should check assigned vs assignment needed for maintain_balance', () => {
      const result = calculateOverfundedByAmount(
        { targetType: 'maintain_balance' },
        5000n, // $50 target
        6000n, // $60 assigned
        5000n, // $50 assignment needed
        6000n, // $60 available
        false
      );
      expect(result).toBe(1000n); // $10 overfunded
    });

    it('should check assigned vs assignment needed for recurring', () => {
      const result = calculateOverfundedByAmount(
        { targetType: 'recurring' },
        10000n, // $100 target
        12000n, // $120 assigned
        10000n, // $100 assignment needed
        12000n, // $120 available
        false
      );
      expect(result).toBe(2000n); // $20 overfunded
    });

    it('should cap recurring overfunding to available amount', () => {
      // Scenario: Assigned exceeds target by $34.85, but only $20 is available after spending
      const result = calculateOverfundedByAmount(
        { targetType: 'recurring' },
        12500n, // $125 target
        15985n, // $159.85 assigned
        12500n, // $125 assignment needed
        2000n, // $20 available
        false
      );
      expect(result).toBe(2000n); // Cap to reducible amount
    });

    it('should return 0 when no target type', () => {
      const result = calculateOverfundedByAmount(
        {}, // no targetType
        10000n,
        10000n,
        10000n,
        15000n,
        false
      );
      expect(result).toBe(0n);
    });

    it('should return 0 when target amount is undefined', () => {
      const result = calculateOverfundedByAmount(
        { targetType: 'recurring_rollover' },
        undefined, // no target amount
        10000n,
        10000n,
        15000n,
        false
      );
      expect(result).toBe(0n);
    });
  });

  describe('maintain_balance target type', () => {
    describe('current month calculations', () => {
      it('should detect overfunding when effective balance exceeds target', () => {
        // Scenario: Target $10k balance, user has $14k (overfunded by $4k)
        // assignedAmount = $0 this month (balance carried over from previous months)
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          0n, // $0 assigned THIS MONTH (balance carried over)
          0n, // $0 assignment needed (already at target)
          1400000n, // $14,000 available
          false, // current month
          0n // no spending
        );
        expect(result).toBe(400000n); // $4,000 overfunded
      });

      it('should detect overfunding using effective balance (available + spending)', () => {
        // Scenario: Target $10k, had $14k, spent $1k (now $13k available)
        // Effective balance = $13k + $1k = $14k, still $4k over
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          0n, // $0 assigned THIS MONTH
          0n, // $0 assignment needed
          1300000n, // $13,000 available (after spending)
          false, // current month
          -100000n // -$1,000 spent (negative = outflow)
        );
        expect(result).toBe(400000n); // $4,000 overfunded (using effective balance)
      });

      it('should return 0 when effective balance equals target', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          0n, // $0 assigned THIS MONTH
          0n, // $0 assignment needed
          1000000n, // $10,000 available
          false,
          0n
        );
        expect(result).toBe(0n);
      });

      it('should return 0 when effective balance is below target', () => {
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          0n, // $0 assigned THIS MONTH
          50000n, // $500 assignment needed
          800000n, // $8,000 available
          false,
          0n
        );
        expect(result).toBe(0n);
      });
    });

    describe('future month calculations (KUAL-1133 bug fix)', () => {
      it('should return 0 for future months even when current month is overfunded', () => {
        // BUG FIX: Overfunding in January should NOT show as overfunded in February
        // When viewing February during January, assume overfunding will be corrected
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          1400000n, // $14,000 assigned (overfunded by $4k)
          0n, // $0 assignment needed
          1400000n, // $14,000 available
          true, // FUTURE month
          0n
        );
        expect(result).toBe(0n); // Should be $0, NOT $4,000
      });

      it('should return 0 for future months regardless of current balance', () => {
        // Even with extreme overfunding ($20k vs $10k target), future months show 0
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          2000000n, // $20,000 assigned
          0n, // $0 assignment needed
          2000000n, // $20,000 available
          true, // FUTURE month
          0n
        );
        expect(result).toBe(0n);
      });

      it('should return 0 for future months even with high spending in current month', () => {
        // Scenario: Had $14k, spent $5k (available $9k), but future month should ignore this
        const result = calculateOverfundedByAmount(
          { targetType: 'maintain_balance' },
          1000000n, // $10,000 target balance
          1400000n, // $14,000 assigned
          0n, // $0 assignment needed
          900000n, // $9,000 available (after spending)
          true, // FUTURE month
          -500000n // -$5,000 spent
        );
        expect(result).toBe(0n);
      });
    });
  });
});

describe('calculateTargetForMonth for maintain_balance (KUAL-1133 bug fix)', () => {
  const createMaintainBalanceTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'maintain_balance',
    targetBalance: 1000000n, // $10,000 target balance
    amount: 1000000n, // Same as targetBalance
    monthlyContribution: 50000n, // $500 monthly contribution
    ...overrides,
  });

  describe('current month - spending should not affect underfunding display', () => {
    it('should show $0 underfunded when at target balance with no spending', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 1000000n, // $10,000 carryover (at target)
        currentBalance: 1000000n, // $10,000 available
        assignedAmount: 1000000n,
        totalSpent: 0n,
      });

      expect(result.monthlyAssignment).toBe(0n); // Already at target
      expect(result.remainingToAssign).toBe(0n);
      expect(result.isCurrentMonth).toBe(true);
    });

    it('should show $0 underfunded when at target balance after spending', () => {
      // Key scenario: User at $10k, spends $2k, effective balance is still $10k
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 1000000n, // $10,000 carryover
        currentBalance: 800000n, // $8,000 available (after $2k spending)
        assignedAmount: 1000000n,
        totalSpent: -200000n, // -$2,000 spent
      });

      // Effective balance = $8k + $2k = $10k = target, so $0 needed
      expect(result.monthlyAssignment).toBe(0n);
      expect(result.remainingToAssign).toBe(0n);
    });

    it('should show monthly contribution needed when below target', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 800000n, // $8,000 carryover (below target)
        currentBalance: 800000n, // $8,000 available
        assignedAmount: 0n, // $0 assigned THIS MONTH (hasn't assigned yet)
        totalSpent: 0n,
      });

      // Below target by $2k, but monthly contribution is $500
      expect(result.monthlyAssignment).toBe(50000n); // $500 monthly contribution
      expect(result.remainingToAssign).toBe(50000n);
    });

    it('should cap monthly contribution at the remaining gap to target', () => {
      // User scenario: $10k target, $500/mo, only $96.86 below target.
      // Should ask for $96.86 (the gap), not the full $500 contribution.
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 990314n, // $9,903.14 carryover
        currentBalance: 990314n, // $9,903.14 available
        assignedAmount: 0n,
        totalSpent: 0n,
      });

      // Gap to target is $96.86, less than the $500 contribution
      expect(result.monthlyAssignment).toBe(9686n); // $96.86, not $500
      expect(result.remainingToAssign).toBe(9686n);
    });

    it('should NOT report overfunding after assigning exactly the gap to reach target', () => {
      // Reported bug: user assigns the $96.86 the app asks for, reaching exactly $10k.
      // available = $9,903.14 + $96.86 = $10,000.00; the balance now meets target so
      // assignmentNeeded recomputes to $0. Must NOT show overfunded by $96.86.
      const result = calculateOverfundedByAmount(
        { targetType: 'maintain_balance' },
        1000000n, // $10,000 target balance
        9686n, // $96.86 assigned this month
        0n, // $0 assignment needed (balance now at target)
        1000000n, // $10,000.00 available (exactly target)
        false, // current month
        0n // no spending
      );
      expect(result).toBe(0n); // exactly at target → not overfunded
    });

    it('should report only the amount above target when over-assigning near target', () => {
      // User over-assigns the full $500 instead of the $96.86 gap.
      // available = $9,903.14 + $500 = $10,403.14; balance recomputes needed to $0.
      // Overfunded is the $403.14 above target, NOT the full $500 assigned.
      const result = calculateOverfundedByAmount(
        { targetType: 'maintain_balance' },
        1000000n, // $10,000 target balance
        50000n, // $500 assigned this month
        0n, // $0 assignment needed (balance now over target)
        1040314n, // $10,403.14 available
        false, // current month
        0n // no spending
      );
      expect(result).toBe(40314n); // $403.14 over target
    });
  });

  describe('future month projections - spending should NOT propagate', () => {
    it('should show $0 underfunded in February when January is at target with spending', () => {
      // BUG FIX: Spending $2k in January should NOT show February as underfunded by $2k
      // When viewing February during January, assume user maintains target balance
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 1000000n, // January started at $10k
        currentBalance: 800000n, // January has $8k available (spent $2k)
        assignedAmount: 0n,
        totalSpent: -200000n, // -$2,000 spent in January
        previousMonthData: {
          // January's data (the month before February)
          assignedAmount: 0n, // No additional assignment this month
          targetAmount: 0n, // January is at target, no assignment needed
          balance: 1000000n, // January's EFFECTIVE balance (capped at target)
        },
      });

      // February should project from target balance, not actual $8k
      // projected = $10k (balance) + $0 (target) = $10k >= $10k target
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(0n); // $0 needed
      expect(result.remainingToAssign).toBe(0n);
    });

    it('should show monthly contribution in February when January was underfunded', () => {
      // January has $8k (underfunded by $2k), February should show $500 needed (capped)
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 800000n, // January started at $8k
        currentBalance: 800000n, // January has $8k
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 50000n, // January needs $500
          balance: 800000n, // January's starting balance
        },
      });

      // February projected = $8k + $500 = $8.5k, still below $10k
      // shortfall = $10k - $8.5k = $1.5k, but capped at monthly contribution ($500)
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(50000n); // $500 (capped at monthly contribution)
    });

    it('should show $0 needed when projected balance will reach target', () => {
      // January has $9.5k, needs $500 to reach $10k target
      // February: projected = $9.5k + $500 = $10k >= target
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601,
        previousMonthCarryover: 950000n, // $9,500
        currentBalance: 950000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 50000n, // January needs $500
          balance: 950000n,
        },
      });

      // projected = $9.5k + $500 = $10k = target, so $0 needed
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(0n);
    });
  });

  describe('future month projections - overfunding should NOT propagate', () => {
    it('should show $0 underfunded in February when January is overfunded', () => {
      // BUG FIX: $4k overfunding in January should NOT show in February
      // When viewing February during January, assume overfunding will be corrected
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 1400000n, // $14k (overfunded by $4k)
        currentBalance: 1400000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 0n, // No assignment needed (overfunded)
          balance: 1000000n, // Balance CAPPED at target for projection
        },
      });

      // February projects from CAPPED balance ($10k), not actual ($14k)
      // projected = $10k + $0 = $10k >= target
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(0n);
    });

    it('should not show overfunding amount in future months', () => {
      // Verify the overfundedByAmount calculation separately
      const result = calculateOverfundedByAmount(
        { targetType: 'maintain_balance' },
        1000000n, // $10k target
        1400000n, // $14k assigned (overfunded)
        0n,
        1400000n,
        true, // FUTURE month
        0n
      );
      expect(result).toBe(0n); // Future months don't show overfunding
    });
  });

  describe('chained future month projections', () => {
    it('should correctly chain projections across multiple future months', () => {
      // January: $5k balance, needs $500/month to reach $10k
      // February (future): projected $5k + $500 = $5.5k, needs $500
      // March (future): projected $5.5k + $500 = $6k, needs $500
      const target = createMaintainBalanceTarget();

      // February projection
      const febResult = calculateTargetForMonth({
        target,
        yearMonth: 202602,
        currentYearMonth: 202601,
        previousMonthCarryover: 500000n, // $5k
        currentBalance: 500000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 50000n,
          balance: 500000n,
        },
      });

      expect(febResult.monthlyAssignment).toBe(50000n); // $500 capped

      // March projection (using February's projected state)
      const marResult = calculateTargetForMonth({
        target,
        yearMonth: 202603,
        currentYearMonth: 202601,
        previousMonthCarryover: 500000n,
        currentBalance: 500000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 50000n, // February's target
          balance: 550000n, // February's projected starting balance (5k + 500)
        },
      });

      // March: projected = $5.5k + $500 = $6k, shortfall = $4k, capped at $500
      expect(marResult.monthlyAssignment).toBe(50000n); // $500 capped
    });
  });
});

describe('calculateTargetForMonth for maintain_balance with partial assignments (KUAL-1172 bug fix)', () => {
  // This test suite validates the bug fix where underfunded amount wasn't updating
  // after partial assignments in the current month
  // Scenario: $10k target, $500/mo contribution, $9k carryover
  // Bug: After assigning $500, still showed $500 underfunded (should be $0)
  const createMaintainBalanceTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'maintain_balance',
    targetBalance: 1000000n, // $10,000 target balance
    amount: 1000000n,
    monthlyContribution: 50000n, // $500 monthly contribution
    ...overrides,
  });

  describe('current month - partial assignments should reduce underfunded amount', () => {
    it('should show $500 underfunded with $9k carryover and $0 assigned', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 900000n, // $9,000 carryover (below target by $1k)
        currentBalance: 900000n, // $9,000 available
        assignedAmount: 0n, // Nothing assigned yet
        totalSpent: 0n,
      });

      // Below target by $1k, but capped at monthly contribution of $500
      expect(result.monthlyAssignment).toBe(50000n); // $500 needed
      expect(result.remainingToAssign).toBe(50000n); // $500 remaining
    });

    it('should show $250 underfunded after assigning $250 (KUAL-1172 fix)', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 900000n, // $9,000 carryover
        currentBalance: 925000n, // $9,250 available (after $250 assigned)
        assignedAmount: 25000n, // $250 assigned THIS MONTH
        totalSpent: 0n,
      });

      // $500 monthly contribution - $250 assigned = $250 remaining
      expect(result.monthlyAssignment).toBe(50000n); // $500 total needed for month
      expect(result.remainingToAssign).toBe(25000n); // Only $250 remaining (KEY FIX)
    });

    it('should show $0 underfunded after assigning full $500 contribution (KUAL-1172 fix)', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 900000n, // $9,000 carryover
        currentBalance: 950000n, // $9,500 available (after $500 assigned)
        assignedAmount: 50000n, // $500 assigned THIS MONTH (full contribution)
        totalSpent: 0n,
      });

      // Contribution cap fully met
      expect(result.monthlyAssignment).toBe(50000n); // $500 needed for month
      expect(result.remainingToAssign).toBe(0n); // $0 remaining (FULLY FUNDED)
    });

    it('should still show $0 underfunded when over-assigning past contribution cap', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 900000n, // $9,000 carryover
        currentBalance: 975000n, // $9,750 available (after $750 assigned)
        assignedAmount: 75000n, // $750 assigned (overfunded by $250)
        totalSpent: 0n,
      });

      // Even when over-assigning, remainingToAssign should be 0
      expect(result.remainingToAssign).toBe(0n);
    });
  });

  describe('current month with spending - assignments should still reduce underfunded', () => {
    it('should show $250 remaining after $250 assigned, even with spending', () => {
      // Scenario: $9k carryover, spent $500, assigned $250
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 900000n, // $9,000 carryover
        currentBalance: 875000n, // $8,750 available (9k - 500 spent + 250 assigned)
        assignedAmount: 25000n, // $250 assigned
        totalSpent: -50000n, // -$500 spent
      });

      // Effective balance: $8,750 + $500 (abs spending) = $9,250
      // Monthly contribution $500 - $250 assigned = $250 remaining
      expect(result.remainingToAssign).toBe(25000n); // $250 remaining
    });
  });

  describe('future month projections with assignments', () => {
    it('should correctly project February needs based on January assignments', () => {
      const target = createMaintainBalanceTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 900000n, // $9,000 carryover
        currentBalance: 950000n, // January assigned $500
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: {
          assignedAmount: 50000n, // January assigned $500
          targetAmount: 50000n, // January's target was $500
          balance: 900000n, // January started at $9k
        },
      });

      // January: started $9k, assigned $500 → ends at $9.5k
      // February: projects from $9.5k, needs $500 to make progress
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(50000n); // $500 needed in Feb
    });
  });
});

describe('maintain_balance future month projection chaining (KUAL-1292 bug fix)', () => {
  // This test suite validates the fix for double-counting in future month projections.
  //
  // BUG: When the current month is fully assigned, future months showed $0 underfunded
  // because previousMonthTargetData stored the FULL assignmentNeeded as targetAmount,
  // but balance already included the assignment. Future months computed:
  //   projected = balance + targetAmount = (carryover + assigned) + fullTarget
  // which double-counted the assignment.
  //
  // FIX: For the current month, store remainingToAssign (not assignmentNeeded) as targetAmount.
  // For future months, keep using assignmentNeeded so pre-assignments aren't lost.
  //
  // These tests simulate the chaining logic from queries.ts by computing
  // previousMonthData the same way the query does, then passing it to calculateTargetForMonth.

  const createMaintainBalanceTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'maintain_balance',
    targetBalance: 1000000n, // $10,000 target balance
    amount: 1000000n,
    monthlyContribution: 50000n, // $500 monthly contribution
    ...overrides,
  });

  /**
   * Simulates how queries.ts builds previousMonthTargetData for the current month.
   * For maintain_balance: balance = min(effectiveBalance, targetBalance),
   * targetAmount = remainingToAssign (after KUAL-1292 fix).
   *
   * Note: calculateCurrentMonthAssignment returns monthlyContribution directly
   * when effective balance is below target (not min(shortfall, contribution)).
   */
  function buildCurrentMonthData(
    carryover: bigint,
    assignedAmount: bigint,
    spent: bigint,
    targetBalance: bigint,
    monthlyContribution: bigint
  ) {
    const spentAbs = spent < 0n ? spent * -1n : 0n;
    const available = carryover + assignedAmount + spent;
    const effectiveBalance = available + spentAbs; // = carryover + assignedAmount
    const balance = effectiveBalance > targetBalance ? targetBalance : effectiveBalance;

    // Matches calculateCurrentMonthAssignment for maintain_balance:
    // returns 0 if at/above target, monthlyContribution otherwise
    const monthlyAssignment = effectiveBalance >= targetBalance ? 0n : monthlyContribution;
    const remainingToAssign = (() => {
      const remaining = monthlyAssignment - assignedAmount;
      return remaining > 0n ? remaining : 0n;
    })();

    return {
      assignedAmount,
      targetAmount: remainingToAssign, // KUAL-1292 fix: use remaining, not full amount
      balance,
    };
  }

  /**
   * Simulates how queries.ts builds previousMonthTargetData for a future month.
   * balance = min(prevBalance + prevTargetAmount, targetBalance),
   * targetAmount = assignmentNeeded (full amount for future months).
   */
  function buildFutureMonthData(
    prevData: { balance: bigint; targetAmount: bigint },
    targetBalance: bigint,
    monthlyContribution: bigint,
    preAssignedAmount = 0n
  ) {
    const projectedBalance = prevData.balance + prevData.targetAmount;
    const balance = projectedBalance > targetBalance ? targetBalance : projectedBalance;

    // For future months, use full assignmentNeeded (not remainingToAssign)
    const monthlyAssignment = (() => {
      if (projectedBalance >= targetBalance) return 0n;
      const shortfall = targetBalance - projectedBalance;
      return shortfall < monthlyContribution ? shortfall : monthlyContribution;
    })();

    return {
      assignedAmount: preAssignedAmount,
      targetAmount: monthlyAssignment, // Future months use full assignmentNeeded
      balance,
    };
  }

  describe('current month fully assigned → future months should show correct underfunding', () => {
    it('should show $46.70 underfunded in April when March is fully assigned (original bug scenario)', () => {
      // User scenario from KUAL-1292:
      // $10k target, $500/month, March has $9,453.30 carryover, assigns $500
      const target = createMaintainBalanceTarget();

      // Build March's data (current month, fully assigned)
      const marchData = buildCurrentMonthData(
        945330n, // $9,453.30 carryover
        50000n, // $500 assigned (fully funded)
        0n, // No spending
        1000000n, // $10k target
        50000n // $500 monthly
      );

      // March: effectiveBalance = $9,953.30, remainingToAssign = $0
      expect(marchData.balance).toBe(995330n); // $9,953.30
      expect(marchData.targetAmount).toBe(0n); // $0 remaining

      // April projects from March's data
      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604, // April (future)
        currentYearMonth: 202603, // Viewing from March
        previousMonthCarryover: 945330n,
        currentBalance: 995330n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: marchData,
      });

      // April: projected = $9,953.30 + $0 = $9,953.30
      // shortfall = $10,000 - $9,953.30 = $46.70
      expect(aprilResult.isFutureMonth).toBe(true);
      expect(aprilResult.monthlyAssignment).toBe(4670n); // $46.70 (NOT $0!)
      expect(aprilResult.remainingToAssign).toBe(4670n);
    });

    it('should show $500 underfunded in April when March has $5k and fully assigns $500', () => {
      const target = createMaintainBalanceTarget();

      const marchData = buildCurrentMonthData(
        500000n, // $5,000 carryover
        50000n, // $500 assigned
        0n,
        1000000n,
        50000n
      );

      // March: effectiveBalance = $5,500, remaining = $0
      expect(marchData.balance).toBe(550000n);
      expect(marchData.targetAmount).toBe(0n);

      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604,
        currentYearMonth: 202603,
        previousMonthCarryover: 500000n,
        currentBalance: 550000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: marchData,
      });

      // projected = $5,500 + $0 = $5,500, shortfall = $4,500, capped at $500
      expect(aprilResult.monthlyAssignment).toBe(50000n); // $500
    });

    it('should chain correctly across multiple future months after full assignment', () => {
      const target = createMaintainBalanceTarget();
      const targetBalance = 1000000n;
      const monthlyContribution = 50000n;

      // March (current): $9,453.30 carryover, fully assigns $500
      const marchData = buildCurrentMonthData(945330n, 50000n, 0n, targetBalance, monthlyContribution);

      // April: projects from March
      const aprilData = buildFutureMonthData(marchData, targetBalance, monthlyContribution);

      // April projected = $9,953.30 + $0 = $9,953.30
      expect(aprilData.balance).toBe(995330n);
      // April needs $46.70 to reach $10k
      expect(aprilData.targetAmount).toBe(4670n);

      // May: projects from April
      const mayResult = calculateTargetForMonth({
        target,
        yearMonth: 202605,
        currentYearMonth: 202603,
        previousMonthCarryover: 945330n,
        currentBalance: 995330n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: aprilData,
      });

      // May: projected = $9,953.30 + $46.70 = $10,000 >= target → $0 needed
      expect(mayResult.monthlyAssignment).toBe(0n);
    });
  });

  describe('current month partially assigned → future months should show remaining shortfall', () => {
    it('should show $46.70 underfunded in April when March partially assigns $200', () => {
      const target = createMaintainBalanceTarget();

      const marchData = buildCurrentMonthData(
        945330n, // $9,453.30 carryover
        20000n, // $200 assigned (partial)
        0n,
        1000000n,
        50000n
      );

      // March: effectiveBalance = $9,653.30, monthlyAssignment = $500, remaining = $500 - $200 = $300
      expect(marchData.balance).toBe(965330n);
      expect(marchData.targetAmount).toBe(30000n); // $300 remaining

      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604,
        currentYearMonth: 202603,
        previousMonthCarryover: 945330n,
        currentBalance: 965330n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: marchData,
      });

      // projected = $9,653.30 + $300 = $9,953.30 (assumes remaining $300 will be assigned)
      // shortfall = $10,000 - $9,953.30 = $46.70
      expect(aprilResult.monthlyAssignment).toBe(4670n); // $46.70
    });

    it('should show $500 in April when March assigns $0 (nothing assigned yet)', () => {
      const target = createMaintainBalanceTarget();

      const marchData = buildCurrentMonthData(
        945330n, // $9,453.30 carryover
        0n, // $0 assigned
        0n,
        1000000n,
        50000n
      );

      // March: effectiveBalance = $9,453.30, remaining = $500
      expect(marchData.balance).toBe(945330n);
      expect(marchData.targetAmount).toBe(50000n); // $500 remaining (= full amount)

      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604,
        currentYearMonth: 202603,
        previousMonthCarryover: 945330n,
        currentBalance: 945330n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: marchData,
      });

      // projected = $9,453.30 + $500 = $9,953.30
      // shortfall = $10,000 - $9,953.30 = $46.70
      expect(aprilResult.monthlyAssignment).toBe(4670n); // $46.70
    });
  });

  describe('current month with spending → future months use effective balance', () => {
    it('should not propagate spending to future months after full assignment', () => {
      const target = createMaintainBalanceTarget();

      // March: $10k carryover, spent $2k, assigns $500
      // available = $10k + $500 - $2k = $8,500
      // effectiveBalance = $8,500 + $2,000 = $10,500 → capped at $10k
      const marchData = buildCurrentMonthData(
        1000000n, // $10k carryover
        50000n, // $500 assigned
        -200000n, // -$2,000 spent
        1000000n,
        50000n
      );

      expect(marchData.balance).toBe(1000000n); // Capped at $10k
      expect(marchData.targetAmount).toBe(0n); // Already at target

      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604,
        currentYearMonth: 202603,
        previousMonthCarryover: 1000000n,
        currentBalance: 850000n,
        assignedAmount: 0n,
        totalSpent: -200000n,
        previousMonthData: marchData,
      });

      // projected = $10k + $0 = $10k >= target → $0 needed
      expect(aprilResult.monthlyAssignment).toBe(0n);
    });
  });

  describe('future months with pre-assignments should project correctly', () => {
    it('should not lose pre-assigned amount when chaining through future months', () => {
      // Scenario: March fully assigned, April has $200 pre-assigned
      // The fix must keep assignmentNeeded (not remainingToAssign) for future months
      const target = createMaintainBalanceTarget();
      const targetBalance = 1000000n;
      const monthlyContribution = 50000n;

      // March: $5k carryover, fully assigns $500
      const marchData = buildCurrentMonthData(500000n, 50000n, 0n, targetBalance, monthlyContribution);
      expect(marchData.balance).toBe(550000n);
      expect(marchData.targetAmount).toBe(0n);

      // April: projects from March, user pre-assigned $200
      // projected = $5,500 + $0 = $5,500, shortfall = $4,500, capped at $500
      const aprilData = buildFutureMonthData(marchData, targetBalance, monthlyContribution, 20000n);
      expect(aprilData.balance).toBe(550000n);
      expect(aprilData.targetAmount).toBe(50000n); // Full $500 (not $300 remaining)

      // May: projects from April
      const mayResult = calculateTargetForMonth({
        target,
        yearMonth: 202605,
        currentYearMonth: 202603,
        previousMonthCarryover: 500000n,
        currentBalance: 550000n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: aprilData,
      });

      // projected = $5,500 + $500 = $6,000, shortfall = $4,000, capped at $500
      expect(mayResult.monthlyAssignment).toBe(50000n); // $500
    });
  });

  describe('over-assignment in current month', () => {
    it('should cap balance at target and show $0 remaining for over-assignment', () => {
      const target = createMaintainBalanceTarget();

      // March: $9,453.30 carryover, over-assigns $1,000
      const marchData = buildCurrentMonthData(
        945330n, // $9,453.30 carryover
        100000n, // $1,000 assigned (over target by $453.30)
        0n,
        1000000n,
        50000n
      );

      // effectiveBalance = $10,453.30, capped at $10,000
      expect(marchData.balance).toBe(1000000n); // Capped at $10k
      expect(marchData.targetAmount).toBe(0n); // Already at target

      const aprilResult = calculateTargetForMonth({
        target,
        yearMonth: 202604,
        currentYearMonth: 202603,
        previousMonthCarryover: 945330n,
        currentBalance: 1045330n,
        assignedAmount: 0n,
        totalSpent: 0n,
        previousMonthData: marchData,
      });

      // projected = $10k + $0 = $10k >= target → $0 needed
      expect(aprilResult.monthlyAssignment).toBe(0n);
    });
  });
});

describe('calculateBaseTarget for bi-yearly recurring_rollover (KUAL-1172 bug fix)', () => {
  // This test suite specifically tests the bug fix for KUAL-1172
  // where bi-yearly (every 2 years) recurring_rollover targets in subsequent intervals
  // were incorrectly dividing by the FULL 24-month interval instead of months remaining
  const createBiYearlyRecurringRolloverTarget = (
    overrides: Partial<ValidCategoryTarget> = {}
  ): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 110000n, // $1,100.00 in cents
    frequency: 'yearly',
    frequencyInterval: 2, // Every 2 years = 24 months
    firstDueDate: '2024-09-01', // September 1, 2024
    ...overrides,
  });

  describe('subsequent interval - projects balance forward (KUAL-1172 fix)', () => {
    it('January 2026 (current month) should calculate correctly with actual balance', () => {
      // User scenario: January 2026, $275.01 balance, $1100 target, every 2 years
      // Next due: September 2026 (8 months away)
      // Months remaining in interval: 9 (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep)
      // Remaining needed: $1100 - $275.01 = $824.99
      // Monthly: $824.99 / 9 = $91.66
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateBaseTarget(target, 202601, 27501n, 202601);
      // $82499 / 9 = $9166 (rounded)
      expect(result).toBe(9166n); // $91.66
    });

    it('February 2026 (future month) should project balance forward and calculate remaining (KUAL-1172 fix)', () => {
      // CRITICAL FIX: February should NOT return $1100 / 24 = $45.83
      // Instead: project balance ($275.01 + $91.66 = ~$366.67), calculate remaining/months
      // Next due: September 2026 (7 months from Feb)
      // Months remaining: 8 (Feb, Mar, Apr, May, Jun, Jul, Aug, Sep)
      const target = createBiYearlyRecurringRolloverTarget();
      // Viewing Feb from Jan, with Jan having $275.01 balance
      // For future months, we use calculateFutureMonthAssignment which uses previousMonthData
      // This test validates the base calculation logic
      const result = calculateBaseTarget(target, 202602, 36667n, 202602); // $366.67 projected
      // Remaining: $1100 - $366.67 = $733.33
      // Months remaining: 8
      // Monthly: $733.33 / 8 = $91.66
      expect(result).toBe(9166n); // $91.66
    });

    it('should return 0 when balance already exceeds target in subsequent interval', () => {
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateBaseTarget(target, 202601, 120000n, 202601); // $1200 > $1100 target
      expect(result).toBe(0n);
    });

    it('September 2026 (due month) should show remaining amount needed', () => {
      // At due date, should show whatever is remaining to reach target
      const target = createBiYearlyRecurringRolloverTarget();
      // If user has saved $1000 by September
      const result = calculateBaseTarget(target, 202609, 100000n, 202609);
      // Remaining: $1100 - $1000 = $100
      // This is the due month, so it gets whatever is remaining
      expect(result).toBe(10000n); // $100.00
    });
  });
});

describe('calculateTargetForMonth for bi-yearly recurring_rollover (KUAL-1172)', () => {
  const createBiYearlyRecurringRolloverTarget = (
    overrides: Partial<ValidCategoryTarget> = {}
  ): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 110000n, // $1,100.00 in cents
    frequency: 'yearly',
    frequencyInterval: 2, // Every 2 years = 24 months
    firstDueDate: '2024-09-01', // September 1, 2024
    ...overrides,
  });

  describe('Bug fix scenario: Future month should project balance, not divide full target', () => {
    it('January 2026 should show $91.66 needed with $275.01 balance', () => {
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current month)
        currentYearMonth: 202601,
        previousMonthCarryover: 27501n, // $275.01 carryover from December
        currentBalance: 27501n,
        assignedAmount: 0n,
      });

      // Remaining: $1100 - $275.01 = $824.99
      // Months remaining: 9 (Jan - Sep)
      // Monthly: $824.99 / 9 = $91.66
      expect(result.baseTarget).toBe(9166n); // $91.66
      expect(result.monthlyAssignment).toBe(9166n);
      expect(result.remainingToAssign).toBe(9166n);
      expect(result.isCurrentMonth).toBe(true);
    });

    it('February 2026 should show ~$91.66 needed, NOT $45.83 (KUAL-1172 fix)', () => {
      // THIS IS THE KEY BUG FIX TEST
      // Before fix: $1100 / 24 = $45.83 (WRONG)
      // After fix: project balance forward, calculate remaining/months = ~$91.66 (CORRECT)
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 27501n, // January started with $275.01
        currentBalance: 27501n,
        assignedAmount: 0n,
        previousMonthData: {
          // January's data
          assignedAmount: 0n, // User hasn't assigned yet
          targetAmount: 9166n, // January's target is $91.66
          balance: 27501n, // January's starting balance
        },
      });

      // Projected balance for Feb: $275.01 + $91.66 = $366.67
      // Remaining: $1100 - $366.67 = $733.33
      // Months remaining: 8 (Feb - Sep)
      // Monthly: $733.33 / 8 = $91.66
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(9166n); // $91.66, NOT $45.83
    });

    it('March 2026 should continue showing consistent monthly target', () => {
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202603, // March (future month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 27501n,
        currentBalance: 27501n,
        assignedAmount: 0n,
        previousMonthData: {
          // February's projected data
          assignedAmount: 0n,
          targetAmount: 9166n, // February's target
          balance: 36667n, // $275.01 + $91.66 = $366.67
        },
      });

      // Projected balance for Mar: $366.67 + $91.66 = $458.33
      // Remaining: $1100 - $458.33 = $641.67
      // Months remaining: 7 (Mar - Sep)
      // Monthly: $641.67 / 7 = $91.67
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(9166n); // ~$91.66
    });

    it('September 2026 (due month) should show the final amount needed', () => {
      const target = createBiYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202609, // September (due month, future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 27501n,
        currentBalance: 27501n,
        assignedAmount: 0n,
        previousMonthData: {
          // August's projected data
          // After 8 months of $91.66: $275.01 + (8 × $91.66) = $275.01 + $733.28 = $1008.29
          assignedAmount: 0n,
          targetAmount: 9166n,
          balance: 100829n, // ~$1008.29
        },
      });

      // Projected balance for Sep: $1008.29 + $91.66 = $1099.95
      // Remaining: $1100 - $1099.95 = $0.05 (basically 0 with rounding)
      // At due month with remainder handling
      expect(result.isFutureMonth).toBe(true);
      // The due month gets the remainder to ensure total adds up
      expect(result.monthlyAssignment).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('Full progression from January to September 2026', () => {
    it('should show consistent monthly targets across the interval', () => {
      const target = createBiYearlyRecurringRolloverTarget();

      // Test each month from Jan to Sep 2026
      // Starting balance: $275.01
      // Each month should need approximately $91.66

      // January (current)
      const janResult = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 27501n,
        currentBalance: 27501n,
        assignedAmount: 0n,
      });
      expect(janResult.baseTarget).toBe(9166n);

      // February (future) - using January's data
      const febResult = calculateTargetForMonth({
        target,
        yearMonth: 202602,
        currentYearMonth: 202601,
        previousMonthCarryover: 27501n,
        currentBalance: 27501n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: janResult.baseTarget,
          balance: 27501n,
        },
      });

      // Both should be approximately the same (within rounding)
      expect(janResult.baseTarget).toBe(9166n);
      expect(febResult.monthlyAssignment).toBe(9166n);
    });
  });
});

describe('calculateTargetForMonth for yearly recurring_rollover in INITIAL interval (future first due date)', () => {
  // This test suite covers the scenario where first due date is in the FUTURE
  // Bug: Future months in initial interval were returning full target/months
  // instead of (remaining needed)/months
  const createYearlyRecurringRolloverTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 40000n, // $400.00 in cents
    frequency: 'yearly',
    frequencyInterval: 1, // Every 1 year
    firstDueDate: '2026-04-01', // April 1, 2026 (FUTURE)
    ...overrides,
  });

  describe('Bug fix: Future months in initial interval should project balance forward', () => {
    it('January 2026 should show $38.88 needed with $244.47 carryover', () => {
      // User scenario:
      // Target: $400, due April 2026
      // Carryover from December: $244.47
      // Months remaining: 4 (Jan, Feb, Mar, Apr)
      // Remaining: $400 - $244.47 = $155.53
      // Monthly: $155.53 / 4 = $38.88
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current month)
        currentYearMonth: 202601,
        previousMonthCarryover: 24447n, // $244.47 carryover from December
        currentBalance: 24447n,
        assignedAmount: 0n,
      });

      // $15553 / 4 = $3888 (rounded)
      expect(result.baseTarget).toBe(3888n); // $38.88
      expect(result.monthlyAssignment).toBe(3888n);
      expect(result.remainingToAssign).toBe(3888n);
      expect(result.isCurrentMonth).toBe(true);
    });

    it('February 2026 should show $38.88 needed, NOT $100 (BUG FIX)', () => {
      // THIS IS THE KEY BUG FIX TEST
      // Before fix: $400 / 4 = $100 (WRONG - used full target)
      // After fix: project balance forward, calculate remaining/months = $38.88 (CORRECT)
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 24447n, // January started with $244.47
        currentBalance: 24447n,
        assignedAmount: 0n,
        previousMonthData: {
          // January's data
          assignedAmount: 0n, // User hasn't assigned yet
          targetAmount: 3888n, // January's target is $38.88
          balance: 24447n, // January's starting balance
        },
      });

      // Projected balance for Feb: $244.47 + $38.88 = $283.35
      // Remaining: $400 - $283.35 = $116.65
      // Months remaining: 3 (Feb, Mar, Apr)
      // Monthly: $116.65 / 3 = $38.88
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(3888n); // $38.88, NOT $100
    });

    it('March 2026 should continue showing consistent monthly target', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202603, // March (future month)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 24447n,
        currentBalance: 24447n,
        assignedAmount: 0n,
        previousMonthData: {
          // February's projected data
          assignedAmount: 0n,
          targetAmount: 3888n, // February's target
          balance: 28335n, // $244.47 + $38.88 = $283.35
        },
      });

      // Projected balance for Mar: $283.35 + $38.88 = $322.23
      // Remaining: $400 - $322.23 = $77.77
      // Months remaining: 2 (Mar, Apr)
      // Monthly: $77.77 / 2 = $38.88
      expect(result.isFutureMonth).toBe(true);
      expect(result.monthlyAssignment).toBe(3888n); // ~$38.88
    });

    it('April 2026 (due month) should show final remaining amount', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202604, // April (due month, future)
        currentYearMonth: 202601, // Viewing from January
        previousMonthCarryover: 24447n,
        currentBalance: 24447n,
        assignedAmount: 0n,
        previousMonthData: {
          // March's projected data
          assignedAmount: 0n,
          targetAmount: 3888n, // March's target
          balance: 32223n, // $322.23 after Feb
        },
      });

      // Projected balance for Apr: $322.23 + $38.88 = $361.11
      // Remaining: $400 - $361.11 = $38.89 (with any remainder)
      expect(result.isFutureMonth).toBe(true);
      // Due month gets whatever is remaining to reach target
      expect(result.monthlyAssignment).toBeGreaterThanOrEqual(3888n);
    });
  });

  describe('Edge cases for initial interval with carryover', () => {
    it('should show 0 when carryover already exceeds target', () => {
      const target = createYearlyRecurringRolloverTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601,
        previousMonthCarryover: 45000n, // $450 carryover (exceeds $400 target)
        currentBalance: 45000n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 0n, // January shows $0 needed (already at target)
          balance: 45000n,
        },
      });

      expect(result.monthlyAssignment).toBe(0n);
    });

    it('should calculate correctly with partial carryover and partial assignment', () => {
      // January: $200 carryover, user assigned $50 (current balance $250)
      // Remaining: $400 - $200 = $200, Monthly: $200 / 4 = $50
      const target = createYearlyRecurringRolloverTarget();
      const janResult = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January (current)
        currentYearMonth: 202601,
        previousMonthCarryover: 20000n, // $200 carryover
        currentBalance: 25000n, // $250 current balance (assigned $50)
        assignedAmount: 5000n, // $50 assigned
      });

      // $200 remaining / 4 months = $50
      expect(janResult.baseTarget).toBe(5000n); // $50

      // February should project forward correctly
      const febResult = calculateTargetForMonth({
        target,
        yearMonth: 202602, // February (future)
        currentYearMonth: 202601,
        previousMonthCarryover: 20000n,
        currentBalance: 25000n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 5000n, // January assigned $50
          targetAmount: 5000n, // January's target was $50
          balance: 20000n, // January started with $200
        },
      });

      // Projected: $200 + $50 = $250
      // Remaining: $400 - $250 = $150
      // Months: 3 (Feb, Mar, Apr)
      // Monthly: $150 / 3 = $50
      expect(febResult.monthlyAssignment).toBe(5000n); // $50
    });
  });

  describe('Full progression Jan -> Apr with $244.47 carryover', () => {
    it('should show consistent monthly targets across the initial interval', () => {
      const target = createYearlyRecurringRolloverTarget();

      // January (current) - starting with $244.47
      const janResult = calculateTargetForMonth({
        target,
        yearMonth: 202601,
        currentYearMonth: 202601,
        previousMonthCarryover: 24447n,
        currentBalance: 24447n,
        assignedAmount: 0n,
      });
      expect(janResult.baseTarget).toBe(3888n); // $38.88

      // February (future)
      const febResult = calculateTargetForMonth({
        target,
        yearMonth: 202602,
        currentYearMonth: 202601,
        previousMonthCarryover: 24447n,
        currentBalance: 24447n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: janResult.baseTarget,
          balance: 24447n,
        },
      });

      // Both should be approximately the same
      expect(janResult.baseTarget).toBe(3888n);
      expect(febResult.monthlyAssignment).toBe(3888n);
    });
  });
});

describe('calculateTargetForMonth for recurring_rollover with negative carryover (overspending deficit)', () => {
  const createMonthlyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 12500n, // $125.00 in cents
    frequency: 'monthly',
    frequencyInterval: 1,
    firstDueDate: '2025-12-01',
    ...overrides,
  });

  it('should include deficit when previous month has negative carryover ($125 target + $125 deficit = $250)', () => {
    const target = createMonthlyTarget();
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202601,
      currentYearMonth: 202601,
      previousMonthCarryover: -12500n, // -$125 overspent from previous month
      currentBalance: -12500n,
      assignedAmount: 0n,
    });

    // Target $125 + deficit $125 = $250 needed
    expect(result.monthlyAssignment).toBe(25000n);
    expect(result.remainingToAssign).toBe(25000n);
  });

  it('should show remaining $125 after assigning $125 toward $250 needed', () => {
    const target = createMonthlyTarget();
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202601,
      currentYearMonth: 202601,
      previousMonthCarryover: -12500n, // -$125 overspent
      currentBalance: 0n, // -$125 + $125 assigned = $0
      assignedAmount: 12500n, // $125 assigned so far
    });

    // Target $125 + deficit $125 = $250 needed, $125 assigned → $125 remaining
    expect(result.monthlyAssignment).toBe(25000n);
    expect(result.remainingToAssign).toBe(12500n);
  });

  it('should show 0 remaining after fully funding $250 needed', () => {
    const target = createMonthlyTarget();
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202601,
      currentYearMonth: 202601,
      previousMonthCarryover: -12500n, // -$125 overspent
      currentBalance: 12500n, // -$125 + $250 assigned = $125
      assignedAmount: 25000n, // $250 assigned
    });

    // Target $125 + deficit $125 = $250 needed, $250 assigned → $0 remaining
    expect(result.monthlyAssignment).toBe(25000n);
    expect(result.remainingToAssign).toBe(0n);
  });

  it('should NOT add deficit when previous month has positive carryover', () => {
    const target = createMonthlyTarget();
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202601,
      currentYearMonth: 202601,
      previousMonthCarryover: 5000n, // +$50 carryover (positive)
      currentBalance: 5000n,
      assignedAmount: 0n,
    });

    // Target $125, positive carryover $50 → baseTarget = $125 - $50 = $75, no deficit
    expect(result.monthlyAssignment).toBe(7500n);
    expect(result.remainingToAssign).toBe(7500n);
  });

  it('should NOT add deficit when previous month carryover is zero', () => {
    const target = createMonthlyTarget();
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202601,
      currentYearMonth: 202601,
      previousMonthCarryover: 0n,
      currentBalance: 0n,
      assignedAmount: 0n,
    });

    // Target $125, zero carryover → just $125 needed
    expect(result.monthlyAssignment).toBe(12500n);
    expect(result.remainingToAssign).toBe(12500n);
  });

  describe('weekly recurring_rollover with negative carryover', () => {
    const createWeeklyTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
      categoryId: 'test-category-id',
      targetType: 'recurring_rollover',
      amount: 12500n, // $125.00 per occurrence
      frequency: 'weekly',
      frequencyInterval: 1,
      dayOfWeek: 0, // Sunday
      firstDueDate: '2025-12-01',
      ...overrides,
    });

    it('should add deficit to weekly total when previous month has negative carryover', () => {
      const target = createWeeklyTarget();
      const result = calculateTargetForMonth({
        target,
        yearMonth: 202601, // January 2026 has 4 Sundays
        currentYearMonth: 202601,
        previousMonthCarryover: -10000n, // -$100 overspent
        currentBalance: -10000n,
        assignedAmount: 0n,
      });

      // 4 Sundays × $125 = $500 base + $100 deficit = $600 needed
      expect(result.monthlyAssignment).toBe(60000n);
      expect(result.remainingToAssign).toBe(60000n);
    });
  });
});

describe('Division by zero fix: getNextDueDateForRecurring returning past date', () => {
  // This test covers the bug where monthsRemaining could be 0 causing division by zero
  // when getNextDueDateForRecurring returns a date before the current yearMonth
  // (e.g., for unsupported frequency types falling through to the default return)

  const createRecurringRolloverTarget = (overrides: Partial<ValidCategoryTarget> = {}): ValidCategoryTarget => ({
    categoryId: 'test-category-id',
    targetType: 'recurring_rollover',
    amount: 120000n, // $1,200.00
    frequency: 'monthly',
    frequencyInterval: 3, // Every 3 months
    firstDueDate: '2025-01-01',
    ...overrides,
  });

  it('should not throw division by zero for future month in subsequent interval', () => {
    const target = createRecurringRolloverTarget();

    // This should not throw RangeError: Division by zero
    expect(() => {
      calculateTargetForMonth({
        target,
        yearMonth: 202604, // April 2026 (future month, after first due date)
        currentYearMonth: 202603,
        previousMonthCarryover: 0n,
        currentBalance: 0n,
        assignedAmount: 0n,
        previousMonthData: {
          assignedAmount: 0n,
          targetAmount: 40000n,
          balance: 0n,
        },
      });
    }).not.toThrow();
  });

  it('should return full remaining amount when months remaining would be zero or negative', () => {
    // Yearly target with first due date in the past
    const target = createRecurringRolloverTarget({
      frequency: 'yearly',
      frequencyInterval: 1,
      firstDueDate: '2025-06-01', // June 2025
      amount: 120000n, // $1,200
    });

    // July 2026 - after June 2026 due date, next due is June 2027
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202607, // July 2026 (future month)
      currentYearMonth: 202606,
      previousMonthCarryover: 0n,
      currentBalance: 0n,
      assignedAmount: 0n,
      previousMonthData: {
        assignedAmount: 0n,
        targetAmount: 10000n, // $100
        balance: 0n,
      },
    });

    // Should calculate without division by zero
    // Projected balance: 0 + $100 = $100
    // Remaining: $1200 - $100 = $1100
    // Next due: June 2027, months until due: 11
    // Months remaining: 11 + 1 = 12
    // Monthly: $1100 / 12 = $91.66
    expect(result.monthlyAssignment).toBe(9166n);
    expect(result.isFutureMonth).toBe(true);
  });

  it('should handle quarterly recurring_rollover at due month boundary', () => {
    const target = createRecurringRolloverTarget({
      frequency: 'monthly',
      frequencyInterval: 3,
      firstDueDate: '2025-01-01',
      amount: 30000n, // $300
    });

    // April 2026 is a due month (3 months after Jan)
    const result = calculateTargetForMonth({
      target,
      yearMonth: 202604, // April 2026 (due month, future)
      currentYearMonth: 202603,
      previousMonthCarryover: 0n,
      currentBalance: 0n,
      assignedAmount: 0n,
      previousMonthData: {
        assignedAmount: 0n,
        targetAmount: 10000n,
        balance: 0n,
      },
    });

    // Should not throw and should return a valid amount
    expect(result.isFutureMonth).toBe(true);
    expect(result.monthlyAssignment).toBeGreaterThanOrEqual(0n);
  });
});

describe('targetDueDateForMonth', () => {
  const recurring: ValidCategoryTarget = {
    categoryId: 'category',
    targetType: 'recurring',
    amount: 100n,
    frequency: 'monthly',
    frequencyInterval: 1,
    firstDueDate: '2025-01-15',
  };

  it.each([
    [202609, '2026-09-15'],
    [202612, '2026-12-15'],
    [202701, '2027-01-15'],
  ])('rolls monthly deadlines forward for %s', (month, expected) => {
    expect(targetDueDateForMonth(recurring, month)).toBe(expected);
  });

  it('keeps overdue one-time deadlines and leaves balance targets undated', () => {
    expect(targetDueDateForMonth({ ...recurring, targetType: 'one_time', targetDate: '2026-08-20' }, 202609)).toBe(
      '2026-08-20'
    );
    expect(targetDueDateForMonth({ ...recurring, targetType: 'maintain_balance' }, 202609)).toBeUndefined();
  });

  it('respects multi-month intervals and the first future deadline', () => {
    const target = { ...recurring, firstDueDate: '2026-02-10', frequencyInterval: 3 };
    expect(targetDueDateForMonth(target, 202609)).toBe('2026-11-10');
    expect(targetDueDateForMonth(target, 202611)).toBe('2026-11-10');
    expect(targetDueDateForMonth(target, 202601)).toBe('2026-02-10');
  });

  it("keeps this year's yearly deadline when its month is still ahead", () => {
    const target = { ...recurring, frequency: 'yearly' as const, firstDueDate: '2025-12-12' };
    expect(targetDueDateForMonth(target, 202609)).toBe('2026-12-12');
    expect(targetDueDateForMonth(target, 202612)).toBe('2026-12-12');
    expect(targetDueDateForMonth(target, 202701)).toBe('2027-12-12');
  });

  it('clamps month-end and leap-day deadlines without shifting to March', () => {
    expect(targetDueDateForMonth({ ...recurring, dueDay: -1 }, 202602)).toBe('2026-02-28');
    expect(targetDueDateForMonth({ ...recurring, dueDay: 31 }, 202602)).toBe('2026-02-28');
    expect(targetDueDateForMonth({ ...recurring, dueDay: -1 }, 202802)).toBe('2028-02-29');
    const leap = { ...recurring, frequency: 'yearly' as const, firstDueDate: '2024-02-29' };
    expect(targetDueDateForMonth(leap, 202602)).toBe('2026-02-28');
    expect(targetDueDateForMonth(leap, 202802)).toBe('2028-02-29');
  });

  it('uses the first weekly occurrence and preserves two-week cadence', () => {
    const weekly = { ...recurring, frequency: 'weekly' as const, firstDueDate: '2026-08-28', dayOfWeek: 5 };
    expect(targetDueDateForMonth(weekly, 202609)).toBe('2026-09-04');
    expect(targetDueDateForMonth({ ...weekly, frequencyInterval: 2 }, 202609)).toBe('2026-09-11');
    expect(targetDueDateForMonth({ ...weekly, firstDueDate: undefined }, 202609)).toBe('2026-09-04');
  });

  it('handles daily cadence and missing or malformed deadlines', () => {
    expect(
      targetDueDateForMonth(
        { ...recurring, frequency: 'daily', firstDueDate: '2026-08-31', frequencyInterval: 3 },
        202609
      )
    ).toBe('2026-09-03');
    expect(targetDueDateForMonth({ ...recurring, firstDueDate: undefined }, 202609)).toBeUndefined();
    expect(targetDueDateForMonth({ ...recurring, firstDueDate: undefined, dueDay: 5 }, 202609)).toBe('2026-09-05');
    expect(targetDueDateForMonth({ ...recurring, firstDueDate: '2026-02-30' }, 202609)).toBeUndefined();
    expect(targetDueDateForMonth({ ...recurring, frequencyInterval: 0 }, 202609)).toBeUndefined();
  });
});
