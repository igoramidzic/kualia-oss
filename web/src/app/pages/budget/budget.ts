import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationStart, Router } from '@angular/router';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { CategoryTarget, CategoryWithTarget, extractTarget } from 'convex/categoryTargets/types';
import {
  nucleoArchive as Archive,
  nucleoArrowUp as ArrowUp,
  nucleoEmail as Box,
  nucleoChevronDown as ChevronDown,
  nucleoChevronLeft as ChevronLeft,
  nucleoChevronRight as ChevronRight,
  nucleoWarningCircle as CircleAlert,
  nucleoPlusCircle as CirclePlus,
  nucleoDots as Ellipsis,
  nucleoEye as Eye,
  nucleoEyeOff as EyeOff,
  nucleoHeart as Heart,
  nucleoLayers as Layers,
  NucleoIcon,
  type NucleoIconData,
  nucleoMoon as Moon,
  nucleoPlusCircle as PlusCircle,
  nucleoRedo as Redo2,
  nucleoRowsTwo as Rows2,
  nucleoRowsThree as Rows3,
  nucleoSearch as Search,
  nucleoTrash as Trash2,
  nucleoTrendDown as TrendingDown,
  nucleoUndo as Undo2,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { filter } from 'rxjs';
import { BudgetMonthPickerComponent } from '../../components/budget-month-picker/budget-month-picker.component';
import { ActivityPopoverComponent } from '../../components/budget/activity-popover/activity-popover.component';
import { AddCategoryButtonComponent } from '../../components/budget/add-category-button.component';
import { AddCategoryGroupButtonComponent } from '../../components/budget/add-category-group-button.component';
import { AssignedAmountEditorComponent } from '../../components/budget/assigned-amount-editor.component';
import { AvailableAmountButtonComponent } from '../../components/budget/available-amount-button/available-amount-button.component';
import { BudgetHistoryPopoverComponent } from '../../components/budget/budget-history-popover.component';
import { BudgetSidebarToggleComponent } from '../../components/budget/budget-sidebar-toggle.component';
import { BudgetSidebarComponent } from '../../components/budget/budget-sidebar.component';
import { CategoryGroupNameEditorComponent } from '../../components/budget/category-group-name-editor.component';
import { CategoryNameEditorComponent } from '../../components/budget/category-name-editor.component';
import { CategoryProgressBarComponent } from '../../components/budget/category-progress-bar/category-progress-bar.component';
import { CategoryTargetIndicatorComponent } from '../../components/budget/category-target-indicator.component';
import { ReadyToAssignCardComponent } from '../../components/budget/ready-to-assign-card.component';
import { FilterConfig, ResponsiveFilterRowComponent } from '../../components/budget/responsive-filter-row.component';
import { DeleteCategoryDialogComponent } from '../../components/dialogs/delete-category-dialog/delete-category-dialog';
import { DeleteCategoryGroupDialogComponent } from '../../components/dialogs/delete-category-group-dialog/delete-category-group-dialog';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { DragGapDirective } from '../../directives/drag-gap.directive';
import { DragData, DragSourceDirective } from '../../directives/drag-source.directive';
import { DropEvent, DropTargetDirective } from '../../directives/drop-target.directive';
import { AiChatService } from '../../services/ai-chat.service';
import { BankAccountService } from '../../services/bank-account.service';
import { BudgetCategorySelectionService } from '../../services/budget-category-selection.service';
import { BudgetFilterService } from '../../services/budget-filter.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetMonthData, BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { DragContextService } from '../../services/drag-context.service';
import { IconService } from '../../services/icon.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import {
  formatYearMonth,
  getCurrentYearMonth,
  getNextYearMonth,
  getPreviousYearMonth,
  validateYearMonth,
} from '../../shared/utils/month.utils';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';

const SCROLL_POSITION_KEY = 'budget-scroll-position';

@Component({
  selector: 'app-budget',
  imports: [
    ActivityPopoverComponent,
    AddCategoryButtonComponent,
    AddCategoryGroupButtonComponent,
    AssignedAmountEditorComponent,
    AvailableAmountButtonComponent,
    BudgetHistoryPopoverComponent,
    BudgetMonthPickerComponent,
    BudgetSidebarComponent,
    BudgetSidebarToggleComponent,
    CategoryGroupNameEditorComponent,
    CategoryNameEditorComponent,
    CategoryProgressBarComponent,
    CategoryTargetIndicatorComponent,
    DragGapDirective,
    DragSourceDirective,
    DropTargetDirective,
    FormsModule,
    HlmButton,
    HlmCheckbox,
    ...HlmCollapsibleImports,
    ...HlmContextMenuImports,
    ...HlmDropdownMenuImports,
    NucleoIcon,
    ReadyToAssignCardComponent,
    ResponsiveFilterRowComponent,
    SidebarToggleComponent,
  ],
  host: { class: 'block h-full min-w-0 max-w-full overflow-hidden' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budget.html',
})
export class BudgetComponent {
  private readonly favoriteFilterStoragePrefix = 'kualia:budget:favorite-only';
  private readonly categoryService = inject(CategoryService);
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly iconService = inject(IconService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly budgetService = inject(BudgetService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly budgetFilterService = inject(BudgetFilterService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly workspaceService = inject(WorkspaceService);
  readonly dragContext = inject(DragContextService);
  readonly selectionService = inject(BudgetCategorySelectionService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly aiChat = inject(AiChatService);

  readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  // Undo/Redo
  readonly canUndo = this.undoRedoService.canUndo;
  readonly canRedo = this.undoRedoService.canRedo;

  // Sidebar state
  readonly isSidebarOpen = this.userPreferencesService.budgetSidebarOpen;
  readonly sidebarTransitionsEnabled = signal(false);

  // Progress bars preference
  readonly showCategoryProgressBars = this.userPreferencesService.showCategoryProgressBars;

  readonly categoryHierarchy = this.categoryService.categoryHierarchy;

  readonly categoryGroups = computed(() => {
    const hierarchy = this.categoryHierarchy();
    const optimisticOrder = this.optimisticGroupOrder();

    // Filter and sort by sortOrder first
    let groups = hierarchy
      .filter((item) => !item.group.isDeleted)
      .sort((a, b) => a.group.sortOrder - b.group.sortOrder);

    // Apply optimistic reordering if available
    if (optimisticOrder && optimisticOrder.length > 0) {
      const groupMap = new Map(groups.map((g) => [g.group._id, g]));
      const reordered = optimisticOrder
        .map((id) => groupMap.get(id))
        .filter((g): g is (typeof groups)[0] => g !== undefined);

      // Add any groups not in optimistic order (shouldn't happen, but safe)
      groups.forEach((g) => {
        if (!optimisticOrder.includes(g.group._id)) {
          reordered.push(g);
        }
      });

      groups = reordered;
    }

    return groups;
  });

  // Enrich categories with bank account data for credit card categories
  readonly categoriesWithBankAccounts = computed(() => {
    const groups = this.categoryGroups();
    const bankAccounts = this.bankAccountService.bankAccounts();
    const optimisticCategoryOrder = this.optimisticCategoryOrderByGroup();
    const optimisticMove = this.optimisticCategoryGroupMove();

    // Create a map of bank accounts by ID for quick lookup
    const bankAccountsMap = new Map(bankAccounts.map((account) => [account._id, account]));

    // Enrich each group's categories with bank account data
    const enriched = groups.map((groupData) => {
      let categories = [...groupData.categories];

      // Apply optimistic cross-group move if this group is affected
      if (optimisticMove) {
        if (groupData.group._id === optimisticMove.fromGroupId) {
          // Remove the category from the source group
          categories = categories.filter((c) => c._id !== optimisticMove.categoryId);
        } else if (groupData.group._id === optimisticMove.toGroupId) {
          // Find the category in the original hierarchy (before enrichment)
          const allCategories = this.categoryHierarchy().flatMap((g) => g.categories);
          const movedCategory = allCategories.find((c) => c._id === optimisticMove.categoryId);
          if (movedCategory && !categories.some((c) => c._id === movedCategory._id)) {
            // The toPosition is based on visible (non-archived) category indices,
            // but categories array includes both visible and hidden (archived) categories.
            // We need to convert the visible position to the correct index in the full array.
            const visibleCategories = categories.filter((c) => !c.isArchived);
            let insertIndex: number;
            if (optimisticMove.toPosition >= visibleCategories.length) {
              // Inserting at or after the last visible category
              // Find the last visible category and insert after it in the full array
              const lastVisible = visibleCategories[visibleCategories.length - 1];
              if (lastVisible) {
                insertIndex = categories.findIndex((c) => c._id === lastVisible._id) + 1;
              } else {
                // No visible categories, insert at the beginning
                insertIndex = 0;
              }
            } else {
              // Inserting before a visible category
              // Find that visible category's position in the full array
              const targetVisibleCategory = visibleCategories[optimisticMove.toPosition];
              insertIndex = categories.findIndex((c) => c._id === targetVisibleCategory._id);
            }
            categories.splice(insertIndex, 0, movedCategory);
          }
        }
      }

      // Apply optimistic within-group reordering if available for this group
      if (optimisticCategoryOrder?.[groupData.group._id]) {
        const order = optimisticCategoryOrder[groupData.group._id];
        const categoryMap = new Map(categories.map((c) => [c._id, c]));
        const reordered = order
          .map((id) => categoryMap.get(id))
          .filter((c): c is (typeof categories)[0] => c !== undefined);

        // Add any categories not in the optimistic order
        categories.forEach((c) => {
          if (!order.includes(c._id)) {
            reordered.push(c);
          }
        });

        categories = reordered;
      }

      const enrichedCategories = categories.map((category) => {
        // Check if this is a credit card category (either by categoryType or group type)
        const isCreditCard = category.categoryType === 'credit_card' || groupData.group.type === 'credit_card';

        // For credit card categories with a bankAccountId, attach the bank account
        if (isCreditCard && category.bankAccountId) {
          const bankAccount = bankAccountsMap.get(category.bankAccountId);
          if (bankAccount) {
            return {
              ...category,
              bankAccount,
            };
          }
        }
        return category;
      });

      return {
        ...groupData,
        categories: enrichedCategories,
      };
    });

    return enriched;
  });

  // Separate visible and hidden categories
  readonly groupedCategoriesWithSeparation = computed(() => {
    const groups = this.categoriesWithBankAccounts();
    return groups.map((groupData) => ({
      ...groupData,
      visibleCategories: groupData.categories.filter((c) => !c.isArchived),
      hiddenCategories: groupData.categories.filter((c) => c.isArchived),
      hiddenCount: groupData.categories.filter((c) => c.isArchived).length,
    }));
  });

  private readonly groupCollapsedStates = signal<Record<string, boolean>>({});
  private readonly hiddenCategoriesVisibleStates = signal<Record<string, boolean>>({});

  // Drag state
  readonly isDraggingGroup = signal<boolean>(false);
  readonly isDraggingCategory = signal<boolean>(false);

  // Disable drag and drop when filtering is active (to avoid index mismatch issues)
  readonly isDragDropDisabled = computed(() => {
    if (this.favoriteOnly()) {
      return true;
    }
    // Disable if a budget filter other than 'all' is active
    if (this.activeFilter() !== 'all') {
      return true;
    }
    // Disable if there's an active search query
    if (this.hasSearchQuery()) {
      return true;
    }
    return false;
  });

  // Optimistic state for reordering
  private readonly optimisticGroupOrder = signal<Id<'categoryGroup'>[] | null>(null);
  private readonly optimisticCategoryOrderByGroup = signal<Record<string, Id<'category'>[]> | null>(null);
  private readonly optimisticCategoryGroupMove = signal<{
    categoryId: Id<'category'>;
    fromGroupId: Id<'categoryGroup'>;
    toGroupId: Id<'categoryGroup'>;
    toPosition: number;
  } | null>(null);

  // Filter state
  private readonly queryParams = toSignal(this.route.queryParams);
  readonly activeFilter = signal<'all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded'>('all');
  readonly favoriteOnly = signal(false);
  private readonly rememberedSelections = signal<Set<Id<'category'>>>(new Set());

  readonly Archive = Archive;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly ChevronLeft = ChevronLeft;
  readonly Ellipsis = Ellipsis;
  readonly Layers = Layers;
  readonly AlertCircle = CircleAlert;
  readonly Trash2 = Trash2;
  readonly TrendingDown = TrendingDown;
  readonly ArrowUp = ArrowUp;
  readonly PlusCircle = PlusCircle;
  readonly Box = Box;
  readonly X = X;
  readonly Search = Search;
  readonly Eye = Eye;
  readonly EyeOff = EyeOff;
  readonly Heart = Heart;
  readonly Moon = Moon;
  readonly Redo2 = Redo2;
  readonly Rows2 = Rows2;
  readonly Rows3 = Rows3;
  readonly Undo2 = Undo2;

  // Search state
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly isSearchFocused = signal(false);
  readonly searchQuery = signal('');
  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  readonly isSearchExpanded = computed(() => this.isSearchFocused() || this.hasSearchQuery());
  readonly favoriteCount = computed(
    () =>
      this.categoriesWithBankAccounts()
        .flatMap((group) => group.categories)
        .filter((category) => !category.isDeleted && category.isFavorite).length
  );

  readonly allGroupsExpanded = computed(() => {
    const groups = this.categoriesWithBankAccounts();
    if (groups.length === 0) return true;
    return groups.every((groupData) => this.isGroupExpanded(groupData.group._id));
  });

  // Month navigation
  readonly currentMonth = getCurrentYearMonth();

  readonly selectedMonth = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    if (!monthParam) {
      return this.currentMonth;
    }
    const parsed = this.budgetMonthService.parseQueryParam(monthParam);
    if (!parsed || !validateYearMonth(parsed)) {
      return this.currentMonth;
    }
    // Validate against available range
    const range = this.budgetService.availableRange();
    if (range && (parsed < range.minYearMonth || parsed > range.maxYearMonth)) {
      return this.currentMonth;
    }
    return parsed;
  });

  readonly isCurrentMonth = computed(() => this.selectedMonth() === this.currentMonth);

  readonly monthDisplay = computed(() => formatYearMonth(this.selectedMonth()));

  readonly availableRange = this.budgetService.availableRange;

  readonly canGoPrevious = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this.selectedMonth() > range.minYearMonth;
  });

  readonly canGoNext = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this.selectedMonth() < range.maxYearMonth;
  });

  readonly previousMonth = computed(() => {
    if (!this.canGoPrevious()) return null;
    return getPreviousYearMonth(this.selectedMonth());
  });

  readonly nextMonth = computed(() => {
    if (!this.canGoNext()) return null;
    return getNextYearMonth(this.selectedMonth());
  });

  // Budget data
  readonly budgetData = computed(() => {
    const months = this.budgetService.months();
    const selected = this.selectedMonth();
    return months.find((m) => m.yearMonth === selected);
  });

  readonly budgetDataByCategory = computed(() => {
    const data = this.budgetData();
    return data?.budgetData ?? {};
  });

  // Filter logic helpers
  private isCategoryOverspent(categoryBudget: BudgetMonthData['budgetData'][string]): boolean {
    return categoryBudget.available < 0n;
  }

  private isCategoryUnderfunded(categoryBudget: BudgetMonthData['budgetData'][string]): boolean {
    // Use the backend-calculated underfunded amount
    return categoryBudget.target.underfundedAmount > 0n;
  }

  private isCategoryAvailable(categoryBudget: BudgetMonthData['budgetData'][string]): boolean {
    return categoryBudget.available > 0n;
  }

  private isCategoryExtraFunded(categoryBudget: BudgetMonthData['budgetData'][string]): boolean {
    return categoryBudget.target.overfundedByAmount > 0n;
  }

  // Categories after applying search filter only (not budget filter)
  // This is used for filter counts so they reflect visible categories after search
  readonly searchFilteredCategories = computed(() => {
    const groups = this.categoriesWithBankAccounts();
    const hiddenCategoriesVisibleStates = this.hiddenCategoriesVisibleStates();
    const searchTerm = this.searchQuery().toLowerCase().trim();

    return groups
      .map((groupData) => {
        // Check if the group name matches the search
        const groupNameMatches = searchTerm ? groupData.group.name.toLowerCase().includes(searchTerm) : false;
        const includeArchivedCategories = hiddenCategoriesVisibleStates[groupData.group._id] ?? false;

        const filteredCategories = groupData.categories.filter((category) => {
          if (category.isDeleted || (category.isArchived && !includeArchivedCategories)) return false;

          // Search filter: match category name, group name, or bank account name (for credit cards)
          if (searchTerm) {
            const categoryName = this.getCategoryDisplayName(category).toLowerCase();
            const categoryNameMatches = categoryName.includes(searchTerm);
            // If neither category name nor group name matches, exclude
            if (!categoryNameMatches && !groupNameMatches) {
              return false;
            }
          }

          return true;
        });

        return {
          ...groupData,
          categories: filteredCategories,
        };
      })
      .filter((groupData) => groupData.categories.length > 0);
  });

  // Filter counts based on search-filtered categories
  readonly filterCounts = computed(() => {
    const groups = this.searchFilteredCategories();
    const budgetData = this.budgetDataByCategory();
    let allCount = 0;
    let overspentCount = 0;
    let underfundedCount = 0;
    let availableCount = 0;
    let extraFundedCount = 0;

    for (const groupData of groups) {
      for (const category of groupData.categories) {
        if (category.isDeleted) continue;
        allCount++;
        const categoryBudget = budgetData[category._id];
        if (categoryBudget) {
          if (this.isCategoryOverspent(categoryBudget)) {
            overspentCount++;
          }
          if (this.isCategoryUnderfunded(categoryBudget)) {
            underfundedCount++;
          }
          if (this.isCategoryAvailable(categoryBudget)) {
            availableCount++;
          }
          if (this.isCategoryExtraFunded(categoryBudget)) {
            extraFundedCount++;
          }
        }
      }
    }

    return {
      all: allCount,
      overspent: overspentCount,
      underfunded: underfundedCount,
      available: availableCount,
      extraFunded: extraFundedCount,
    };
  });

  // Query params for filter links (preserve month param)
  readonly allFilterQueryParams = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const params: Record<string, string> = {};
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  readonly overspentFilterQueryParams = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const params: Record<string, string> = { filter: 'overspent' };
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  readonly underfundedFilterQueryParams = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const params: Record<string, string> = { filter: 'underfunded' };
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  readonly availableFilterQueryParams = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const params: Record<string, string> = { filter: 'available' };
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  readonly extraFundedFilterQueryParams = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const params: Record<string, string> = { filter: 'extra-funded' };
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  // Filters for responsive filter row component
  readonly responsiveFilters = computed<FilterConfig[]>(() => {
    const counts = this.filterCounts();
    const active = this.activeFilter();

    return [
      {
        id: 'all',
        label: 'All',
        icon: Layers,
        queryParams: this.allFilterQueryParams(),
        isVisible: true,
        isDisabled: counts.all === 0,
        isActive: active === 'all',
        isDestructive: false,
        count: counts.all > 0 ? counts.all : undefined,
        showCount: true,
      },
      {
        id: 'overspent',
        label: 'Overspent',
        icon: CircleAlert,
        queryParams: this.overspentFilterQueryParams(),
        isVisible: true,
        isDisabled: counts.overspent === 0,
        isActive: active === 'overspent',
        isDestructive: true,
        count: counts.overspent > 0 ? counts.overspent : undefined,
        showCount: true,
      },
      {
        id: 'underfunded',
        label: 'Underfunded',
        icon: TrendingDown,
        queryParams: this.underfundedFilterQueryParams(),
        isVisible: true,
        isDisabled: counts.underfunded === 0,
        isActive: active === 'underfunded',
        isDestructive: false,
        count: counts.underfunded > 0 ? counts.underfunded : undefined,
        showCount: true,
      },
      {
        id: 'available',
        label: 'Available',
        icon: ArrowUp,
        queryParams: this.availableFilterQueryParams(),
        isVisible: true,
        isDisabled: counts.available === 0,
        isActive: active === 'available',
        isDestructive: false,
        count: counts.available > 0 ? counts.available : undefined,
        showCount: true,
      },
      {
        id: 'extraFunded',
        label: 'Extra Funded',
        icon: CirclePlus,
        queryParams: this.extraFundedFilterQueryParams(),
        isVisible: true,
        isDisabled: counts.extraFunded === 0,
        isActive: active === 'extraFunded',
        isDestructive: false,
        count: counts.extraFunded > 0 ? counts.extraFunded : undefined,
        showCount: true,
      },
    ];
  });

  // Filtered category groups (using enriched categories with bank accounts and visible/hidden separation)
  readonly filteredCategoryGroups = computed(() => {
    const groups = this.groupedCategoriesWithSeparation();
    const budgetFilter = this.activeFilter();
    const budgetData = this.budgetDataByCategory();
    const searchTerm = this.searchQuery().toLowerCase().trim();

    type CategoryWithGroup = {
      _id: Id<'category'>;
      isDeleted: boolean;
      groupName?: string;
      isArchived?: boolean;
      name: string;
      categoryType?: string | null;
      bankAccountId?: Id<'bankAccount'> | null;
      bankAccount?: { name: string } | null;
      isFavorite?: boolean;
    };

    const applyFilters = (category: CategoryWithGroup) => {
      if (category.isDeleted) return false;

      if (this.favoriteOnly() && !category.isFavorite) {
        return false;
      }

      // Search filter: match category name or group name
      if (searchTerm) {
        const categoryName = this.getCategoryDisplayName(category).toLowerCase();
        const categoryNameMatches = categoryName.includes(searchTerm);
        const groupNameMatches = category.groupName?.toLowerCase().includes(searchTerm) ?? false;
        if (!categoryNameMatches && !groupNameMatches) {
          return false;
        }
      }

      // Budget filter: apply when not 'all'
      if (budgetFilter !== 'all') {
        const categoryBudget = budgetData[category._id];
        if (!categoryBudget) return false;

        switch (budgetFilter) {
          case 'overspent':
            return this.isCategoryOverspent(categoryBudget);
          case 'underfunded':
            return this.isCategoryUnderfunded(categoryBudget);
          case 'available':
            return this.isCategoryAvailable(categoryBudget);
          case 'extraFunded':
            return this.isCategoryExtraFunded(categoryBudget);
          default:
            return true;
        }
      }

      return true;
    };

    // Determine if we should show empty groups
    // Empty groups should be visible when there's no active filter or search
    const showEmptyGroups = budgetFilter === 'all' && !searchTerm && !this.favoriteOnly();

    return groups
      .map((groupData) => {
        const groupNameMatches = searchTerm ? groupData.group.name.toLowerCase().includes(searchTerm) : false;

        // Apply filters to both visible and hidden categories
        const filteredVisibleCategories = groupData.visibleCategories.filter((category) => {
          return applyFilters({ ...category, groupName: groupNameMatches ? groupData.group.name : undefined });
        });

        const filteredHiddenCategories = groupData.hiddenCategories.filter((category) => {
          return applyFilters({ ...category, groupName: groupNameMatches ? groupData.group.name : undefined });
        });

        return {
          ...groupData,
          categories: [...filteredVisibleCategories, ...filteredHiddenCategories], // Keep all for compatibility
          visibleCategories: filteredVisibleCategories,
          hiddenCategories: filteredHiddenCategories,
          hiddenCount: filteredHiddenCategories.length,
        };
      })
      .filter((groupData) => {
        const hasCategories = groupData.visibleCategories.length > 0 || groupData.hiddenCategories.length > 0;

        // Always hide credit card groups if they have no categories
        if (groupData.group.type === 'credit_card' && !hasCategories) {
          return false;
        }

        return showEmptyGroups || hasCategories;
      });
  });

  // Group totals (based on filtered categories)
  readonly groupTotals = computed(() => {
    const groups = this.filteredCategoryGroups();
    const budgetData = this.budgetDataByCategory();
    const totals: Record<string, { carryOver: bigint; assigned: bigint; activity: bigint; available: bigint }> = {};

    for (const groupData of groups) {
      const groupId = groupData.group._id;
      let carryOver = 0n;
      let assigned = 0n;
      let activity = 0n;
      let available = 0n;

      for (const category of groupData.categories) {
        if (category.isDeleted) continue;
        const categoryBudget = budgetData[category._id];
        if (categoryBudget) {
          carryOver += categoryBudget.carryoverFromPrevious;
          assigned += categoryBudget.assignedAmount;
          activity += this.getActivity(categoryBudget);
          available += categoryBudget.available;
        }
      }

      totals[groupId] = { carryOver, assigned, activity, available };
    }

    return totals;
  });

  // Grand totals (sum of all filtered group totals)
  readonly grandTotals = computed(() => {
    const groups = this.filteredCategoryGroups();
    const budgetData = this.budgetDataByCategory();
    let carryOver = 0n;
    let assigned = 0n;
    let activity = 0n;
    let available = 0n;

    for (const groupData of groups) {
      for (const category of groupData.categories) {
        if (category.isDeleted) continue;
        const categoryBudget = budgetData[category._id];
        if (categoryBudget) {
          carryOver += categoryBudget.carryoverFromPrevious;
          assigned += categoryBudget.assignedAmount;
          activity += this.getActivity(categoryBudget);
          available += categoryBudget.available;
        }
      }
    }

    return { carryOver, assigned, activity, available };
  });

  // Category selection
  readonly allCategoryIds = computed(() => {
    return this.selectionService.getAllCategoryIds();
  });

  // Get visible category IDs from filtered groups (excludes hidden categories)
  readonly visibleCategoryIds = computed(() => {
    const filteredGroups = this.filteredCategoryGroups();
    const visibleIds: Id<'category'>[] = [];
    for (const groupData of filteredGroups) {
      // Only include visible categories (not hidden)
      for (const category of groupData.visibleCategories) {
        if (!category.isDeleted) {
          visibleIds.push(category._id);
        }
      }
    }
    return visibleIds;
  });

  readonly headerCheckboxState = computed(() => {
    const visibleIds = this.visibleCategoryIds();
    if (visibleIds.length === 0) return false;

    const selected = this.selectionService.selectedCategories();
    const selectedSet = new Set(selected);

    const allSelected = visibleIds.every((id) => selectedSet.has(id));
    const someSelected = visibleIds.some((id) => selectedSet.has(id));

    if (allSelected) return true;
    if (someSelected) return 'indeterminate' as const;
    return false;
  });

  groupCheckboxState(groupId: string) {
    return computed(() => {
      // Get filtered categories in this group (only visible ones)
      const categories = this.getCategoriesInGroup(groupId);
      if (categories.length === 0) return false;

      const selected = this.selectionService.selectedCategories();
      const selectedSet = new Set(selected);

      const selectedCount = categories.filter((cat) => selectedSet.has(cat._id)).length;
      const allSelected = selectedCount === categories.length;
      const someSelected = selectedCount > 0;

      if (allSelected) return true;
      if (someSelected) return 'indeterminate' as const;
      return false;
    });
  }

  hiddenCategoriesCheckboxState(groupId: string) {
    return computed(() => {
      // Get hidden categories in this group
      const categories = this.getHiddenCategoriesInGroup(groupId);
      if (categories.length === 0) return false;

      const selected = this.selectionService.selectedCategories();
      const selectedSet = new Set(selected);

      const selectedCount = categories.filter((cat) => selectedSet.has(cat._id)).length;
      const allSelected = selectedCount === categories.length;
      const someSelected = selectedCount > 0;

      if (allSelected) return true;
      if (someSelected) return 'indeterminate' as const;
      return false;
    });
  }

  private scrollRestored = false;
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  private autoScrollCleanup: (() => void) | null = null;

  constructor() {
    // Enable sidebar margin transitions after first render to prevent animation on load
    afterNextRender(() => {
      this.restoreFavoriteFilter();
      this.sidebarTransitionsEnabled.set(true);

      // Set up auto-scroll for drag-and-drop
      this.setupAutoScroll();
    });

    // Clean up auto-scroll on destroy
    this.destroyRef.onDestroy(() => {
      this.autoScrollCleanup?.();
    });

    // Save last viewed month for persistence (don't trigger re-fetch - query already returns all months)
    effect(() => {
      const selected = this.selectedMonth();
      this.budgetMonthService.setLastViewedMonth(selected);
    });

    // Initialize filter from query params or stored filter
    effect(() => {
      const filterParam = this.queryParams()?.['filter'] as string | undefined;
      if (filterParam) {
        // Convert URL query parameter format to internal filter names
        const internalFilter = filterParam === 'extra-funded' ? 'extraFunded' : filterParam;
        const validFilters: ('all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded')[] = [
          'all',
          'overspent',
          'underfunded',
          'available',
          'extraFunded',
        ];
        const filter = internalFilter as 'all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded';
        if (validFilters.includes(filter)) {
          this.activeFilter.set(filter);
          this.budgetFilterService.setLastFilter(filter);
        }
      } else {
        // If no filter in URL, set to 'all' and clear stored filter
        // This handles the case when clicking "All categories" link
        this.activeFilter.set('all');
        this.budgetFilterService.setLastFilter('all');
      }
    });

    // Validate and redirect if month is invalid
    effect(() => {
      const monthParam = this.queryParams()?.['month'] as string | undefined;
      if (monthParam) {
        const parsed = this.budgetMonthService.parseQueryParam(monthParam);
        const range = this.availableRange();
        if (
          !parsed ||
          !validateYearMonth(parsed) ||
          (range && (parsed < range.minYearMonth || parsed > range.maxYearMonth))
        ) {
          // Redirect to current month (preserve filter)
          const filterParam = this.queryParams()?.['filter'] as string | undefined;
          const queryParams: Record<string, string> = {};
          if (filterParam) {
            queryParams['filter'] = filterParam;
          }
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            replaceUrl: true,
          });
        }
      }
    });

    // Load collapsed states from preferences when groups are available
    effect(() => {
      const groups = this.categoriesWithBankAccounts();
      if (groups.length > 0) {
        const states: Record<string, boolean> = {};
        for (const groupData of groups) {
          const groupId = groupData.group._id;
          const isCollapsed = this.userPreferencesService.getBudgetGroupCollapsedState(groupId);
          if (isCollapsed) {
            states[groupId] = true;
          }
        }
        this.groupCollapsedStates.set(states);
      }
    });

    // Load hidden categories visibility states from preferences
    effect(() => {
      const groups = this.categoryGroups();
      const initialStates: Record<string, boolean> = {};
      groups.forEach((groupData) => {
        const groupId = groupData.group._id;
        initialStates[groupId] = this.userPreferencesService.getHiddenCategoriesVisibleState(groupId);
      });
      this.hiddenCategoriesVisibleStates.set(initialStates);
    });

    // Save scroll position when navigating away from budget page
    const subscription = this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        filter((event) => {
          // Only save if we're navigating away from the budget page
          const navEvent = event;
          const currentUrl = this.router.url;
          const nextUrl = navEvent.url.split('?')[0];
          return currentUrl.includes('/budget') && !nextUrl.includes('/budget');
        })
      )
      .subscribe(() => {
        this.saveScrollPosition();
      });

    // Cleanup subscription on destroy
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      // Also save scroll position on component destroy as a fallback
      this.saveScrollPosition();
      // Clear scroll timeout
      if (this.scrollTimeout) {
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = null;
      }
    });

    // Restore scroll position when both data and DOM are ready
    // This effect watches both categoriesWithBankAccounts and scrollContainer signals
    // and restores scroll position only when both are available
    effect(() => {
      const container = this.scrollContainer()?.nativeElement;

      // Only restore if:
      // 1. We haven't restored yet (prevent multiple restorations)
      // 2. Category groups are loaded (data is ready)
      // 3. Scroll container exists (DOM is ready)
      const groups = this.categoriesWithBankAccounts();
      if (!this.scrollRestored && groups.length > 0 && container) {
        // Try to restore immediately if content is already laid out
        // Check if scrollHeight is greater than clientHeight (content is rendered)
        if (container.scrollHeight > container.clientHeight) {
          // Content is ready, restore immediately
          this.restoreScrollPosition();
          this.scrollRestored = true;
        } else {
          // Content not fully laid out yet, poll until ready using requestAnimationFrame
          const checkAndRestore = () => {
            const currentContainer = this.scrollContainer()?.nativeElement;
            if (
              !this.scrollRestored &&
              currentContainer &&
              currentContainer.scrollHeight > currentContainer.clientHeight
            ) {
              this.restoreScrollPosition();
              this.scrollRestored = true;
            } else if (!this.scrollRestored && currentContainer) {
              // Keep checking until content is laid out
              requestAnimationFrame(checkAndRestore);
            }
          };
          requestAnimationFrame(checkAndRestore);
        }
      }
    });

    // Set up overlay scrollbar behavior - show scrollbar when scrolling
    effect(() => {
      const container = this.scrollContainer()?.nativeElement;
      if (!container) return;

      const handleScroll = () => {
        // Add scrolling class to show scrollbar
        container.classList.add('scrolling');

        // Clear existing timeout
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
        }

        // Remove scrolling class after scrolling stops (1.5s delay for macOS-like fade)
        this.scrollTimeout = setTimeout(() => {
          container.classList.remove('scrolling');
        }, 1500);
      };

      container.addEventListener('scroll', handleScroll, { passive: true });

      // Cleanup
      return () => {
        container.removeEventListener('scroll', handleScroll);
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = null;
        }
      };
    });

    // Selection memory management - store/restore selections when filter changes
    effect(() => {
      const filteredGroups = this.filteredCategoryGroups();
      const selectedCategories = this.selectionService.selectedCategories();
      const remembered = this.rememberedSelections();

      // Get all visible category IDs in current filter (includes hidden categories that are currently shown)
      const visibleCategoryIds = new Set<Id<'category'>>();
      for (const groupData of filteredGroups) {
        // Include visible categories
        for (const category of groupData.visibleCategories) {
          if (!category.isDeleted) {
            visibleCategoryIds.add(category._id);
          }
        }
        // Also include hidden categories if they are currently shown
        if (this.isHiddenCategoriesVisible(groupData.group._id)) {
          for (const category of groupData.hiddenCategories) {
            if (!category.isDeleted) {
              visibleCategoryIds.add(category._id);
            }
          }
        }
      }

      // Step 1: Restore remembered selections that are now visible
      const toRestore: Id<'category'>[] = [];
      for (const categoryId of remembered) {
        if (visibleCategoryIds.has(categoryId) && !selectedCategories.includes(categoryId)) {
          toRestore.push(categoryId);
        }
      }

      if (toRestore.length > 0) {
        const newRemembered = new Set(remembered);
        for (const id of toRestore) {
          newRemembered.delete(id);
          this.selectionService.selectCategory(id);
        }
        this.rememberedSelections.set(newRemembered);
        // Effect will run again with updated selections, so we can return early
        return;
      }

      // Step 2: Remember and deselect categories that are selected but no longer visible
      const toRemember = new Set<Id<'category'>>();
      for (const categoryId of selectedCategories) {
        if (!visibleCategoryIds.has(categoryId) && !remembered.has(categoryId)) {
          toRemember.add(categoryId);
        }
      }

      if (toRemember.size > 0) {
        const newRemembered = new Set(remembered);
        for (const id of toRemember) {
          newRemembered.add(id);
          this.selectionService.deselectCategory(id);
        }
        this.rememberedSelections.set(newRemembered);
      }
    });

    // Update visible category IDs in selection service for keyboard shortcuts
    effect(() => {
      const filteredGroups = this.filteredCategoryGroups();
      const visibleCategoryIds: Id<'category'>[] = [];
      for (const groupData of filteredGroups) {
        // Only include visible categories (excludes hidden categories)
        for (const category of groupData.visibleCategories) {
          if (!category.isDeleted) {
            visibleCategoryIds.push(category._id);
          }
        }
      }
      this.selectionService.setVisibleCategoryIds(visibleCategoryIds);
    });
  }

  getCategoriesInGroup(groupId: string) {
    const filteredGroups = this.filteredCategoryGroups();
    const groupData = filteredGroups.find((item) => item.group._id === groupId);
    if (!groupData) return [];

    // Only return visible categories (not hidden)
    return groupData.visibleCategories
      .filter((cat) => !cat.isDeleted)
      .sort((a, b) => {
        // Sort by sortOrder first, then by name (matching backend query sorting)
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
  }

  getHiddenCategoriesInGroup(groupId: string) {
    const filteredGroups = this.filteredCategoryGroups();
    const groupData = filteredGroups.find((item) => item.group._id === groupId);
    if (!groupData) return [];

    // Return hidden categories
    return groupData.hiddenCategories
      .filter((cat) => !cat.isDeleted)
      .sort((a, b) => {
        // Sort by sortOrder first, then by name (matching backend query sorting)
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
  }

  isGroupExpanded(groupId: string): boolean {
    const states = this.groupCollapsedStates();
    return !(states[groupId] ?? false); // Default to expanded (not collapsed)
  }

  onGroupExpandedChange(groupId: string, expanded: boolean): void {
    const collapsed = !expanded;
    this.groupCollapsedStates.update((states) => {
      const newStates = { ...states };
      if (collapsed) {
        newStates[groupId] = true;
      } else {
        // Remove from map if opening (to keep map clean)
        delete newStates[groupId];
      }
      return newStates;
    });
    this.userPreferencesService.setBudgetGroupCollapsedState(groupId, collapsed);
  }

  isHiddenCategoriesVisible(groupId: string): boolean {
    const states = this.hiddenCategoriesVisibleStates();
    return states[groupId] ?? false;
  }

  onHiddenCategoriesExpandedChange(groupId: string, expanded: boolean): void {
    this.hiddenCategoriesVisibleStates.update((states) => {
      const newStates = { ...states };
      if (expanded) {
        newStates[groupId] = true;
      } else {
        delete newStates[groupId]; // Keep map clean
      }
      return newStates;
    });
    this.userPreferencesService.setHiddenCategoriesVisibleState(groupId, expanded);
  }

  onProgressBarsToggle(): void {
    this.userPreferencesService.setShowCategoryProgressBars(!this.showCategoryProgressBars());
  }

  toggleAllGroups(): void {
    const allExpanded = this.allGroupsExpanded();
    const groups = this.categoriesWithBankAccounts();

    // Update all groups to the opposite state
    const newStates: Record<string, boolean> = {};
    for (const groupData of groups) {
      const groupId = groupData.group._id;
      if (allExpanded) {
        // Collapse all
        newStates[groupId] = true;
        this.userPreferencesService.setBudgetGroupCollapsedState(groupId, true);
      } else {
        // Expand all - remove from states
        this.userPreferencesService.setBudgetGroupCollapsedState(groupId, false);
      }
    }

    if (allExpanded) {
      this.groupCollapsedStates.set(newStates);
    } else {
      this.groupCollapsedStates.set({});
    }
  }

  private saveScrollPosition(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (container) {
      const scrollTop = container.scrollTop;
      if (scrollTop > 0) {
        sessionStorage.setItem(SCROLL_POSITION_KEY, scrollTop.toString());
      }
    }
  }

  private restoreScrollPosition(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (!container) {
      return;
    }

    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (savedPosition) {
      const scrollTop = parseInt(savedPosition, 10);
      if (!isNaN(scrollTop) && scrollTop > 0) {
        container.scrollTop = scrollTop;
        // Clear saved position after successful restoration
        sessionStorage.removeItem(SCROLL_POSITION_KEY);
      }
    }
  }

  /**
   * Set up auto-scroll for drag-and-drop operations.
   * This enables automatic scrolling when dragging items near the edges of the scroll container.
   */
  private setupAutoScroll(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (!container) return;

    this.autoScrollCleanup = autoScrollForElements({
      element: container,
      // Allow scrolling in both directions with a generous threshold
      // The threshold is specified in pixels from the edge where scrolling starts
      getConfiguration: () => ({
        maxScrollSpeed: 'standard',
      }),
    });
  }

  undo(): void {
    void this.undoRedoService.undo();
  }

  redo(): void {
    void this.undoRedoService.redo();
  }

  // Month navigation methods
  navigateToMonth(yearMonth: number): void {
    const isCurrent = yearMonth === this.currentMonth;
    const currentFilter = this.activeFilter();
    const existingFilterParam = this.queryParams()?.['filter'] as string | undefined;
    const queryParams: Record<string, string> = {};

    if (!isCurrent) {
      queryParams['month'] = yearMonth.toString();
    }

    // Preserve filter in URL (use existing param if available, otherwise use current filter)
    const filterToPreserve = existingFilterParam ?? (currentFilter !== 'all' ? currentFilter : undefined);
    if (filterToPreserve && filterToPreserve !== 'all') {
      // Convert internal filter names to URL query parameter format
      const urlFilter = filterToPreserve === 'extraFunded' ? 'extra-funded' : filterToPreserve;
      queryParams['filter'] = urlFilter;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: false,
    });
  }

  navigateToPreviousMonth(): void {
    const previous = this.previousMonth();
    if (previous) {
      this.navigateToMonth(previous);
    }
  }

  navigateToNextMonth(): void {
    const next = this.nextMonth();
    if (next) {
      this.navigateToMonth(next);
    }
  }

  // Budget data helpers
  getCategoryBudget(categoryId: string): BudgetMonthData['budgetData'][string] | undefined {
    return this.budgetDataByCategory()[categoryId];
  }

  getGroupTotal(groupId: string): { carryOver: bigint; assigned: bigint; activity: bigint; available: bigint } {
    return this.groupTotals()[groupId] ?? { carryOver: 0n, assigned: 0n, activity: 0n, available: 0n };
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  getActivity(categoryBudget: BudgetMonthData['budgetData'][string]): bigint {
    return categoryBudget.activity ?? 0n;
  }

  hasActiveTarget(category: { enableTarget?: boolean; target_type?: string }): boolean {
    return (category.enableTarget ?? false) && !!category.target_type;
  }

  isCategorySnoozed(categoryBudget: BudgetMonthData['budgetData'][string]): boolean {
    return categoryBudget.target.isSnoozed === true;
  }

  hasCategoryTarget(categoryId: Id<'category'>): boolean {
    const category = this.categoriesWithBankAccounts()
      .flatMap((group) => group.categories)
      .find((candidate) => candidate._id === categoryId);

    return category ? this.hasActiveTarget(category) : false;
  }

  isCategoryTargetSnoozed(categoryId: Id<'category'>): boolean {
    const categoryBudget = this.getCategoryBudget(categoryId);
    return categoryBudget ? this.isCategorySnoozed(categoryBudget) : false;
  }

  getCategoryIcon(category: { iconName?: string | null }): NucleoIconData | null {
    if (!category.iconName) return null;
    return this.iconService.getIconByName(category.iconName);
  }

  /**
   * Get the display name for a category.
   * For credit card categories with a linked bank account, returns the bank account name.
   * Otherwise, returns the category name.
   */
  getCategoryDisplayName(category: {
    _id?: Id<'category'>;
    categoryType?: string | null;
    bankAccountId?: Id<'bankAccount'> | null;
    bankAccount?: { name: string } | null;
    name: string;
  }): string {
    // Check if this is a credit card category (check both categoryType and group type)
    let isCreditCard = category.categoryType === 'credit_card';

    // If categoryType isn't set, check the group type from enriched categories
    if (!isCreditCard && category._id) {
      const groups = this.categoriesWithBankAccounts();
      for (const groupData of groups) {
        const foundCategory = groupData.categories.find((c) => c._id === category._id);
        if (foundCategory && groupData.group.type === 'credit_card') {
          isCreditCard = true;
          break;
        }
      }
    }

    if (isCreditCard && category.bankAccountId) {
      // First try to use the attached bank account
      if (category.bankAccount?.name) {
        return category.bankAccount.name;
      }
      // If not attached, do a lookup (fallback for edge cases)
      const bankAccounts = this.bankAccountService.bankAccounts();
      const bankAccount = bankAccounts.find((acc) => acc._id === category.bankAccountId);
      if (bankAccount?.name) {
        return bankAccount.name;
      }
    }
    // Otherwise, use the category name
    return category.name;
  }

  /**
   * Get the existing target for a category, if any.
   * Used to pass to the CategoryTargetDialog for editing.
   */
  getExistingTarget(category: unknown): CategoryTarget {
    return extractTarget(category as CategoryWithTarget);
  }

  /**
   * Check if a category is a credit card category.
   * Credit card categories cannot have their names edited.
   */
  isCreditCardCategory(category: { _id?: Id<'category'>; categoryType?: string | null }): boolean {
    // Check if categoryType is 'credit_card'
    if (category.categoryType === 'credit_card') {
      return true;
    }

    // If categoryType isn't set, check the group type from enriched categories
    if (category._id) {
      const groups = this.categoriesWithBankAccounts();
      for (const groupData of groups) {
        const foundCategory = groupData.categories.find((c) => c._id === category._id);
        if (foundCategory && groupData.group.type === 'credit_card') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a category is a system category or credit card category.
   * These categories cannot be deleted or archived.
   */
  isSystemOrCreditCardCategory(categoryId: Id<'category'>): boolean {
    const groups = this.categoriesWithBankAccounts();
    for (const groupData of groups) {
      const category = groupData.categories.find((c) => c._id === categoryId);
      if (category) {
        // Check if it's a system category
        if (category.isSystemCategory === true) {
          return true;
        }
        // Check if it's a credit card category (by categoryType or group type)
        if (category.categoryType === 'credit_card' || groupData.group.type === 'credit_card') {
          return true;
        }
        return false;
      }
    }
    return false;
  }

  /**
   * Get regular (non-system, non-credit-card) categories from a list of category IDs.
   */
  getRegularCategories(categoryIds: Id<'category'>[]): Id<'category'>[] {
    return categoryIds.filter((id) => !this.isSystemOrCreditCardCategory(id));
  }

  /**
   * Check if archive/delete actions should be disabled in the context menu.
   * Returns true if the right-clicked category or all selected categories are system/credit-card categories.
   */
  shouldDisableArchiveDelete(rightClickedCategoryId: Id<'category'>): boolean {
    const selectedCategories = this.selectionService.selectedCategories();
    const isClickedCategorySelected = selectedCategories.includes(rightClickedCategoryId);

    // Get the list of categories that would be affected by the action
    const categoriesToCheck =
      isClickedCategorySelected && selectedCategories.length > 0 ? selectedCategories : [rightClickedCategoryId];

    // Get regular (non-system, non-credit-card) categories
    const regularCategories = this.getRegularCategories(categoriesToCheck);

    // Disable if there are no regular categories to act upon
    return regularCategories.length === 0;
  }

  // Category selection handlers
  onHeaderCheckboxChange(): void {
    const visibleIds = this.visibleCategoryIds();
    if (visibleIds.length === 0) return;

    const selected = this.selectionService.selectedCategories();
    const selectedSet = new Set(selected);

    const allSelected = visibleIds.every((id) => selectedSet.has(id));
    if (allSelected) {
      // Deselect all visible categories
      for (const id of visibleIds) {
        this.selectionService.deselectCategory(id);
      }
    } else {
      // Select all visible categories
      this.selectionService.selectAllCategories(visibleIds);
    }
  }

  onGroupCheckboxChange(groupId: string): void {
    const categories = this.getCategoriesInGroup(groupId);
    if (categories.length === 0) return;

    const categoryIds = categories.map((cat) => cat._id);
    const selected = this.selectionService.selectedCategories();
    const selectedSet = new Set(selected);

    // Check if all visible categories in this group are selected
    const allSelected = categoryIds.every((id) => selectedSet.has(id));

    if (allSelected) {
      // Deselect all visible categories in this group
      for (const id of categoryIds) {
        this.selectionService.deselectCategory(id);
      }
    } else {
      // Select all visible categories in this group
      this.selectionService.selectAllCategories(categoryIds);
    }
  }

  onHiddenCategoriesCheckboxChange(groupId: string): void {
    const categories = this.getHiddenCategoriesInGroup(groupId);
    if (categories.length === 0) return;

    const categoryIds = categories.map((cat) => cat._id);
    const selected = this.selectionService.selectedCategories();
    const selectedSet = new Set(selected);

    // Check if all hidden categories in this group are selected
    const allSelected = categoryIds.every((id) => selectedSet.has(id));

    if (allSelected) {
      // Deselect all hidden categories in this group
      for (const id of categoryIds) {
        this.selectionService.deselectCategory(id);
      }
    } else {
      // Select all hidden categories in this group
      this.selectionService.selectAllCategories(categoryIds);
    }
  }

  onCategoryCheckboxChange(categoryId: string, event?: Event): void {
    const typedCategoryId = categoryId as Id<'category'>;
    const lastClicked = this.selectionService.getLastClickedCategoryId();

    // Shift+click: select range from last clicked to current
    const hasShiftKey = event && 'shiftKey' in event && (event as MouseEvent | KeyboardEvent).shiftKey;
    if (hasShiftKey && lastClicked) {
      this.selectionService.selectRange(lastClicked, typedCategoryId);
      this.selectionService.setLastClickedCategoryId(typedCategoryId);
    } else {
      // Normal click: toggle single category
      this.selectionService.toggleCategory(typedCategoryId);
      this.selectionService.setLastClickedCategoryId(typedCategoryId);
    }
  }

  onCategoryRowClick(categoryId: string, event: Event): void {
    const typedCategoryId = categoryId as Id<'category'>;
    const lastClicked = this.selectionService.getLastClickedCategoryId();

    // Shift+click: select range without deselecting others
    if ((event as KeyboardEvent | MouseEvent).shiftKey && lastClicked) {
      this.selectionService.selectRange(lastClicked, typedCategoryId);
      this.selectionService.setLastClickedCategoryId(typedCategoryId);
    } else {
      // Normal click: single selection mode (deselect all, select only this one)
      this.selectionService.deselectAllCategories();
      this.selectionService.selectCategory(typedCategoryId);
      this.selectionService.setLastClickedCategoryId(typedCategoryId);
    }
  }

  // Filter handlers
  setFilter(filter: 'all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded'): void {
    this.activeFilter.set(filter);
    this.budgetFilterService.setLastFilter(filter);

    // Update URL with filter query parameter
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    const queryParams: Record<string, string> = {};

    if (monthParam) {
      queryParams['month'] = monthParam;
    }

    if (filter !== 'all') {
      // Convert internal filter names to URL query parameter format
      const urlFilter = filter === 'extraFunded' ? 'extra-funded' : filter;
      queryParams['filter'] = urlFilter;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: false,
    });
  }

  toggleFavoriteFilter(): void {
    if (this.favoriteCount() === 0) return;
    this.setFavoriteFilter(!this.favoriteOnly());
  }

  isCategoryFavorite(categoryId: Id<'category'>): boolean {
    return (
      this.categoriesWithBankAccounts()
        .flatMap((group) => group.categories)
        .find((category) => category._id === categoryId)?.isFavorite ?? false
    );
  }

  async onToggleCategoryFavorite(categoryId: Id<'category'>, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const wasFavorite = this.isCategoryFavorite(categoryId);
    const success = await this.categoryService.setCategoryFavorite(categoryId, !wasFavorite);

    if (!success) {
      toast.error('Failed to update favorite');
      return;
    }

    if (wasFavorite && this.favoriteOnly() && this.favoriteCount() <= 1) {
      this.setFavoriteFilter(false);
    }
  }

  async onToggleCategoryTargetSnooze(categoryId: Id<'category'>, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId || !this.hasCategoryTarget(categoryId)) return;

    const snoozed = !this.isCategoryTargetSnoozed(categoryId);

    try {
      await this.convexService.mutation(api.categoryBudgets.toggleTargetSnooze, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        yearMonth: this.selectedMonth(),
        snoozed,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update snooze';
      console.error('Failed to toggle snooze:', errorMessage);
      toast.error(errorMessage);
    }
  }

  private restoreFavoriteFilter(): void {
    const key = this.favoriteFilterStorageKey();
    if (key) {
      this.favoriteOnly.set(localStorage.getItem(key) === 'true');
    }
  }

  private setFavoriteFilter(active: boolean): void {
    this.favoriteOnly.set(active);
    const key = this.favoriteFilterStorageKey();
    if (key) {
      localStorage.setItem(key, String(active));
    }
  }

  private favoriteFilterStorageKey(): string | null {
    const workspaceId = this.workspaceService.workspaceId();
    return workspaceId ? `${this.favoriteFilterStoragePrefix}:${workspaceId}` : null;
  }

  /**
   * Get the full class string for a filter button.
   * Uses string concatenation to avoid formatter issues with opacity modifiers in class bindings.
   */
  getFilterButtonClasses(
    filter: 'all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded',
    isDestructive = false
  ): string {
    const isActive = this.activeFilter() === filter;
    const counts = this.filterCounts();
    const count = counts[filter] ?? 0;
    const isDisabled = count === 0;

    const baseClasses = 'h-6 border text-xs px-2';
    const activeClass = isActive ? ' bg-accent/50' : '';
    const textClass = isDestructive
      ? ' text-destructive hover:text-destructive'
      : isActive
        ? ' text-foreground'
        : ' text-muted-foreground hover:text-foreground';
    const disabledClass = isDisabled ? ' pointer-events-none opacity-50' : '';

    return baseClasses + activeClass + textClass + disabledClass;
  }

  // Keyboard shortcuts:
  // - Cmd+F (Mac) / Ctrl+F (Windows) to focus search
  // - ] to toggle sidebar
  // - 1, 2, 3, 4, 5 to switch filters (when not typing in input)
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.aiChat.shouldCaptureShortcuts()) return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      if (!this.isSearchFocused()) {
        event.preventDefault();
        this.focusSearch();
      }
      return;
    }

    // Don't handle shortcuts if typing in input fields
    const target = event.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (!isTyping) {
      if (event.key === ']') {
        event.preventDefault();
        this.userPreferencesService.toggleBudgetSidebar();
      } else if (event.key === '1') {
        event.preventDefault();
        this.setFilter('all');
      } else if (event.key === '2') {
        event.preventDefault();
        this.setFilter('overspent');
      } else if (event.key === '3') {
        event.preventDefault();
        this.setFilter('underfunded');
      } else if (event.key === '4') {
        event.preventDefault();
        this.setFilter('available');
      } else if (event.key === '5') {
        event.preventDefault();
        this.setFilter('extraFunded');
      }
    }
  }

  // Search methods
  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.focusSearch();
  }

  onSearchFocus(): void {
    this.isSearchFocused.set(true);
  }

  onSearchBlur(): void {
    this.isSearchFocused.set(false);
  }

  onSearchEscape(): void {
    this.searchQuery.set('');
    this.searchInput()?.nativeElement.blur();
  }

  onWrapperSpaceKey(event: Event): void {
    // Only prevent default if the wrapper div itself has focus (not the input)
    // This allows space to work normally when typing in the input field
    const keyboardEvent = event as KeyboardEvent;
    if (
      keyboardEvent.target === keyboardEvent.currentTarget ||
      (keyboardEvent.target as HTMLElement).tagName !== 'INPUT'
    ) {
      keyboardEvent.preventDefault();
      this.focusSearch();
    }
  }

  // Category actions
  async onArchiveCategory(categoryId: Id<'category'>, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();

    // Get selected categories - if the right-clicked category is selected,
    // archive all selected categories; otherwise just archive the clicked one
    const selectedCategories = this.selectionService.selectedCategories();
    const isClickedCategorySelected = selectedCategories.includes(categoryId);

    const categoriesToArchiveIds =
      isClickedCategorySelected && selectedCategories.length > 0 ? selectedCategories : [categoryId];

    // Filter out system/credit-card categories - they cannot be archived
    const regularCategories = this.getRegularCategories(categoriesToArchiveIds);

    if (regularCategories.length === 0) {
      // No regular categories to archive
      return;
    }

    // Get the archive state from the right-clicked category to determine the action
    const allCategories = this.categoriesWithBankAccounts().flatMap((g) => g.categories);
    const clickedCategory = allCategories.find((c) => c._id === categoryId);
    if (!clickedCategory) return;

    const isArchived = clickedCategory.isArchived ?? false;
    const newArchivedState = !isArchived;

    // Determine toast messages based on action and count
    const categoryCount = regularCategories.length;
    const categoryText = categoryCount === 1 ? 'category' : 'categories';
    const action = newArchivedState ? 'Hiding' : 'Unhiding';
    const actionPast = newArchivedState ? 'hidden' : 'unhidden';

    // Archive all regular categories in a single batch operation with toast
    const archivePromise = this.categoryService.archiveCategories(regularCategories, newArchivedState);

    toast.promise(archivePromise, {
      loading: `${action} ${categoryCount} ${categoryText}...`,
      success: `Successfully ${actionPast} ${categoryCount} ${categoryText}`,
      error: `Failed to ${newArchivedState ? 'hide' : 'unhide'} ${categoryText}`,
    });

    await archivePromise;
  }

  onDeleteCategory(categoryId: Id<'category'>, event?: MouseEvent): void {
    event?.stopPropagation();

    // Get selected categories - if the right-clicked category is selected,
    // delete all selected categories; otherwise just delete the clicked one
    const selectedCategories = this.selectionService.selectedCategories();
    const isClickedCategorySelected = selectedCategories.includes(categoryId);

    const categoriesToDeleteIds =
      isClickedCategorySelected && selectedCategories.length > 0 ? selectedCategories : [categoryId];

    // Filter out system/credit-card categories - they cannot be deleted
    const regularCategories = this.getRegularCategories(categoriesToDeleteIds);

    if (regularCategories.length === 0) {
      // No regular categories to delete
      return;
    }

    // Get category objects
    const allCategories = this.categoriesWithBankAccounts().flatMap((g) => g.categories);
    const categories = allCategories.filter((c) => regularCategories.includes(c._id));

    if (categories.length === 0) return;

    // Build transaction counts map from budget data
    const budgetData = this.budgetDataByCategory();
    const transactionCounts = new Map<string, bigint>();
    for (const category of categories) {
      const categoryBudget = budgetData[category._id];
      if (categoryBudget?.transactionCount !== undefined) {
        transactionCounts.set(category._id, categoryBudget.transactionCount);
      }
    }

    // Open delete dialog
    const dialogRef = this.dialogService.open(DeleteCategoryDialogComponent, {
      context: {
        categories,
        transactionCounts,
        onClose: (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            // Clear selection after successful deletion
            this.selectionService.deselectAllCategories();
          }
        },
      },
    });
  }

  onDeleteCategoryGroup(groupId: Id<'categoryGroup'>): void {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) return;

    // Find the group data from the hierarchy (unfiltered)
    const groupData = this.categoryHierarchy()?.find((g) => g.group._id === groupId);
    if (!groupData) return;

    // Credit card groups cannot be deleted
    if (groupData.group.type === 'credit_card') return;

    // Get the total category count from the raw hierarchy (includes archived categories)
    // This ensures we always prompt for a target group if there are any categories (including archived)
    const totalCategoryCount = groupData.categories.filter((c) => !c.isDeleted).length;

    if (totalCategoryCount === 0) {
      // No categories - delete directly with toast
      const deletePromise = this.convexService.mutation(api.categoryGroups.deleteCategoryGroupWithMove, {
        categoryGroupId: groupId,
        workspaceId: workspaceId as Id<'workspace'>,
      });

      toast.promise(deletePromise, {
        loading: 'Deleting group...',
        success: 'Group deleted',
        error: (err) => (err instanceof Error ? err.message : 'Failed to delete group'),
      });
    } else {
      // Has categories - show dialog
      // Get available groups (non-deleted expense groups, excluding current)
      const availableGroups =
        this.categoryHierarchy()
          ?.filter((g) => g.group._id !== groupId && g.group.type !== 'credit_card' && !g.group.isDeleted)
          .map((g) => g.group) ?? [];

      const dialogRef = this.dialogService.open(DeleteCategoryGroupDialogComponent, {
        context: {
          categoryGroup: groupData.group,
          categoryCount: totalCategoryCount,
          availableGroups,
          onClose: (deleted?: boolean) => {
            dialogRef.close();
            if (deleted) {
              // Clear selection after successful deletion
              this.selectionService.deselectAllCategories();
            }
          },
        },
      });
    }
  }

  // ==========================================
  // Drag-and-Drop Handlers
  // ==========================================

  /**
   * Check if a category can be dragged.
   * System categories, archived categories cannot be dragged.
   * Also disabled when filtering is active.
   */
  isCategoryDragDisabled(category: { isSystemCategory?: boolean; isArchived?: boolean }): boolean {
    if (this.isDragDropDisabled()) return true;
    return category.isSystemCategory === true || category.isArchived === true;
  }

  /**
   * Check if a category group can be dragged.
   * System groups cannot be dragged.
   * Also disabled when filtering is active.
   */
  isGroupDragDisabled(): boolean {
    // All groups (including system groups like Credit Card) can be dragged for reordering
    return this.isDragDropDisabled();
  }

  /**
   * Create a validator function for category drops.
   * Used to check credit card constraints.
   */
  canAcceptCategoryDrop(targetGroupType: 'expense' | 'credit_card'): (source: DragData) => boolean {
    return (source: DragData): boolean => {
      const categoryType = source.categoryType;

      // Credit card categories cannot leave credit card group
      if (categoryType === 'credit_card' && targetGroupType !== 'credit_card') {
        return false;
      }

      // Non-credit card categories cannot enter credit card group
      if (categoryType !== 'credit_card' && targetGroupType === 'credit_card') {
        return false;
      }

      return true;
    };
  }

  /** Called when group drag starts */
  onGroupDragStart(): void {
    this.isDraggingGroup.set(true);
  }

  /** Called when group drag ends */
  onGroupDragEnd(): void {
    this.isDraggingGroup.set(false);
  }

  /** Called when category drag starts */
  onCategoryDragStart(): void {
    this.isDraggingCategory.set(true);
  }

  /** Called when category drag ends */
  onCategoryDragEnd(): void {
    this.isDraggingCategory.set(false);
  }

  /** Check if an empty group is the current drop target */
  isEmptyGroupDropTarget(groupId: Id<'categoryGroup'>): boolean {
    return this.dragContext.dropTargetGroupKey() === groupId;
  }

  /** Called when a category group is dropped */
  async onGroupDropped(event: DropEvent): Promise<void> {
    if (event.source.type !== 'category-group' || event.target.type !== 'category-group') return;

    const groups = this.filteredCategoryGroups();
    const sourceIndex = event.source.index;
    let targetIndex = event.target.index ?? 0;

    // Adjust target index based on edge position
    if (event.closestEdge === 'bottom') {
      targetIndex = targetIndex + 1;
    }
    // If dragging from before to after, account for the removed item
    if (sourceIndex < targetIndex) {
      targetIndex = targetIndex - 1;
    }

    if (sourceIndex === targetIndex) return;

    const categoryGroupId = event.source.id as Id<'categoryGroup'>;

    // Set optimistic state immediately using reorder utility
    const groupOrder = reorder({
      list: groups.map((g) => g.group._id),
      startIndex: sourceIndex,
      finishIndex: targetIndex,
    });
    this.optimisticGroupOrder.set(groupOrder);

    try {
      await this.categoryService.updateCategoryGroupSortOrder(categoryGroupId, targetIndex);
    } catch (error) {
      console.error('Failed to reorder category group:', error);
      toast.error('Failed to reorder group');
    } finally {
      // Clear optimistic state after mutation completes
      setTimeout(() => {
        this.optimisticGroupOrder.set(null);
      }, 100);
    }
  }

  /** Called when a category is dropped */
  async onCategoryDropped(
    event: DropEvent,
    targetGroup: { _id: Id<'categoryGroup'>; type: 'expense' | 'credit_card' }
  ): Promise<void> {
    if (event.source.type !== 'category') return;

    const sourceGroupId = event.source.groupLabel as Id<'categoryGroup'>;
    const targetGroupId = targetGroup._id;
    const categoryId = event.source.id as Id<'category'>;

    // Calculate target position
    let targetPosition = event.target.index ?? 0;
    if (event.closestEdge === 'bottom') {
      targetPosition = targetPosition + 1;
    }

    // Check if same group (reorder) or different group (move)
    if (sourceGroupId === targetGroupId) {
      // Same group - reorder within group
      const sourceIndex = event.source.index;

      // If dragging from before to after, account for the removed item
      if (sourceIndex < targetPosition) {
        targetPosition = targetPosition - 1;
      }

      if (sourceIndex === targetPosition) return;

      // Get categories in this group for optimistic reordering
      const group = this.filteredCategoryGroups().find((g) => g.group._id === targetGroupId);
      if (group) {
        const categoryIds = reorder({
          list: group.visibleCategories.map((c) => c._id),
          startIndex: sourceIndex,
          finishIndex: targetPosition,
        });

        // Set optimistic state
        const currentOrder = this.optimisticCategoryOrderByGroup() ?? {};
        this.optimisticCategoryOrderByGroup.set({
          ...currentOrder,
          [targetGroupId]: categoryIds,
        });
      }

      try {
        await this.categoryService.updateCategorySortOrder(categoryId, targetPosition);
      } catch (error) {
        console.error('Failed to reorder category:', error);
        toast.error('Failed to reorder category');
      } finally {
        // Clear optimistic state after mutation completes
        setTimeout(() => {
          this.optimisticCategoryOrderByGroup.set(null);
        }, 100);
      }
    } else {
      // Different group - move to new group
      // Frontend validation (backend also validates)
      const categoryType = event.source.categoryType;

      if (categoryType === 'credit_card' && targetGroup.type !== 'credit_card') {
        toast.error('Credit card categories must stay in the Credit Cards group');
        return;
      }

      if (categoryType !== 'credit_card' && targetGroup.type === 'credit_card') {
        toast.error('Only credit card categories can be in the Credit Cards group');
        return;
      }

      // Set optimistic state for cross-group move
      this.optimisticCategoryGroupMove.set({
        categoryId,
        fromGroupId: sourceGroupId,
        toGroupId: targetGroupId,
        toPosition: targetPosition,
      });

      try {
        await this.categoryService.moveCategoryToGroup(categoryId, targetGroupId, targetPosition);
      } catch (error) {
        console.error('Failed to move category:', error);
        toast.error('Failed to move category');
      } finally {
        // Clear optimistic state after mutation completes
        setTimeout(() => {
          this.optimisticCategoryGroupMove.set(null);
        }, 100);
      }
    }
  }

  /**
   * Handle category drop on a group header.
   * This inserts the category at position 0 of the target group.
   */
  async onCategoryDroppedOnGroupHeader(
    event: DropEvent,
    targetGroup: { _id: Id<'categoryGroup'>; type: 'expense' | 'credit_card' }
  ): Promise<void> {
    if (event.source.type !== 'category') return;

    const sourceGroupId = event.source.groupLabel as Id<'categoryGroup'>;
    const targetGroupId = targetGroup._id;
    const categoryId = event.source.id as Id<'category'>;

    // Dropping on header means insert at position 0
    const targetPosition = 0;

    // Check if same group (reorder to top) or different group (move to top)
    if (sourceGroupId === targetGroupId) {
      // Same group - reorder to top
      const sourceIndex = event.source.index;
      if (sourceIndex === 0) return; // Already at top

      // Get categories in this group for optimistic reordering
      const group = this.filteredCategoryGroups().find((g) => g.group._id === targetGroupId);
      if (group) {
        const categoryIds = reorder({
          list: group.visibleCategories.map((c) => c._id),
          startIndex: sourceIndex,
          finishIndex: targetPosition,
        });

        // Set optimistic state
        const currentOrder = this.optimisticCategoryOrderByGroup() ?? {};
        this.optimisticCategoryOrderByGroup.set({
          ...currentOrder,
          [targetGroupId]: categoryIds,
        });
      }

      try {
        await this.categoryService.updateCategorySortOrder(categoryId, targetPosition);
      } catch (error) {
        console.error('Failed to reorder category:', error);
        toast.error('Failed to reorder category');
      } finally {
        // Clear optimistic state after mutation completes
        setTimeout(() => {
          this.optimisticCategoryOrderByGroup.set(null);
        }, 100);
      }
    } else {
      // Different group - move to top of new group
      const categoryType = event.source.categoryType;

      if (categoryType === 'credit_card' && targetGroup.type !== 'credit_card') {
        toast.error('Credit card categories must stay in the Credit Cards group');
        return;
      }

      if (categoryType !== 'credit_card' && targetGroup.type === 'credit_card') {
        toast.error('Only credit card categories can be in the Credit Cards group');
        return;
      }

      // Set optimistic state for cross-group move
      this.optimisticCategoryGroupMove.set({
        categoryId,
        fromGroupId: sourceGroupId,
        toGroupId: targetGroupId,
        toPosition: targetPosition,
      });

      try {
        await this.categoryService.moveCategoryToGroup(categoryId, targetGroupId, targetPosition);
      } catch (error) {
        console.error('Failed to move category:', error);
        toast.error('Failed to move category');
      } finally {
        // Clear optimistic state after mutation completes
        setTimeout(() => {
          this.optimisticCategoryGroupMove.set(null);
        }, 100);
      }
    }
  }

  // ==========================================
  // Funding Status Text
  // ==========================================

  /**
   * Get the funding status text for a category (matches iOS implementation).
   * Returns text like "Funded", "$50 more needed", "Overspent", etc.
   */
  getFundingStatusText(
    category: {
      enableTarget?: boolean;
      target_type?: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
      target_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
      target_frequencyInterval?: number;
      target_dueDay?: number;
    },
    budgetData: BudgetMonthData['budgetData'][string]
  ): string | null {
    if (!budgetData || !category.enableTarget || !category.target_type) {
      return null;
    }

    const remaining = budgetData.target.remainingToAssign;
    const targetType = category.target_type;
    const frequency = category.target_frequency;

    // Check if overspent first
    if (budgetData.available < 0n) {
      const outflow = budgetData.outflowAmount ?? 0n;
      if (outflow > 0n) {
        const originalAvailable = budgetData.available + outflow;
        return `Overspent. ${this.formatCurrency(outflow)} of ${this.formatCurrency(originalAvailable)}`;
      }
      return 'Overspent';
    }

    // Check for overfunded status
    const overfunded = budgetData.target.overfundedByAmount;
    if (overfunded > 0n) {
      return `Overfunded by ${this.formatCurrency(overfunded)}`;
    }

    // Target is met
    if (remaining <= 0n) {
      switch (targetType) {
        case 'recurring':
        case 'recurring_rollover':
          return 'Funded';
        case 'maintain_balance':
        case 'one_time':
          if (budgetData.target.targetAmount !== undefined && budgetData.available >= budgetData.target.targetAmount) {
            return 'Funded';
          }
          return 'On track';
      }
    }

    // Underfunded - needs more assignment
    const formattedAmount = this.formatCurrency(remaining);

    switch (targetType) {
      case 'recurring':
      case 'recurring_rollover': {
        if (!frequency) return `${formattedAmount} needed`;
        switch (frequency) {
          case 'monthly': {
            const interval = category.target_frequencyInterval ?? 1;
            if (interval === 1) {
              if (category.target_dueDay !== undefined) {
                if (category.target_dueDay <= 0) {
                  return `${formattedAmount} more needed this month`;
                }
                return `${formattedAmount} more needed by the ${this.ordinal(category.target_dueDay)}`;
              }
              return `${formattedAmount} needed`;
            } else {
              // Multi-month: show date only in due month
              const current = budgetData.target.currentMonthInInterval ?? 1;
              const total = budgetData.target.totalMonthsInInterval ?? 1;
              if (current === total && category.target_dueDay !== undefined) {
                if (category.target_dueDay <= 0) {
                  return `${formattedAmount} more needed this month`;
                }
                return `${formattedAmount} more needed by the ${this.ordinal(category.target_dueDay)}`;
              }
              return `${formattedAmount} more needed this month`;
            }
          }
          case 'yearly': {
            const current = budgetData.target.currentMonthInInterval ?? 1;
            const total = budgetData.target.totalMonthsInInterval ?? 1;
            if (current === total && category.target_dueDay !== undefined) {
              if (category.target_dueDay <= 0) {
                return `${formattedAmount} more needed this month`;
              }
              return `${formattedAmount} needed by the ${this.ordinal(category.target_dueDay)}`;
            }
            return `${formattedAmount} more needed this month`;
          }
          case 'weekly':
          case 'daily':
            return `${formattedAmount} needed`;
        }
        return `${formattedAmount} needed`;
      }
      case 'maintain_balance':
        return `${formattedAmount} more needed this month`;
      case 'one_time':
        return `${formattedAmount} needed`;
      default:
        return `${formattedAmount} needed`;
    }
  }

  /**
   * Get ordinal suffix for a day number (1st, 2nd, 3rd, etc.)
   */
  private ordinal(day: number): string {
    if (day === -1) return 'end of month';
    const ones = day % 10;
    const tens = Math.floor((day / 10) % 10);
    if (tens === 1) return `${day}th`;
    switch (ones) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  }

  // ==========================================
  // Quick Assign Helper Methods
  // ==========================================

  private activityToSpent(activity: bigint): bigint {
    return activity < 0n ? -activity : 0n;
  }

  getSpentLastMonth(categoryId: Id<'category'>): bigint {
    const previousYearMonth = getPreviousYearMonth(this.selectedMonth());
    const previousMonth = this.budgetService.months().find((m) => m.yearMonth === previousYearMonth);
    if (!previousMonth) return 0n;
    return this.activityToSpent(previousMonth.budgetData[categoryId]?.activity ?? 0n);
  }

  getMonthlyAverage(categoryId: Id<'category'>): bigint {
    const currentYearMonth = this.selectedMonth();
    const previousMonths = this.budgetService.months().filter((m) => m.yearMonth < currentYearMonth);
    if (previousMonths.length === 0) return 0n;

    let totalSpent = 0n;
    for (const month of previousMonths) {
      totalSpent += this.activityToSpent(month.budgetData[categoryId]?.activity ?? 0n);
    }
    return totalSpent / BigInt(previousMonths.length);
  }

  getMonthlyHistory(categoryId: Id<'category'>): { yearMonth: number; spent: bigint }[] {
    const currentYearMonth = this.selectedMonth();
    return this.budgetService
      .months()
      .filter((m) => m.yearMonth < currentYearMonth)
      .sort((a, b) => b.yearMonth - a.yearMonth)
      .slice(0, 6)
      .reverse()
      .map((m) => ({
        yearMonth: m.yearMonth,
        spent: this.activityToSpent(m.budgetData[categoryId]?.activity ?? 0n),
      }));
  }
}
