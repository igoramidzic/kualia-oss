import { computed, inject, Injectable } from '@angular/core';
import { Id } from 'convex/_generated/dataModel';
import { BudgetMonthData } from 'convex/categoryBudgets/types';
import { getCurrentYearMonth, getPreviousYearMonth } from '../shared/utils/month.utils';
import { BudgetCategorySelectionService } from './budget-category-selection.service';
import { BudgetMonthService } from './budget-month.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';

/**
 * Represents a single category's quick assign update
 */
export interface QuickAssignUpdate {
  categoryId: Id<'category'>;
  newAssignedAmount: bigint;
}

/**
 * Quick assign data for a single option
 */
export interface QuickAssignData {
  /** Total amount that will change across all categories (absolute value for display) */
  totalAmount: bigint;
  /** List of category updates to apply */
  updates: QuickAssignUpdate[];
}

/**
 * All quick assign options with their calculated data
 */
export interface QuickAssignDataSet {
  underfunded: QuickAssignData;
  overfunded: QuickAssignData;
  resetAssignedAmounts: QuickAssignData;
  resetAvailableAmounts: QuickAssignData;
  assignedLastMonth: QuickAssignData;
  spentLastMonth: QuickAssignData;
  averageAssigned: QuickAssignData;
  averageSpent: QuickAssignData;
}

/**
 * Empty quick assign data set for initialization
 */
function createEmptyQuickAssignDataSet(): QuickAssignDataSet {
  return {
    underfunded: { totalAmount: 0n, updates: [] },
    overfunded: { totalAmount: 0n, updates: [] },
    resetAssignedAmounts: { totalAmount: 0n, updates: [] },
    resetAvailableAmounts: { totalAmount: 0n, updates: [] },
    assignedLastMonth: { totalAmount: 0n, updates: [] },
    spentLastMonth: { totalAmount: 0n, updates: [] },
    averageAssigned: { totalAmount: 0n, updates: [] },
    averageSpent: { totalAmount: 0n, updates: [] },
  };
}

@Injectable({
  providedIn: 'root',
})
export class QuickAssignService {
  private readonly budgetService = inject(BudgetService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly categoryService = inject(CategoryService);
  private readonly selectionService = inject(BudgetCategorySelectionService);

  /**
   * Computed quick assign data based on selected categories and current month
   */
  readonly quickAssignData = computed(() => {
    const months = this.budgetService.months();
    const currentYearMonth = this.budgetMonthService.getLastViewedMonth();

    // Find current month data
    const currentMonthData = months.find((m) => m.yearMonth === currentYearMonth);
    if (!currentMonthData) {
      return createEmptyQuickAssignDataSet();
    }

    // Get selected category IDs - only work with selected categories
    const selectedIds = this.selectionService.selectedCategories();
    const eligibleCategoryIds = this.getEligibleCategoryIds(selectedIds);

    if (eligibleCategoryIds.length === 0) {
      return createEmptyQuickAssignDataSet();
    }

    return this.generateQuickAssignData(eligibleCategoryIds, currentMonthData, months);
  });

  /**
   * Get category IDs eligible for quick assign operations
   * Filters out credit card and deleted categories
   * Only returns selected categories - no fallback to all categories
   */
  private getEligibleCategoryIds(selectedIds: Id<'category'>[]): Id<'category'>[] {
    const categories = this.categoryService.activeCategories();
    const categoryMap = new Map(categories.map((c) => [c._id, c]));

    // Only use selected categories - no fallback to all categories
    if (selectedIds.length === 0) {
      return [];
    }

    return selectedIds.filter((categoryId) => {
      const category = categoryMap.get(categoryId);
      if (!category) return false;

      // Exclude credit card categories
      if (category.type === 'credit_card') return false;

      return true;
    });
  }

  /**
   * Generate quick assign data for the given categories
   */
  private generateQuickAssignData(
    categoryIds: Id<'category'>[],
    currentMonthData: BudgetMonthData,
    allMonths: BudgetMonthData[]
  ): QuickAssignDataSet {
    const result = createEmptyQuickAssignDataSet();

    // Get real-world current month for historical calculations
    const realWorldCurrentMonth = getCurrentYearMonth();
    const realWorldPreviousMonth = getPreviousYearMonth(realWorldCurrentMonth);

    // Get all previous months (before real-world current month)
    const previousMonths = allMonths
      .filter((m) => m.yearMonth < realWorldCurrentMonth)
      .sort((a, b) => a.yearMonth - b.yearMonth);

    // Get previous month data
    const previousMonthData = allMonths.find((m) => m.yearMonth === realWorldPreviousMonth);

    // Collect underfunded categories and always assign full amounts
    // (no RTA capping - allow ready-to-assign to go negative)
    for (const categoryId of categoryIds) {
      const budgetData = currentMonthData.budgetData[categoryId];
      if (!budgetData) continue;

      const assignedAmount = budgetData.assignedAmount;

      // 1. Underfunded - use the backend-calculated underfunded amount
      const underfundedAmount = budgetData.target.underfundedAmount;

      if (underfundedAmount > 0n) {
        result.underfunded.updates.push({
          categoryId,
          newAssignedAmount: assignedAmount + underfundedAmount,
        });
        result.underfunded.totalAmount += underfundedAmount;
      }
    }

    // Continue with the rest of the calculations for other quick assign options
    for (const categoryId of categoryIds) {
      const budgetData = currentMonthData.budgetData[categoryId];
      if (!budgetData) continue;

      const assignedAmount = budgetData.assignedAmount;

      // 2. Overfunded - reduce by overfunded amount, but don't make available negative
      if (budgetData.target.overfundedByAmount > 0n) {
        const overfundedAmount = budgetData.target.overfundedByAmount;
        const available = budgetData.available;

        // Calculate the maximum amount we can safely reduce without making available negative
        // available = carryover + assignedAmount - totalSpent
        // If we reduce assignedAmount by X, new available = carryover + (assignedAmount - X) - totalSpent
        // To keep available >= 0: carryover + assignedAmount - X - totalSpent >= 0
        // Therefore: X <= available
        // So maxReduction = min(overfundedAmount, available)

        // Only reduce if available is positive (otherwise we'd make it negative)
        if (available > 0n) {
          const actualReduction = overfundedAmount < available ? overfundedAmount : available;
          result.overfunded.updates.push({
            categoryId,
            newAssignedAmount: assignedAmount - actualReduction,
          });
          result.overfunded.totalAmount += actualReduction;
        }
      }

      // 3. Reset assigned amounts - set to zero
      // Always include all eligible categories, even if already at zero
      result.resetAssignedAmounts.updates.push({
        categoryId,
        newAssignedAmount: 0n,
      });

      // 4. Reset available amounts - adjust assigned to make available zero
      // Always include all eligible categories, even if already at zero
      result.resetAvailableAmounts.updates.push({
        categoryId,
        newAssignedAmount: assignedAmount - budgetData.available,
      });

      // 5. Assigned last month
      if (previousMonthData) {
        const previousBudgetData = previousMonthData.budgetData[categoryId];
        if (previousBudgetData) {
          const assignedLastMonth = previousBudgetData.assignedAmount;
          result.assignedLastMonth.updates.push({
            categoryId,
            newAssignedAmount: assignedLastMonth,
          });
          result.assignedLastMonth.totalAmount += this.abs(assignedLastMonth);
        }
      }

      // 6. Spent last month (only count actual spending, not inflows)
      if (previousMonthData) {
        const previousBudgetData = previousMonthData.budgetData[categoryId];
        if (previousBudgetData) {
          // Activity is inflow - outflow, so negative means spending
          const activity = previousBudgetData.activity ?? 0n;
          const spentAmount = activity < 0n ? -activity : 0n;
          result.spentLastMonth.updates.push({
            categoryId,
            newAssignedAmount: spentAmount,
          });
          result.spentLastMonth.totalAmount += spentAmount;
        }
      }

      // 7. Average assigned (from all previous months)
      if (previousMonths.length > 0) {
        let totalAssigned = 0n;
        let monthsWithData = 0;

        for (const month of previousMonths) {
          const historicalBudgetData = month.budgetData[categoryId];
          if (historicalBudgetData) {
            totalAssigned += historicalBudgetData.assignedAmount;
            monthsWithData++;
          }
        }

        if (monthsWithData > 0) {
          const averageAmount = totalAssigned / BigInt(monthsWithData);
          result.averageAssigned.updates.push({
            categoryId,
            newAssignedAmount: averageAmount,
          });
          result.averageAssigned.totalAmount += this.abs(averageAmount);
        }
      }

      // 8. Average spent (from all previous months)
      if (previousMonths.length > 0) {
        let totalSpent = 0n;
        let monthsWithData = 0;

        for (const month of previousMonths) {
          const historicalBudgetData = month.budgetData[categoryId];
          if (historicalBudgetData) {
            const activity = historicalBudgetData.activity ?? 0n;
            const monthlySpent = activity < 0n ? -activity : 0n;
            totalSpent += monthlySpent;
            monthsWithData++;
          }
        }

        if (monthsWithData > 0) {
          const averageAmount = totalSpent / BigInt(monthsWithData);
          result.averageSpent.updates.push({
            categoryId,
            newAssignedAmount: averageAmount,
          });
          result.averageSpent.totalAmount += averageAmount;
        }
      }
    }

    // Hard code totalAmount to zero for reset options
    result.resetAssignedAmounts.totalAmount = 0n;
    result.resetAvailableAmounts.totalAmount = 0n;

    return result;
  }

  /**
   * Absolute value for bigint
   */
  private abs(value: bigint): bigint {
    return value < 0n ? -value : value;
  }
}
