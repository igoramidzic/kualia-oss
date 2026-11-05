import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { CategoryTarget } from 'convex/categoryTargets/types';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { ConvexService } from '../../../services/convex.service';
import { CurrencyService } from '../../../services/currency.service';
import { ReportingService, TrackingEvent } from '../../../services/reporting.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { CurrencyInputComponent } from '../../../shared/components/currency-input/currency-input.component';
import { DatePickerComponent } from '../../../shared/components/date-picker/date-picker.component';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { formatDateToString, getOrdinal } from '../../../shared/utils/date-utils';
import { CategoryTargetDescriptionComponent } from '../../budget/category-target-description.component';
import { TargetTypeSelection, TargetTypeToggleComponent } from '../../budget/target-type-toggle.component';

type TargetType = 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface DialogContext {
  categoryId: Id<'category'>;
  categoryName: string;
  existingTarget: CategoryTarget;
  enableTarget: boolean;
  onClose: (saved?: boolean) => void;
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'day' },
  { value: 'weekly', label: 'week' },
  { value: 'monthly', label: 'month' },
  { value: 'yearly', label: 'year' },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const DAY_OF_MONTH_OPTIONS = [
  { value: -1, label: 'last day of month' },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: getOrdinal(i + 1) })),
];

/**
 * Parse a date string (YYYY-MM-DD) as a local date to avoid timezone shifts.
 */
function parseDateAsLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

@Component({
  selector: 'app-category-target-dialog',
  imports: [
    FormsModule,
    HlmButton,
    HlmDialogHeader,
    HlmDialogFooter,
    DatePickerComponent,
    NucleoIcon,
    CurrencyInputComponent,
    TargetTypeToggleComponent,
    CategoryTargetDescriptionComponent,
    HlmSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category-target-dialog.html',
})
export class CategoryTargetDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);

  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();
  protected readonly categoryName = this.dialogContext.categoryName;
  protected readonly existingTarget = this.dialogContext.existingTarget;
  protected readonly enableTarget = this.dialogContext.enableTarget;

  // UI selection state (maps to 4-option popover)
  protected readonly targetTypeSelection = signal<TargetTypeSelection>(this.getInitialTargetTypeSelection());

  // Form state
  protected readonly amount = signal<bigint>(this.existingTarget?.amount ?? 0n);
  protected readonly frequency = signal<Frequency>(this.existingTarget?.frequency ?? 'monthly');
  protected readonly frequencyInterval = signal<number>(this.existingTarget?.frequencyInterval ?? 1);
  protected readonly dayOfWeek = signal<number | undefined>(this.existingTarget?.dayOfWeek);
  protected readonly dueDay = signal<number | undefined>(this.existingTarget?.dueDay);
  protected readonly firstDueDate = signal<Date | undefined>(
    this.existingTarget?.firstDueDate
      ? parseDateAsLocal(this.existingTarget.firstDueDate)
      : this.getDefaultFirstDueDate()
  );
  protected readonly targetDate = signal<Date | undefined>(
    this.existingTarget?.targetDate ? parseDateAsLocal(this.existingTarget.targetDate) : undefined
  );
  protected readonly monthlyContribution = signal<bigint>(this.existingTarget?.monthlyContribution ?? 0n);

  // Track if user has manually set the first due date
  private readonly isFirstDueDateManuallySet = signal<boolean>(!!this.existingTarget?.firstDueDate);

  // UI state
  protected readonly isSubmitting = signal(false);
  protected readonly isDeleting = signal(false);
  protected readonly error = signal<string | null>(null);

  // Options
  protected readonly frequencyOptions = FREQUENCY_OPTIONS;
  protected readonly dayOfWeekOptions = DAY_OF_WEEK_OPTIONS;
  protected readonly dayOfMonthOptions = DAY_OF_MONTH_OPTIONS;
  protected readonly minTargetDate = new Date();
  protected readonly compactSelectTriggerClass =
    'h-8 border-transparent bg-transparent px-1 py-0 text-xs shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

  // Computed: Maps UI selection to backend targetType
  protected readonly computedTargetType = computed<TargetType>(() => {
    const selection = this.targetTypeSelection();
    switch (selection) {
      case 'set_aside':
        return 'recurring';
      case 'fill_up':
        return 'recurring_rollover';
      case 'maintain_balance':
        return 'maintain_balance';
      case 'one_time':
        return 'one_time';
      default:
        return 'recurring';
    }
  });

  // Display values for currency inputs (convert bigint to number)
  protected readonly amountDisplay = computed(() => {
    const amt = this.amount();
    return amt !== 0n ? Number(amt) : null;
  });

  protected readonly monthlyContributionDisplay = computed(() => {
    const contrib = this.monthlyContribution();
    return contrib !== 0n ? Number(contrib) : null;
  });

  // Computed: Frequency interval options based on selected frequency
  protected readonly frequencyIntervalOptions = computed(() => {
    const freq = this.frequency();
    let max: number;
    switch (freq) {
      case 'daily':
        max = 365;
        break;
      case 'weekly':
        max = 50;
        break;
      case 'monthly':
        max = 24;
        break;
      case 'yearly':
        max = 12;
        break;
      default:
        max = 12;
    }
    return Array.from({ length: max }, (_, i) => ({ value: i + 1, label: `${i + 1}` }));
  });

  // Computed: Frequency label with singular/plural based on interval
  protected readonly frequencyLabel = computed(() => {
    const freq = this.frequency();
    const interval = this.frequencyInterval();
    const isSingular = interval === 1;

    const labels: Record<Frequency, { singular: string; plural: string }> = {
      daily: { singular: 'day', plural: 'days' },
      weekly: { singular: 'week', plural: 'weeks' },
      monthly: { singular: 'month', plural: 'months' },
      yearly: { singular: 'year', plural: 'years' },
    };

    return isSingular ? labels[freq].singular : labels[freq].plural;
  });

  // Computed: Frequency options with singular/plural labels based on interval
  protected readonly frequencyOptionsWithLabels = computed(() => {
    const interval = this.frequencyInterval();
    const isSingular = interval === 1;

    return FREQUENCY_OPTIONS.map((option) => {
      const pluralLabel = option.label + 's';
      return {
        value: option.value,
        label: isSingular ? option.label : pluralLabel,
      };
    });
  });

  protected readonly frequencyIntervalToString = (value: number): string =>
    this.frequencyIntervalOptions().find((option) => option.value === value)?.label ?? `${value}`;

  protected readonly frequencyToString = (value: Frequency): string =>
    this.frequencyOptionsWithLabels().find((option) => option.value === value)?.label ?? value;

  protected readonly dayOfWeekToString = (value: number): string =>
    DAY_OF_WEEK_OPTIONS.find((option) => option.value === value)?.label ?? `${value}`;

  protected readonly dueDayToString = (value: number): string =>
    DAY_OF_MONTH_OPTIONS.find((option) => option.value === value)?.label ?? `${value}`;

  // Auto-select default values when switching frequency
  constructor() {
    // Auto-select default day/date values
    effect(() => {
      const freq = this.frequency();

      // Auto-select Sunday for weekly frequency
      if (freq === 'weekly' && this.dayOfWeek() === undefined) {
        this.dayOfWeek.set(0); // Sunday
      }

      // Auto-select last day of month for monthly frequency
      if (freq === 'monthly' && this.dueDay() === undefined) {
        this.dueDay.set(-1); // Last day of month
      }
    });

    // Auto-update first due date when frequency settings change
    effect(() => {
      // Watch all relevant signals to trigger recalculation
      this.frequency();
      this.frequencyInterval();
      this.dayOfWeek();
      this.dueDay();

      // Only auto-update if user hasn't manually set the date
      if (!this.isFirstDueDateManuallySet()) {
        const nextDate = this.calculateNextDueDate();
        this.firstDueDate.set(nextDate);
      }
    });
  }

  protected onFirstDueDateChange(date: Date | undefined): void {
    this.firstDueDate.set(date);
    // Mark as manually set when user changes it
    this.isFirstDueDateManuallySet.set(true);
  }

  private getInitialTargetTypeSelection(): TargetTypeSelection {
    const existing = this.existingTarget;
    if (!this.dialogContext.enableTarget) return 'set_aside';

    switch (existing.targetType) {
      case 'recurring':
        return 'set_aside';
      case 'recurring_rollover':
        return 'fill_up';
      case 'maintain_balance':
        return 'maintain_balance';
      case 'one_time':
        return 'one_time';
      default:
        return 'set_aside';
    }
  }

  private getDefaultFirstDueDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /**
   * Calculate the next due date based on current frequency settings
   */
  private calculateNextDueDate(): Date {
    const now = new Date();
    const freq = this.frequency();
    const dow = this.dayOfWeek();
    const day = this.dueDay();

    switch (freq) {
      case 'daily': {
        // Next occurrence is tomorrow
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }

      case 'weekly': {
        if (dow === undefined) return now;
        // Find next occurrence of the selected day of week
        const currentDow = now.getDay();
        let daysUntilTarget = dow - currentDow;
        if (daysUntilTarget <= 0) daysUntilTarget += 7;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilTarget);
      }

      case 'monthly': {
        if (day === undefined) return now;
        const targetDay = day === -1 ? this.getLastDayOfMonth(now.getFullYear(), now.getMonth()) : day;
        let targetMonth = now.getMonth();
        let targetYear = now.getFullYear();

        // If target day has passed this month, use next month
        if (now.getDate() >= targetDay) {
          targetMonth++;
          if (targetMonth > 11) {
            targetMonth = 0;
            targetYear++;
          }
        }

        // Handle last day of month for different month lengths
        const finalDay =
          day === -1
            ? this.getLastDayOfMonth(targetYear, targetMonth)
            : Math.min(targetDay, this.getLastDayOfMonth(targetYear, targetMonth));

        return new Date(targetYear, targetMonth, finalDay);
      }

      case 'yearly': {
        // Next occurrence is same day next year
        return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      }

      default:
        return now;
    }
  }

  /**
   * Get the last day of a specific month
   */
  private getLastDayOfMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
  }

  protected onTargetTypeChange(selection: TargetTypeSelection): void {
    this.targetTypeSelection.set(selection);
  }

  protected onAmountChange(value: number | null): void {
    this.amount.set(value !== null ? BigInt(value) : 0n);
  }

  protected onMonthlyContributionChange(value: number | null): void {
    this.monthlyContribution.set(value !== null ? BigInt(value) : 0n);
  }

  protected isFormValid(): boolean {
    if (this.amount() <= 0n) return false;

    const selection = this.targetTypeSelection();

    if (selection === 'one_time') {
      const td = this.targetDate();
      if (!td) return false;
      if (td <= new Date()) return false;
      return true;
    }

    if (selection === 'set_aside' || selection === 'fill_up') {
      if (this.frequency() === 'weekly' && this.dayOfWeek() === undefined) return false;
    }

    if (selection === 'maintain_balance' && this.monthlyContribution() <= 0n) {
      return false;
    }

    return true;
  }

  cancel(): void {
    this.dialogContext.onClose(false);
  }

  async handleSave(): Promise<void> {
    if (this.isSubmitting()) return;

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.error.set('No workspace selected');
      return;
    }

    this.isSubmitting.set(true);
    this.isDeleting.set(false);
    this.error.set(null);

    try {
      const targetType = this.computedTargetType();
      const amountNumber = Number(this.amount());
      const monthlyContributionNumber =
        targetType === 'maintain_balance' ? Number(this.monthlyContribution()) : undefined;

      const targetData = {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId: this.dialogContext.categoryId,
        targetType,
        amount: amountNumber,
        frequency: targetType === 'one_time' ? undefined : this.frequency(),
        frequencyInterval: targetType === 'one_time' ? undefined : this.frequencyInterval(),
        dayOfWeek: targetType === 'one_time' ? undefined : this.frequency() === 'weekly' ? this.dayOfWeek() : undefined,
        dueDay: targetType === 'one_time' ? undefined : (this.dueDay() ?? undefined),
        firstDueDate:
          targetType === 'one_time'
            ? undefined
            : this.firstDueDate()
              ? formatDateToString(this.firstDueDate()!)
              : undefined,
        targetDate: this.targetDate() ? formatDateToString(this.targetDate()!) : undefined,
        monthlyContribution: monthlyContributionNumber,
        targetBalance: targetType === 'maintain_balance' ? amountNumber : undefined,
      };

      if (this.dialogContext.enableTarget) {
        await this.convexService.mutation(api.categoryTargets.updateCategoryTarget, targetData);
      } else {
        await this.convexService.mutation(api.categoryTargets.createCategoryTarget, targetData);
      }
      this.reportingService.capture(TrackingEvent.TARGET_SET, { type: targetType });

      this.dialogContext.onClose(true);
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to save target'));
      this.isSubmitting.set(false);
    }
  }

  async handleDelete(): Promise<void> {
    if (!this.dialogContext.enableTarget) return;
    if (this.isSubmitting()) return;

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.error.set('No workspace selected');
      return;
    }

    this.isSubmitting.set(true);
    this.isDeleting.set(true);
    this.error.set(null);

    try {
      await this.convexService.mutation(api.categoryTargets.deleteCategoryTarget, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId: this.dialogContext.categoryId,
      });
      this.reportingService.capture(TrackingEvent.TARGET_REMOVED);

      this.dialogContext.onClose(true);
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to delete target'));
      this.isSubmitting.set(false);
      this.isDeleting.set(false);
    }
  }
}
