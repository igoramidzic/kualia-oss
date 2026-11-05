import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { nucleoCalendarFilled as Calendar, NucleoIcon, nucleoRecurrence as Repeat } from '@kualia/icons';
import { BrnCommand } from '@spartan-ng/brain/command';
import type { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCalendar } from '@spartan-ng/helm/calendar';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import * as chrono from 'chrono-node';
import { RECURRENCE_OPTIONS, type Recurrence, recurrenceLabel } from '../../shared/utils/recurrence.utils';

@Component({
  selector: 'app-transaction-date-picker',
  imports: [
    HlmSelectImports,
    HlmButton,
    NucleoIcon,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
    BrnCommand,
    HlmCommandImports,
    HlmCalendar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-popover [state]="popoverState()" (stateChanged)="onPopoverStateChange($event)" sideOffset="5">
      <button
        type="button"
        hlmBtn
        [variant]="variant()"
        size="sm"
        [class]="buttonClass()"
        [disabled]="disabled()"
        brnPopoverTrigger
        (click)="$event.stopPropagation(); $event.preventDefault()"
      >
        <span class="flex items-center gap-2">
          <nucleo-icon [icon]="Calendar" [size]="14" class="text-muted-foreground" />
          {{ displayDate() }}
          @if (showRecurrence() && recurrence() !== 'once') {
            <nucleo-icon [icon]="Repeat" [size]="14" class="text-muted-foreground" />
          }
        </span>
      </button>
      <hlm-command
        *brnPopoverContent="let ctx"
        hlmPopoverContent
        class="w-auto p-0"
        [search]="dateInputText"
        (searchChange)="onDateInputChange($event)"
      >
        <hlm-command-input placeholder="Try: yesterday, monday, Sep 12th" (keydown.enter)="onEnterKey()" />
        <div class="p-3">
          <hlm-calendar
            class="p-0"
            calendarClass="border-0 p-0"
            [date]="dateValue()"
            [max]="maxDate()"
            (dateChange)="onCalendarDateChange($event)"
          />
          @if (showRecurrence()) {
            <div class="mt-3 border-t pt-3">
              <label
                [for]="recurrenceSelectId"
                class="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs select-none"
              >
                <nucleo-icon [icon]="Repeat" [size]="12" />
                Frequency
              </label>
              <hlm-select
                [value]="recurrence()"
                [itemToString]="recurrenceToString"
                (valueChange)="onRecurrenceChange($event)"
              >
                <hlm-select-trigger [buttonId]="recurrenceSelectId" size="sm" class="w-full text-xs">
                  <hlm-select-value />
                </hlm-select-trigger>
                <hlm-select-content *hlmSelectPortal>
                  @for (option of recurrenceOptions; track option.value) {
                    <hlm-select-item [value]="option.value" class="text-xs">{{ option.label }}</hlm-select-item>
                  }
                </hlm-select-content>
              </hlm-select>
            </div>
          }
          @if (showMakeRecurring()) {
            <div class="mt-3 border-t pt-3">
              <button
                type="button"
                hlmBtn
                variant="ghost"
                size="sm"
                class="w-full justify-start px-2 text-xs"
                (click)="onMakeRecurringClick()"
              >
                <nucleo-icon [icon]="Repeat" [size]="14" class="text-muted-foreground" />
                Make recurring
              </button>
            </div>
          }
        </div>
      </hlm-command>
    </brn-popover>
  `,
})
export class TransactionDatePickerComponent {
  private static nextId = 0;

  // Inputs
  readonly date = input<Date>(new Date());
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');
  // undefined = default to today, null = no max, Date = specific max
  readonly max = input<Date | undefined | null>(undefined);
  // When true, a frequency picker is shown under the calendar and a repeat icon appears
  // in the trigger button whenever the recurrence is anything other than 'once'.
  readonly showRecurrence = input<boolean>(false);
  readonly recurrence = input<Recurrence>('once');
  readonly showMakeRecurring = input<boolean>(false);

  // Outputs
  readonly dateChange = output<Date>();
  readonly recurrenceChange = output<Recurrence>();
  readonly makeRecurring = output<void>();

  // Internal state
  readonly popoverState = signal<BrnDialogState>('closed');
  dateInputText = '';
  readonly dateParseError = signal<string | null>(null);
  readonly parsedDate = signal<Date | null>(null);

  // Icons
  readonly Calendar = Calendar;
  readonly Repeat = Repeat;
  readonly recurrenceSelectId = `transaction-date-picker-recurrence-${TransactionDatePickerComponent.nextId++}`;
  protected readonly recurrenceOptions = RECURRENCE_OPTIONS;
  protected readonly recurrenceToString = recurrenceLabel;

  // Computed max date - defaults to today if not provided, null means no max
  readonly maxDate = computed(() => {
    const providedMax = this.max();
    // null means no max date restriction
    if (providedMax === null) return undefined;
    // If a specific date is provided, use it
    if (providedMax) return providedMax;
    // Default to end of today
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return today;
  });

  // Computed values
  readonly dateValue = computed(() => {
    // If we have a parsed date from the input, use that for the calendar display
    const parsed = this.parsedDate();
    if (parsed) return parsed;

    const d = this.date();
    // Ensure we have a valid Date object
    return d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  });

  readonly displayDate = computed(() => {
    // Show the parsed date preview while popover is open, otherwise show the actual date
    if (this.popoverState() === 'open' && this.parsedDate()) {
      return this.formatDate(this.parsedDate()!);
    }
    const d = this.date();
    const validDate = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
    return this.formatDate(validDate);
  });

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  onCalendarDateChange(date: Date | null | undefined) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      this.popoverState.set('closed');
      this.dateInputText = '';
      this.dateParseError.set(null);
      this.parsedDate.set(null);
      return;
    }

    this.dateChange.emit(date);
    this.popoverState.set('closed');
    // Reset input text when closing
    this.dateInputText = '';
    this.dateParseError.set(null);
    this.parsedDate.set(null);
  }

  onRecurrenceChange(recurrence: Recurrence | null | undefined) {
    if (recurrence == null) return;
    // Keep the popover open so the user can also adjust the date if they want.
    this.recurrenceChange.emit(recurrence);
  }

  onMakeRecurringClick() {
    this.makeRecurring.emit();
    this.popoverState.set('closed');
    this.dateInputText = '';
    this.dateParseError.set(null);
    this.parsedDate.set(null);
  }

  onDateInputChange(text: string) {
    if (!text.trim()) {
      this.dateParseError.set(null);
      this.parsedDate.set(this.dateValue());
      return;
    }

    try {
      const parsed = chrono.parseDate(text, new Date(), {
        forwardDate: false,
      });

      if (parsed) {
        // Reject dates beyond the max date (if max is set)
        const max = this.maxDate();
        if (max && parsed > max) {
          this.dateParseError.set(null);
          this.parsedDate.set(null);
          return;
        }
        this.parsedDate.set(parsed);
        this.dateParseError.set(null);
      } else {
        this.dateParseError.set(null);
        this.parsedDate.set(null);
      }
    } catch {
      this.dateParseError.set(null);
      this.parsedDate.set(null);
    }
  }

  onEnterKey() {
    if (this.parsedDate()) {
      this.dateChange.emit(this.parsedDate()!);
      this.popoverState.set('closed');
      // Reset input text when closing
      this.dateInputText = '';
      this.dateParseError.set(null);
      this.parsedDate.set(null);
    }
  }

  onPopoverStateChange(state: BrnDialogState) {
    this.popoverState.set(state);
    // When the popover closes, reset the parsed date and input text
    // This ensures the preview date doesn't persist when escape is pressed
    if (state === 'closed') {
      this.dateInputText = '';
      this.dateParseError.set(null);
      this.parsedDate.set(null);
    }
  }
}
