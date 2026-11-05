import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BankAccountService } from '../../services/bank-account.service';
import { BudgetCategorySelectionService } from '../../services/budget-category-selection.service';
import { BudgetFilterService } from '../../services/budget-filter.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetMonthData, BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { ConvexService } from '../../services/convex.service';
import { IconService } from '../../services/icon.service';
import { WorkspaceService } from '../../services/workspace.service';
import { BudgetComponent } from './budget';
import budgetTemplate from './budget.html?raw';

describe('BudgetComponent', () => {
  // Helper to create IDs
  const catId = (id: string) => `cat_${id}` as Id<'category'>;
  const groupId = (id: string) => `group_${id}` as Id<'categoryGroup'>;

  // Mock services
  let mockCategoryService: {
    categoryHierarchy: ReturnType<typeof signal>;
    setCategoryFavorite: ReturnType<typeof vi.fn>;
  };

  let mockBudgetService: {
    readyToAssign: ReturnType<typeof signal>;
    months: ReturnType<typeof signal>;
    availableRange: ReturnType<typeof signal>;
  };

  let mockBankAccountService: {
    bankAccounts: ReturnType<typeof signal>;
  };

  let mockBudgetMonthService: {
    parseQueryParam: ReturnType<typeof vi.fn>;
    setLastViewedMonth: ReturnType<typeof vi.fn>;
  };

  let mockBudgetFilterService: {
    setLastFilter: ReturnType<typeof vi.fn>;
  };

  let mockUserPreferencesService: {
    budgetSidebarOpen: ReturnType<typeof signal>;
    getBudgetGroupCollapsedState: ReturnType<typeof vi.fn>;
    setBudgetGroupCollapsedState: ReturnType<typeof vi.fn>;
    getHiddenCategoriesVisibleState: ReturnType<typeof vi.fn>;
    setHiddenCategoriesVisibleState: ReturnType<typeof vi.fn>;
  };

  let mockIconService: {
    getIconByName: ReturnType<typeof vi.fn>;
  };

  let mockConvexService: {
    mutation: ReturnType<typeof vi.fn>;
  };

  let mockWorkspaceService: {
    workspaceId: ReturnType<typeof signal<string | null>>;
  };

  let mockSelectionService: {
    selectedCategories: ReturnType<typeof signal>;
    getAllCategoryIds: ReturnType<typeof vi.fn>;
    isCategorySelected: ReturnType<typeof vi.fn>;
    setVisibleCategoryIds: ReturnType<typeof vi.fn>;
  };

  // Helper to create budget data for a category
  const createCategoryBudget = (
    assigned: bigint,
    activity: bigint,
    available: bigint,
    carryover = 0n,
    options: {
      remainingToAssign?: bigint;
      overfundedByAmount?: bigint;
      underfundedAmount?: bigint;
    } = {}
  ): BudgetMonthData['budgetData'][string] => {
    const remainingToAssign = options.remainingToAssign ?? 0n;
    // Calculate underfundedAmount if not explicitly provided
    const underfundedAmount = options.underfundedAmount ?? remainingToAssign;

    return {
      assignedAmount: assigned,
      activity,
      available,
      carryoverFromPrevious: carryover,
      target: {
        remainingToAssign,
        overfundedByAmount: options.overfundedByAmount ?? 0n,
        underfundedAmount,
        type: 'none',
        targetAmount: null,
        targetMonthlyAmount: null,
        isTargetMet: true,
        monthlyContribution: null,
        targetDate: null,
        targetDayOfMonth: null,
        percentComplete: 100,
        monthsRemaining: null,
      },
    };
  };

  // Helper to create category hierarchy
  const createCategoryHierarchy = () => [
    {
      group: {
        _id: groupId('1'),
        name: 'Group 1',
        isDeleted: false,
        sortOrder: 1,
        type: 'expense',
      },
      categories: [
        {
          _id: catId('1'),
          name: 'Category 1',
          isDeleted: false,
          sortOrder: 1,
          categoryType: null,
          bankAccountId: null,
          iconName: null,
          isFavorite: false,
        },
        {
          _id: catId('2'),
          name: 'Category 2',
          isDeleted: false,
          sortOrder: 2,
          categoryType: null,
          bankAccountId: null,
          iconName: null,
          isFavorite: false,
        },
      ],
    },
    {
      group: {
        _id: groupId('2'),
        name: 'Group 2',
        isDeleted: false,
        sortOrder: 2,
        type: 'expense',
      },
      categories: [
        {
          _id: catId('3'),
          name: 'Category 3',
          isDeleted: false,
          sortOrder: 1,
          categoryType: null,
          bankAccountId: null,
          iconName: null,
          isFavorite: false,
        },
        {
          _id: catId('4'),
          name: 'Category 4',
          isDeleted: false,
          sortOrder: 2,
          categoryType: null,
          bankAccountId: null,
          iconName: null,
          isFavorite: false,
        },
      ],
    },
  ];

  // Get current year-month for testing
  const getCurrentYearMonth = () => {
    const now = new Date();
    return now.getFullYear() * 100 + (now.getMonth() + 1);
  };

  beforeEach(() => {
    const currentYearMonth = getCurrentYearMonth();

    mockCategoryService = {
      categoryHierarchy: signal(createCategoryHierarchy()),
      setCategoryFavorite: vi.fn().mockResolvedValue(true),
    };

    mockBudgetService = {
      readyToAssign: signal(100000n),
      months: signal([
        {
          yearMonth: currentYearMonth,
          budgetData: {
            [catId('1')]: createCategoryBudget(100_00n, -50_00n, 50_00n, 0n),
            [catId('2')]: createCategoryBudget(200_00n, -100_00n, -50_00n, 50_00n), // Overspent
            [catId('3')]: createCategoryBudget(
              50_00n,
              0n,
              50_00n,
              0n,
              { remainingToAssign: 50_00n } // Underfunded
            ),
            [catId('4')]: createCategoryBudget(
              300_00n,
              -50_00n,
              250_00n,
              0n,
              { overfundedByAmount: 100_00n } // Extra funded
            ),
          },
        },
      ]),
      availableRange: signal({
        minYearMonth: currentYearMonth - 100,
        maxYearMonth: currentYearMonth + 100,
      }),
    };

    mockBankAccountService = {
      bankAccounts: signal([]),
    };

    mockBudgetMonthService = {
      parseQueryParam: vi.fn().mockReturnValue(null),
      setLastViewedMonth: vi.fn(),
    };

    mockBudgetFilterService = {
      setLastFilter: vi.fn(),
    };

    mockUserPreferencesService = {
      budgetSidebarOpen: signal(false),
      getBudgetGroupCollapsedState: vi.fn().mockReturnValue(false),
      setBudgetGroupCollapsedState: vi.fn(),
      getHiddenCategoriesVisibleState: vi.fn().mockReturnValue(false),
      setHiddenCategoriesVisibleState: vi.fn(),
    };

    mockIconService = {
      getIconByName: vi.fn().mockReturnValue(null),
    };

    mockConvexService = {
      mutation: vi.fn().mockResolvedValue({ success: true }),
    };

    mockWorkspaceService = {
      workspaceId: signal('workspace_1'),
    };

    mockSelectionService = {
      selectedCategories: signal([]),
      getAllCategoryIds: vi.fn().mockReturnValue([]),
      isCategorySelected: vi.fn().mockReturnValue(signal(false)),
      setVisibleCategoryIds: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: BankAccountService, useValue: mockBankAccountService },
        { provide: BudgetMonthService, useValue: mockBudgetMonthService },
        { provide: BudgetFilterService, useValue: mockBudgetFilterService },
        { provide: UserPreferencesService, useValue: mockUserPreferencesService },
        { provide: IconService, useValue: mockIconService },
        { provide: ConvexService, useValue: mockConvexService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: BudgetCategorySelectionService, useValue: mockSelectionService },
      ],
    });
  });

  describe('header layout', () => {
    it('keeps search and sidebar controls aligned to the right edge', () => {
      expect(budgetTemplate).toContain('<div class="ml-auto flex shrink-0 items-center justify-end gap-2">');
      expect(budgetTemplate).toContain('<app-budget-sidebar-toggle />');
    });

    it('places budget history with the table header actions', () => {
      expect(budgetTemplate).toMatch(
        /<app-add-category-group-button\s*\/>\s*<app-budget-history-popover\s*\/>\s*@if \(favoriteCount\(\) > 0\)/
      );
    });
  });

  describe('category context menu target snooze', () => {
    it('renders snooze and unsnooze labels only for categories with a target', () => {
      expect(budgetTemplate).toContain('@if (hasCategoryTarget(categoryId))');
      expect(budgetTemplate).toContain("isCategoryTargetSnoozed(categoryId) ? 'Unsnooze Target' : 'Snooze Target'");
    });

    it('snoozes an active target for the selected month', async () => {
      const hierarchy = createCategoryHierarchy();
      Object.assign(hierarchy[0].categories[0], {
        enableTarget: true,
        target_type: 'monthly',
      });
      mockCategoryService.categoryHierarchy.set(hierarchy);
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      await component.onToggleCategoryTargetSnooze(catId('1'));

      expect(mockConvexService.mutation).toHaveBeenCalledWith(api.categoryBudgets.toggleTargetSnooze, {
        workspaceId: 'workspace_1',
        categoryId: catId('1'),
        yearMonth: getCurrentYearMonth(),
        snoozed: true,
      });
    });

    it('unsnoozes an already snoozed target', async () => {
      const hierarchy = createCategoryHierarchy();
      Object.assign(hierarchy[0].categories[0], {
        enableTarget: true,
        target_type: 'monthly',
      });
      mockCategoryService.categoryHierarchy.set(hierarchy);
      const month = (
        mockBudgetService.months() as {
          yearMonth: number;
          budgetData: BudgetMonthData['budgetData'];
        }[]
      )[0];
      mockBudgetService.months.set([
        {
          ...month,
          budgetData: {
            ...month.budgetData,
            [catId('1')]: {
              ...month.budgetData[catId('1')],
              target: {
                ...month.budgetData[catId('1')].target,
                isSnoozed: true,
              },
            },
          },
        },
      ]);
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      await component.onToggleCategoryTargetSnooze(catId('1'));

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        api.categoryBudgets.toggleTargetSnooze,
        expect.objectContaining({ categoryId: catId('1'), snoozed: false })
      );
    });

    it('does not snooze a category without an active target', async () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      await component.onToggleCategoryTargetSnooze(catId('1'));

      expect(mockConvexService.mutation).not.toHaveBeenCalled();
    });
  });

  describe('page sizing', () => {
    it('contains the table scroller within the routed page host', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const host = fixture.nativeElement as HTMLElement;

      expect(host.classList.contains('min-w-0')).toBe(true);
      expect(host.classList.contains('max-w-full')).toBe(true);
      expect(host.classList.contains('overflow-hidden')).toBe(true);
    });
  });

  describe('groupTotals with filtering', () => {
    it('should calculate totals for all categories when filter is "all"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      // Default filter is 'all'
      expect(component.activeFilter()).toBe('all');

      const totals = component.groupTotals();

      // Group 1: Cat1 (100, -50, 50, 0) + Cat2 (200, -100, -50, 50)
      expect(totals[groupId('1')]).toEqual({
        assigned: 300_00n,
        activity: -150_00n,
        available: 0n,
        carryOver: 50_00n,
      });

      // Group 2: Cat3 (50, 0, 50, 0) + Cat4 (300, -50, 250, 0)
      expect(totals[groupId('2')]).toEqual({
        assigned: 350_00n,
        activity: -50_00n,
        available: 300_00n,
        carryOver: 0n,
      });
    });

    it('should calculate totals only for overspent categories when filter is "overspent"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('overspent');

      const totals = component.groupTotals();

      // Only Cat2 is overspent (available < 0)
      // Group 1 should only include Cat2
      expect(totals[groupId('1')]).toEqual({
        assigned: 200_00n,
        activity: -100_00n,
        available: -50_00n,
        carryOver: 50_00n,
      });

      // Group 2 has no overspent categories, so it shouldn't appear
      expect(totals[groupId('2')]).toBeUndefined();
    });

    it('should calculate totals only for underfunded categories when filter is "underfunded"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('underfunded');

      const totals = component.groupTotals();

      // Group 1 has no underfunded categories
      expect(totals[groupId('1')]).toBeUndefined();

      // Only Cat3 is underfunded (remainingToAssign > 0)
      expect(totals[groupId('2')]).toEqual({
        assigned: 50_00n,
        activity: 0n,
        available: 50_00n,
        carryOver: 0n,
      });
    });

    it('should calculate totals only for categories with available balance when filter is "available"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('available');

      const totals = component.groupTotals();

      // Cat1 has available > 0 (50)
      expect(totals[groupId('1')]).toEqual({
        assigned: 100_00n,
        activity: -50_00n,
        available: 50_00n,
        carryOver: 0n,
      });

      // Cat3 (50) and Cat4 (250) have available > 0
      expect(totals[groupId('2')]).toEqual({
        assigned: 350_00n,
        activity: -50_00n,
        available: 300_00n,
        carryOver: 0n,
      });
    });

    it('should calculate totals only for extra funded categories when filter is "extraFunded"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('extraFunded');

      const totals = component.groupTotals();

      // Group 1 has no extra funded categories
      expect(totals[groupId('1')]).toBeUndefined();

      // Only Cat4 is extra funded (overfundedByAmount > 0)
      expect(totals[groupId('2')]).toEqual({
        assigned: 300_00n,
        activity: -50_00n,
        available: 250_00n,
        carryOver: 0n,
      });
    });

    it('should filter by search query', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      // Search for "Category 1"
      component.searchQuery.set('Category 1');

      const totals = component.groupTotals();

      // Only Cat1 matches the search
      expect(totals[groupId('1')]).toEqual({
        assigned: 100_00n,
        activity: -50_00n,
        available: 50_00n,
        carryOver: 0n,
      });

      // Group 2 has no matching categories
      expect(totals[groupId('2')]).toBeUndefined();
    });

    it('should combine filter and search', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      // Filter for available and search for "Category"
      component.activeFilter.set('available');
      component.searchQuery.set('Category 3');

      const totals = component.groupTotals();

      // Group 1 has no matching categories (Cat1 has available but doesn't match search)
      expect(totals[groupId('1')]).toBeUndefined();

      // Only Cat3 matches both filter and search
      expect(totals[groupId('2')]).toEqual({
        assigned: 50_00n,
        activity: 0n,
        available: 50_00n,
        carryOver: 0n,
      });
    });
  });

  describe('grandTotals with filtering', () => {
    it('should calculate grand totals for all categories when filter is "all"', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      const grandTotals = component.grandTotals();

      // All 4 categories combined
      expect(grandTotals).toEqual({
        assigned: 650_00n, // 100 + 200 + 50 + 300
        activity: -200_00n, // -50 + -100 + 0 + -50
        available: 300_00n, // 50 + -50 + 50 + 250
        carryOver: 50_00n, // 0 + 50 + 0 + 0
      });
    });

    it('should calculate grand totals only for overspent categories', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('overspent');

      const grandTotals = component.grandTotals();

      // Only Cat2 is overspent
      expect(grandTotals).toEqual({
        assigned: 200_00n,
        activity: -100_00n,
        available: -50_00n,
        carryOver: 50_00n,
      });
    });

    it('should calculate grand totals only for underfunded categories', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('underfunded');

      const grandTotals = component.grandTotals();

      // Only Cat3 is underfunded
      expect(grandTotals).toEqual({
        assigned: 50_00n,
        activity: 0n,
        available: 50_00n,
        carryOver: 0n,
      });
    });

    it('should calculate grand totals only for categories with available balance', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('available');

      const grandTotals = component.grandTotals();

      // Cat1, Cat3, Cat4 have available > 0
      expect(grandTotals).toEqual({
        assigned: 450_00n, // 100 + 50 + 300
        activity: -100_00n, // -50 + 0 + -50
        available: 350_00n, // 50 + 50 + 250
        carryOver: 0n,
      });
    });

    it('should calculate grand totals only for extra funded categories', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('extraFunded');

      const grandTotals = component.grandTotals();

      // Only Cat4 is extra funded
      expect(grandTotals).toEqual({
        assigned: 300_00n,
        activity: -50_00n,
        available: 250_00n,
        carryOver: 0n,
      });
    });

    it('should calculate grand totals with search filter', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      // Search for categories containing "2" or "3"
      component.searchQuery.set('Category 2');

      const grandTotals = component.grandTotals();

      // Only Cat2 matches
      expect(grandTotals).toEqual({
        assigned: 200_00n,
        activity: -100_00n,
        available: -50_00n,
        carryOver: 50_00n,
      });
    });

    it('should return zero totals when no categories match filter', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      // Search for something that doesn't exist
      component.searchQuery.set('nonexistent');

      const grandTotals = component.grandTotals();

      expect(grandTotals).toEqual({
        assigned: 0n,
        activity: 0n,
        available: 0n,
        carryOver: 0n,
      });
    });
  });

  describe('filterCounts', () => {
    it('should exclude archived categories from tab counts until their hidden section is shown', () => {
      const hierarchy = createCategoryHierarchy();
      hierarchy[0].categories[1] = {
        ...hierarchy[0].categories[1],
        isArchived: true,
      };
      mockCategoryService.categoryHierarchy.set(hierarchy);

      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      expect(component.filterCounts()).toEqual({
        all: 3,
        overspent: 0,
        underfunded: 1,
        available: 3,
        extraFunded: 1,
      });

      const allFilter = component.responsiveFilters().find((filterConfig) => filterConfig.id === 'all');
      expect(allFilter?.count).toBe(3);

      component.onHiddenCategoriesExpandedChange(groupId('1'), true);

      expect(component.filterCounts()).toEqual({
        all: 4,
        overspent: 1,
        underfunded: 1,
        available: 3,
        extraFunded: 1,
      });

      const shownAllFilter = component.responsiveFilters().find((filterConfig) => filterConfig.id === 'all');
      expect(shownAllFilter?.count).toBe(4);
    });
  });

  describe('filteredCategoryGroups', () => {
    it('should return all groups and categories when filter is "all" and no search', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      const filtered = component.filteredCategoryGroups();

      expect(filtered).toHaveLength(2);
      expect(filtered[0].categories).toHaveLength(2);
      expect(filtered[1].categories).toHaveLength(2);
    });

    it('should exclude groups with no matching categories', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.activeFilter.set('overspent');

      const filtered = component.filteredCategoryGroups();

      // Only Group 1 has overspent category (Cat2)
      expect(filtered).toHaveLength(1);
      expect(filtered[0].group._id).toBe(groupId('1'));
      expect(filtered[0].categories).toHaveLength(1);
      expect(filtered[0].categories[0]._id).toBe(catId('2'));
    });

    it('should include all categories matching group name search', () => {
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.searchQuery.set('Group 2');

      const filtered = component.filteredCategoryGroups();

      // Searching for group name should include all categories in that group
      expect(filtered).toHaveLength(1);
      expect(filtered[0].group._id).toBe(groupId('2'));
      expect(filtered[0].categories).toHaveLength(2);
    });

    it('should show only favorited categories when the heart filter is active', () => {
      const hierarchy = createCategoryHierarchy();
      hierarchy[0].categories[0].isFavorite = true;
      mockCategoryService.categoryHierarchy.set(hierarchy);
      const fixture = TestBed.createComponent(BudgetComponent);
      const component = fixture.componentInstance;

      component.favoriteOnly.set(true);

      const filtered = component.filteredCategoryGroups();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].categories.map((category) => category._id)).toEqual([catId('1')]);
      expect(component.isDragDropDisabled()).toBe(true);
    });
  });
});
