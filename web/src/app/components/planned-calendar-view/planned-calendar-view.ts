import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  nucleoCalendarCheck as CalendarArrowDown,
  nucleoCheck as Check,
  NucleoIcon,
  nucleoPause as Pause,
  nucleoPlus as Plus,
  nucleoSkip as SkipForward,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { PlannedMonthEntryView } from '../../services/planned-transaction.service';
import { getMonthFromYearMonth, getYearFromYearMonth } from '../../shared/utils/month.utils';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import { PlannedTransactionAction } from '../planned-transaction-row/planned-transaction-row';

interface CalendarDay {
  day: number | null;
  dateString: string; // YYYY-MM-DD format for grouping, or empty for padding cells
  isToday: boolean;
}

interface CalendarWeek {
  days: CalendarDay[];
}

/**
 * Month grid for the Planned page. Occurrences render as chips colored by coverage status
 * (green paid/income, amber upcoming/skipped expense, red overdue). Clicking an empty day
 * (or its hover "+") asks the parent to create a transaction on that date.
 */
@Component({
  selector: 'app-planned-calendar-view',
  imports: [NucleoIcon, ...HlmContextMenuImports, ...HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Weekday headers -->
    <div class="grid grid-cols-7 border-t border-b text-center">
      @for (day of weekdays; track day) {
        <div class="text-muted-foreground px-1 py-2 text-xs font-medium">{{ day }}</div>
      }
    </div>

    <!-- Calendar grid rows -->
    @for (week of calendarWeeks(); track $index) {
      <div class="grid grid-cols-7 border-b">
        @for (day of week.days; track day.dateString) {
          <div
            class="group/day relative min-h-40 border-r p-1 last:border-r-0"
            [class.bg-accent/30]="!day.day"
            [class.bg-primary/5]="day.isToday"
            [class.cursor-pointer]="!!day.day"
            [attr.tabindex]="day.day ? 0 : null"
            (click)="onDayClick(day)"
            (keydown.enter)="onDayClick(day)"
            (keydown.space)="$event.preventDefault(); onDayClick(day)"
          >
            @if (day.day) {
              <!-- Day number + add button -->
              <div class="mb-1 flex items-center justify-between">
                <span
                  class="flex h-6 w-6 items-center justify-center text-xs font-medium"
                  [class.bg-primary]="day.isToday"
                  [class.text-primary-foreground]="day.isToday"
                  [class.rounded-full]="day.isToday"
                >
                  {{ day.day }}
                </span>
                <button
                  class="hover:bg-accent flex h-5 w-5 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover/day:opacity-100"
                  (click)="$event.stopPropagation(); onAddClick(day.dateString)"
                >
                  <nucleo-icon [icon]="Plus" [size]="14" class="text-muted-foreground" />
                </button>
              </div>

              <!-- Occurrences for this day -->
              @for (view of getEntriesForDate(day.dateString); track view.key) {
                <button
                  class="mb-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-opacity hover:opacity-80"
                  [class.bg-green-100]="isGreenBackground(view)"
                  [class.dark:bg-green-900/30]="isGreenBackground(view)"
                  [class.bg-amber-100]="isAmberBackground(view)"
                  [class.dark:bg-amber-900/30]="isAmberBackground(view)"
                  [class.bg-red-100]="isOverdueBackground(view)"
                  [class.dark:bg-red-900/30]="isOverdueBackground(view)"
                  (click)="$event.stopPropagation(); onEntryClick(view)"
                  [hlmContextMenuTrigger]="entryContextMenu"
                >
                  @if (merchantLogo(view)) {
                    <img
                      [src]="merchantLogo(view)"
                      [alt]="displayName(view)"
                      class="h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  }
                  @if (view.entry.coverage.status === 'paid') {
                    <nucleo-icon [icon]="Check" class="h-3 w-3 shrink-0 text-green-600" />
                  }
                  <span class="min-w-0 flex-1 truncate">{{ displayName(view) }}</span>
                  <span
                    class="shrink-0 font-medium"
                    [class.text-green-600]="isIncome(view)"
                    [class.dark:text-green-500]="isIncome(view)"
                  >
                    {{ formatAmount(view) }}
                  </span>
                </button>
                <ng-template #entryContextMenu>
                  <hlm-dropdown-menu class="w-48">
                    <button hlmDropdownMenuItem [disabled]="!canActOnOccurrence(view)" (click)="onAction('enter', view)">
                      <nucleo-icon [icon]="CalendarArrowDown" [size]="14" />
                      <span class="text-xs">Enter now</span>
                    </button>
                    <button hlmDropdownMenuItem [disabled]="view.base.status === 'completed'" (click)="onAction('pause', view)">
                      <nucleo-icon [icon]="Pause" [size]="14" />
                      <span class="text-xs">Pause schedule</span>
                    </button>
                    <button hlmDropdownMenuItem [disabled]="!canActOnOccurrence(view)" (click)="onAction('skip', view)">
                      <nucleo-icon [icon]="SkipForward" [size]="14" />
                      <span class="text-xs">Skip</span>
                    </button>
                    <button hlmDropdownMenuItem variant="destructive" (click)="onAction('delete', view)">
                      <nucleo-icon [icon]="Trash2" [size]="14" />
                      <span class="text-xs">Delete schedule</span>
                    </button>
                  </hlm-dropdown-menu>
                </ng-template>
              }
            }
          </div>
        }
      </div>
    }
  `,
})
export class PlannedCalendarViewComponent {
  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);

  protected readonly Check = Check;
  protected readonly Plus = Plus;
  protected readonly CalendarArrowDown = CalendarArrowDown;
  protected readonly Pause = Pause;
  protected readonly SkipForward = SkipForward;
  protected readonly Trash2 = Trash2;
  protected readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Inputs
  readonly entries = input.required<PlannedMonthEntryView[]>();
  readonly selectedMonth = input.required<number>(); // YYYYMM format

  // Outputs
  readonly entryClick = output<PlannedMonthEntryView>();
  readonly addClick = output<string>(); // dateString in YYYY-MM-DD format
  readonly action = output<{ action: PlannedTransactionAction; planned: PlannedMonthEntryView['base'] }>();

  // Build calendar grid
  readonly calendarWeeks = computed<CalendarWeek[]>(() => {
    const yearMonth = this.selectedMonth();
    const year = getYearFromYearMonth(yearMonth);
    const month = getMonthFromYearMonth(yearMonth);

    // Get first day of month and total days
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    // Get today's date string for comparison
    const today = new Date();
    const todayString = this.formatDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());

    const weeks: CalendarWeek[] = [];
    let currentDay = 1;
    let weekIndex = 0;

    // Generate weeks until we've placed all days
    while (currentDay <= daysInMonth) {
      const week: CalendarDay[] = [];

      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        if (weekIndex === 0 && dayOfWeek < startDayOfWeek) {
          // Padding at start of month
          week.push({ day: null, dateString: `empty-start-${dayOfWeek}`, isToday: false });
        } else if (currentDay > daysInMonth) {
          // Padding at end of month
          week.push({ day: null, dateString: `empty-end-${dayOfWeek}`, isToday: false });
        } else {
          // Actual day
          const dateString = this.formatDateString(year, month, currentDay);
          week.push({
            day: currentDay,
            dateString,
            isToday: dateString === todayString,
          });
          currentDay++;
        }
      }

      weeks.push({ days: week });
      weekIndex++;
    }

    return weeks;
  });

  // Group occurrences by display date
  private readonly entriesByDate = computed<Map<string, PlannedMonthEntryView[]>>(() => {
    const map = new Map<string, PlannedMonthEntryView[]>();

    for (const view of this.entries()) {
      const date = view.entry.displayDate;
      const existing = map.get(date) ?? [];
      existing.push(view);
      map.set(date, existing);
    }

    return map;
  });

  getEntriesForDate(dateString: string): PlannedMonthEntryView[] {
    return this.entriesByDate().get(dateString) ?? [];
  }

  displayName(view: PlannedMonthEntryView): string {
    if (view.entry.isTransfer) {
      return `Transfer to ${view.base.transferToAccountName ?? 'account'}`;
    }
    const merchantName = view.base.merchantId
      ? this.merchantService.merchants().find((merchant) => merchant._id === view.base.merchantId)?.name
      : undefined;
    return view.base.merchantName ?? merchantName ?? 'No payee';
  }

  merchantLogo(view: PlannedMonthEntryView): string | null {
    const merchantId = view.base.merchantId;
    if (view.entry.isTransfer || !merchantId) return null;
    return this.merchantService.merchants().find((merchant) => merchant._id === merchantId)?.logoUrl ?? null;
  }

  isIncome(view: PlannedMonthEntryView): boolean {
    return !view.entry.isTransfer && view.entry.coverage.expectedAmount > 0n;
  }

  isGreenBackground(view: PlannedMonthEntryView): boolean {
    // Paid occurrences or income get a green background
    return view.entry.coverage.status === 'paid' || this.isIncome(view);
  }

  isAmberBackground(view: PlannedMonthEntryView): boolean {
    // Upcoming/skipped expenses get an amber background
    const status = view.entry.coverage.status;
    return (status === 'upcoming' || status === 'skipped') && !this.isIncome(view);
  }

  isOverdueBackground(view: PlannedMonthEntryView): boolean {
    // Overdue expenses get a red/danger background
    return view.entry.coverage.status === 'overdue' && !this.isIncome(view);
  }

  formatAmount(view: PlannedMonthEntryView): string {
    const coverage = view.entry.coverage;
    const amount = coverage.status === 'paid' ? coverage.paidAmount : coverage.expectedAmount;
    const formatted = this.currencyService.format(amount < 0n ? -amount : amount);

    if (this.isIncome(view)) {
      return `+${formatted}`;
    }
    return formatted;
  }

  onEntryClick(view: PlannedMonthEntryView): void {
    this.entryClick.emit(view);
  }

  onDayClick(day: CalendarDay): void {
    if (!day.day) return;
    this.addClick.emit(day.dateString);
  }

  onAddClick(dateString: string): void {
    this.addClick.emit(dateString);
  }

  onAction(action: PlannedTransactionAction, view: PlannedMonthEntryView): void {
    if ((action === 'enter' || action === 'skip') && !this.canActOnOccurrence(view)) return;
    if (action === 'pause' && view.base.status === 'completed') return;
    this.action.emit({ action, planned: view.base });
  }

  canActOnOccurrence(view: PlannedMonthEntryView): boolean {
    const status = view.entry.coverage.status;
    return (
      view.base.status === 'active' &&
      view.entry.occurrenceDate === view.base.nextDate &&
      (status === 'upcoming' || status === 'overdue')
    );
  }

  private formatDateString(year: number, month: number, day: number): string {
    const monthStr = month.toString().padStart(2, '0');
    const dayStr = day.toString().padStart(2, '0');
    return `${year}-${monthStr}-${dayStr}`;
  }
}
