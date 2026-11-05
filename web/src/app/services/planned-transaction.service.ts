import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import type {
  PlannedBaseTransaction,
  PlannedCoverageStatus,
  PlannedMonthlyEntry,
  PlannedMonthlySummary,
} from 'convex/scheduledTransactions/plannedData';
import { formatDateToString } from '../shared/utils/date-utils';
import {
  formatYearMonth,
  getCurrentYearMonth,
  getNextYearMonth,
  getPreviousYearMonth,
} from '../shared/utils/month.utils';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

export type { PlannedBaseTransaction, PlannedCoverageStatus, PlannedMonthlyEntry, PlannedMonthlySummary };

export interface PlannedTransactionsDataResponse {
  today: string;
  availableRange: {
    minYearMonth: number;
    maxYearMonth: number;
  };
  allPlannedTransactions: PlannedBaseTransaction[];
  plannedByMonth: Record<number, PlannedMonthlyEntry[]>;
  monthlySummaries: Record<number, PlannedMonthlySummary>;
}

/** A month occurrence joined with its schedule (base) for display. */
export interface PlannedMonthEntryView {
  /** Stable template track key (a schedule can occur several times per month). */
  key: string;
  entry: PlannedMonthlyEntry;
  base: PlannedBaseTransaction;
}

/**
 * Data source for the Planned page (monthly list/calendar + all schedules). Subscribes to
 * scheduledTransactions.listPlannedTransactionsData for the active workspace and exposes
 * month navigation + view-mode state, mirroring the old recurring-transaction service's
 * subscription lifecycle (workspace switching, teardown).
 */
@Injectable({
  providedIn: 'root',
})
export class PlannedTransactionService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  // Selected month for the monthly tab (YYYYMM format)
  private readonly _selectedYearMonth = signal<number>(getCurrentYearMonth());

  // Selected view mode for the monthly tab
  private readonly _selectedViewMode = signal<'list' | 'calendar'>('calendar');

  private readonly _rawData = signal<PlannedTransactionsDataResponse | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  private plannedSubscription?: () => void;
  private lastWorkspaceId: string | null = null;
  private lastToday: string | null = null;
  private readonly currentTime = signal(new Date());

  readonly today = computed(() => formatDateToString(this.currentTime(), this.workspaceService.workspace()?.timezone));

  readonly selectedYearMonth = this._selectedYearMonth.asReadonly();
  readonly selectedViewMode = this._selectedViewMode.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();

  // Formatted display string for the selected month (e.g., "January 2026")
  readonly selectedMonthDisplay = computed(() => formatYearMonth(this._selectedYearMonth()));

  readonly availableRange = computed(() => this._rawData()?.availableRange ?? null);

  readonly canNavigatePrevious = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this._selectedYearMonth() > range.minYearMonth;
  });

  readonly canNavigateNext = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this._selectedYearMonth() < range.maxYearMonth;
  });

  readonly isCurrentMonth = computed(() => this._selectedYearMonth() === getCurrentYearMonth());

  // Every non-deleted schedule (active/paused/completed), populated with names
  readonly allPlannedTransactions = computed<PlannedBaseTransaction[]>(
    () => this._rawData()?.allPlannedTransactions ?? []
  );

  // Lookup map: scheduledTransactionId -> base schedule
  readonly plannedById = computed<Map<string, PlannedBaseTransaction>>(
    () => new Map(this.allPlannedTransactions().map((planned) => [planned._id, planned]))
  );

  // Inflow/outflow rollup for the selected month (transfers excluded server-side)
  readonly selectedMonthSummary = computed<PlannedMonthlySummary | null>(() => {
    const rawData = this._rawData();
    if (!rawData) return null;
    return rawData.monthlySummaries[this._selectedYearMonth()] ?? null;
  });

  // Month occurrences for the selected month, joined with their schedules
  readonly selectedMonthEntries = computed<PlannedMonthEntryView[]>(() => {
    const rawData = this._rawData();
    if (!rawData) return [];

    const entries = rawData.plannedByMonth[this._selectedYearMonth()] ?? [];
    if (entries.length === 0) return [];

    const byId = this.plannedById();
    return entries
      .map((entry): PlannedMonthEntryView | null => {
        const base = byId.get(entry.scheduledTransactionId);
        if (!base) return null;
        return {
          key: `${entry.scheduledTransactionId}|${entry.occurrenceDate}|${
            entry.coverage.linkedTransactions[0]?.transactionId ?? entry.coverage.status
          }`,
          entry,
          base,
        };
      })
      .filter((view): view is PlannedMonthEntryView => view !== null);
  });

  constructor() {
    const dayCheck = setInterval(() => this.currentTime.set(new Date()), 60_000);
    // Watch for workspace changes and start/stop the subscription.
    // Month navigation is local filtering; no re-fetch needed.
    effect(() => {
      const workspaceId = this.workspaceService.workspaceId();
      const hasWorkspace = !!workspaceId;
      const isAuthenticated = this.convexService.isAuthenticated();
      const today = this.today();

      const workspaceChanged = this.lastWorkspaceId !== null && this.lastWorkspaceId !== workspaceId;

      if (isAuthenticated && hasWorkspace) {
        if (workspaceChanged) {
          this.stopWatching();
          this._rawData.set(null);
          this._hasLoaded.set(false);
          this._error.set(null);
        }
        if (workspaceChanged || today !== this.lastToday || !this.plannedSubscription) {
          this.startWatching(today);
        }
      } else {
        this.stopWatching();
        this._rawData.set(null);
        this._hasLoaded.set(false);
      }

      this.lastWorkspaceId = workspaceId;
      this.lastToday = today;
    });

    this.destroyRef.onDestroy(() => {
      clearInterval(dayCheck);
      this.stopWatching();
    });
  }

  navigateToMonth(yearMonth: number): void {
    this._selectedYearMonth.set(yearMonth);
  }

  navigateToPreviousMonth(): void {
    if (this.canNavigatePrevious()) {
      this._selectedYearMonth.set(getPreviousYearMonth(this._selectedYearMonth()));
    }
  }

  navigateToNextMonth(): void {
    if (this.canNavigateNext()) {
      this._selectedYearMonth.set(getNextYearMonth(this._selectedYearMonth()));
    }
  }

  navigateToCurrentMonth(): void {
    this._selectedYearMonth.set(getCurrentYearMonth());
  }

  setViewMode(mode: 'list' | 'calendar'): void {
    this._selectedViewMode.set(mode);
  }

  private startWatching(today: string): void {
    this.stopWatching();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    this._loading.set(true);

    const watcher = this.convexService.watchQuery<PlannedTransactionsDataResponse>(
      api.scheduledTransactions.listPlannedTransactionsData,
      {
        workspaceId: workspaceId as Id<'workspace'>,
        today,
      }
    );

    this.plannedSubscription = watcher.subscribe((result) => {
      if (result !== undefined) {
        this._rawData.set(result);
        this._hasLoaded.set(true);
        this._loading.set(false);
      }
    });
  }

  private stopWatching(): void {
    if (this.plannedSubscription) {
      this.plannedSubscription();
      this.plannedSubscription = undefined;
    }
  }
}
