import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { NucleoIcon, nucleoMoon as Moon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BudgetCategorySelectionService } from '../../../services/budget-category-selection.service';
import { BudgetService } from '../../../services/budget.service';
import { ConvexService } from '../../../services/convex.service';
import { CurrencyService } from '../../../services/currency.service';
import { ReportingService, TrackingEvent } from '../../../services/reporting.service';
import { UndoRedoService } from '../../../services/undo-redo.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { CoverOverspendingFormComponent } from './cover-overspending-form.component';
import { MoveMoneyFormComponent } from './move-money-form.component';

@Component({
  selector: 'app-available-amount-button',
  imports: [
    BrnPopover,
    BrnPopoverContent,
    BrnPopoverTrigger,
    CoverOverspendingFormComponent,
    HlmButton,
    HlmPopoverContent,
    NucleoIcon,
    MoveMoneyFormComponent,
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
    <div class="flex justify-end">
      <brn-popover
        [state]="popoverState()"
        (stateChanged)="onPopoverStateChange($event)"
        side="bottom"
        align="end"
        sideOffset="5"
      >
        <button
          hlmBtn
          [variant]="buttonVariant()"
          size="sm"
          type="button"
          [class]="buttonClasses()"
          brnPopoverTrigger
          (click)="onButtonClick()"
        >
          <span [class]="textColorClass()">{{ formatCurrency(availableAmount()) }}</span>
          @if (isSnoozed()) {
            <div
              class="bg-background border-border absolute -top-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full border"
            >
              <nucleo-icon [icon]="Moon" [size]="9" class="text-muted-foreground" />
            </div>
          }
        </button>
        <div *brnPopoverContent="let ctx" class="mt-2 w-[320px] p-4" hlmPopoverContent>
          @if (isPositiveAmount()) {
            <app-move-money-form
              [categoryId]="categoryId()"
              [availableAmount]="availableAmount()"
              [yearMonth]="yearMonth()"
              [saving]="saving()"
              (moveMoney)="onMoveMoney($event)"
              (canceled)="cancel()"
            />
          } @else if (isNegativeAmount()) {
            <app-cover-overspending-form
              [categoryId]="categoryId()"
              [availableAmount]="availableAmount()"
              [yearMonth]="yearMonth()"
              [saving]="saving()"
              (moveMoney)="onCoverOverspending($event)"
              (canceled)="cancel()"
            />
          } @else {
            <!-- Zero available amount -->
            <div class="space-y-3">
              <div>
                <p class="text-muted-foreground text-sm">No money available to move.</p>
              </div>
            </div>
          }
        </div>
      </brn-popover>
    </div>
  `,
})
export class AvailableAmountButtonComponent {
  private readonly selectionService = inject(BudgetCategorySelectionService);
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly budgetService = inject(BudgetService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Inputs
  readonly categoryId = input.required<Id<'category'>>();
  readonly availableAmount = input.required<bigint>();
  readonly assignedAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();
  readonly isSelected = input<boolean>(false);
  readonly underfundedAmount = input<bigint>(0n);
  readonly isSnoozed = input<boolean>(false);

  readonly Moon = Moon;

  // Internal state
  readonly popoverState = signal<'open' | 'closed'>('closed');
  readonly saving = signal<boolean>(false);

  constructor() {
    // Reset saving state when popover closes
    effect(() => {
      const state = this.popoverState();
      if (state === 'closed') {
        this.saving.set(false);
      }
    });
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  readonly buttonVariant = computed(() => {
    const amount = this.availableAmount();

    if (amount > 0n) {
      return 'default' as const;
    } else if (amount < 0n) {
      return 'destructive' as const;
    } else {
      return 'outline' as const;
    }
  });

  readonly hasUnmetTarget = computed(() => !this.isSnoozed() && this.underfundedAmount() > 0n);

  readonly buttonClasses = computed(() => {
    const amount = this.availableAmount();
    const selected = this.isSelected();
    const unmetTarget = this.hasUnmetTarget();

    const baseClasses =
      'relative overflow-visible flex items-center justify-end gap-2 px-2 py-0 transition-none border';

    if (amount < 0n) {
      // Light red background with border (negative takes priority)
      if (selected) {
        return `${baseClasses} !bg-red-100 !border-red-300 hover:!bg-red-100 dark:!bg-red-950 dark:!border-red-800 dark:hover:!bg-red-900`;
      }
      return `${baseClasses} bg-red-100 border-red-300 hover:bg-red-100 dark:bg-red-950 dark:border-red-800 dark:hover:bg-red-900`;
    } else if (unmetTarget) {
      // Light yellow background with border (unmet target)
      if (selected) {
        return `${baseClasses} !bg-yellow-100 !border-yellow-300 hover:!bg-yellow-100 dark:!bg-yellow-950 dark:!border-yellow-700 dark:hover:!bg-yellow-900`;
      }
      return `${baseClasses} bg-yellow-100 border-yellow-300 hover:bg-yellow-100 dark:bg-yellow-950 dark:border-yellow-700 dark:hover:bg-yellow-900`;
    } else if (amount > 0n) {
      // Light green background with border
      if (selected) {
        return `${baseClasses} !bg-green-100 !border-green-300 hover:!bg-green-100 dark:!bg-green-950 dark:!border-green-800 dark:hover:!bg-green-900`;
      }
      return `${baseClasses} bg-green-100 border-green-300 hover:bg-green-100 dark:bg-green-950 dark:border-green-800 dark:hover:bg-green-900`;
    } else {
      // Zero amount - neutral grayish background with border
      if (selected) {
        return `${baseClasses} !bg-gray-100 !border-gray-300 hover:!bg-gray-100 focus:!ring-gray-400 dark:!bg-gray-900 dark:!border-gray-700 dark:hover:!bg-gray-800 dark:focus:!ring-gray-600`;
      }
      return `${baseClasses} bg-gray-100 border-gray-300 hover:bg-gray-100 focus:ring-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800 dark:focus:ring-gray-600`;
    }
  });

  readonly textColorClass = computed(() => {
    return 'text-foreground';
  });

  readonly isPositiveAmount = computed(() => this.availableAmount() > 0n);
  readonly isNegativeAmount = computed(() => this.availableAmount() < 0n);

  onPopoverStateChange(state: 'open' | 'closed'): void {
    this.popoverState.set(state);
  }

  onButtonClick(): void {
    // Deselect all categories and select this one
    this.selectionService.deselectAllCategories();
    this.selectionService.selectCategory(this.categoryId());
  }

  async onMoveMoney(event: { amount: number; targetCategoryId: Id<'category'> | 'ready-to-assign' }): Promise<void> {
    const { amount, targetCategoryId } = event;
    await this.executeMoveMoney(amount, this.categoryId(), targetCategoryId);
  }

  async onCoverOverspending(event: {
    amount: number;
    sourceCategoryId: Id<'category'> | 'ready-to-assign';
  }): Promise<void> {
    const { amount, sourceCategoryId } = event;
    await this.executeMoveMoney(amount, sourceCategoryId, this.categoryId());
  }

  private async executeMoveMoney(
    moveAmount: number,
    fromCategoryId: Id<'category'> | 'ready-to-assign',
    toCategoryId: Id<'category'> | 'ready-to-assign'
  ): Promise<void> {
    if (moveAmount <= 0) {
      return;
    }

    const moveAmountBigInt = BigInt(Math.round(moveAmount));
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('Workspace ID not available');
      return;
    }

    const yearMonth = this.yearMonth();
    const months = this.budgetService.months();
    const currentMonthData = months.find((m) => m.yearMonth === yearMonth);

    // Prepare updates for batch mutation, tracking previous amounts for undo
    const updates: { categoryId: Id<'category'>; assignedAmount: bigint }[] = [];
    const previousUpdates: { categoryId: Id<'category'>; assignedAmount: bigint }[] = [];

    // Handle FROM category (or ready-to-assign)
    if (fromCategoryId !== 'ready-to-assign') {
      const fromCategoryBudget = currentMonthData?.budgetData[fromCategoryId];
      const fromCurrentAssigned = fromCategoryBudget?.assignedAmount ?? 0n;
      const fromNewAssigned = fromCurrentAssigned - moveAmountBigInt;
      updates.push({ categoryId: fromCategoryId, assignedAmount: fromNewAssigned });
      previousUpdates.push({ categoryId: fromCategoryId, assignedAmount: fromCurrentAssigned });
    }

    // Handle TO category (or ready-to-assign)
    if (toCategoryId !== 'ready-to-assign') {
      const toCategoryBudget = currentMonthData?.budgetData[toCategoryId];
      const toCurrentAssigned = toCategoryBudget?.assignedAmount ?? 0n;
      const toNewAssigned = toCurrentAssigned + moveAmountBigInt;
      updates.push({ categoryId: toCategoryId, assignedAmount: toNewAssigned });
      previousUpdates.push({ categoryId: toCategoryId, assignedAmount: toCurrentAssigned });
    }

    // If both are ready-to-assign, nothing to do
    if (updates.length === 0) {
      return;
    }

    this.saving.set(true);
    const capturedYearMonth = Math.trunc(yearMonth);

    const savePromise = this.convexService.mutation(api.categoryBudgets.batchUpdateCategoryBudgets, {
      workspaceId: workspaceId as Id<'workspace'>,
      yearMonth: capturedYearMonth,
      updates,
    });

    toast.promise(savePromise, {
      loading: 'Moving money...',
      success: 'Money moved successfully',
      error: (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Failed to move money';
        console.error('Failed to move money:', errorMessage);
        return errorMessage;
      },
    });

    try {
      await savePromise;
      this.reportingService.capture(TrackingEvent.MONEY_ASSIGNED, { method: 'move' });

      this.undoRedoService.pushAction({
        description: 'Money moved',
        type: 'budget-move-money',
        timestamp: Date.now(),
        undo: async () => {
          await this.convexService.mutation(api.categoryBudgets.batchUpdateCategoryBudgets, {
            workspaceId: workspaceId as Id<'workspace'>,
            yearMonth: capturedYearMonth,
            updates: previousUpdates,
          });
        },
        redo: async () => {
          await this.convexService.mutation(api.categoryBudgets.batchUpdateCategoryBudgets, {
            workspaceId: workspaceId as Id<'workspace'>,
            yearMonth: capturedYearMonth,
            updates,
          });
        },
      });

      // Close popover on success
      this.popoverState.set('closed');
    } catch (error: unknown) {
      // Error is already handled by toast.promise
      console.error('Failed to move money:', error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.popoverState.set('closed');
  }
}
