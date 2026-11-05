import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';
import { ReportingService, TrackingEvent } from './reporting.service';
import { WorkspaceService } from './workspace.service';

// Infer the return types from the hierarchical query
export type CategoryHierarchy = FunctionReturnType<typeof api.categories.listCategoriesHierarchical>;
export type CategoryGroup = CategoryHierarchy[number]['group'];
export type Category = CategoryHierarchy[number]['categories'][number];
export type CategoryDetails = FunctionReturnType<typeof api.categories.getCategory>;

export interface CategoryFilters {
  type?: 'expense' | 'credit_card';
  includeDeleted?: boolean;
  search?: string;
}

@Injectable({
  providedIn: 'root',
})
export class CategoryService {
  private readonly convexService = inject(ConvexService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly destroyRef = inject(DestroyRef);

  // Signals for state management - store hierarchical data
  private readonly _categoryHierarchy = signal<CategoryHierarchy>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<CategoryFilters>({});

  // Subscription management
  private categorySubscription?: () => void;

  // Public read-only signals
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();

  // Expose the hierarchical structure directly
  readonly categoryHierarchy = this._categoryHierarchy.asReadonly();

  // Flatten categories from hierarchy for backward compatibility
  private readonly _allCategories = computed(() => {
    return this._categoryHierarchy().flatMap((item) => item.categories);
  });

  // Filtered categories computed from all categories and search filter
  readonly categories = computed(() => {
    const allCategories = this._allCategories();
    const filters = this._filters();
    const search = filters.search?.toLowerCase().trim();

    let filteredCategories = allCategories;

    if (search) {
      filteredCategories = filteredCategories.filter((category) => category.name.toLowerCase().includes(search));
    }

    return filteredCategories;
  });

  // Computed values
  readonly sortedCategories = computed(() =>
    [...this._allCategories()].sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    })
  );

  readonly totalCategories = computed(() => this._allCategories().length);
  readonly hasCategories = computed(() => this._allCategories().length > 0);

  readonly activeCategories = computed(() => {
    return this._allCategories().filter((category) => !category.isDeleted);
  });

  readonly deletedCategories = computed(() => {
    return this._allCategories().filter((category) => category.isDeleted);
  });

  // Groups computed from hierarchy
  readonly groups = computed(() => {
    return this._categoryHierarchy().map((item) => item.group);
  });

  readonly activeGroups = computed(() => {
    return this._categoryHierarchy()
      .filter((item) => !item.group.isDeleted)
      .map((item) => item.group);
  });

  // Computed values for category groups - now simpler since data is already grouped
  readonly categoriesByGroup = computed(() => {
    const byGroup = new Map<string, Category[]>();
    this._categoryHierarchy().forEach((item) => {
      byGroup.set(
        item.group._id,
        item.categories.filter((c) => !c.isDeleted)
      );
    });
    return byGroup;
  });

  readonly ungroupedCategories = computed(() =>
    this._allCategories().filter((c) => !c.categoryGroupId && !c.isDeleted)
  );

  constructor() {
    // Start watching categories when authenticated AND workspace is available
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      if (this.convexService.isAuthenticated() && hasWorkspace) {
        this.startWatchingCategories();
      } else {
        this.stopWatchingCategories();
        this._categoryHierarchy.set([]);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingCategories();
    });
  }

  /**
   * Update filters (client-side filtering for search, server request for other filters)
   */
  updateFilters(filters: Partial<CategoryFilters>) {
    const previousFilters = this._filters();
    this._filters.update((current) => ({ ...current, ...filters }));

    // Only restart subscription if server-side filters change (type or includeDeleted)
    const serverFiltersChanged =
      (filters.type !== undefined && filters.type !== previousFilters.type) ||
      (filters.includeDeleted !== undefined && filters.includeDeleted !== previousFilters.includeDeleted);

    if (serverFiltersChanged) {
      this.startWatchingCategories();
    }
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    this._filters.set({});
    this.startWatchingCategories();
  }

  /**
   * Start watching categories with real-time updates
   */
  private startWatchingCategories() {
    // Stop existing subscription if any
    this.stopWatchingCategories();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._loading.set(false);
      this._error.set('No workspace selected');
      return;
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      const filters = this._filters();
      const queryArgs: {
        workspaceId: Id<'workspace'>;
        includeDeleted: boolean;
        type?: 'expense' | 'credit_card';
      } = {
        workspaceId: workspaceId as Id<'workspace'>,
        includeDeleted: filters.includeDeleted ?? false,
      };

      // Add type filter if specified
      if (filters.type) {
        queryArgs.type = filters.type;
      }

      // Subscribe to the hierarchical query
      const watcher = this.convexService.watchQuery<CategoryHierarchy>(
        api.categories.listCategoriesHierarchical,
        queryArgs
      );

      this.categorySubscription = watcher.subscribe((hierarchy) => {
        if (hierarchy !== undefined) {
          this._categoryHierarchy.set(hierarchy);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching categories:', error);
      this._error.set('Failed to load categories');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching categories
   */
  private stopWatchingCategories() {
    if (this.categorySubscription) {
      this.categorySubscription();
      this.categorySubscription = undefined;
    }
  }

  /**
   * Update an existing category
   */
  async updateCategory(
    categoryId: Id<'category'>,
    updates: { name?: string; categoryGroupId?: Id<'categoryGroup'>; iconName?: string }
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }
      await this.convexService.mutation(api.categories.updateCategory, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        ...updates,
      });
      return true;
    } catch (error) {
      console.error('Error updating category:', error);
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this._error.set('A category with this name already exists');
        } else {
          this._error.set('Failed to update category');
        }
      } else {
        this._error.set('Failed to update category');
      }
      return false;
    }
  }

  async setCategoryFavorite(categoryId: Id<'category'>, isFavorite: boolean): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    try {
      this._error.set(null);
      await this.convexService.mutation(api.categories.setCategoryFavorite, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        isFavorite,
      });
      return true;
    } catch (error: unknown) {
      console.error('Failed to update category favorite:', error);
      this._error.set(error instanceof Error ? error.message : 'Failed to update category favorite');
      return false;
    }
  }

  /**
   * Archive or unarchive a category
   */
  async archiveCategory(categoryId: Id<'category'>, isArchived: boolean): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    this._error.set(null);

    try {
      await this.convexService.mutation(api.categories.updateCategory, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        isArchived,
      });
      return true;
    } catch (error: unknown) {
      console.error('Failed to archive category:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to archive category';
      this._error.set(errorMessage);
      return false;
    }
  }

  /**
   * Archive or unarchive multiple categories
   */
  async archiveCategories(categoryIds: Id<'category'>[], isArchived: boolean): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    if (categoryIds.length === 0) {
      return true;
    }

    this._error.set(null);

    try {
      await this.convexService.mutation(api.categories.archiveCategories, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryIds,
        isArchived,
      });
      return true;
    } catch (error: unknown) {
      console.error('Failed to archive categories:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to archive categories';
      this._error.set(errorMessage);
      return false;
    }
  }

  /**
   * Delete multiple categories with optional transaction recategorization
   */
  async deleteCategoriesWithRecategorization(
    categoryIds: Id<'category'>[],
    newCategoryId?: Id<'category'>
  ): Promise<{ deletedCount: number; movedTransactionCount: number }> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        throw new Error('No workspace selected');
      }
      const result = await this.convexService.mutation(api.categories.deleteCategoriesWithRecategorization, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryIds,
        newCategoryId,
      });
      this.reportingService.capture(TrackingEvent.CATEGORY_DELETED);
      return result as { deletedCount: number; movedTransactionCount: number };
    } catch (error) {
      console.error('Error deleting categories:', error);
      this._error.set(error instanceof Error ? error.message : 'Failed to delete categories');
      throw error;
    }
  }

  /**
   * Get a specific category by ID with detailed stats
   */
  async getCategory(categoryId: Id<'category'>): Promise<CategoryDetails | null> {
    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const category = await this.convexService.getClient().query(api.categories.getCategory, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
      });
      return category;
    } catch (error) {
      console.error('Error getting category:', error);
      this._error.set('Failed to get category details');
      return null;
    }
  }

  /**
   * Get a category by the last 8 characters of its ID
   * First checks if category exists in local state, otherwise returns null
   */
  getCategoryByShortId(shortId: string): Category | null {
    const localCategory = this._allCategories().find((c) => c._id.slice(-8) === shortId);
    return localCategory ?? null;
  }

  /**
   * Create a new category in a group
   */
  async createCategory(name: string, categoryGroupId: Id<'categoryGroup'>): Promise<Id<'category'> | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const result = await this.convexService.mutation<Id<'category'>>(api.categories.createCategory, {
        workspaceId: workspaceId as Id<'workspace'>,
        name,
        categoryGroupId,
      });
      this.reportingService.capture(TrackingEvent.CATEGORY_CREATED);
      return result;
    } catch (error) {
      console.error('Error creating category:', error);
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this._error.set('A category with this name already exists');
        } else {
          this._error.set('Failed to create category');
        }
      } else {
        this._error.set('Failed to create category');
      }
      return null;
    }
  }

  /**
   * Create a new category group
   */
  async createCategoryGroup(name: string, type: 'expense' | 'credit_card'): Promise<Id<'categoryGroup'> | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const result = await this.convexService.mutation<Id<'categoryGroup'>>(api.categoryGroups.createCategoryGroup, {
        workspaceId: workspaceId as Id<'workspace'>,
        name,
        type,
      });
      this.reportingService.capture(TrackingEvent.CATEGORY_GROUP_CREATED);
      return result;
    } catch (error) {
      console.error('Error creating category group:', error);
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this._error.set('A category group with this name already exists');
        } else {
          this._error.set('Failed to create category group');
        }
      } else {
        this._error.set('Failed to create category group');
      }
      return null;
    }
  }

  /**
   * Update an existing category group
   */
  async updateCategoryGroup(
    categoryGroupId: Id<'categoryGroup'>,
    updates: { name?: string; type?: 'expense' | 'credit_card' }
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }
      await this.convexService.mutation(api.categoryGroups.updateCategoryGroup, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryGroupId,
        ...updates,
      });
      return true;
    } catch (error) {
      console.error('Error updating category group:', error);
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this._error.set('A category group with this name already exists');
        } else if (error.message.includes('with existing categories')) {
          this._error.set('Cannot change type of category group with existing categories');
        } else {
          this._error.set('Failed to update category group');
        }
      } else {
        this._error.set('Failed to update category group');
      }
      return false;
    }
  }

  /**
   * Delete a category group (soft delete)
   */
  async deleteCategoryGroup(categoryGroupId: Id<'categoryGroup'>): Promise<boolean> {
    try {
      this._error.set(null);
      await this.convexService.mutation(api.categoryGroups.deleteCategoryGroup, {
        categoryGroupId,
      });
      this.reportingService.capture(TrackingEvent.CATEGORY_GROUP_DELETED);
      return true;
    } catch (error) {
      console.error('Error deleting category group:', error);
      this._error.set('Failed to delete category group');
      return false;
    }
  }

  /**
   * Refresh categories manually
   */
  refresh() {
    this.startWatchingCategories();
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Update the sort order of a category within its group
   */
  async updateCategorySortOrder(categoryId: Id<'category'>, newPosition: number): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    try {
      await this.convexService.mutation(api.categories.updateCategorySortOrder, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        newPosition,
      });
      this.reportingService.capture(TrackingEvent.CATEGORY_REORDERED);
      return true;
    } catch (error) {
      console.error('Error updating category sort order:', error);
      this._error.set('Failed to reorder category');
      return false;
    }
  }

  /**
   * Update the sort order of a category group
   */
  async updateCategoryGroupSortOrder(categoryGroupId: Id<'categoryGroup'>, newPosition: number): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    try {
      await this.convexService.mutation(api.categoryGroups.updateCategoryGroupSortOrder, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryGroupId,
        newPosition,
      });
      return true;
    } catch (error) {
      console.error('Error updating category group sort order:', error);
      this._error.set('Failed to reorder group');
      return false;
    }
  }

  /**
   * Move a category to a different group at a specific position
   */
  async moveCategoryToGroup(
    categoryId: Id<'category'>,
    targetGroupId: Id<'categoryGroup'>,
    newPosition: number
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    try {
      await this.convexService.mutation(api.categories.moveCategoryToGroup, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId,
        targetGroupId,
        newPosition,
      });
      return true;
    } catch (error) {
      console.error('Error moving category to group:', error);
      if (error instanceof Error) {
        this._error.set(error.message);
      } else {
        this._error.set('Failed to move category');
      }
      return false;
    }
  }
}
