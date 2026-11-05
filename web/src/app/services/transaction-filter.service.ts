import { Injectable, signal } from '@angular/core';
import { TransactionFilterType } from './transaction.service';

@Injectable({
  providedIn: 'root',
})
export class TransactionFilterService {
  private readonly STORAGE_KEY = 'kualia-transaction-last-filter';
  private readonly _lastFilter = signal<TransactionFilterType | null>(this.loadLastFilter());

  readonly lastFilter = this._lastFilter.asReadonly();

  /**
   * Get the last filter, or 'all' if none stored
   */
  getLastFilter(): TransactionFilterType {
    return this._lastFilter() ?? 'all';
  }

  /**
   * Set the last filter
   * If filter is 'all', clears the stored value
   */
  setLastFilter(filter: TransactionFilterType): void {
    if (filter === 'all') {
      this._lastFilter.set(null);
      this.clearStorage();
    } else {
      this._lastFilter.set(filter);
      this.saveToStorage(filter);
    }
  }

  /**
   * Get query parameter string for the last filter
   * Returns null if filter is 'all' (no query param needed)
   */
  getLastFilterQueryParam(): string | null {
    const filter = this._lastFilter();
    if (!filter || filter === 'all') return null;
    return filter;
  }

  private loadLastFilter(): TransactionFilterType | null {
    try {
      const stored = sessionStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;

      const validFilters: TransactionFilterType[] = ['all', 'needs_review', 'pending'];
      if (validFilters.includes(stored as TransactionFilterType)) {
        return stored as TransactionFilterType;
      }
      return null;
    } catch {
      return null;
    }
  }

  private saveToStorage(filter: TransactionFilterType): void {
    try {
      sessionStorage.setItem(this.STORAGE_KEY, filter);
    } catch {
      // Ignore storage errors
    }
  }

  private clearStorage(): void {
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}
