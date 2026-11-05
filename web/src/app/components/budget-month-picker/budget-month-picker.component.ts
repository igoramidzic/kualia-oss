import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  nucleoChevronDown as ChevronDown,
  nucleoChevronLeft as ChevronLeft,
  nucleoChevronRight as ChevronRight,
  NucleoIcon,
} from '@kualia/icons';
import { formatMonthShort, getMonthFromYearMonth, getYearFromYearMonth } from '../../shared/utils/month.utils';

@Component({
  selector: 'app-budget-month-picker',
  imports: [HlmButton, NucleoIcon, BrnPopover, BrnPopoverTrigger, BrnPopoverContent, HlmPopoverContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2">
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        (click)="navigateToPreviousMonth()"
        [disabled]="!canGoPrevious()"
        class="w-7"
        aria-label="Previous month"
      >
        <nucleo-icon [icon]="ChevronLeft" class="h-4 w-4" />
      </button>
      @if (showDropdown()) {
        <brn-popover
          [state]="popoverState()"
          (stateChanged)="popoverState.set($event)"
          side="bottom"
          align="start"
          sideOffset="5"
        >
          <button
            type="button"
            hlmBtn
            variant="outline"
            size="sm"
            class="flex w-[120px] items-center justify-between text-sm font-medium"
            brnPopoverTrigger
          >
            <span class="text-left">{{ displayMonth() }}</span>
            <nucleo-icon [icon]="ChevronDown" class="h-4 w-4 flex-shrink-0" />
          </button>
          <div *brnPopoverContent class="!w-auto p-4" hlmPopoverContent>
            <!-- Year Navigation -->
            <div class="mb-4 flex items-center justify-between">
              <button
                type="button"
                hlmBtn
                variant="ghost"
                size="icon"
                class="h-8 w-8 border"
                (click)="$event.stopPropagation(); navigateYear(-1)"
                [disabled]="!canNavigateYear(-1)"
                aria-label="Previous year"
              >
                <nucleo-icon [icon]="ChevronLeft" class="h-4 w-4" />
              </button>
              <span class="text-sm font-medium">{{ selectedYear() }}</span>
              <button
                type="button"
                hlmBtn
                variant="ghost"
                size="icon"
                class="h-8 w-8 border"
                (click)="$event.stopPropagation(); navigateYear(1)"
                [disabled]="!canNavigateYear(1)"
                aria-label="Next year"
              >
                <nucleo-icon [icon]="ChevronRight" class="h-4 w-4" />
              </button>
            </div>

            <!-- Month Grid -->
            <div class="grid grid-cols-4 gap-1">
              @for (month of months(); track month.value) {
                <button
                  type="button"
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  [class]="getMonthButtonClass(month.isSelected)"
                  [disabled]="!month.enabled"
                  (click)="selectMonth(month.value)"
                >
                  {{ month.label }}
                </button>
              }
            </div>
          </div>
        </brn-popover>
      }
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        (click)="navigateToNextMonth()"
        [disabled]="!canGoNext()"
        class="w-7"
        aria-label="Next month"
      >
        <nucleo-icon [icon]="ChevronRight" class="h-4 w-4" />
      </button>
      @if (alwaysShowTodayButton() || !isCurrentMonth()) {
        <button
          hlmBtn
          variant="secondary"
          size="sm"
          type="button"
          (click)="navigateToToday()"
          [disabled]="isCurrentMonth()"
          class="text-xs"
        >
          Today
        </button>
      }
    </div>
  `,
})
export class BudgetMonthPickerComponent {
  // Inputs
  readonly selectedMonth = input.required<number>();
  readonly availableRange = input.required<{ minYearMonth: number; maxYearMonth: number } | undefined>();
  readonly isCurrentMonth = input.required<boolean>();
  readonly currentMonth = input.required<number>();
  readonly canGoPrevious = input.required<boolean>();
  readonly canGoNext = input.required<boolean>();
  readonly previousMonth = input.required<number | null>();
  readonly nextMonth = input.required<number | null>();

  // Optional inputs with defaults
  readonly showDropdown = input<boolean>(true);
  readonly alwaysShowTodayButton = input<boolean>(false);

  // Output
  readonly monthChange = output<number>();

  // Internal state
  readonly popoverState = signal<BrnDialogState>('closed');
  readonly selectedYear = signal<number>(0);

  // Icons
  readonly ChevronDown = ChevronDown;
  readonly ChevronLeft = ChevronLeft;
  readonly ChevronRight = ChevronRight;

  // Computed values
  readonly displayMonth = computed(() => formatMonthShort(this.selectedMonth()));

  readonly months = computed(() => {
    const year = this.selectedYear();
    const selected = this.selectedMonth();
    const range = this.availableRange();
    const selectedYearValue = getYearFromYearMonth(selected);
    const selectedMonthValue = getMonthFromYearMonth(selected);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return monthNames.map((name, index) => {
      const month = index + 1; // 1-12
      const yearMonth = year * 100 + month;
      const isSelected = year === selectedYearValue && month === selectedMonthValue;
      const enabled = range ? yearMonth >= range.minYearMonth && yearMonth <= range.maxYearMonth : true;

      return {
        label: name,
        value: yearMonth,
        enabled,
        isSelected,
      };
    });
  });

  constructor() {
    // Initialize selectedYear from selectedMonth
    effect(() => {
      const month = this.selectedMonth();
      this.selectedYear.set(getYearFromYearMonth(month));
    });

    // Update selectedYear when popover opens to ensure it matches selected month's year
    effect(() => {
      if (this.popoverState() === 'open') {
        const month = this.selectedMonth();
        this.selectedYear.set(getYearFromYearMonth(month));
      }
    });
  }

  navigateYear(direction: number): void {
    const currentYear = this.selectedYear();
    const newYear = currentYear + direction;
    this.selectedYear.set(newYear);
  }

  canNavigateYear(direction: number): boolean {
    const range = this.availableRange();
    if (!range) return true;

    const currentYear = this.selectedYear();
    const newYear = currentYear + direction;

    // Check if any month in the new year would be within range
    const firstMonth = newYear * 100 + 1;
    const lastMonth = newYear * 100 + 12;

    // Allow navigation if any part of the year overlaps with the available range
    return firstMonth <= range.maxYearMonth && lastMonth >= range.minYearMonth;
  }

  selectMonth(yearMonth: number): void {
    this.monthChange.emit(yearMonth);
    this.popoverState.set('closed');
  }

  getMonthButtonClass(isSelected: boolean): string {
    const baseClasses = 'h-9 w-9 text-xs';
    if (isSelected) {
      return `${baseClasses} bg-primary text-primary-foreground font-semibold hover:!bg-primary/80`;
    }
    return baseClasses;
  }

  navigateToPreviousMonth(): void {
    const previous = this.previousMonth();
    if (previous) {
      this.monthChange.emit(previous);
    }
  }

  navigateToNextMonth(): void {
    const next = this.nextMonth();
    if (next) {
      this.monthChange.emit(next);
    }
  }

  navigateToToday(): void {
    this.monthChange.emit(this.currentMonth());
  }
}
