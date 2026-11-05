import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { getCurrentYearMonth } from '../shared/utils/month.utils';

/**
 * Service that tracks the current year-month based on the user's device time.
 * Automatically updates when the day changes (at midnight local time).
 *
 * This ensures budget data queries use the client's local date rather than server time,
 * avoiding timezone discrepancies where the server might be on a different day.
 */
@Injectable({
  providedIn: 'root',
})
export class CurrentMonthService {
  private readonly destroyRef = inject(DestroyRef);
  private midnightTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * The current year-month in YYYYMM format, based on the user's device time.
   * Updates automatically at midnight.
   */
  private readonly _currentYearMonth = signal<number>(getCurrentYearMonth());
  readonly currentYearMonth = this._currentYearMonth.asReadonly();

  constructor() {
    this.scheduleMidnightUpdate();

    this.destroyRef.onDestroy(() => {
      this.clearMidnightTimeout();
    });
  }

  /**
   * Schedule a check at the next midnight to update the current month if needed.
   * Uses setTimeout to check at midnight, then reschedules for the following midnight.
   */
  private scheduleMidnightUpdate(): void {
    this.clearMidnightTimeout();

    const msUntilMidnight = this.getMillisecondsUntilMidnight();

    this.midnightTimeoutId = setTimeout(() => {
      this.checkAndUpdateMonth();
      // Reschedule for the next midnight
      this.scheduleMidnightUpdate();
    }, msUntilMidnight);
  }

  /**
   * Check if the month has changed and update the signal if so.
   */
  private checkAndUpdateMonth(): void {
    const newYearMonth = getCurrentYearMonth();
    if (newYearMonth !== this._currentYearMonth()) {
      this._currentYearMonth.set(newYearMonth);
    }
  }

  /**
   * Calculate milliseconds until the next midnight (00:00:00.000).
   */
  private getMillisecondsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  private clearMidnightTimeout(): void {
    if (this.midnightTimeoutId !== null) {
      clearTimeout(this.midnightTimeoutId);
      this.midnightTimeoutId = null;
    }
  }
}
