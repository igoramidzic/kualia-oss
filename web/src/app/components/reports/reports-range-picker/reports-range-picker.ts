import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  nucleoCalendarRepeating as CalendarDays,
  nucleoChevronLeft as ChevronLeft,
  nucleoChevronRight as ChevronRight,
  NucleoIcon,
} from '@kualia/icons';
import { formatMonthShort, getYearFromYearMonth } from '../../../shared/utils/month.utils';
import { HlmSeparator } from '../../../ui/separator/src';

// Range types
export type ReportRange =
  | { type: 'preset'; preset: ReportRangePresetKind }
  | { type: 'range'; start: number | null; end: number | null };

export type ReportRangePresetKind =
  | 'thisMonth'
  | 'lastMonth'
  | 'last3Months'
  | 'last6Months'
  | 'yearToDate'
  | 'lastYear'
  | 'allTime';

export const PRESET_LABELS: Record<ReportRangePresetKind, string> = {
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  last3Months: 'Last 3 Months',
  last6Months: 'Last 6 Months',
  yearToDate: 'Year to Date',
  lastYear: 'Last Year',
  allTime: 'All Time',
};

const PRESET_LIST: ReportRangePresetKind[] = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'last6Months',
  'yearToDate',
  'lastYear',
  'allTime',
];

export function getRangeLabel(range: ReportRange, selectedMonth: number): string {
  switch (range.type) {
    case 'preset':
      return PRESET_LABELS[range.preset];
    case 'range': {
      const startLabel = range.start ? formatMonthShort(range.start) : 'Earliest';
      const endLabel = range.end ? formatMonthShort(range.end) : formatMonthShort(selectedMonth);
      return `${startLabel} - ${endLabel}`;
    }
  }
}

type PickerMode = 'presets' | 'range';

@Component({
  selector: 'app-reports-range-picker',
  imports: [HlmButton, NucleoIcon, BrnPopover, BrnPopoverTrigger, BrnPopoverContent, HlmPopoverContent, HlmSeparator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-popover
      [state]="popoverState()"
      (stateChanged)="onPopoverStateChanged($event)"
      side="bottom"
      align="start"
      sideOffset="5"
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          hlmBtn
          variant="outline"
          size="sm"
          class="relative flex w-auto items-center gap-1.5 text-sm font-medium"
          brnPopoverTrigger
        >
          @if (isActive()) {
            <span class="bg-destructive absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full"></span>
          }
          <nucleo-icon [icon]="CalendarIcon" class="text-muted-foreground h-3.5 w-3.5" />
          <span>{{ triggerLabel() }}</span>
        </button>
        @if (isActive()) {
          <button
            type="button"
            hlmBtn
            variant="ghost"
            size="sm"
            class="text-primary text-sm font-medium"
            (click)="clearRange()"
          >
            Clear
          </button>
        }
      </div>
      <div *brnPopoverContent class="!w-auto !p-0" hlmPopoverContent>
        <div class="flex">
          <!-- Left panel: range mode + presets -->
          <div class="flex w-[160px] flex-shrink-0 flex-col gap-0.5 p-1.5" [class.border-r]="pickerMode() === 'range'">
            <!-- Range mode button -->
            <button
              type="button"
              class="rounded-md px-3 py-2 text-left text-sm font-medium"
              [class.bg-primary]="pickerMode() === 'range'"
              [class.text-primary-foreground]="pickerMode() === 'range'"
              [class.hover:bg-primary/80]="pickerMode() === 'range'"
              [class.hover:bg-accent]="pickerMode() !== 'range'"
              (click)="setPickerMode('range')"
            >
              Custom Range
            </button>
            <hlm-separator class="my-1" />
            <!-- Preset list -->
            @for (preset of presetList; track preset) {
              <button
                type="button"
                class="rounded-md px-3 py-2 text-left text-sm"
                [class.bg-primary]="isPresetSelected(preset)"
                [class.text-primary-foreground]="isPresetSelected(preset)"
                [class.font-medium]="isPresetSelected(preset)"
                [class.hover:bg-primary/80]="isPresetSelected(preset)"
                [class.hover:bg-accent]="!isPresetSelected(preset)"
                (click)="selectPreset(preset)"
              >
                {{ presetLabels[preset] }}
              </button>
            }
          </div>

          <!-- Right panel: only shown in range mode -->
          @if (pickerMode() === 'range') {
            <div class="flex min-h-[300px] w-[260px] flex-col">
              <div class="flex-1 p-4">
                <div>
                  <!-- Range summary -->
                  <div class="mb-3 flex items-center justify-between">
                    <span class="text-muted-foreground text-xs font-medium">
                      @if (draftRangeStart() !== null && draftRangeEnd() !== null) {
                        {{ formatMonth(draftRangeStart()!) }} - {{ formatMonth(draftRangeEnd()!) }}
                      } @else if (draftRangeStart() !== null) {
                        {{ formatMonth(draftRangeStart()!) }} - select end
                      } @else {
                        Select start month
                      }
                    </span>
                    @if (draftRangeStart() !== null) {
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground text-xs"
                        (click)="clearRangeSelection()"
                      >
                        Clear
                      </button>
                    }
                  </div>

                  <!-- Year nav -->
                  <div class="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7"
                      (click)="rangeYear.set(rangeYear() - 1)"
                      [disabled]="!canNavigateRangeYear(-1)"
                    >
                      <nucleo-icon [icon]="ChevronLeft" class="h-3.5 w-3.5" />
                    </button>
                    <span class="text-sm font-medium">{{ rangeYear() }}</span>
                    <button
                      type="button"
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7"
                      (click)="rangeYear.set(rangeYear() + 1)"
                      [disabled]="!canNavigateRangeYear(1)"
                    >
                      <nucleo-icon [icon]="ChevronRight" class="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <!-- Month grid -->
                  <div class="grid grid-cols-4 gap-1">
                    @for (m of rangeMonths(); track m.value) {
                      <button
                        type="button"
                        hlmBtn
                        variant="ghost"
                        size="sm"
                        class="h-8 text-xs"
                        [class.bg-primary]="m.isEndpoint"
                        [class.text-primary-foreground]="m.isEndpoint"
                        [class.font-semibold]="m.isEndpoint"
                        [class.bg-primary/15]="m.isInRange && !m.isEndpoint"
                        [disabled]="!m.enabled"
                        (click)="onRangeMonthClick(m.value)"
                      >
                        {{ m.label }}
                      </button>
                    }
                  </div>
                </div>
              </div>

              <!-- Footer -->
              <div class="flex items-center justify-end border-t px-4 py-3">
                <button type="button" hlmBtn variant="default" size="sm" (click)="apply()">Apply</button>
              </div>
            </div>
          }
        </div>
      </div>
    </brn-popover>
  `,
})
export class ReportsRangePickerComponent {
  // Inputs/Outputs
  readonly selectedRange = input.required<ReportRange>();
  readonly selectedMonth = input.required<number>();
  readonly availableRange = input<{ minYearMonth: number; maxYearMonth: number } | undefined>();
  readonly rangeChange = output<ReportRange>();

  // Icons
  protected readonly CalendarIcon = CalendarDays;
  protected readonly ChevronLeft = ChevronLeft;
  protected readonly ChevronRight = ChevronRight;

  // Constants
  protected readonly presetList = PRESET_LIST;
  protected readonly presetLabels = PRESET_LABELS;

  // Popover state
  readonly popoverState = signal<BrnDialogState>('closed');

  // Picker mode
  readonly pickerMode = signal<PickerMode>('presets');

  // Draft state for "Range" mode - single calendar approach
  readonly draftRangeStart = signal<number | null>(null);
  readonly draftRangeEnd = signal<number | null>(null);

  // Year navigation for range mode (single calendar)
  readonly rangeYear = signal(new Date().getFullYear());

  // Month names
  private readonly monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Whether a non-default range is active
  readonly isActive = computed(() => {
    const range = this.selectedRange();
    return !(range.type === 'preset' && range.preset === 'thisMonth');
  });

  // Trigger label
  readonly triggerLabel = computed(() => getRangeLabel(this.selectedRange(), this.selectedMonth()));

  // Single month grid for range mode with range highlighting
  readonly rangeMonths = computed(() => {
    const year = this.rangeYear();
    const start = this.draftRangeStart();
    const end = this.draftRangeEnd();
    const available = this.availableRange();

    return this.monthNames.map((name, index) => {
      const month = index + 1;
      const yearMonth = year * 100 + month;
      const enabled = available ? yearMonth >= available.minYearMonth && yearMonth <= available.maxYearMonth : true;
      const isStart = start === yearMonth;
      const isEnd = end === yearMonth;
      const isEndpoint = isStart || isEnd;
      const isInRange = start !== null && end !== null && yearMonth >= start && yearMonth <= end;
      return { label: name, value: yearMonth, enabled, isEndpoint, isInRange };
    });
  });

  get canNavigateRangeYear(): (direction: number) => boolean {
    return (direction: number) => {
      const range = this.availableRange();
      if (!range) return true;
      const newYear = this.rangeYear() + direction;
      return newYear * 100 + 1 <= range.maxYearMonth && newYear * 100 + 12 >= range.minYearMonth;
    };
  }

  constructor() {
    // Initialize draft state when popover opens
    effect(() => {
      if (this.popoverState() === 'open') {
        this.initializeDraftFromSelection();
      }
    });
  }

  private initializeDraftFromSelection(): void {
    const range = this.selectedRange();
    const currentYear = new Date().getFullYear();

    switch (range.type) {
      case 'preset':
        this.pickerMode.set('presets');
        break;
      case 'range':
        this.pickerMode.set('range');
        this.draftRangeStart.set(range.start);
        this.draftRangeEnd.set(range.end);
        this.rangeYear.set(
          range.start ? getYearFromYearMonth(range.start) : range.end ? getYearFromYearMonth(range.end) : currentYear
        );
        break;
    }
  }

  onPopoverStateChanged(state: BrnDialogState): void {
    this.popoverState.set(state);
  }

  setPickerMode(mode: PickerMode): void {
    this.pickerMode.set(mode);
  }

  isPresetSelected(preset: ReportRangePresetKind): boolean {
    if (this.pickerMode() === 'range') return false;
    const range = this.selectedRange();
    return range.type === 'preset' && range.preset === preset;
  }

  selectPreset(preset: ReportRangePresetKind): void {
    this.rangeChange.emit({ type: 'preset', preset });
    this.popoverState.set('closed');
  }

  // Range mode: standard range picker click behavior
  onRangeMonthClick(yearMonth: number): void {
    const start = this.draftRangeStart();
    const end = this.draftRangeEnd();

    if (start === null || end !== null) {
      this.draftRangeStart.set(yearMonth);
      this.draftRangeEnd.set(null);
    } else {
      if (yearMonth < start) {
        this.draftRangeEnd.set(start);
        this.draftRangeStart.set(yearMonth);
      } else {
        this.draftRangeEnd.set(yearMonth);
      }
    }
  }

  clearRangeSelection(): void {
    this.draftRangeStart.set(null);
    this.draftRangeEnd.set(null);
  }

  apply(): void {
    this.rangeChange.emit({ type: 'range', start: this.draftRangeStart(), end: this.draftRangeEnd() });
    this.popoverState.set('closed');
  }

  clearRange(): void {
    this.rangeChange.emit({ type: 'preset', preset: 'thisMonth' });
  }

  formatMonth(yearMonth: number): string {
    return formatMonthShort(yearMonth);
  }
}
