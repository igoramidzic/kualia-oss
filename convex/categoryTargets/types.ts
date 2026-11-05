import type { Doc } from '../_generated/dataModel';

// Target information is now embedded in the category table with target_ prefix
export type CategoryWithTarget = Doc<'category'> & {
  // Ensure target fields are defined (TypeScript helper)
  target_type?: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
  target_amount?: bigint;
  target_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  target_frequencyInterval?: number;
  target_dayOfWeek?: number;
  target_dueDay?: number;
  target_firstDueDate?: string;
  target_targetDate?: string;
  target_monthlyContribution?: bigint;
  target_targetBalance?: bigint;
};

// Helper to extract target information from a category
// All fields except categoryId are optional since the target might not be enabled
export interface CategoryTarget {
  categoryId: string;
  targetType?: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
  amount?: bigint;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly'; // Optional for one_time
  frequencyInterval?: number; // Optional for one_time
  dayOfWeek?: number;
  dueDay?: number;
  firstDueDate?: string;
  targetDate?: string; // Required for one_time
  monthlyContribution?: bigint;
  targetBalance?: bigint;
}

// Helper function to check if a category has an enabled target
export function hasTarget(category: Doc<'category'>): boolean {
  return category.enableTarget === true;
}

// Type guard to check if a CategoryTarget has valid data for calculations
export function isValidTarget(
  target: CategoryTarget
): target is Required<
  Omit<CategoryTarget, 'dayOfWeek' | 'dueDay' | 'firstDueDate' | 'targetDate' | 'monthlyContribution' | 'targetBalance'>
> &
  CategoryTarget {
  return target.targetType !== undefined && target.amount !== undefined;
}

// Type for a validated category target with required fields for calculations
export type ValidCategoryTarget = Required<Pick<CategoryTarget, 'categoryId' | 'targetType' | 'amount'>> &
  CategoryTarget;

// Helper function to extract target from category
// Always returns a CategoryTarget object with categoryId, other fields may be undefined
export function extractTarget(category: CategoryWithTarget): CategoryTarget {
  return {
    categoryId: category._id,
    targetType: category.target_type,
    amount: category.target_amount,
    frequency: category.target_frequency,
    frequencyInterval: category.target_frequencyInterval,
    dayOfWeek: category.target_dayOfWeek,
    dueDay: category.target_dueDay,
    firstDueDate: category.target_firstDueDate,
    targetDate: category.target_targetDate,
    monthlyContribution: category.target_monthlyContribution,
    targetBalance: category.target_targetBalance,
  };
}

export type TargetType = 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TargetCalculationInput {
  target: ValidCategoryTarget;
  yearMonth: number;
  currentYearMonth: number;
  previousMonthCarryover: bigint; // From previous completed month
  currentBalance: bigint; // For maintain_balance type
  assignedAmount: bigint; // Amount already assigned this month
  totalSpent?: bigint; // Total spent this month (negative for spending, used for maintain_balance)
  // For future month calculations: data from the previous month
  previousMonthData?: {
    assignedAmount: bigint;
    targetAmount: bigint; // The monthly assignment target (not remaining)
    balance: bigint; // Starting balance of previous month
  };
}

export interface TargetCalculationResult {
  targetType: TargetType;
  baseTarget: bigint; // "Clean" target amount before adjustments
  monthlyAssignment: bigint; // Actual amount needed for the month
  remainingToAssign: bigint; // How much more needs to be assigned (monthlyAssignment - assignedAmount)
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
}

export interface CategoryTargetWithCalculation extends ValidCategoryTarget {
  calculation: TargetCalculationResult;
}
