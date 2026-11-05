import { computed, inject, Injectable, signal } from '@angular/core';
import { Id } from 'convex/_generated/dataModel';
import { CategoryService } from './category.service';

@Injectable({
  providedIn: 'root',
})
export class BudgetCategorySelectionService {
  private readonly categoryService = inject(CategoryService);

  // Internal state - use Set for efficient lookups
  private readonly _selectedCategoryIds = signal<Set<Id<'category'>>>(new Set());

  // Visible category IDs (set by budget component based on current filter)
  private readonly _visibleCategoryIds = signal<Id<'category'>[]>([]);

  // Track last clicked category for shift+click range selection
  private readonly _lastClickedCategoryId = signal<Id<'category'> | null>(null);

  // Public readonly signal
  readonly selectedCategoryIds = this._selectedCategoryIds.asReadonly();

  // Computed signals
  readonly selectedCategories = computed(() => {
    return Array.from(this._selectedCategoryIds());
  });

  readonly hasSelections = computed(() => {
    return this._selectedCategoryIds().size > 0;
  });

  readonly isAllSelected = computed(() => {
    const hierarchy = this.categoryService.categoryHierarchy();
    const allCategoryIds = new Set<Id<'category'>>();

    for (const groupData of hierarchy) {
      if (groupData.group.isDeleted) continue;
      for (const category of groupData.categories) {
        if (!category.isDeleted) {
          allCategoryIds.add(category._id);
        }
      }
    }

    if (allCategoryIds.size === 0) return false;

    const selected = this._selectedCategoryIds();
    return allCategoryIds.size === selected.size && Array.from(allCategoryIds).every((id) => selected.has(id));
  });

  readonly isSomeSelected = computed(() => {
    const selected = this._selectedCategoryIds();
    if (selected.size === 0) return false;

    const hierarchy = this.categoryService.categoryHierarchy();
    const allCategoryIds = new Set<Id<'category'>>();

    for (const groupData of hierarchy) {
      if (groupData.group.isDeleted) continue;
      for (const category of groupData.categories) {
        if (!category.isDeleted) {
          allCategoryIds.add(category._id);
        }
      }
    }

    if (allCategoryIds.size === 0) return false;

    // Some selected but not all
    return selected.size > 0 && selected.size < allCategoryIds.size;
  });

  // Check if a specific category is selected
  isCategorySelected(categoryId: Id<'category'>) {
    return computed(() => this._selectedCategoryIds().has(categoryId));
  }

  // Check if all categories in a group are selected
  isGroupFullySelected(groupId: string) {
    return computed(() => {
      const hierarchy = this.categoryService.categoryHierarchy();
      const groupData = hierarchy.find((item) => item.group._id === groupId);

      if (!groupData) return false;

      const groupCategories = groupData.categories.filter((cat) => !cat.isDeleted);
      if (groupCategories.length === 0) return false;

      const selected = this._selectedCategoryIds();
      return groupCategories.every((cat) => selected.has(cat._id));
    });
  }

  // Check if some (but not all) categories in a group are selected
  isGroupPartiallySelected(groupId: string) {
    return computed(() => {
      const hierarchy = this.categoryService.categoryHierarchy();
      const groupData = hierarchy.find((item) => item.group._id === groupId);

      if (!groupData) return false;

      const groupCategories = groupData.categories.filter((cat) => !cat.isDeleted);
      if (groupCategories.length === 0) return false;

      const selected = this._selectedCategoryIds();
      const selectedCount = groupCategories.filter((cat) => selected.has(cat._id)).length;

      return selectedCount > 0 && selectedCount < groupCategories.length;
    });
  }

  // Get checkbox state for a group (true, false, or 'indeterminate')
  getGroupCheckboxState(groupId: string) {
    return computed(() => {
      const fullySelected = this.isGroupFullySelected(groupId)();
      const partiallySelected = this.isGroupPartiallySelected(groupId)();

      if (fullySelected) return true;
      if (partiallySelected) return 'indeterminate' as const;
      return false;
    });
  }

  // Selection methods
  selectCategory(categoryId: Id<'category'>): void {
    this._selectedCategoryIds.update((set) => {
      const newSet = new Set(set);
      newSet.add(categoryId);
      return newSet;
    });
  }

  deselectCategory(categoryId: Id<'category'>): void {
    this._selectedCategoryIds.update((set) => {
      const newSet = new Set(set);
      newSet.delete(categoryId);
      return newSet;
    });
  }

  toggleCategory(categoryId: Id<'category'>): void {
    const current = this._selectedCategoryIds();
    if (current.has(categoryId)) {
      this.deselectCategory(categoryId);
    } else {
      this.selectCategory(categoryId);
    }
  }

  selectAllCategories(categoryIds: Id<'category'>[]): void {
    this._selectedCategoryIds.update((set) => {
      const newSet = new Set(set);
      for (const id of categoryIds) {
        newSet.add(id);
      }
      return newSet;
    });
  }

  deselectAllCategories(): void {
    this._selectedCategoryIds.set(new Set());
  }

  selectGroupCategories(groupId: string, categoryIds: Id<'category'>[]): void {
    this.selectAllCategories(categoryIds);
  }

  deselectGroupCategories(groupId: string): void {
    const hierarchy = this.categoryService.categoryHierarchy();
    const groupData = hierarchy.find((item) => item.group._id === groupId);

    if (!groupData) return;

    const groupCategoryIds = groupData.categories.filter((cat) => !cat.isDeleted).map((cat) => cat._id);

    this._selectedCategoryIds.update((set) => {
      const newSet = new Set(set);
      for (const id of groupCategoryIds) {
        newSet.delete(id);
      }
      return newSet;
    });
  }

  toggleGroupCategories(groupId: string, categoryIds: Id<'category'>[]): void {
    const fullySelected = this.isGroupFullySelected(groupId)();

    if (fullySelected) {
      this.deselectGroupCategories(groupId);
    } else {
      this.selectGroupCategories(groupId, categoryIds);
    }
  }

  // Get all category IDs from the hierarchy
  getAllCategoryIds(): Id<'category'>[] {
    const hierarchy = this.categoryService.categoryHierarchy();
    const allIds: Id<'category'>[] = [];

    for (const groupData of hierarchy) {
      if (groupData.group.isDeleted) continue;
      for (const category of groupData.categories) {
        if (!category.isDeleted) {
          allIds.push(category._id);
        }
      }
    }

    return allIds;
  }

  // Set visible category IDs (called by budget component when filter changes)
  setVisibleCategoryIds(categoryIds: Id<'category'>[]): void {
    this._visibleCategoryIds.set(categoryIds);
  }

  // Select all visible categories
  selectAllVisibleCategories(): void {
    const visibleIds = this._visibleCategoryIds();
    if (visibleIds.length > 0) {
      this.selectAllCategories(visibleIds);
    }
  }

  // Get visible category IDs
  getVisibleCategoryIds(): Id<'category'>[] {
    return this._visibleCategoryIds();
  }

  // Get last clicked category ID for shift+click range selection
  getLastClickedCategoryId(): Id<'category'> | null {
    return this._lastClickedCategoryId();
  }

  // Set last clicked category ID
  setLastClickedCategoryId(categoryId: Id<'category'> | null): void {
    this._lastClickedCategoryId.set(categoryId);
  }

  // Select a range of categories between two IDs (inclusive)
  // Uses the visible category order to determine the range
  selectRange(fromId: Id<'category'>, toId: Id<'category'>): void {
    const visibleIds = this._visibleCategoryIds();
    const fromIndex = visibleIds.indexOf(fromId);
    const toIndex = visibleIds.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) return;

    const startIndex = Math.min(fromIndex, toIndex);
    const endIndex = Math.max(fromIndex, toIndex);

    const rangeIds = visibleIds.slice(startIndex, endIndex + 1);
    this.selectAllCategories(rangeIds);
  }
}
