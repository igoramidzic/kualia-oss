import { Injectable, signal } from '@angular/core';

export type BudgetFilter = 'all' | 'overspent' | 'underfunded' | 'available' | 'extraFunded';

@Injectable({
  providedIn: 'root',
})
export class BudgetFilterService {
  private readonly STORAGE_KEY = 'kualia-budget-last-filter';

  private readonly _lastFilter = signal<BudgetFilter | null>(this.loadLastFilter());

  readonly lastFilter = this._lastFilter.asReadonly();

  /**
   * Get the last filter, or 'all' if none stored
   */
  getLastFilter(): BudgetFilter {
    return this._lastFilter() ?? 'all';
  }

  /**
   * Set the last filter
   * If filter is 'all', clears the stored value
   */
  setLastFilter(filter: BudgetFilter): void {
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
    // Convert internal filter names to URL query parameter format
    return filter === 'extraFunded' ? 'extra-funded' : filter;
  }

  private loadLastFilter(): BudgetFilter | null {
    try {
      const stored = sessionStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;

      const validFilters: BudgetFilter[] = ['all', 'overspent', 'underfunded', 'available', 'extraFunded'];
      if (validFilters.includes(stored as BudgetFilter)) {
        return stored as BudgetFilter;
      }
      return null;
    } catch {
      return null;
    }
  }

  private saveToStorage(filter: BudgetFilter): void {
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
