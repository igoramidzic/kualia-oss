import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { BankAccountWithRelations } from '../../services/bank-account.service';
import { TransactionService } from '../../services/transaction.service';

@Injectable()
export class BankAccountPageService {
  private readonly transactionService = inject(TransactionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _bankAccount = signal<BankAccountWithRelations | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly bankAccount = computed(() => this._bankAccount());
  readonly error = this._error.asReadonly();

  // Use global transaction service with server-side filtering by bankAccountId
  readonly transactionsLoading = this.transactionService.loading;
  readonly loadingMore = this.transactionService.loadingMore;
  readonly hasMore = this.transactionService.hasMore;

  // Computed: transactions filtered by the current bank account (server-side filtering via updateFilters)
  readonly transactions = this.transactionService.transactions;

  readonly sortedTransactions = computed(() => {
    return [...this.transactions()].sort((a, b) => {
      const dateA = a.date ?? '';
      const dateB = b.date ?? '';
      return dateB.localeCompare(dateA);
    });
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      // Clear bankAccountId filter when leaving the page
      void this.transactionService.updateFilters({ bankAccountId: undefined });
    });
  }

  setBankAccount(bankAccount: BankAccountWithRelations | null) {
    this._bankAccount.set(bankAccount);

    if (bankAccount) {
      // Set the bankAccountId filter on the global transaction service
      // Clear other filters (filterType, merchantId, categoryId, search) to ensure we only show
      // transactions for this bank account, not filtered by status/search from other pages
      void this.transactionService.updateFilters({
        bankAccountId: bankAccount._id,
        filterType: undefined,
        merchantId: undefined,
        categoryId: undefined,
        search: undefined,
      });
    } else {
      this._error.set(null);
      void this.transactionService.updateFilters({ bankAccountId: undefined });
    }
  }

  clearError() {
    this._error.set(null);
  }

  async loadMore() {
    await this.transactionService.loadMore();
  }
}
