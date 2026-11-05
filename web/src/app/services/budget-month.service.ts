import { Injectable, signal } from '@angular/core';
import {
  getCurrentYearMonth,
  queryParamToYearMonth,
  validateYearMonth,
  yearMonthToQueryParam,
} from '../shared/utils/month.utils';

@Injectable({
  providedIn: 'root',
})
export class BudgetMonthService {
  private readonly STORAGE_KEY = 'kualia-budget-last-month';

  private readonly _lastViewedMonth = signal<number | null>(this.loadLastViewedMonth());

  readonly lastViewedMonth = this._lastViewedMonth.asReadonly();

  /**
   * Get the last viewed month, or current month if none stored
   */
  getLastViewedMonth(): number {
    return this._lastViewedMonth() ?? getCurrentYearMonth();
  }

  /**
   * Set the last viewed month
   * If month is current month, clears the stored value
   */
  setLastViewedMonth(yearMonth: number): void {
    const currentMonth = getCurrentYearMonth();
    if (yearMonth === currentMonth) {
      // Clear storage if viewing current month
      this._lastViewedMonth.set(null);
      this.clearStorage();
    } else {
      // Validate before storing
      if (validateYearMonth(yearMonth)) {
        this._lastViewedMonth.set(yearMonth);
        this.saveToStorage(yearMonth);
      }
    }
  }

  /**
   * Get query parameter string for the last viewed month
   * Returns null if viewing current month (no query param needed)
   */
  getLastViewedMonthQueryParam(): string | null {
    const month = this._lastViewedMonth();
    if (!month) return null;
    return yearMonthToQueryParam(month);
  }

  /**
   * Parse query parameter to yearMonth
   * Returns null if invalid
   */
  parseQueryParam(param: string | null): number | null {
    return queryParamToYearMonth(param);
  }

  /**
   * Convert yearMonth to query parameter string
   */
  toQueryParam(yearMonth: number): string {
    return yearMonthToQueryParam(yearMonth);
  }

  private loadLastViewedMonth(): number | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && validateYearMonth(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load last viewed month from localStorage:', error);
    }
    return null;
  }

  private saveToStorage(yearMonth: number): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, yearMonth.toString());
    } catch (error) {
      console.warn('Failed to save last viewed month to localStorage:', error);
    }
  }

  private clearStorage(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear last viewed month from localStorage:', error);
    }
  }
}
