import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Id } from 'convex/_generated/dataModel';
import {
  ScheduledTransactionService,
  ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';

const PAGE_SIZE = 50;

/**
 * Shares planned-transaction data between the wrapper page and its child detail route.
 *
 * The scheduled doc is resolved reactively from ScheduledTransactionService's live
 * subscription (so inline edits reflect immediately), falling back to a one-shot fetch for
 * deep links / paused or completed schedules that are not in the active list. Also loads the
 * real transactions this schedule has already entered.
 */
@Injectable()
export class PlannedTransactionPageService {
  private readonly scheduledService = inject(ScheduledTransactionService);
  private readonly transactionService = inject(TransactionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _currentId = signal<Id<'scheduledTransaction'> | null>(null);
  private readonly _fallback = signal<ScheduledTransactionWithRelations | null>(null);
  private readonly _isLoading = signal<boolean>(false);

  // Linked (entered) transactions
  private readonly _transactions = signal<TransactionWithRelations[]>([]);
  private readonly _transactionsLoading = signal<boolean>(false);
  private readonly _transactionsError = signal<string | null>(null);
  private readonly _hasMore = signal<boolean>(true);
  private readonly _loadingMore = signal<boolean>(false);

  readonly scheduled = computed<ScheduledTransactionWithRelations | null>(() => {
    const id = this._currentId();
    if (!id) return null;
    const fromList = this.scheduledService.scheduledTransactions().find((s) => s._id === id);
    return fromList ?? this._fallback();
  });
  readonly isLoading = this._isLoading.asReadonly();

  readonly transactions = this._transactions.asReadonly();
  readonly transactionsLoading = this._transactionsLoading.asReadonly();
  readonly transactionsError = this._transactionsError.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();

  readonly sortedTransactions = computed(() =>
    [...this._transactions()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this._transactions.set([]);
      this._transactionsError.set(null);
    });
  }

  /** Load a planned transaction (and its entered transactions) by id. */
  async load(id: Id<'scheduledTransaction'>): Promise<void> {
    this._currentId.set(id);
    this._fallback.set(null);
    this._transactions.set([]);
    this._isLoading.set(true);
    try {
      const fetched = await this.scheduledService.getScheduledTransactionById(id);
      this._fallback.set(fetched);
    } finally {
      this._isLoading.set(false);
    }
    await this.fetchLinkedTransactions();
  }

  /**
   * Re-fetch the scheduled doc. Linked transactions are refreshed only after an action that
   * can create one; ordinary template edits should not restart that request.
   */
  async reload(options: { refreshLinkedTransactions?: boolean } = {}): Promise<void> {
    const id = this._currentId();
    if (!id) return;
    const fetched = await this.scheduledService.getScheduledTransactionById(id);
    this._fallback.set(fetched);
    if (options.refreshLinkedTransactions) {
      await this.fetchLinkedTransactions();
    }
  }

  async fetchLinkedTransactions(): Promise<void> {
    const id = this._currentId();
    if (!id) return;

    this._transactionsLoading.set(true);
    this._transactionsError.set(null);
    try {
      const rawTransactions = await this.scheduledService.getLinkedTransactions(id, PAGE_SIZE);
      this._transactions.set(this.transactionService.populateTransactions(rawTransactions));
      this._hasMore.set(rawTransactions.length >= PAGE_SIZE);
    } catch (error) {
      console.error('Error fetching entered transactions:', error);
      this._transactionsError.set('Failed to load transactions');
    } finally {
      this._transactionsLoading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const id = this._currentId();
    if (!id || this._loadingMore() || !this._hasMore()) return;

    this._loadingMore.set(true);
    try {
      const currentCount = this._transactions().length;
      const rawTransactions = await this.scheduledService.getLinkedTransactions(id, currentCount + PAGE_SIZE);
      this._transactions.set(this.transactionService.populateTransactions(rawTransactions));
      this._hasMore.set(rawTransactions.length >= currentCount + PAGE_SIZE);
    } catch (error) {
      console.error('Error loading more entered transactions:', error);
      this._transactionsError.set('Failed to load more transactions');
    } finally {
      this._loadingMore.set(false);
    }
  }
}
