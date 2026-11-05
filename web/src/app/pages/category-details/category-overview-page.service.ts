import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';

export type { TransactionWithRelations };
export type CategoryWithStats = FunctionReturnType<typeof api.categories.getCategoryWithStats>;

/**
 * Service to share category data and transactions between the category parent page and its child routes
 */
@Injectable()
export class CategoryOverviewPageService {
  private readonly transactionService = inject(TransactionService);
  private readonly destroyRef = inject(DestroyRef);

  // Category state
  private readonly _currentCategory = signal<CategoryWithStats | null>(null);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _categoryNameEdit = signal<string>('');
  private readonly _error = signal<string | null>(null);

  // Public read-only signals - Category
  readonly category = computed(() => this._currentCategory());
  readonly isLoading = computed(() => this._isLoading());
  readonly categoryNameEdit = computed(() => this._categoryNameEdit());
  readonly error = this._error.asReadonly();

  // Use global transaction service with client-side filtering by categoryId
  readonly transactionsLoading = this.transactionService.loading;

  // Computed: transactions filtered by the current category
  readonly transactions = computed(() => {
    const category = this._currentCategory();
    if (!category) return [];

    const allTransactions = this.transactionService.transactions();
    return allTransactions.filter((t) => t.movements.some((m) => m.categoryId === category._id));
  });

  readonly sortedTransactions = computed(() => {
    return [...this.transactions()].sort((a, b) => {
      const dateA = a.date ?? '';
      const dateB = b.date ?? '';
      return dateB.localeCompare(dateA);
    });
  });

  readonly recentTransactions = computed(() => this.sortedTransactions().slice(0, 3));

  constructor() {
    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      void this.transactionService.updateFilters({ categoryId: undefined });
    });
  }

  setCategory(category: CategoryWithStats | null) {
    this._currentCategory.set(category);
    // Initialize the edit name when category is loaded
    if (category) {
      this._categoryNameEdit.set(category.name);
      // Set the categoryId filter on the global transaction service
      void this.transactionService.updateFilters({
        categoryId: category._id,
      });
    } else {
      this._error.set(null);
      void this.transactionService.updateFilters({ categoryId: undefined });
    }
  }

  setCategoryNameEdit(name: string) {
    this._categoryNameEdit.set(name);
  }

  setLoading(isLoading: boolean) {
    this._isLoading.set(isLoading);
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }
}
