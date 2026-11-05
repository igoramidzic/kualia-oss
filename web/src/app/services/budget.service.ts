import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexService } from './convex.service';
import { CurrentMonthService } from './current-month.service';
import { WorkspaceService } from './workspace.service';

// Infer the return type from the query
export type BudgetMonthDataResponse = FunctionReturnType<typeof api.categoryBudgets.listBudgetDataByMonth>;
export type BudgetMonthData = BudgetMonthDataResponse['months'][number];

@Injectable({
  providedIn: 'root',
})
export class BudgetService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly currentMonthService = inject(CurrentMonthService);
  private readonly destroyRef = inject(DestroyRef);

  // Signals for state management
  private readonly _budgetData = signal<BudgetMonthDataResponse | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // Subscription management
  private budgetSubscription?: () => void;

  // Public read-only signals
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly budgetData = this._budgetData.asReadonly();

  // Computed values
  readonly months = computed(() => this._budgetData()?.months ?? []);
  readonly readyToAssign = computed(() => this._budgetData()?.readyToAssign ?? 0n);
  readonly availableRange = computed(() => this._budgetData()?.availableRange);

  constructor() {
    // Start watching budget data when authenticated AND workspace is available.
    // Also re-subscribe when the current month changes (at midnight) to get updated boundaries.
    // Note: currentYearMonth parameter is the real-world current month (for range calculation),
    // not the month the user wants to view. The query returns all months in the range.
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      // Track currentYearMonth so the effect re-runs when the month changes (at midnight)
      const currentYearMonth = this.currentMonthService.currentYearMonth();
      if (this.convexService.isAuthenticated() && hasWorkspace && currentYearMonth) {
        this.startWatchingBudgetData(currentYearMonth);
      } else {
        this.stopWatchingBudgetData();
        this._budgetData.set(null);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingBudgetData();
    });
  }

  /**
   * Start watching budget data with real-time updates.
   * @param currentYearMonth The client's current year-month in YYYYMM format.
   *   This is used for calculating the available month range, not for filtering.
   *   The query returns all months in the range.
   */
  private startWatchingBudgetData(currentYearMonth: number) {
    // Stop existing subscription if any
    this.stopWatchingBudgetData();

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
      // Pass the client's current month for calculating the available range
      // Convert to bigint as required by Convex v.int64()
      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        currentYearMonth: BigInt(currentYearMonth),
      };

      // Subscribe to the budget data query
      const watcher = this.convexService.watchQuery<BudgetMonthDataResponse>(
        api.categoryBudgets.listBudgetDataByMonth,
        queryArgs
      );

      this.budgetSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._budgetData.set(data);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching budget data:', error);
      this._error.set('Failed to load budget data');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching budget data
   */
  private stopWatchingBudgetData() {
    if (this.budgetSubscription) {
      this.budgetSubscription();
      this.budgetSubscription = undefined;
    }
  }

  /**
   * Refresh budget data manually
   */
  refresh() {
    this.startWatchingBudgetData(this.currentMonthService.currentYearMonth());
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }
}
