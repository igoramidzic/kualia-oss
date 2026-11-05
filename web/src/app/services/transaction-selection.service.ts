import { computed, Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class TransactionSelectionService {
  // Internal state - use Set for efficient lookups.
  // Regular transaction ids ONLY (bulk transaction mutations receive these); scheduled
  // transaction ids are tracked in a parallel set so they never leak into those mutations.
  private readonly _selectedTransactionIds = signal<Set<string>>(new Set());
  private readonly _selectedScheduledIds = signal<Set<string>>(new Set());

  // Visible transaction IDs (set by transactions table component based on current page)
  private readonly _visibleTransactionIds = signal<string[]>([]);

  // Track last clicked transaction for shift+click range selection
  private readonly _lastClickedTransactionId = signal<string | null>(null);

  // Public readonly signals
  readonly selectedTransactionIds = this._selectedTransactionIds.asReadonly();
  readonly selectedScheduledIds = this._selectedScheduledIds.asReadonly();

  // Computed signals
  readonly selectedTransactions = computed(() => {
    return Array.from(this._selectedTransactionIds());
  });

  readonly selectedScheduledTransactions = computed(() => {
    return Array.from(this._selectedScheduledIds());
  });

  // True when at least one regular transaction is selected (drives transaction-only bulk actions)
  readonly hasRegularSelections = computed(() => {
    return this._selectedTransactionIds().size > 0;
  });

  readonly hasScheduledSelections = computed(() => {
    return this._selectedScheduledIds().size > 0;
  });

  // True when anything (regular or scheduled) is selected - drives the floating bulk toolbar
  readonly hasSelections = computed(() => {
    return this._selectedTransactionIds().size > 0 || this._selectedScheduledIds().size > 0;
  });

  // Check if a specific transaction is selected
  isTransactionSelected(transactionId: string) {
    return computed(() => this._selectedTransactionIds().has(transactionId));
  }

  // Check if a specific scheduled transaction is selected
  isScheduledSelected(scheduledId: string) {
    return computed(() => this._selectedScheduledIds().has(scheduledId));
  }

  // Selection methods
  selectTransaction(transactionId: string): void {
    this._selectedTransactionIds.update((set) => {
      const newSet = new Set(set);
      newSet.add(transactionId);
      return newSet;
    });
  }

  deselectTransaction(transactionId: string): void {
    this._selectedTransactionIds.update((set) => {
      const newSet = new Set(set);
      newSet.delete(transactionId);
      return newSet;
    });
  }

  toggleTransaction(transactionId: string): void {
    const current = this._selectedTransactionIds();
    if (current.has(transactionId)) {
      this.deselectTransaction(transactionId);
    } else {
      this.selectTransaction(transactionId);
    }
  }

  selectAllTransactions(transactionIds: string[]): void {
    this._selectedTransactionIds.update((set) => {
      const newSet = new Set(set);
      for (const id of transactionIds) {
        newSet.add(id);
      }
      return newSet;
    });
  }

  // Scheduled-transaction selection methods (parallel channel)
  selectScheduled(scheduledId: string): void {
    this._selectedScheduledIds.update((set) => {
      const newSet = new Set(set);
      newSet.add(scheduledId);
      return newSet;
    });
  }

  deselectScheduled(scheduledId: string): void {
    this._selectedScheduledIds.update((set) => {
      const newSet = new Set(set);
      newSet.delete(scheduledId);
      return newSet;
    });
  }

  toggleScheduled(scheduledId: string): void {
    const current = this._selectedScheduledIds();
    if (current.has(scheduledId)) {
      this.deselectScheduled(scheduledId);
    } else {
      this.selectScheduled(scheduledId);
    }
  }

  deselectAll(): void {
    this._selectedTransactionIds.set(new Set());
    this._selectedScheduledIds.set(new Set());
  }

  // Set visible transaction IDs (called by transactions table component when page changes)
  setVisibleTransactionIds(transactionIds: string[]): void {
    this._visibleTransactionIds.set(transactionIds);
  }

  // Get visible transaction IDs
  getVisibleTransactionIds(): string[] {
    return this._visibleTransactionIds();
  }

  // Get last clicked transaction ID for shift+click range selection
  getLastClickedTransactionId(): string | null {
    return this._lastClickedTransactionId();
  }

  // Set last clicked transaction ID
  setLastClickedTransactionId(transactionId: string | null): void {
    this._lastClickedTransactionId.set(transactionId);
  }

  // Select a range of transactions between two IDs (inclusive)
  // Uses the visible transaction order to determine the range
  selectRange(fromId: string, toId: string): void {
    const visibleIds = this._visibleTransactionIds();
    const fromIndex = visibleIds.indexOf(fromId);
    const toIndex = visibleIds.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) return;

    const startIndex = Math.min(fromIndex, toIndex);
    const endIndex = Math.max(fromIndex, toIndex);

    const rangeIds = visibleIds.slice(startIndex, endIndex + 1);
    this.selectAllTransactions(rangeIds);
  }
}
