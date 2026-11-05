import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Merchant } from '../../services/merchant.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';

export type { TransactionWithRelations };

type LoadedMerchant = Exclude<Merchant, null>;

/**
 * Service to share merchant data and transactions between the merchant parent page and its child routes
 */
@Injectable()
export class MerchantPageService {
  private readonly transactionService = inject(TransactionService);
  private readonly destroyRef = inject(DestroyRef);

  // Merchant state
  private readonly _currentMerchant = signal<Merchant | null>(null);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _merchantNameEdit = signal<string>('');
  private readonly _error = signal<string | null>(null);

  // Public read-only signals - Merchant
  readonly merchant = computed(() => this._currentMerchant());
  readonly isLoading = computed(() => this._isLoading());
  readonly merchantNameEdit = computed(() => this._merchantNameEdit());
  readonly error = this._error.asReadonly();

  // Use global transaction service with client-side filtering by merchantId
  readonly transactionsLoading = this.transactionService.loading;

  // Computed: transactions filtered by the current merchant
  readonly transactions = computed(() => {
    const merchant = this._currentMerchant();
    if (!merchant) return [];

    const allTransactions = this.transactionService.transactions();
    return allTransactions.filter((t) => t.merchantId === merchant._id);
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
      void this.transactionService.updateFilters({ merchantId: undefined });
    });
  }

  setMerchant(merchant: Merchant | null) {
    this._currentMerchant.set(merchant);
    // Initialize the edit name when merchant is loaded
    if (merchant) {
      this._merchantNameEdit.set(merchant.name);
      // Set the merchantId filter on the global transaction service
      void this.transactionService.updateFilters({
        merchantId: merchant._id,
      });
    } else {
      this._error.set(null);
      void this.transactionService.updateFilters({ merchantId: undefined });
    }
  }

  setCurrentMerchant(merchant: LoadedMerchant) {
    this._currentMerchant.set(merchant);
  }

  setMerchantNameEdit(name: string) {
    this._merchantNameEdit.set(name);
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
