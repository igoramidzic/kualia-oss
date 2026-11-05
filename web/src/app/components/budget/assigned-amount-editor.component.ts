import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  ChartData,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { NucleoIcon, nucleoMoon as Moon } from '@kualia/icons';
import { BaseChartDirective } from 'ng2-charts';
import { toast } from 'ngx-sonner';

import { BudgetCategorySelectionService } from '../../services/budget-category-selection.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { ReportingService, TrackingEvent } from '../../services/reporting.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { ArithmeticCurrencyInputComponent } from '../../shared/components/arithmetic-currency-input/arithmetic-currency-input.component';
import { fromBaseUnits } from '../../shared/utils/currency-conversion';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface MonthlyHistoryEntry {
  yearMonth: number;
  spent: bigint;
}

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

@Component({
  selector: 'app-assigned-amount-editor',
  imports: [
    ArithmeticCurrencyInputComponent,
    BaseChartDirective,
    BrnPopover,
    BrnPopoverContent,
    BrnPopoverTrigger,
    HlmButton,
    HlmPopoverContent,
    NucleoIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
  template: `
    <div class="w-full">
      <brn-popover [state]="popoverState()" (stateChanged)="onPopoverStateChange($event)" sideOffset="5" class="w-full">
        <button
          hlmBtn
          variant="ghost"
          size="sm"
          type="button"
          [class]="
            isSelected()
              ? 'hover:!bg-accent hover:!text-accent-foreground group-hover:!bg-accent group-hover:!text-accent-foreground flex w-full items-center justify-end gap-2 px-1.5 py-0 transition-none'
              : 'hover:bg-accent hover:text-accent-foreground group-hover:bg-accent group-hover:text-accent-foreground flex w-full items-center justify-end gap-2 px-1.5 py-0 transition-none'
          "
          brnPopoverTrigger
          [disabled]="saving()"
          (click)="onButtonClick()"
        >
          <span
            [class]="
              isSelected()
                ? 'text-foreground hover:!text-accent-foreground group-hover:!text-accent-foreground'
                : 'text-foreground hover:text-accent-foreground group-hover:text-accent-foreground'
            "
            >{{ formatCurrency(assignedAmount()) }}</span
          >
        </button>
        <div *brnPopoverContent="let ctx" class="mt-2 w-[300px] p-4" hlmPopoverContent>
          <div class="space-y-4">
            <!-- Input section -->
            <div>
              <app-arithmetic-currency-input
                #arithmeticInput
                [initialValue]="inputValue()"
                (valueChange)="onInputValueChange($event)"
                (enterPressed)="onEnterKey()"
                [disabled]="saving()"
                inputClass="w-full h-10 rounded-md border border-input bg-background px-3 text-right text-lg font-medium focus:border-ring focus:ring-[3px] focus:ring-ring/50"
                [autoFocus]="true"
              />
            </div>

            <!-- Quick action buttons -->
            @if (hasHistoryData()) {
              <div>
                <h4 class="text-muted-foreground mb-3 text-xs font-medium">History</h4>
                <div class="mb-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="bg-accent/50 hover:bg-accent rounded-lg p-3 text-left transition-colors"
                    [disabled]="saving()"
                    (click)="applyAmount(spentLastMonth())"
                  >
                    <div class="text-foreground text-sm font-semibold">{{ formatCurrency(spentLastMonth()) }}</div>
                    <div class="text-muted-foreground text-xs">Spent last month</div>
                  </button>
                  <button
                    type="button"
                    class="bg-accent/50 hover:bg-accent rounded-lg p-3 text-left transition-colors"
                    [disabled]="saving()"
                    (click)="applyAmount(monthlyAverage())"
                  >
                    <div class="text-foreground text-sm font-semibold">{{ formatCurrency(monthlyAverage()) }}</div>
                    <div class="text-muted-foreground text-xs">Monthly average</div>
                  </button>
                </div>

                <!-- Cover underfunded -->
                @if (hasUnderfunded()) {
                  <button
                    type="button"
                    class="bg-accent/50 hover:bg-accent mb-3 w-full rounded-lg p-3 text-left transition-colors"
                    [disabled]="saving()"
                    (click)="coverUnderfunded()"
                  >
                    <div class="text-foreground text-sm font-semibold">{{ formatCurrency(underfundedAmount()) }}</div>
                    <div class="text-muted-foreground text-xs">Cover underfunded</div>
                  </button>
                }

                <!-- Bar chart -->
                @if (monthlyHistory().length > 0) {
                  <div class="h-28 cursor-pointer">
                    <canvas
                      #chart
                      baseChart
                      [data]="chartData()"
                      [options]="chartOptions"
                      [type]="'bar'"
                      (chartClick)="onChartClick($event)"
                    >
                    </canvas>
                  </div>
                }
              </div>
            }

            <!-- Snooze target -->
            @if (hasTarget()) {
              <div class="border-border border-t pt-3">
                @if (isSnoozed()) {
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                    (click)="onCancelSnooze()"
                  >
                    <nucleo-icon [icon]="Moon" [size]="14" />
                    Cancel Snooze
                  </button>
                } @else {
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                    (click)="onSnoozeTarget()"
                  >
                    <nucleo-icon [icon]="Moon" [size]="14" />
                    Snooze Target
                  </button>
                }
              </div>
            }
          </div>
        </div>
      </brn-popover>
    </div>
  `,
})
export class AssignedAmountEditorComponent {
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly selectionService = inject(BudgetCategorySelectionService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Inputs
  readonly categoryId = input.required<Id<'category'>>();
  readonly assignedAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();
  readonly isSelected = input<boolean>(false);
  readonly isSnoozed = input<boolean>(false);
  readonly hasTarget = input<boolean>(false);

  // Quick action data (passed from budget page)
  readonly spentLastMonth = input<bigint>(0n);
  readonly monthlyAverage = input<bigint>(0n);
  readonly underfundedAmount = input<bigint>(0n);
  readonly monthlyHistory = input<MonthlyHistoryEntry[]>([]);

  readonly Moon = Moon;

  // View children
  readonly arithmeticInput = viewChild<ArithmeticCurrencyInputComponent>('arithmeticInput');

  // Internal state
  readonly popoverState = signal<BrnDialogState>('closed');
  readonly inputValue = signal<number | null>(null);
  readonly saving = signal<boolean>(false);

  readonly hasHistoryData = computed(
    () => this.spentLastMonth() > 0n || this.monthlyAverage() > 0n || this.monthlyHistory().length > 0
  );

  readonly hasUnderfunded = computed(() => this.underfundedAmount() > 0n);

  readonly chartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 } },
        border: { display: false },
      },
      y: {
        display: false,
        beginAtZero: true,
      },
    },
  };

  readonly chartData = computed<ChartData<'bar'>>(() => {
    const history = this.monthlyHistory();
    return {
      labels: history.map((entry) => MONTH_LABELS[(entry.yearMonth % 100) - 1] ?? ''),
      datasets: [
        {
          data: history.map((entry) => fromBaseUnits(entry.spent, this.currencyService.currencyCode())),
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderRadius: 4,
          barThickness: 'flex' as const,
        },
      ],
    };
  });

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  onPopoverStateChange(state: BrnDialogState): void {
    this.popoverState.set(state);

    // Initialize input value when opening popover
    if (state === 'open') {
      // Convert bigint cents to number for the input component
      const currentAmount = Number(this.assignedAmount());
      this.inputValue.set(currentAmount);
    }

    // Reset state when closing
    if (state === 'closed') {
      this.inputValue.set(null);
      this.saving.set(false);
    }
  }

  onInputValueChange(value: number): void {
    this.inputValue.set(value);
  }

  async saveAmount(amount: bigint): Promise<void> {
    const originalAmount = this.assignedAmount();

    // If the amount hasn't changed, just close without saving
    if (amount === originalAmount) {
      this.popoverState.set('closed');
      return;
    }

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('Workspace ID not available');
      return;
    }

    // Set saving state
    this.saving.set(true);

    try {
      await this.convexService.mutation(api.categoryBudgets.upsertCategoryBudget, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId: this.categoryId(),
        yearMonth: BigInt(Math.trunc(this.yearMonth())),
        assignedAmount: amount,
      });
      this.reportingService.capture(TrackingEvent.MONEY_ASSIGNED, { method: 'manual' });

      // Push undo action
      const categoryId = this.categoryId();
      const yearMonth = BigInt(Math.trunc(this.yearMonth()));
      this.undoRedoService.pushAction({
        description: 'Budget assignment updated',
        type: 'budget-assignment',
        timestamp: Date.now(),
        undo: async () => {
          await this.convexService.mutation(api.categoryBudgets.upsertCategoryBudget, {
            workspaceId: workspaceId as Id<'workspace'>,
            categoryId,
            yearMonth,
            assignedAmount: originalAmount,
          });
        },
        redo: async () => {
          await this.convexService.mutation(api.categoryBudgets.upsertCategoryBudget, {
            workspaceId: workspaceId as Id<'workspace'>,
            categoryId,
            yearMonth,
            assignedAmount: amount,
          });
        },
      });

      // Close popover on success
      this.popoverState.set('closed');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save assigned amount';
      console.error('Failed to save assigned amount:', errorMessage);
      toast.error(errorMessage);
      // Keep popover open on error so user can retry
    } finally {
      this.saving.set(false);
    }
  }

  onEnterKey(): void {
    const value = this.inputValue();
    if (value === null || value === undefined) {
      return;
    }
    void this.saveAmount(BigInt(value));
  }

  onButtonClick(): void {
    // Deselect all categories and select this one
    this.selectionService.deselectAllCategories();
    this.selectionService.selectCategory(this.categoryId());
  }

  // Quick action methods - set value in input, then save and close
  applyAmount(amount: bigint): void {
    const cents = Number(amount);
    // Update the input to show the value being saved
    this.inputValue.set(cents);
    this.arithmeticInput()?.setValue(cents);
    // Save and close
    void this.saveAmount(amount);
  }

  coverUnderfunded(): void {
    const current = this.inputValue() ?? 0;
    const underfunded = Number(this.underfundedAmount());
    const newAmount = current + underfunded;
    // Update the input to show the value being saved
    this.inputValue.set(newAmount);
    this.arithmeticInput()?.setValue(newAmount);
    // Save and close
    void this.saveAmount(BigInt(newAmount));
  }

  onChartClick(event: { event?: unknown; active?: object[] }): void {
    if (!event.active || event.active.length === 0) {
      return;
    }

    const activeElement = event.active[0] as { index: number };
    const clickedIndex = activeElement.index;
    const history = this.monthlyHistory();

    if (clickedIndex >= 0 && clickedIndex < history.length) {
      const clickedMonth = history[clickedIndex];
      const cents = Number(clickedMonth.spent);
      // Update the input to show the value being saved
      this.inputValue.set(cents);
      this.arithmeticInput()?.setValue(cents);
      // Save and close
      void this.saveAmount(clickedMonth.spent);
    }
  }

  async onSnoozeTarget(): Promise<void> {
    await this.toggleSnooze(true);
  }

  async onCancelSnooze(): Promise<void> {
    await this.toggleSnooze(false);
  }

  private async toggleSnooze(snoozed: boolean): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) return;

    try {
      await this.convexService.mutation(api.categoryBudgets.toggleTargetSnooze, {
        workspaceId: workspaceId as Id<'workspace'>,
        categoryId: this.categoryId(),
        yearMonth: this.yearMonth(),
        snoozed,
      });
      this.popoverState.set('closed');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update snooze';
      console.error('Failed to toggle snooze:', errorMessage);
      toast.error(errorMessage);
    }
  }
}
