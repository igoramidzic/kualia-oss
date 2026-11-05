import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnCommand } from '@spartan-ng/brain/command';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCalendar } from '@spartan-ng/helm/calendar';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import * as chrono from 'chrono-node';
import { nucleoCalendarFilled as Calendar, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-date-picker',
  imports: [
    FormsModule,
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
      >
        <span class="flex items-center gap-2">
          <nucleo-icon [icon]="Calendar" [size]="14" class="text-muted-foreground" />
          {{ displayDate() }}
        </span>
      </button>
      <hlm-command
        *brnPopoverContent="let ctx"
        hlmPopoverContent
        class="w-auto p-0"
        [search]="dateInputText"
        (searchChange)="onDateInputChange($event)"
      >
        <hlm-command-input [placeholder]="placeholder()" (keydown.enter)="onEnterKey()" />
        <div class="p-3">
          <hlm-calendar
            class="p-0"
            calendarClass="border-0 p-0"
            [date]="dateValue()"
            [min]="min()"
            [max]="max()"
            (dateChange)="onCalendarDateChange($event)"
          />
        </div>
      </hlm-command>
    </brn-popover>
  `,
})
export class DatePickerComponent {
  // Inputs
  readonly date = input<Date | undefined>(undefined);
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');
  readonly placeholder = input<string>('Try: tomorrow, monday, Sep 12th');
  readonly emptyText = input<string>('Select date');
  readonly min = input<Date | undefined>(undefined);
  readonly max = input<Date | undefined>(undefined);

  // Output
  readonly dateChange = output<Date>();

  // Internal state
  readonly popoverState = signal<BrnDialogState>('closed');
  dateInputText = '';
  readonly dateParseError = signal<string | null>(null);
  readonly parsedDate = signal<Date | null>(null);

  // Icons
  readonly Calendar = Calendar;

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
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) {
      return this.emptyText();
    }
    return this.formatDate(d);
  });

  private formatDate(date: Date): string {
    const currentYear = new Date().getFullYear();
    const dateYear = date.getFullYear();

    if (dateYear === currentYear) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }

  onCalendarDateChange(date: Date) {
    this.dateChange.emit(date);
    this.popoverState.set('closed');
    // Reset input text when closing
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
