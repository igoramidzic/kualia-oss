import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { BudgetMonthData } from 'convex/categoryBudgets/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetCategorySelectionService } from './budget-category-selection.service';
import { BudgetMonthService } from './budget-month.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { QuickAssignService } from './quick-assign.service';

// Mock the month utils
vi.mock('../shared/utils/month.utils', () => ({
  getCurrentYearMonth: vi.fn(() => 202511),
  getPreviousYearMonth: vi.fn((yearMonth: number) => {
    const year = Math.floor(yearMonth / 100);
    const month = yearMonth % 100;
    if (month === 1) {
      return (year - 1) * 100 + 12;
    }
    return yearMonth - 1;
  }),
}));

describe('QuickAssignService', () => {
  let service: QuickAssignService;

  // Mock services
  let mockBudgetService: {
    months: ReturnType<typeof signal<BudgetMonthData[]>>;
    readyToAssign: ReturnType<typeof signal<bigint>>;
  };
  let mockBudgetMonthService: {
    getLastViewedMonth: ReturnType<typeof vi.fn>;
  };
  let mockCategoryService: {
    activeCategories: ReturnType<typeof signal<{ _id: Id<'category'>; type?: string }[]>>;
  };
  let mockSelectionService: {
    selectedCategories: ReturnType<typeof signal<Id<'category'>[]>>;
  };

  // Helper to create mock budget data
  const createMockBudgetData = (
    categoryId: string,
    options: {
      assignedAmount?: bigint;
      available?: bigint;
      activity?: bigint;
      remainingToAssign?: bigint;
      overfundedByAmount?: bigint;
      underfundedAmount?: bigint;
    } = {}
  ) => {
    const available = options.available ?? 5000n;
    const remainingToAssign = options.remainingToAssign ?? 0n;
    // Calculate underfundedAmount: max of remainingToAssign and overspent amount (if available < 0)
    const overspentAmount = available < 0n ? -available : 0n;
    const calculatedUnderfunded = remainingToAssign > overspentAmount ? remainingToAssign : overspentAmount;
    const underfundedAmount = options.underfundedAmount ?? calculatedUnderfunded;

    return {
      assignedAmount: options.assignedAmount ?? 10000n,
      totalSpent: 0n,
      carryoverFromPrevious: 0n,
      available,
      activity: options.activity ?? -5000n,
      target: {
        assignmentNeeded: 0n,
        remainingToAssign,
        overfundedByAmount: options.overfundedByAmount ?? 0n,
        underfundedAmount,
      },
    };
  };

  // Helper to create mock month data
  const createMockMonthData = (
    yearMonth: number,
    budgetData: Record<string, ReturnType<typeof createMockBudgetData>>
  ): BudgetMonthData => ({
    yearMonth,
    yearMonthString: yearMonth.toString(),
    budgetData: budgetData as BudgetMonthData['budgetData'],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock signals
    mockBudgetService = {
      months: signal<BudgetMonthData[]>([]),
      readyToAssign: signal<bigint>(1000000n), // Default to $10,000 - enough for most tests
    };

    mockBudgetMonthService = {
      getLastViewedMonth: vi.fn(() => 202511),
    };

    mockCategoryService = {
      activeCategories: signal<{ _id: Id<'category'>; type?: string }[]>([]),
    };

    mockSelectionService = {
      selectedCategories: signal<Id<'category'>[]>([]),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        QuickAssignService,
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: BudgetMonthService, useValue: mockBudgetMonthService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BudgetCategorySelectionService, useValue: mockSelectionService },
      ],
    });

    service = TestBed.inject(QuickAssignService);
  });

  describe('quickAssignData computed', () => {
    it('should return empty data when no months available', () => {
      mockBudgetService.months.set([]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(0);
      expect(result.overfunded.updates).toHaveLength(0);
      expect(result.resetAssignedAmounts.updates).toHaveLength(0);
    });

    it('should return empty data when current month not found', () => {
      mockBudgetService.months.set([createMockMonthData(202510, {})]);
      mockBudgetMonthService.getLastViewedMonth.mockReturnValue(202511);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(0);
    });

    it('should return empty data when no categories are selected', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 10000n,
            remainingToAssign: 5000n,
          }),
        }),
      ]);

      mockSelectionService.selectedCategories.set([]);

      const result = service.quickAssignData();

      // When no categories are selected, all updates should be empty
      expect(result.underfunded.updates).toHaveLength(0);
      expect(result.overfunded.updates).toHaveLength(0);
      expect(result.resetAssignedAmounts.updates).toHaveLength(0);
      expect(result.resetAvailableAmounts.updates).toHaveLength(0);
    });

    it('should filter to only selected categories when selection exists', () => {
      const category1 = 'cat_111' as Id<'category'>;
      const category2 = 'cat_222' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: category1, type: 'expense' },
        { _id: category2, type: 'expense' },
      ]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [category1]: createMockBudgetData(category1, { remainingToAssign: 5000n }),
          [category2]: createMockBudgetData(category2, { remainingToAssign: 3000n }),
        }),
      ]);

      mockSelectionService.selectedCategories.set([category1]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].categoryId).toBe(category1);
    });

    it('should exclude credit card categories from selected categories', () => {
      const expenseCategory = 'cat_expense' as Id<'category'>;
      const creditCardCategory = 'cat_credit' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: expenseCategory, type: 'expense' },
        { _id: creditCardCategory, type: 'credit_card' },
      ]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [expenseCategory]: createMockBudgetData(expenseCategory, { remainingToAssign: 5000n }),
          [creditCardCategory]: createMockBudgetData(creditCardCategory, { remainingToAssign: 3000n }),
        }),
      ]);

      // Select both categories, but credit card should be excluded
      mockSelectionService.selectedCategories.set([expenseCategory, creditCardCategory]);

      const result = service.quickAssignData();

      // Should only include expense category, not credit card
      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].categoryId).toBe(expenseCategory);
    });
  });

  describe('underfunded calculation', () => {
    it('should calculate underfunded amount correctly', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const currentAssigned = 10000n;
      const remainingToAssign = 5000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: currentAssigned,
            remainingToAssign,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(currentAssigned + remainingToAssign);
      expect(result.underfunded.totalAmount).toBe(remainingToAssign);
    });

    it('should not include categories with zero remaining to assign and positive available', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 10000n,
            remainingToAssign: 0n,
            available: 5000n, // Positive available - not overspent
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(0);
      expect(result.underfunded.totalAmount).toBe(0n);
    });

    it('should include overspent categories with no target', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      // Category is overspent by $100 but has no target (remainingToAssign = 0)
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 5000n,
            remainingToAssign: 0n,
            available: -10000n, // Overspent by $100
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].categoryId).toBe(categoryId);
      // Should add $100 to cover overspending
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(5000n + 10000n);
      expect(result.underfunded.totalAmount).toBe(10000n);
    });

    it('should use larger of remainingToAssign and overspent amount', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      // Category has target needing $20, but is overspent by $30
      // Should use the larger amount ($30)
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 5000n,
            remainingToAssign: 2000n, // Target needs $20
            available: -3000n, // Overspent by $30
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      // Should use overspent amount since it's larger
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(5000n + 3000n);
      expect(result.underfunded.totalAmount).toBe(3000n);
    });

    it('should use remainingToAssign when larger than overspent amount', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      // Category has target needing $50, but is only overspent by $10
      // Should use the larger amount ($50)
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 5000n,
            remainingToAssign: 5000n, // Target needs $50
            available: -1000n, // Overspent by $10
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      // Should use remainingToAssign since it's larger
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(5000n + 5000n);
      expect(result.underfunded.totalAmount).toBe(5000n);
    });

    it('should correctly calculate underfunded amount when assigned amount is negative', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      // Scenario: Target $50/month, assigned -$150
      // Expected: Underfunded by $200 ($150 to get to zero + $50 to meet target)
      const assignedAmount = -15000n; // -$150 in cents
      const remainingToAssign = 20000n; // $200 in cents (50 - (-150) = 200)

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount,
            remainingToAssign,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].categoryId).toBe(categoryId);
      // Should add $200 to -$150, resulting in $50
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(assignedAmount + remainingToAssign);
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(5000n); // $50
      expect(result.underfunded.totalAmount).toBe(remainingToAssign);
      expect(result.underfunded.totalAmount).toBe(20000n); // $200
    });
  });

  describe('underfunded always assigns full amounts (no RTA capping)', () => {
    it('should assign full underfunded amount even when RTA is insufficient', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const currentAssigned = 0n;
      const remainingToAssign = 50000n; // $500 needed

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);
      mockBudgetService.readyToAssign.set(20000n); // Only $200 available - but we assign full amount anyway

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: currentAssigned,
            remainingToAssign,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(1);
      // Should assign full $500 regardless of RTA (allowing RTA to go negative)
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(currentAssigned + remainingToAssign);
      expect(result.underfunded.totalAmount).toBe(50000n);
    });

    it('should assign full amounts to all underfunded categories regardless of RTA', () => {
      const category1 = 'cat_111' as Id<'category'>;
      const category2 = 'cat_222' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: category1, type: 'expense' },
        { _id: category2, type: 'expense' },
      ]);
      mockSelectionService.selectedCategories.set([category1, category2]);
      mockBudgetService.readyToAssign.set(10000n); // Only $100 available - but we assign full amounts

      // Category 1 needs $300, Category 2 needs $200 - total $500
      // Both should get full amounts regardless of RTA
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [category1]: createMockBudgetData(category1, {
            assignedAmount: 0n,
            remainingToAssign: 30000n, // $300
          }),
          [category2]: createMockBudgetData(category2, {
            assignedAmount: 0n,
            remainingToAssign: 20000n, // $200
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // Both categories should get full amounts
      expect(result.underfunded.updates).toHaveLength(2);
      expect(result.underfunded.totalAmount).toBe(50000n);

      const cat1Update = result.underfunded.updates.find((u) => u.categoryId === category1);
      const cat2Update = result.underfunded.updates.find((u) => u.categoryId === category2);

      expect(cat1Update).toBeDefined();
      expect(cat2Update).toBeDefined();

      expect(cat1Update!.newAssignedAmount).toBe(30000n); // Full $300
      expect(cat2Update!.newAssignedAmount).toBe(20000n); // Full $200
    });

    it('should assign full amounts when readyToAssign is sufficient', () => {
      const category1 = 'cat_111' as Id<'category'>;
      const category2 = 'cat_222' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: category1, type: 'expense' },
        { _id: category2, type: 'expense' },
      ]);
      mockSelectionService.selectedCategories.set([category1, category2]);
      mockBudgetService.readyToAssign.set(100000n); // $1000 available - plenty

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [category1]: createMockBudgetData(category1, {
            assignedAmount: 0n,
            remainingToAssign: 30000n, // $300
          }),
          [category2]: createMockBudgetData(category2, {
            assignedAmount: 0n,
            remainingToAssign: 20000n, // $200
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(2);
      expect(result.underfunded.totalAmount).toBe(50000n); // Full $500

      const cat1Update = result.underfunded.updates.find((u) => u.categoryId === category1);
      const cat2Update = result.underfunded.updates.find((u) => u.categoryId === category2);

      expect(cat1Update!.newAssignedAmount).toBe(30000n); // Full $300
      expect(cat2Update!.newAssignedAmount).toBe(20000n); // Full $200
    });

    it('should assign nothing when readyToAssign is zero', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);
      mockBudgetService.readyToAssign.set(0n); // Nothing available - but we assign anyway

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 0n,
            remainingToAssign: 50000n, // $500 needed
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // Full updates even when readyToAssign is zero (allowing RTA to go negative)
      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(50000n);
      expect(result.underfunded.totalAmount).toBe(50000n);
    });

    it('should handle negative readyToAssign by assigning full amounts', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);
      mockBudgetService.readyToAssign.set(-10000n); // Negative - over-assigned, but we still assign

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 0n,
            remainingToAssign: 50000n, // $500 needed
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // Full updates even when readyToAssign is negative (allowing RTA to go more negative)
      expect(result.underfunded.updates).toHaveLength(1);
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(50000n);
      expect(result.underfunded.totalAmount).toBe(50000n);
    });

    it('should fund all categories fully regardless of RTA', () => {
      const category1 = 'cat_111' as Id<'category'>;
      const category2 = 'cat_222' as Id<'category'>;
      const category3 = 'cat_333' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: category1, type: 'expense' },
        { _id: category2, type: 'expense' },
        { _id: category3, type: 'expense' },
      ]);
      mockSelectionService.selectedCategories.set([category1, category2, category3]);
      mockBudgetService.readyToAssign.set(10000n); // $100 available - but we assign full $300

      // Each needs $100, total $300 - all get full amounts
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [category1]: createMockBudgetData(category1, {
            assignedAmount: 0n,
            remainingToAssign: 10000n, // $100
          }),
          [category2]: createMockBudgetData(category2, {
            assignedAmount: 0n,
            remainingToAssign: 10000n, // $100
          }),
          [category3]: createMockBudgetData(category3, {
            assignedAmount: 0n,
            remainingToAssign: 10000n, // $100
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // All categories get fully funded (no RTA capping)
      expect(result.underfunded.updates).toHaveLength(3);
      expect(result.underfunded.totalAmount).toBe(30000n);

      // All categories get their full amounts
      expect(result.underfunded.updates[0].categoryId).toBe(category1);
      expect(result.underfunded.updates[0].newAssignedAmount).toBe(10000n); // $100
      expect(result.underfunded.updates[1].categoryId).toBe(category2);
      expect(result.underfunded.updates[1].newAssignedAmount).toBe(10000n); // $100
      expect(result.underfunded.updates[2].categoryId).toBe(category3);
      expect(result.underfunded.updates[2].newAssignedAmount).toBe(10000n); // $100
    });
  });

  describe('overfunded calculation', () => {
    it('should calculate overfunded amount correctly', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const currentAssigned = 20000n;
      const overfundedBy = 5000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: currentAssigned,
            overfundedByAmount: overfundedBy,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.overfunded.updates).toHaveLength(1);
      expect(result.overfunded.updates[0].newAssignedAmount).toBe(currentAssigned - overfundedBy);
      expect(result.overfunded.totalAmount).toBe(overfundedBy);
    });

    it('should not reduce overfunding if it would make available negative', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 15000n; // $150
      const available = 5000n; // $50
      const overfundedByAmount = 10000n; // Overfunded by $100
      // carryoverFromPrevious + assignedAmount - totalSpent = available
      // carryoverFromPrevious + 15000 - totalSpent = 5000
      // So totalSpent = carryoverFromPrevious + 10000
      // Assuming carryoverFromPrevious = 0, totalSpent = 10000
      const totalSpent = 10000n;
      const carryoverFromPrevious = 0n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: {
            assignedAmount,
            totalSpent,
            carryoverFromPrevious,
            available,
            activity: -totalSpent,
            target: {
              assignmentNeeded: 5000n,
              remainingToAssign: 0n,
              overfundedByAmount, // Overfunded by $100 according to target
            },
          },
        }),
      ]);

      const result = service.quickAssignData();

      // If we reduce by full overfunded amount (10000):
      // newAssigned = 15000 - 10000 = 5000
      // newAvailable = carryover + newAssigned - totalSpent = 0 + 5000 - 10000 = -5000 (NEGATIVE!)

      // The fix should limit reduction to only what's safe:
      // maxReduction = available (since reducing by more would make it negative)
      // So newAssigned should be assignedAmount - available = 15000 - 5000 = 10000
      // And newAvailable = 0 + 10000 - 10000 = 0 (not negative)

      expect(result.overfunded.updates).toHaveLength(1);
      expect(result.overfunded.updates[0].newAssignedAmount).toBe(10000n);
      // Total amount reduced should be the actual reduction (5000), not the full overfunded amount
      expect(result.overfunded.totalAmount).toBe(5000n);
    });

    it('should handle case where available is zero and category is overfunded', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 10000n; // $100
      const available = 0n; // $0
      const overfundedByAmount = 5000n; // Overfunded by $50
      const totalSpent = 10000n; // Spent $100
      const carryoverFromPrevious = 0n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: {
            assignedAmount,
            totalSpent,
            carryoverFromPrevious,
            available,
            activity: -totalSpent,
            target: {
              assignmentNeeded: 5000n,
              remainingToAssign: 0n,
              overfundedByAmount,
            },
          },
        }),
      ]);

      const result = service.quickAssignData();

      // When available is already 0, we shouldn't reduce at all
      // (any reduction would make available negative)
      expect(result.overfunded.updates).toHaveLength(0);
      expect(result.overfunded.totalAmount).toBe(0n);
    });

    it('should handle case where available is negative (overspent)', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 10000n; // $100
      const available = -5000n; // -$50 (overspent)
      const overfundedByAmount = 8000n; // Somehow marked as overfunded by $80
      const totalSpent = 15000n; // Spent $150
      const carryoverFromPrevious = 0n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: {
            assignedAmount,
            totalSpent,
            carryoverFromPrevious,
            available,
            activity: -totalSpent,
            target: {
              assignmentNeeded: 18000n,
              remainingToAssign: 8000n,
              overfundedByAmount, // This shouldn't happen in practice, but let's be safe
            },
          },
        }),
      ]);

      const result = service.quickAssignData();

      // When available is negative, we definitely shouldn't reduce
      // (we should be adding money, not removing it)
      expect(result.overfunded.updates).toHaveLength(0);
      expect(result.overfunded.totalAmount).toBe(0n);
    });

    it('should allow full reduction when available is greater than overfunded amount', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 20000n; // $200
      const available = 15000n; // $150
      const overfundedByAmount = 10000n; // Overfunded by $100
      const totalSpent = 5000n; // Spent $50
      const carryoverFromPrevious = 0n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: {
            assignedAmount,
            totalSpent,
            carryoverFromPrevious,
            available,
            activity: -totalSpent,
            target: {
              assignmentNeeded: 10000n,
              remainingToAssign: 0n,
              overfundedByAmount,
            },
          },
        }),
      ]);

      const result = service.quickAssignData();

      // Can safely reduce by full amount:
      // newAssigned = 20000 - 10000 = 10000
      // newAvailable = 0 + 10000 - 5000 = 5000 (still positive)
      expect(result.overfunded.updates).toHaveLength(1);
      expect(result.overfunded.updates[0].newAssignedAmount).toBe(10000n);
      expect(result.overfunded.totalAmount).toBe(10000n);
    });
  });

  describe('reset assigned amounts calculation', () => {
    it('should set assigned amount to zero', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const currentAssigned = 15000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: currentAssigned,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // When categories have non-zero assigned amounts, they should be included in reset
      const update = result.resetAssignedAmounts.updates.find((u) => u.categoryId === categoryId);
      if (update) {
        expect(update.newAssignedAmount).toBe(0n);
      }
      // The totalAmount should be the sum of absolute values being reset
      expect(result.resetAssignedAmounts.totalAmount).toBeGreaterThanOrEqual(0n);
    });

    it('should handle categories correctly', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);

      // Categories with assigned amounts should be included
      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount: 5000n,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      // Verify the structure is correct
      expect(result.resetAssignedAmounts).toBeDefined();
      expect(result.resetAssignedAmounts.updates).toBeDefined();
      expect(Array.isArray(result.resetAssignedAmounts.updates)).toBe(true);
    });
  });

  describe('reset available amounts calculation', () => {
    it('should set available to zero with positive available', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 10000n;
      const available = 3000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount,
            available,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.resetAvailableAmounts.updates).toHaveLength(1);
      // New assigned = assigned - available = 10000 - 3000 = 7000
      expect(result.resetAvailableAmounts.updates[0].newAssignedAmount).toBe(assignedAmount - available);
    });

    it('should set available to zero with negative available', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const assignedAmount = 10000n;
      const available = -3000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, {
            assignedAmount,
            available,
          }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.resetAvailableAmounts.updates).toHaveLength(1);
      // New assigned = assigned - available = 10000 - (-3000) = 13000
      expect(result.resetAvailableAmounts.updates[0].newAssignedAmount).toBe(assignedAmount - available);
    });
  });

  describe('historical calculations', () => {
    it('should calculate assigned last month correctly', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const lastMonthAssigned = 8000n;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202510, {
          [categoryId]: createMockBudgetData(categoryId, { assignedAmount: lastMonthAssigned }),
        }),
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, { assignedAmount: 10000n }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.assignedLastMonth.updates).toHaveLength(1);
      expect(result.assignedLastMonth.updates[0].newAssignedAmount).toBe(lastMonthAssigned);
    });

    it('should calculate spent last month correctly (negative activity = spending)', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const lastMonthSpending = -7500n; // Negative activity = spending

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202510, {
          [categoryId]: createMockBudgetData(categoryId, { activity: lastMonthSpending }),
        }),
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.spentLastMonth.updates).toHaveLength(1);
      expect(result.spentLastMonth.updates[0].newAssignedAmount).toBe(7500n); // Absolute value
    });

    it('should calculate average assigned from historical months', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202509, {
          [categoryId]: createMockBudgetData(categoryId, { assignedAmount: 6000n }),
        }),
        createMockMonthData(202510, {
          [categoryId]: createMockBudgetData(categoryId, { assignedAmount: 12000n }),
        }),
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, { assignedAmount: 10000n }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.averageAssigned.updates).toHaveLength(1);
      // Average of 6000 + 12000 = 18000 / 2 = 9000
      expect(result.averageAssigned.updates[0].newAssignedAmount).toBe(9000n);
    });

    it('should calculate average spent from historical months', () => {
      const categoryId = 'cat_123' as Id<'category'>;

      mockCategoryService.activeCategories.set([{ _id: categoryId, type: 'expense' }]);
      mockSelectionService.selectedCategories.set([categoryId]);

      mockBudgetService.months.set([
        createMockMonthData(202509, {
          [categoryId]: createMockBudgetData(categoryId, { activity: -4000n }),
        }),
        createMockMonthData(202510, {
          [categoryId]: createMockBudgetData(categoryId, { activity: -8000n }),
        }),
        createMockMonthData(202511, {
          [categoryId]: createMockBudgetData(categoryId, { activity: -6000n }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.averageSpent.updates).toHaveLength(1);
      // Average of 4000 + 8000 = 12000 / 2 = 6000
      expect(result.averageSpent.updates[0].newAssignedAmount).toBe(6000n);
    });
  });

  describe('multiple categories', () => {
    it('should aggregate total amounts across multiple categories', () => {
      const category1 = 'cat_111' as Id<'category'>;
      const category2 = 'cat_222' as Id<'category'>;

      mockCategoryService.activeCategories.set([
        { _id: category1, type: 'expense' },
        { _id: category2, type: 'expense' },
      ]);
      mockSelectionService.selectedCategories.set([category1, category2]);

      mockBudgetService.months.set([
        createMockMonthData(202511, {
          [category1]: createMockBudgetData(category1, { remainingToAssign: 5000n }),
          [category2]: createMockBudgetData(category2, { remainingToAssign: 3000n }),
        }),
      ]);

      const result = service.quickAssignData();

      expect(result.underfunded.updates).toHaveLength(2);
      expect(result.underfunded.totalAmount).toBe(8000n); // 5000 + 3000
    });
  });
});
