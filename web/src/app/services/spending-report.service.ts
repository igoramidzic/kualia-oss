import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexService } from './convex.service';
import { CurrentMonthService } from './current-month.service';
import { WorkspaceService } from './workspace.service';

// Infer the return type from the query
export type SpendingReportResponse = FunctionReturnType<typeof api.reports.getSpendingReport>;
export type MonthlySpending = SpendingReportResponse['months'][number];
export type CategorySpendingData = MonthlySpending['categorySpending']['items'][number];
export type GroupSpendingData = MonthlySpending['groupSpending']['items'][number];
export type MerchantSpendingData = MonthlySpending['merchantSpending']['items'][number];

@Injectable({
  providedIn: 'root',
})
export class SpendingReportService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly currentMonthService = inject(CurrentMonthService);
  private readonly destroyRef = inject(DestroyRef);

  // Signals for state management
  private readonly _spendingReport = signal<SpendingReportResponse | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // Subscription management
  private reportSubscription?: () => void;

  // Public read-only signals
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly spendingReport = this._spendingReport.asReadonly();

  // Computed values
  readonly months = computed(() => this._spendingReport()?.months ?? []);
  readonly currentMonth = computed(() => this._spendingReport()?.currentMonth);
  readonly hasData = computed(() => this.months().length > 0);

  constructor() {
    // Start watching spending report when authenticated AND workspace is available.
    // Also re-subscribe when the current month changes (at midnight) to get updated boundaries.
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      const currentYearMonth = this.currentMonthService.currentYearMonth();
      if (this.convexService.isAuthenticated() && hasWorkspace && currentYearMonth) {
        this.startWatchingSpendingReport(currentYearMonth);
      } else {
        this.stopWatchingSpendingReport();
        this._spendingReport.set(null);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingSpendingReport();
    });
  }

  /**
   * Start watching spending report with real-time updates.
   * @param currentYearMonth The client's current year-month in YYYYMM format.
   */
  private startWatchingSpendingReport(currentYearMonth: number) {
    // Stop existing subscription if any
    this.stopWatchingSpendingReport();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._loading.set(false);
      this._error.set('No workspace selected');
      return;
    }

    // Only set loading if we haven't loaded yet
    if (!this._hasLoaded()) {
      this._loading.set(true);
    }
    this._error.set(null);

    try {
      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        currentYearMonth: BigInt(currentYearMonth),
        grossDirectional: true,
      };

      // Subscribe to the spending report query
      const watcher = this.convexService.watchQuery<SpendingReportResponse>(api.reports.getSpendingReport, queryArgs);

      this.reportSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._spendingReport.set(data);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching spending report:', error);
      this._error.set('Failed to load spending report');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching spending report
   */
  private stopWatchingSpendingReport() {
    if (this.reportSubscription) {
      this.reportSubscription();
      this.reportSubscription = undefined;
    }
  }

  /**
   * Refresh spending report manually
   */
  refresh() {
    this.startWatchingSpendingReport(this.currentMonthService.currentYearMonth());
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Get spending data for a specific month
   */
  getMonthData(yearMonth: string): MonthlySpending | undefined {
    return this.months().find((m) => m.yearMonth === yearMonth);
  }
}
