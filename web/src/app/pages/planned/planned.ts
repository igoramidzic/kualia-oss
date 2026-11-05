import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import {
  nucleoCalendarFilled as CalendarDays,
  nucleoCheckCircle as CircleCheck,
  nucleoClock as Clock,
  nucleoClock as ClockAlert,
  nucleoInfo as Info,
  nucleoList as List,
  NucleoIcon,
  nucleoPause as Pause,
  nucleoPlay as Play,
  nucleoPlus as Plus,
  nucleoSkip as SkipForward,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BudgetMonthPickerComponent } from '../../components/budget-month-picker/budget-month-picker.component';
import { FilterConfig, ResponsiveFilterRowComponent } from '../../components/budget/responsive-filter-row.component';
import { confirmSkipPlannedTransaction } from '../../components/dialogs/skip-planned-transaction-dialog/skip-planned-transaction-dialog';
import { PlannedCalendarViewComponent } from '../../components/planned-calendar-view/planned-calendar-view';
import {
  PlannedTransactionAction,
  PlannedTransactionRowComponent,
} from '../../components/planned-transaction-row/planned-transaction-row';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { AiChatService } from '../../services/ai-chat.service';
import { CurrencyService } from '../../services/currency.service';
import { NavigationService } from '../../services/navigation.service';
import {
  PlannedBaseTransaction,
  PlannedMonthEntryView,
  PlannedTransactionService,
} from '../../services/planned-transaction.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionService } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { extractConvexErrorMessage } from '../../shared/utils/convex-error-message';
import {
  formatYearMonth,
  getCurrentYearMonth,
  getMonthFromYearMonth,
  getNextYearMonth,
  getPreviousYearMonth,
  getYearFromYearMonth,
} from '../../shared/utils/month.utils';
import { HlmProgress } from '../../ui/progress/src/lib/hlm-progress';
import { HlmProgressIndicator } from '../../ui/progress/src/lib/hlm-progress-indicator';
import { HlmToggleGroupImports } from '../../ui/toggle-group/src';
import { HlmTooltip } from '../../ui/tooltip/src';

type PlannedTab = 'all' | 'monthly';

@Component({
  selector: 'app-planned',
  imports: [
    NucleoIcon,
    HlmButton,
    SidebarToggleComponent,
    ResponsiveFilterRowComponent,
    PlannedTransactionRowComponent,
    BudgetMonthPickerComponent,
    HlmProgress,
    HlmProgressIndicator,
    HlmTooltip,
    PlannedCalendarViewComponent,
    ...HlmToggleGroupImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned.html',
  styles: `
    .overdue-header {
      background: linear-gradient(90deg, lch(96.736 1.5 35) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .overdue-header {
      background: linear-gradient(90deg, lch(9.934 2.5 35) 0%, lch(8.3 1.867 272) 100%);
    }
    .upcoming-header {
      background: linear-gradient(90deg, lch(96.736 1.255 81.521) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .upcoming-header {
      background: linear-gradient(90deg, lch(9.934 0.75 57.258) 0%, lch(8.3 1.867 272) 100%);
    }
    .paid-header {
      background: linear-gradient(90deg, lch(96.736 1.754 157.443) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .paid-header {
      background: linear-gradient(90deg, lch(9.934 3.109 188.083) 0%, lch(8.3 1.867 272) 100%);
    }
    .active-header {
      background: linear-gradient(90deg, lch(96.736 1.754 157.443) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .active-header {
      background: linear-gradient(90deg, lch(9.934 3.109 188.083) 0%, lch(8.3 1.867 272) 100%);
    }
    .paused-header {
      background: linear-gradient(90deg, lch(96.667 0.5 282.863) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .paused-header {
      background: linear-gradient(90deg, lch(12 1 272) 0%, lch(8.3 1.867 272) 100%);
    }
    .skipped-header {
      background: linear-gradient(90deg, lch(96.667 0.5 282.863) 0%, lch(96.667 0 282.863) 100%);
    }
    :host-context(.dark) .skipped-header {
      background: linear-gradient(90deg, lch(12 1 272) 0%, lch(8.3 1.867 272) 100%);
    }
  `,
})
export class PlannedComponent implements OnInit {
  protected readonly Plus = Plus;
  protected readonly ClockAlert = ClockAlert;
  protected readonly Clock = Clock;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Play = Play;
  protected readonly Pause = Pause;
  protected readonly Info = Info;
  protected readonly List = List;
  protected readonly CalendarDays = CalendarDays;
  protected readonly SkipForward = SkipForward;

  private readonly plannedTransactionService = inject(PlannedTransactionService);
  private readonly transactionService = inject(TransactionService);
  private readonly navigationService = inject(NavigationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly currencyService = inject(CurrencyService);
  private readonly aiChat = inject(AiChatService);
  private readonly scheduledTransactionService = inject(ScheduledTransactionService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Query params signal
  private readonly queryParams = toSignal(this.route.queryParams);

  // Track whether initial params have been applied
  private initialParamsApplied = false;

  // Tab state derived from query params (default to 'monthly')
  readonly activeTab = computed<PlannedTab>(() => {
    const tab = this.queryParams()?.['tab'] as string | undefined;
    if (tab === 'all') {
      return tab;
    }
    return 'monthly';
  });

  readonly plannedFilters = computed<FilterConfig[]>(() => [
    {
      id: 'monthly',
      label: 'Monthly',
      icon: CalendarDays,
      queryParams: this.plannedTabQueryParams('monthly'),
      isActive: this.activeTab() === 'monthly',
    },
    {
      id: 'all',
      label: 'All Planned',
      icon: List,
      queryParams: this.plannedTabQueryParams('all'),
      isActive: this.activeTab() === 'all',
    },
  ]);

  // View mode from service (persisted across navigation)
  readonly viewMode = this.plannedTransactionService.selectedViewMode;

  // Month occurrences (joined with schedules) for the monthly tab
  readonly monthEntries = this.plannedTransactionService.selectedMonthEntries;

  // Month navigation signals from service
  readonly selectedMonth = this.plannedTransactionService.selectedYearMonth;
  readonly availableRange = this.plannedTransactionService.availableRange;
  readonly canNavigatePrevious = this.plannedTransactionService.canNavigatePrevious;
  readonly canNavigateNext = this.plannedTransactionService.canNavigateNext;
  readonly currentMonth = getCurrentYearMonth();
  readonly isCurrentMonth = computed(() => this.selectedMonth() === this.currentMonth);

  constructor() {
    // Effect to sync service month changes to URL
    effect(() => {
      const month = this.selectedMonth();
      // Only update URL after initial params have been applied
      if (this.initialParamsApplied) {
        this.updateQueryParams({ month: month === this.currentMonth ? null : month });
      }
    });

    // Effect to sync service view mode changes to URL
    effect(() => {
      const view = this.viewMode();
      // Only update URL after initial params have been applied
      if (this.initialParamsApplied) {
        this.updateQueryParams({ view: view === 'calendar' ? null : view });
      }
    });
  }

  ngOnInit(): void {
    // Initialize month from query params if present
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    if (monthParam) {
      const parsed = parseInt(monthParam, 10);
      if (!isNaN(parsed) && parsed >= 100000 && parsed <= 999999) {
        this.plannedTransactionService.navigateToMonth(parsed);
      }
    }

    // Initialize view mode from query params if present
    const viewParam = this.queryParams()?.['view'] as string | undefined;
    if (viewParam === 'list') {
      this.plannedTransactionService.setViewMode('list');
    }

    this.initialParamsApplied = true;
  }

  readonly previousMonth = computed(() => {
    if (!this.canNavigatePrevious()) return null;
    return getPreviousYearMonth(this.selectedMonth());
  });

  readonly nextMonth = computed(() => {
    if (!this.canNavigateNext()) return null;
    return getNextYearMonth(this.selectedMonth());
  });

  // Monthly summary from service
  readonly selectedMonthSummary = this.plannedTransactionService.selectedMonthSummary;

  // Formatted month display (e.g., "January 2026")
  readonly selectedMonthDisplay = computed(() => formatYearMonth(this.selectedMonth()));

  // Keyboard shortcuts for tab switching and month navigation
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.aiChat.shouldCaptureShortcuts()) return;

    // Only handle if not typing in an input/textarea
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    if (event.key === '1') {
      this.navigateToTab('monthly');
    } else if (event.key === '2') {
      this.navigateToTab('all');
    } else if (event.key === 'ArrowLeft') {
      this.navigateToPreviousMonth();
    } else if (event.key === 'ArrowRight') {
      this.navigateToNextMonth();
    }
  }

  readonly loading = this.plannedTransactionService.loading;
  readonly error = this.plannedTransactionService.error;

  // Grouped schedules for the "All Planned" tab (completed schedules are hidden)
  readonly allActivePlanned = computed(() =>
    this.plannedTransactionService
      .allPlannedTransactions()
      .filter((planned) => planned.status === 'active')
      .sort((a, b) => this.plannedDisplayName(a).localeCompare(this.plannedDisplayName(b)))
  );

  readonly allPausedPlanned = computed(() =>
    this.plannedTransactionService
      .allPlannedTransactions()
      .filter((planned) => planned.status === 'paused')
      .sort((a, b) => this.plannedDisplayName(a).localeCompare(this.plannedDisplayName(b)))
  );

  // Check if the "All Planned" tab has any schedules
  readonly hasAllTransactions = computed(
    () => this.allActivePlanned().length > 0 || this.allPausedPlanned().length > 0
  );

  // Grouped occurrences for the monthly tab - using coverage.status
  readonly overdueEntries = computed(() =>
    this.monthEntries()
      .filter((view) => view.entry.coverage.status === 'overdue')
      .sort((a, b) => a.entry.displayDate.localeCompare(b.entry.displayDate))
  );

  readonly skippedEntries = computed(() =>
    this.monthEntries()
      .filter((view) => view.entry.coverage.status === 'skipped')
      .sort((a, b) => a.entry.displayDate.localeCompare(b.entry.displayDate))
  );

  readonly upcomingEntries = computed(() =>
    this.monthEntries()
      .filter((view) => view.entry.coverage.status === 'upcoming')
      .sort((a, b) => a.entry.displayDate.localeCompare(b.entry.displayDate))
  );

  readonly paidEntries = computed(() =>
    this.monthEntries()
      .filter((view) => view.entry.coverage.status === 'paid')
      .sort((a, b) => b.entry.displayDate.localeCompare(a.entry.displayDate))
  );

  // Check if the monthly tab has any occurrences (for the empty state)
  readonly hasMonthlyTransactions = computed(() => this.monthEntries().length > 0);

  navigateToTab(tab: PlannedTab): void {
    // 'monthly' is default, so we omit it; also reset view to list when switching to 'all' tab
    this.updateQueryParams({
      tab: tab === 'monthly' ? null : tab,
      view: tab === 'all' ? null : undefined, // Reset view when switching to 'all' tab
    });
  }

  navigateToMonth(yearMonth: number): void {
    this.plannedTransactionService.navigateToMonth(yearMonth);
  }

  navigateToPreviousMonth(): void {
    this.plannedTransactionService.navigateToPreviousMonth();
  }

  navigateToNextMonth(): void {
    this.plannedTransactionService.navigateToNextMonth();
  }

  onViewModeChange(value: string | string[] | null | undefined): void {
    if (value === 'list' || value === 'calendar') {
      this.plannedTransactionService.setViewMode(value);
    }
  }

  private plannedTabQueryParams(tab: PlannedTab): Record<string, string> {
    const currentParams = this.queryParams() ?? {};
    const params: Record<string, string> = {};
    const monthParam = currentParams['month'] as string | undefined;
    const viewParam = currentParams['view'] as string | undefined;

    if (monthParam) {
      params['month'] = monthParam;
    }

    if (tab === 'all') {
      params['tab'] = 'all';
    } else if (viewParam === 'list') {
      params['view'] = 'list';
    }

    return params;
  }

  /**
   * Updates query params while preserving other params.
   * Pass null to remove a param, undefined to keep existing value.
   */
  private updateQueryParams(params: Record<string, string | number | null | undefined>): void {
    const currentParams = this.queryParams() ?? {};
    const newParams: Record<string, string | number | undefined> = { ...currentParams };

    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        delete newParams[key];
      } else if (value !== undefined) {
        newParams[key] = value;
      }
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: newParams,
      replaceUrl: false,
    });
  }

  /** "Add planned": create-transaction dialog prefilled with the selected month (or today). */
  openCreateDialog(): void {
    this.transactionService.openCreateDialog({ initialDate: this.defaultCreateDate() });
  }

  openCreateDialogWithDate(dateString: string): void {
    this.transactionService.openCreateDialog({ initialDate: dateString });
  }

  onRowClick(planned: PlannedBaseTransaction): void {
    void this.navigationService.navigateToPlannedTransaction(planned._id);
  }

  onCalendarEntryClick(view: PlannedMonthEntryView): void {
    void this.navigationService.navigateToPlannedTransaction(view.base._id);
  }

  async onPlannedAction(event: { action: PlannedTransactionAction; planned: PlannedBaseTransaction }): Promise<void> {
    const { action, planned } = event;
    try {
      if (action === 'enter') {
        const result = await this.scheduledTransactionService.enterNow(planned._id);
        toast.success('Transaction entered', {
          action: {
            label: 'View',
            onClick: () => void this.navigationService.navigateToTransaction(result.transactionId),
          },
        });
        return;
      }

      if (action === 'pause') {
        const pausing = planned.status !== 'paused';
        await this.scheduledTransactionService.updateScheduledTransaction({
          scheduledTransactionId: planned._id,
          paused: pausing,
        });
        toast.success(`Planned transaction ${pausing ? 'paused' : 'resumed'}`);
        return;
      }

      if (action === 'skip') {
        const confirmed = await confirmSkipPlannedTransaction(this.dialogService, planned);
        if (!confirmed) return;
        await this.scheduledTransactionService.skip(planned._id);
        toast.success('Occurrence skipped');
        return;
      }

      await this.scheduledTransactionService.deleteScheduledTransaction(planned._id);
      this.undoRedoService.pushAction({
        description: 'Planned transaction deleted',
        type: 'planned-transaction-delete',
        timestamp: Date.now(),
        undo: () => this.scheduledTransactionService.restoreScheduledTransaction(planned._id),
        redo: () => this.scheduledTransactionService.deleteScheduledTransaction(planned._id),
      });
      toast('Planned transaction deleted', {
        action: {
          label: 'Undo',
          onClick: () => void this.undoRedoService.undo(),
        },
      });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, `Failed to ${action} planned transaction`));
    }
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  private plannedDisplayName(planned: PlannedBaseTransaction): string {
    if ((planned.transactionType ?? 'regular') === 'transfer') {
      return `Transfer to ${planned.transferToAccountName ?? 'account'}`;
    }
    return planned.merchantName ?? 'No payee';
  }

  private defaultCreateDate(): string {
    if (this.isCurrentMonth()) {
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${today.getFullYear()}-${month}-${day}`;
    }
    const yearMonth = this.selectedMonth();
    const month = String(getMonthFromYearMonth(yearMonth)).padStart(2, '0');
    return `${getYearFromYearMonth(yearMonth)}-${month}-01`;
  }
}
