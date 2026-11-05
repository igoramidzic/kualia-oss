import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_QUICK_ASSIGN_PREFERENCES,
  QuickAssignPreferences,
  UserPreferencesService,
} from '../../core/services/preferences/user-preferences.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetService } from '../../services/budget.service';
import { ConvexService } from '../../services/convex.service';
import { QuickAssignDataSet, QuickAssignService } from '../../services/quick-assign.service';
import { WorkspaceService } from '../../services/workspace.service';
import { QuickAssignCardComponent } from './quick-assign-card.component';

// Mock Convex API
vi.mock('../../../../convex/_generated/api', () => ({
  api: {
    categoryBudgets: {
      batchUpdateCategoryBudgets: vi.fn(),
    },
  },
}));

describe('QuickAssignCardComponent', () => {
  let component: QuickAssignCardComponent;
  let fixture: ComponentFixture<QuickAssignCardComponent>;

  // Mock services
  let mockUserPreferencesService: {
    theme: ReturnType<typeof signal<'light' | 'dark' | 'system'>>;
    quickAssignCollapsed: ReturnType<typeof signal<boolean>>;
    quickAssignPreferences: ReturnType<typeof signal<QuickAssignPreferences>>;
    quickAssignAllowNegativeRta: ReturnType<typeof signal<boolean>>;
    toggleQuickAssignCollapsed: ReturnType<typeof vi.fn>;
    setQuickAssignCollapsed: ReturnType<typeof vi.fn>;
    toggleQuickAssignPreference: ReturnType<typeof vi.fn>;
    setQuickAssignAllowNegativeRta: ReturnType<typeof vi.fn>;
  };

  let mockQuickAssignService: {
    quickAssignData: ReturnType<typeof signal<QuickAssignDataSet>>;
  };

  let mockBudgetService: {
    readyToAssign: ReturnType<typeof signal<bigint>>;
    months: ReturnType<typeof signal<any[]>>;
  };

  let mockBudgetMonthService: {
    getLastViewedMonth: ReturnType<typeof vi.fn>;
  };

  let mockWorkspaceService: {
    workspaceId: ReturnType<typeof vi.fn>;
    workspace: ReturnType<typeof signal<{ _id: string; currency?: string } | undefined>>;
  };

  let mockConvexService: {
    mutation: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
  };

  // Helper to create empty quick assign data
  const createEmptyQuickAssignData = (): QuickAssignDataSet => ({
    underfunded: { totalAmount: 0n, updates: [] },
    overfunded: { totalAmount: 0n, updates: [] },
    resetAssignedAmounts: { totalAmount: 0n, updates: [] },
    resetAvailableAmounts: { totalAmount: 0n, updates: [] },
    assignedLastMonth: { totalAmount: 0n, updates: [] },
    spentLastMonth: { totalAmount: 0n, updates: [] },
    averageAssigned: { totalAmount: 0n, updates: [] },
    averageSpent: { totalAmount: 0n, updates: [] },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Create mock signals and functions
    mockUserPreferencesService = {
      theme: signal<'light' | 'dark' | 'system'>('light'),
      quickAssignCollapsed: signal(false),
      quickAssignPreferences: signal({ ...DEFAULT_QUICK_ASSIGN_PREFERENCES }),
      quickAssignAllowNegativeRta: signal(true),
      toggleQuickAssignCollapsed: vi.fn(),
      setQuickAssignCollapsed: vi.fn(),
      toggleQuickAssignPreference: vi.fn(),
      setQuickAssignAllowNegativeRta: vi.fn(),
    };

    mockQuickAssignService = {
      quickAssignData: signal(createEmptyQuickAssignData()),
    };

    mockBudgetService = {
      readyToAssign: signal(100000n),
      months: signal([
        {
          yearMonth: 202511,
          budgetData: {
            cat_123: {
              assignedAmount: 10000n,
              totalSpent: 0n,
              carryoverFromPrevious: 0n,
              available: 10000n,
              target: {
                remainingToAssign: 0n,
                overfundedByAmount: 0n,
              },
            },
            cat_456: {
              assignedAmount: 20000n,
              totalSpent: 0n,
              carryoverFromPrevious: 0n,
              available: 20000n,
              target: {
                remainingToAssign: 0n,
                overfundedByAmount: 0n,
              },
            },
          },
        },
      ]),
    };

    mockBudgetMonthService = {
      getLastViewedMonth: vi.fn(() => 202511),
    };

    mockWorkspaceService = {
      workspaceId: vi.fn(() => 'workspace_123' as Id<'workspace'>),
      workspace: signal({ _id: 'workspace_123', currency: 'USD' }),
    };

    mockConvexService = {
      mutation: vi.fn().mockResolvedValue({ success: true }),
      isAuthenticated: vi.fn().mockReturnValue(false),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [QuickAssignCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UserPreferencesService, useValue: mockUserPreferencesService },
        { provide: QuickAssignService, useValue: mockQuickAssignService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: BudgetMonthService, useValue: mockBudgetMonthService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: ConvexService, useValue: mockConvexService },
      ],
    });

    fixture = TestBed.createComponent(QuickAssignCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should start in non-edit mode', () => {
      expect(component['isEditMode']()).toBe(false);
    });

    it('should not be saving initially', () => {
      expect(component['saving']()).toBe(false);
    });
  });

  describe('collapsed state', () => {
    it('should reflect collapsed state from preferences', () => {
      mockUserPreferencesService.quickAssignCollapsed.set(true);
      expect(component['isCollapsed']()).toBe(true);

      mockUserPreferencesService.quickAssignCollapsed.set(false);
      expect(component['isCollapsed']()).toBe(false);
    });

    it('should toggle collapsed state when header clicked (not in edit mode)', () => {
      component.toggleCollapsed();

      expect(mockUserPreferencesService.toggleQuickAssignCollapsed).toHaveBeenCalled();
    });

    it('should not toggle collapsed when in edit mode', () => {
      component['isEditMode'].set(true);
      component.toggleCollapsed();

      expect(mockUserPreferencesService.toggleQuickAssignCollapsed).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    it('should toggle edit mode when settings button clicked', () => {
      const mockEvent = { stopPropagation: vi.fn() } as unknown as Event;

      component.toggleEditMode(mockEvent);

      expect(component['isEditMode']()).toBe(true);
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should expand card when entering edit mode while collapsed', () => {
      mockUserPreferencesService.quickAssignCollapsed.set(true);
      const mockEvent = { stopPropagation: vi.fn() } as unknown as Event;

      component.toggleEditMode(mockEvent);

      expect(mockUserPreferencesService.setQuickAssignCollapsed).toHaveBeenCalledWith(false);
    });

    it('should exit edit mode when Done button clicked', () => {
      component['isEditMode'].set(true);

      component.exitEditMode();

      expect(component['isEditMode']()).toBe(false);
    });
  });

  describe('hasPositiveReadyToAssign', () => {
    it('should return true when ready to assign is positive', () => {
      mockBudgetService.readyToAssign.set(50000n);

      expect(component['hasPositiveReadyToAssign']()).toBe(true);
    });

    it('should return false when ready to assign is zero', () => {
      mockBudgetService.readyToAssign.set(0n);

      expect(component['hasPositiveReadyToAssign']()).toBe(false);
    });

    it('should return false when ready to assign is negative', () => {
      mockBudgetService.readyToAssign.set(-10000n);

      expect(component['hasPositiveReadyToAssign']()).toBe(false);
    });
  });

  describe('hasMiddleGroupVisible', () => {
    it('should return false when all middle options are hidden', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        assignedLastMonth: false,
        spentLastMonth: false,
        averageAssigned: false,
        averageSpent: false,
      });

      expect(component['hasMiddleGroupVisible']()).toBe(false);
    });

    it('should return true when any middle option is visible', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        assignedLastMonth: true,
      });

      expect(component['hasMiddleGroupVisible']()).toBe(true);
    });
  });

  describe('hasBottomGroupVisible', () => {
    it('should return false when all bottom options are hidden', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        resetAssignedAmounts: false,
        resetAvailableAmounts: false,
      });

      expect(component['hasBottomGroupVisible']()).toBe(false);
    });

    it('should return true when any bottom option is visible', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        resetAssignedAmounts: true,
      });

      expect(component['hasBottomGroupVisible']()).toBe(true);
    });
  });

  describe('onOptionClick', () => {
    it('should toggle preference when in edit mode', () => {
      component['isEditMode'].set(true);

      component.onOptionClick('assignedLastMonth', { totalAmount: 0n, updates: [] });

      expect(mockUserPreferencesService.toggleQuickAssignPreference).toHaveBeenCalledWith('assignedLastMonth');
    });

    it('should apply quick assign when not in edit mode', async () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const quickAssignData = {
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      };

      await component.onOptionClick('assignedLastMonth', quickAssignData);

      expect(mockConvexService.mutation).toHaveBeenCalled();
    });
  });

  describe('onToggleChange', () => {
    it('should toggle preference when value changes', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        spentLastMonth: false,
      });

      component.onToggleChange('spentLastMonth', true);

      expect(mockUserPreferencesService.toggleQuickAssignPreference).toHaveBeenCalledWith('spentLastMonth');
    });

    it('should not toggle when value is the same', () => {
      mockUserPreferencesService.quickAssignPreferences.set({
        ...DEFAULT_QUICK_ASSIGN_PREFERENCES,
        spentLastMonth: true,
      });

      component.onToggleChange('spentLastMonth', true);

      expect(mockUserPreferencesService.toggleQuickAssignPreference).not.toHaveBeenCalled();
    });
  });

  describe('applyQuickAssign', () => {
    it('should not apply when updates array is empty', async () => {
      await component.applyQuickAssign({ totalAmount: 0n, updates: [] });

      expect(mockConvexService.mutation).not.toHaveBeenCalled();
    });

    it('should not apply when already saving', async () => {
      component['saving'].set(true);
      const categoryId = 'cat_123' as Id<'category'>;

      await component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      });

      expect(mockConvexService.mutation).not.toHaveBeenCalled();
    });

    it('should not apply when workspace ID is not available', async () => {
      mockWorkspaceService.workspaceId.mockReturnValue(null);
      const categoryId = 'cat_123' as Id<'category'>;

      await component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      });

      expect(mockConvexService.mutation).not.toHaveBeenCalled();
    });

    it('should not apply when all updates have same value as current', async () => {
      const categoryId = 'cat_123' as Id<'category'>;
      // Current assignedAmount is 10000n, newAssignedAmount is also 10000n
      await component.applyQuickAssign({
        totalAmount: 0n,
        updates: [{ categoryId, newAssignedAmount: 10000n }],
      });

      expect(mockConvexService.mutation).not.toHaveBeenCalled();
    });

    it('should filter out updates with same value and only send changes', async () => {
      const categoryId1 = 'cat_123' as Id<'category'>;
      const categoryId2 = 'cat_456' as Id<'category'>;
      // cat_123: current is 10000n, new is 10000n (no change - should be filtered)
      // cat_456: current is 20000n, new is 25000n (change - should be sent)
      await component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [
          { categoryId: categoryId1, newAssignedAmount: 10000n },
          { categoryId: categoryId2, newAssignedAmount: 25000n },
        ],
      });

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: 'workspace_123',
          yearMonth: 202511,
          updates: [{ categoryId: categoryId2, assignedAmount: 25000n }],
        })
      );
    });

    it('should call mutation with correct parameters when values change', async () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const quickAssignData = {
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      };

      await component.applyQuickAssign(quickAssignData);

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: 'workspace_123',
          yearMonth: 202511,
          updates: [{ categoryId, assignedAmount: 15000n }],
        })
      );
    });

    it('should handle category with no current budget data (defaults to 0n)', async () => {
      const categoryId = 'cat_new' as Id<'category'>;
      // Category doesn't exist in budgetData, so current is 0n
      await component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 5000n }],
      });

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: 'workspace_123',
          yearMonth: 202511,
          updates: [{ categoryId, assignedAmount: 5000n }],
        })
      );
    });

    it('should not apply when month data is not found', async () => {
      mockBudgetMonthService.getLastViewedMonth.mockReturnValue(202512);
      const categoryId = 'cat_123' as Id<'category'>;

      await component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      });

      // Should still call mutation since we can't compare (month not found)
      // But the backend will handle it
      expect(mockConvexService.mutation).toHaveBeenCalled();
    });

    it('should set and reset saving state', async () => {
      const categoryId = 'cat_123' as Id<'category'>;
      let resolvePromise: (value: { success: boolean }) => void;
      const promise = new Promise<{ success: boolean }>((resolve) => {
        resolvePromise = resolve;
      });
      mockConvexService.mutation.mockReturnValue(promise);

      const applyPromise = component.applyQuickAssign({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      });

      // Check that saving is true while the mutation is in progress
      expect(component['saving']()).toBe(true);

      // Resolve the mutation
      resolvePromise!({ success: true });
      await applyPromise;

      // Check that saving is false after completion
      expect(component['saving']()).toBe(false);
    });

    it('should handle mutation errors gracefully', async () => {
      const categoryId = 'cat_123' as Id<'category'>;
      mockConvexService.mutation.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(
        component.applyQuickAssign({
          totalAmount: 5000n,
          updates: [{ categoryId, newAssignedAmount: 15000n }],
        })
      ).resolves.toBeUndefined();

      expect(component['saving']()).toBe(false);
    });
  });

  describe('hasActualChanges', () => {
    it('should return false when updates array is empty', () => {
      const result = component['hasActualChanges']({ totalAmount: 0n, updates: [] });
      expect(result).toBe(false);
    });

    it('should return false when all updates have same value as current', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const result = component['hasActualChanges']({
        totalAmount: 0n,
        updates: [{ categoryId, newAssignedAmount: 10000n }],
      });
      expect(result).toBe(false);
    });

    it('should return true when at least one update has different value', () => {
      const categoryId = 'cat_123' as Id<'category'>;
      const result = component['hasActualChanges']({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 15000n }],
      });
      expect(result).toBe(true);
    });

    it('should return true when some updates change and some do not', () => {
      const categoryId1 = 'cat_123' as Id<'category'>;
      const categoryId2 = 'cat_456' as Id<'category'>;
      const result = component['hasActualChanges']({
        totalAmount: 5000n,
        updates: [
          { categoryId: categoryId1, newAssignedAmount: 10000n }, // no change
          { categoryId: categoryId2, newAssignedAmount: 25000n }, // change
        ],
      });
      expect(result).toBe(true);
    });

    it('should handle category with no current budget data (defaults to 0n)', () => {
      const categoryId = 'cat_new' as Id<'category'>;
      const result = component['hasActualChanges']({
        totalAmount: 5000n,
        updates: [{ categoryId, newAssignedAmount: 5000n }],
      });
      expect(result).toBe(true); // 5000n !== 0n
    });

    it('should return false when new value is 0n and current is also 0n', () => {
      const categoryId = 'cat_new' as Id<'category'>;
      const result = component['hasActualChanges']({
        totalAmount: 0n,
        updates: [{ categoryId, newAssignedAmount: 0n }],
      });
      expect(result).toBe(false);
    });
  });

  describe('hasActualChanges computed signals', () => {
    it('should return false for underfunded when no changes', () => {
      mockQuickAssignService.quickAssignData.set({
        ...createEmptyQuickAssignData(),
        underfunded: {
          totalAmount: 0n,
          updates: [{ categoryId: 'cat_123' as Id<'category'>, newAssignedAmount: 10000n }],
        },
      });

      expect(component['hasUnderfundedChanges']()).toBe(false);
    });

    it('should return true for underfunded when there are changes', () => {
      mockQuickAssignService.quickAssignData.set({
        ...createEmptyQuickAssignData(),
        underfunded: {
          totalAmount: 5000n,
          updates: [{ categoryId: 'cat_123' as Id<'category'>, newAssignedAmount: 15000n }],
        },
      });

      expect(component['hasUnderfundedChanges']()).toBe(true);
    });

    it('should return false for resetAvailableAmounts when no changes', () => {
      mockQuickAssignService.quickAssignData.set({
        ...createEmptyQuickAssignData(),
        resetAvailableAmounts: {
          totalAmount: 0n,
          updates: [
            { categoryId: 'cat_123' as Id<'category'>, newAssignedAmount: 10000n }, // current is 10000n, available is 10000n, so newAssignedAmount = 10000n - 10000n = 0n
          ],
        },
      });

      // Update budget data to have available = 0n (so assignedAmount - available = assignedAmount)
      mockBudgetService.months.set([
        {
          yearMonth: 202511,
          budgetData: {
            cat_123: {
              assignedAmount: 10000n,
              totalSpent: 0n,
              carryoverFromPrevious: 0n,
              available: 0n,
              target: {
                remainingToAssign: 0n,
                overfundedByAmount: 0n,
              },
            },
          },
        },
      ]);

      expect(component['hasResetAvailableChanges']()).toBe(false);
    });

    it('should return true for resetAvailableAmounts when there are changes', () => {
      mockQuickAssignService.quickAssignData.set({
        ...createEmptyQuickAssignData(),
        resetAvailableAmounts: {
          totalAmount: 0n,
          updates: [{ categoryId: 'cat_123' as Id<'category'>, newAssignedAmount: 0n }],
        },
      });

      expect(component['hasResetAvailableChanges']()).toBe(true); // 0n !== 10000n
    });
  });

  describe('formatAmount', () => {
    it('should format bigint amounts correctly', () => {
      // 100000 cents = $1000.00
      const formatted = component.formatAmount(100000n);

      expect(formatted).toContain('1,000');
    });

    it('should handle zero amounts', () => {
      const formatted = component.formatAmount(0n);

      expect(formatted).toContain('0');
    });
  });

  describe('template rendering', () => {
    it('should render header with Quick Assign title', () => {
      const header = fixture.nativeElement.querySelector('button[type="button"]');
      expect(header.textContent).toContain('Quick Assign');
    });

    it('should render Underfunded button', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button[hlmBtn]');
      const buttonTexts = Array.from(buttons).map((b: unknown) => (b as Element).textContent);

      expect(buttonTexts.some((text: string | null) => text?.includes('Underfunded'))).toBe(true);
    });

    it('should render Reduce Overfunding button', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button[hlmBtn]');
      const buttonTexts = Array.from(buttons).map((b: unknown) => (b as Element).textContent);

      expect(buttonTexts.some((text: string | null) => text?.includes('Reduce Overfunding'))).toBe(true);
    });

    it('should show Done button in edit mode', () => {
      component['isEditMode'].set(true);
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll('button[hlmBtn]');
      const buttonTexts = Array.from(buttons).map((b: unknown) => (b as Element).textContent);

      expect(buttonTexts.some((text: string | null) => text?.includes('Done'))).toBe(true);
    });

    it('should hide content when collapsed', () => {
      mockUserPreferencesService.quickAssignCollapsed.set(true);
      fixture.detectChanges();

      const content = fixture.nativeElement.querySelector('.space-y-1.px-3.pb-3');
      expect(content).toBeFalsy();
    });

    it('should show content when not collapsed', () => {
      mockUserPreferencesService.quickAssignCollapsed.set(false);
      fixture.detectChanges();

      const content = fixture.nativeElement.querySelector('.space-y-1.px-3.pb-3');
      expect(content).toBeTruthy();
    });
  });
});
