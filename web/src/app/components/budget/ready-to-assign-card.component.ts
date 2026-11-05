import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoChevronDown as ChevronDown, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetService } from '../../services/budget.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { AssignMoneyFormComponent } from './assign-money-form.component';

@Component({
  selector: 'app-ready-to-assign-card',
  imports: [AssignMoneyFormComponent, BrnPopover, BrnPopoverTrigger, BrnPopoverContent, HlmPopoverContent, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-popover [state]="popoverState()" (stateChanged)="popoverState.set($event)" sideOffset="5">
      <button
        type="button"
        class="flex h-7 cursor-pointer items-center gap-2 rounded-md border-0 px-3 transition-colors focus-visible:ring-0 focus-visible:outline-none"
        [class]="cardColorClasses()"
        brnPopoverTrigger
      >
        <span class="text-xs font-medium" [class]="isNegative() ? 'text-destructive' : 'text-muted-foreground'">
          Ready to Assign
        </span>
        <span class="text-sm font-semibold" [class]="isNegative() ? 'text-destructive' : ''">
          {{ formattedAmount() }}
        </span>
        <nucleo-icon
          [icon]="ChevronDown"
          class="h-4 w-4"
          [class]="isNegative() ? 'text-destructive' : 'text-muted-foreground'"
        />
      </button>
      <div *brnPopoverContent="let ctx" hlmPopoverContent class="w-[320px] p-4">
        @if (hasPositiveAmount()) {
          <app-assign-money-form
            [readyToAssignAmount]="readyToAssign()"
            [yearMonth]="yearMonth()"
            [saving]="saving()"
            (assignMoney)="onAssignMoney($event)"
            (canceled)="cancel()"
          />
        } @else {
          <div class="space-y-3">
            <div>
              <p class="text-muted-foreground text-sm">No money available to assign.</p>
            </div>
          </div>
        }
      </div>
    </brn-popover>
  `,
})
export class ReadyToAssignCardComponent {
  private readonly budgetService = inject(BudgetService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly workspaceService = inject(WorkspaceService);

  protected readonly readyToAssign = this.budgetService.readyToAssign;
  protected readonly popoverState = signal<'open' | 'closed'>('closed');
  protected readonly saving = signal<boolean>(false);
  protected readonly ChevronDown = ChevronDown;

  protected readonly yearMonth = computed(() => this.budgetMonthService.getLastViewedMonth());
  protected readonly isNegative = computed(() => this.readyToAssign() < 0n);
  protected readonly hasPositiveAmount = computed(() => this.readyToAssign() > 0n);
  protected readonly cardColorClasses = computed(() => {
    if (this.isNegative()) {
      return 'bg-destructive/10 hover:bg-destructive/20';
    }

    if (this.hasPositiveAmount()) {
      return 'bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/40';
    }

    return 'bg-secondary hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]';
  });

  protected readonly formattedAmount = computed(() => {
    return this.currencyService.format(this.readyToAssign());
  });

  constructor() {
    // Reset saving state when popover closes
    effect(() => {
      const state = this.popoverState();
      if (state === 'closed') {
        this.saving.set(false);
      }
    });
  }

  async onAssignMoney(event: { amount: number; categoryId: Id<'category'> }): Promise<void> {
    const { amount, categoryId } = event;
    if (amount <= 0) {
      return;
    }

    const assignAmountBigInt = BigInt(Math.round(amount));
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('Workspace ID not available');
      return;
    }

    const yearMonth = this.budgetMonthService.getLastViewedMonth();
    const months = this.budgetService.months();
    const currentMonthData = months.find((m) => m.yearMonth === yearMonth);

    // Prepare updates for batch mutation
    // Only update the TO category (increase assigned amount)
    // The mutation automatically decreases readyToAssign based on the delta
    const updates: { categoryId: Id<'category'>; assignedAmount: bigint }[] = [];

    const toCategoryBudget = currentMonthData?.budgetData[categoryId];
    const toCurrentAssigned = toCategoryBudget?.assignedAmount ?? 0n;
    const toNewAssigned = toCurrentAssigned + assignAmountBigInt;
    updates.push({
      categoryId,
      assignedAmount: toNewAssigned,
    });

    if (updates.length === 0) {
      return;
    }

    this.saving.set(true);

    const savePromise = this.convexService.mutation(api.categoryBudgets.batchUpdateCategoryBudgets, {
      workspaceId: workspaceId as Id<'workspace'>,
      yearMonth: Math.trunc(yearMonth),
      updates,
    });

    toast.promise(savePromise, {
      loading: 'Assigning money...',
      success: 'Money assigned successfully',
      error: (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Failed to assign money';
        console.error('Failed to assign money:', errorMessage);
        return errorMessage;
      },
    });

    try {
      await savePromise;

      // Push undo action
      const previousUpdates = [{ categoryId, assignedAmount: toCurrentAssigned }];
      const capturedYearMonth = Math.trunc(yearMonth);

      this.undoRedoService.pushAction({
        description: 'Money assigned',
        type: 'budget-rta-assign',
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
      console.error('Failed to assign money:', error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.popoverState.set('closed');
  }
}
