import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoChevronDown as ChevronDown,
  NucleoIcon,
  nucleoPreferences as Settings,
  nucleoBolt as Zap,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import {
  QuickAssignPreferences,
  UserPreferencesService,
} from '../../core/services/preferences/user-preferences.service';
import { BudgetCategorySelectionService } from '../../services/budget-category-selection.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetService } from '../../services/budget.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { QuickAssignData, QuickAssignService } from '../../services/quick-assign.service';
import { ReportingService, TrackingEvent } from '../../services/reporting.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { QuickAssignButtonComponent } from './quick-assign-button.component';

@Component({
  selector: 'app-quick-assign-card',
  imports: [NucleoIcon, HlmButton, QuickAssignButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border-border bg-card overflow-hidden rounded-lg border">
      <!-- Header -->
      <button
        type="button"
        class="group flex w-full items-center justify-between px-3 py-2 transition-colors"
        (click)="toggleCollapsed()"
      >
        <div class="flex items-center gap-2">
          <nucleo-icon [icon]="zapIcon" class="text-muted-foreground h-4 w-4" />
          <span class="text-sm font-medium">Quick Assign</span>
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            class="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
            (click)="toggleEditMode($event)"
          >
            <nucleo-icon [icon]="settingsIcon" class="h-3 w-3" />
          </button>
        </div>
        @if (!isEditMode()) {
          <nucleo-icon
            [icon]="chevronIcon"
            class="text-muted-foreground h-4 w-4 transition-transform"
            [class.rotate-180]="!isCollapsed()"
          />
        }
      </button>

      <!-- Content -->
      @if (!isCollapsed() || isEditMode()) {
        <div class="space-y-1 px-3 pb-3">
          <!-- Top group: Underfunded/Overfunded (always visible) -->
          <div class="space-y-1 pb-2">
            <!-- Underfunded -->
            <app-quick-assign-button
              label="Underfunded"
              [amount]="quickAssignData().underfunded.totalAmount"
              [disabled]="
                isEditMode() ||
                saving() ||
                !hasSelectedCategories() ||
                !hasUnderfundedAmount() ||
                !hasUnderfundedChanges()
              "
              [isEditMode]="isEditMode()"
              [switchChecked]="true"
              [switchDisabled]="true"
              (clicked)="applyQuickAssign(quickAssignData().underfunded)"
            />

            <!-- Reduce Overfunding -->
            <app-quick-assign-button
              label="Reduce Overfunding"
              [amount]="quickAssignData().overfunded.totalAmount"
              [disabled]="
                isEditMode() ||
                saving() ||
                !hasSelectedCategories() ||
                quickAssignData().overfunded.updates.length === 0 ||
                !hasOverfundedChanges()
              "
              [isEditMode]="isEditMode()"
              [switchChecked]="true"
              [switchDisabled]="true"
              (clicked)="applyQuickAssign(quickAssignData().overfunded)"
            />
          </div>

          <!-- Middle group: Historical options (toggleable visibility) -->
          @if (isEditMode() || hasMiddleGroupVisible()) {
            <div class="space-y-1">
              <!-- Assigned Last Month -->
              @if (isEditMode() || preferences().assignedLastMonth) {
                <app-quick-assign-button
                  label="Assigned Last Month"
                  [amount]="quickAssignData().assignedLastMonth.totalAmount"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().assignedLastMonth.updates.length === 0 ||
                      !hasAssignedLastMonthChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().assignedLastMonth"
                  [switchDisabled]="false"
                  (clicked)="onOptionClick('assignedLastMonth', quickAssignData().assignedLastMonth)"
                  (switchChanged)="onToggleChange('assignedLastMonth', $event)"
                />
              }

              <!-- Spent Last Month -->
              @if (isEditMode() || preferences().spentLastMonth) {
                <app-quick-assign-button
                  label="Spent Last Month"
                  [amount]="quickAssignData().spentLastMonth.totalAmount"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().spentLastMonth.updates.length === 0 ||
                      !hasSpentLastMonthChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().spentLastMonth"
                  [switchDisabled]="false"
                  (clicked)="onOptionClick('spentLastMonth', quickAssignData().spentLastMonth)"
                  (switchChanged)="onToggleChange('spentLastMonth', $event)"
                />
              }

              <!-- Average Assigned -->
              @if (isEditMode() || preferences().averageAssigned) {
                <app-quick-assign-button
                  label="Average Assigned"
                  [amount]="quickAssignData().averageAssigned.totalAmount"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().averageAssigned.updates.length === 0 ||
                      !hasAverageAssignedChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().averageAssigned"
                  [switchDisabled]="false"
                  (clicked)="onOptionClick('averageAssigned', quickAssignData().averageAssigned)"
                  (switchChanged)="onToggleChange('averageAssigned', $event)"
                />
              }

              <!-- Average Spent -->
              @if (isEditMode() || preferences().averageSpent) {
                <app-quick-assign-button
                  label="Average Spent"
                  [amount]="quickAssignData().averageSpent.totalAmount"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().averageSpent.updates.length === 0 ||
                      !hasAverageSpentChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().averageSpent"
                  [switchDisabled]="false"
                  (clicked)="onOptionClick('averageSpent', quickAssignData().averageSpent)"
                  (switchChanged)="onToggleChange('averageSpent', $event)"
                />
              }
            </div>
          }

          <!-- Bottom group: Reset options (toggleable visibility) -->
          @if (isEditMode() || hasBottomGroupVisible()) {
            <div class="space-y-1 pt-2">
              <!-- Set Assignments to Zero -->
              @if (isEditMode() || preferences().resetAssignedAmounts) {
                <app-quick-assign-button
                  label="Set Assignments to Zero"
                  [amount]="null"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().resetAssignedAmounts.updates.length === 0 ||
                      !hasResetAssignedChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().resetAssignedAmounts"
                  [switchDisabled]="false"
                  labelClass="font-medium"
                  (clicked)="onOptionClick('resetAssignedAmounts', quickAssignData().resetAssignedAmounts)"
                  (switchChanged)="onToggleChange('resetAssignedAmounts', $event)"
                />
              }

              <!-- Set Available Amounts to Zero -->
              @if (isEditMode() || preferences().resetAvailableAmounts) {
                <app-quick-assign-button
                  label="Set Available to Zero"
                  [amount]="null"
                  [disabled]="
                    !isEditMode() &&
                    (saving() ||
                      !hasSelectedCategories() ||
                      quickAssignData().resetAvailableAmounts.updates.length === 0 ||
                      !hasResetAvailableChanges())
                  "
                  [isEditMode]="isEditMode()"
                  [switchChecked]="preferences().resetAvailableAmounts"
                  [switchDisabled]="false"
                  labelClass="font-medium"
                  (clicked)="onOptionClick('resetAvailableAmounts', quickAssignData().resetAvailableAmounts)"
                  (switchChanged)="onToggleChange('resetAvailableAmounts', $event)"
                />
              }
            </div>
          }

          <!-- Done button in edit mode -->
          @if (isEditMode()) {
            <button hlmBtn variant="default" size="sm" class="mt-3 h-8 w-full" (click)="exitEditMode()">Done</button>
          }

          <!-- Allow overspending toggle (hidden in edit mode) -->
          @if (!isEditMode()) {
            <div class="pt-2">
              <app-quick-assign-button
                label="Allow overspending"
                [amount]="null"
                [disabled]="false"
                [isEditMode]="true"
                [switchChecked]="allowNegativeRta()"
                [switchDisabled]="false"
                switchClass="data-[state=checked]:bg-muted-foreground"
                (clicked)="onAllowNegativeRtaChange(!allowNegativeRta())"
                (switchChanged)="onAllowNegativeRtaChange($event)"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class QuickAssignCardComponent {
  protected readonly zapIcon = Zap;
  protected readonly settingsIcon = Settings;
  protected readonly chevronIcon = ChevronDown;

  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly quickAssignService = inject(QuickAssignService);
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly budgetService = inject(BudgetService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly selectionService = inject(BudgetCategorySelectionService);
  private readonly undoRedoService = inject(UndoRedoService);

  // State
  protected readonly isEditMode = signal(false);
  protected readonly saving = signal(false);

  // Preferences
  protected readonly isCollapsed = this.userPreferencesService.quickAssignCollapsed;
  protected readonly preferences = this.userPreferencesService.quickAssignPreferences;
  protected readonly allowNegativeRta = this.userPreferencesService.quickAssignAllowNegativeRta;

  // Budget data
  protected readonly readyToAssign = this.budgetService.readyToAssign;
  protected readonly quickAssignData = this.quickAssignService.quickAssignData;

  // Computed: check if ready to assign is positive (can't use 0n in templates)
  protected readonly hasPositiveReadyToAssign = computed(() => this.readyToAssign() > 0n);

  // Computed: check if there's any underfunded amount (can't use 0n in templates)
  protected readonly hasUnderfundedAmount = computed(() => this.quickAssignData().underfunded.totalAmount > 0n);

  // Computed: check if any categories are selected
  protected readonly hasSelectedCategories = computed(() => this.selectionService.hasSelections());

  // Computed: check if any middle group option is visible
  protected readonly hasMiddleGroupVisible = computed(() => {
    const prefs = this.preferences();
    return prefs.assignedLastMonth || prefs.spentLastMonth || prefs.averageAssigned || prefs.averageSpent;
  });

  // Computed: check if any bottom group option is visible
  protected readonly hasBottomGroupVisible = computed(() => {
    const prefs = this.preferences();
    return prefs.resetAssignedAmounts || prefs.resetAvailableAmounts;
  });

  // Helper: check if quick assign data has actual changes
  private hasActualChanges(data: QuickAssignData): boolean {
    if (data.updates.length === 0) return false;

    const yearMonth = this.budgetMonthService.getLastViewedMonth();
    const months = this.budgetService.months();
    const currentMonthData = months.find((m) => m.yearMonth === yearMonth);

    return data.updates.some((update) => {
      const budgetData = currentMonthData?.budgetData[update.categoryId];
      const currentAssignedAmount = budgetData?.assignedAmount ?? 0n;
      return update.newAssignedAmount !== currentAssignedAmount;
    });
  }

  // Computed: check if each quick assign option has actual changes
  // These computed signals will re-evaluate when quickAssignData or months change
  // (hasActualChanges accesses months() and getLastViewedMonth() which makes these reactive)
  protected readonly hasUnderfundedChanges = computed(() => this.hasActualChanges(this.quickAssignData().underfunded));
  protected readonly hasOverfundedChanges = computed(() => this.hasActualChanges(this.quickAssignData().overfunded));
  protected readonly hasAssignedLastMonthChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().assignedLastMonth)
  );
  protected readonly hasSpentLastMonthChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().spentLastMonth)
  );
  protected readonly hasAverageAssignedChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().averageAssigned)
  );
  protected readonly hasAverageSpentChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().averageSpent)
  );
  protected readonly hasResetAssignedChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().resetAssignedAmounts)
  );
  protected readonly hasResetAvailableChanges = computed(() =>
    this.hasActualChanges(this.quickAssignData().resetAvailableAmounts)
  );

  toggleCollapsed(): void {
    if (!this.isEditMode()) {
      this.userPreferencesService.toggleQuickAssignCollapsed();
    }
  }

  toggleEditMode(event: Event): void {
    event.stopPropagation();
    const wasInEditMode = this.isEditMode();
    this.isEditMode.update((v) => !v);

    if (wasInEditMode) {
      // Exiting edit mode - preferences are already saved by the service when toggled
      // No additional save needed as preferences are saved on each toggle
    } else {
      // Entering edit mode - ensure card is expanded
      if (this.isCollapsed()) {
        this.userPreferencesService.setQuickAssignCollapsed(false);
      }
    }
  }

  exitEditMode(): void {
    this.isEditMode.set(false);
    // Preferences are already saved by the service when toggled
  }

  onOptionClick(key: keyof QuickAssignPreferences, data: QuickAssignData): void {
    if (this.isEditMode()) {
      this.userPreferencesService.toggleQuickAssignPreference(key);
    } else {
      void this.applyQuickAssign(data);
    }
  }

  onToggleChange(key: keyof QuickAssignPreferences, checked: boolean): void {
    const currentValue = this.preferences()[key];
    if (currentValue !== checked) {
      this.userPreferencesService.toggleQuickAssignPreference(key);
    }
  }

  onAllowNegativeRtaChange(checked: boolean): void {
    this.userPreferencesService.setQuickAssignAllowNegativeRta(checked);
  }

  async applyQuickAssign(data: QuickAssignData): Promise<void> {
    if (data.updates.length === 0 || this.saving()) return;

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('Workspace ID not available');
      return;
    }

    const yearMonth = this.budgetMonthService.getLastViewedMonth();

    // Get current month's budget data to compare with new values
    const months = this.budgetService.months();
    const currentMonthData = months.find((m) => m.yearMonth === yearMonth);

    // Filter out updates where newAssignedAmount equals current assignedAmount
    // and calculate the change for each update
    const updatesWithChanges = data.updates
      .map((update) => {
        const budgetData = currentMonthData?.budgetData[update.categoryId];
        const currentAssignedAmount = budgetData?.assignedAmount ?? 0n;
        const change = update.newAssignedAmount - currentAssignedAmount;
        return { ...update, currentAssignedAmount, change };
      })
      .filter((update) => update.change !== 0n);

    // Early return if no updates after filtering
    if (updatesWithChanges.length === 0) {
      return;
    }

    // Calculate total net change (positive = increasing assignments, negative = decreasing)
    const totalNetChange = updatesWithChanges.reduce((sum, u) => sum + u.change, 0n);

    // Apply RTA capping if the preference is OFF and we're increasing assignments
    const currentRta = this.readyToAssign();
    const allowNegativeRta = this.allowNegativeRta();

    console.log('Quick Assign Debug:', {
      totalNetChange: totalNetChange.toString(),
      currentRta: currentRta.toString(),
      allowNegativeRta,
      wouldEnterCapping: !allowNegativeRta && totalNetChange > 0n,
    });

    let finalUpdates = updatesWithChanges;

    // Only apply capping when:
    // 1. allowNegativeRta is OFF
    // 2. We're increasing assignments (totalNetChange > 0)
    // 3. This would make RTA negative or more negative
    if (!allowNegativeRta && totalNetChange > 0n) {
      const newRta = currentRta - totalNetChange;

      // Check if action would make RTA worse (more negative)
      // Exception: if RTA is already negative and this makes it better, always allow
      const wouldMakeRtaWorse = newRta < currentRta && newRta < 0n;
      const rtaAlreadyNegativeAndImproving = currentRta < 0n && newRta > currentRta;

      console.log('Inside capping block:', {
        newRta: newRta.toString(),
        wouldMakeRtaWorse,
        rtaAlreadyNegativeAndImproving,
        shouldCap: wouldMakeRtaWorse && !rtaAlreadyNegativeAndImproving,
      });

      if (wouldMakeRtaWorse && !rtaAlreadyNegativeAndImproving) {
        // Calculate how much we can actually assign
        // If RTA is positive, we can assign up to RTA
        // If RTA is already negative, we can't assign any more (maxAssignable = 0)
        const maxAssignable = currentRta > 0n ? currentRta : 0n;

        if (maxAssignable === 0n) {
          // Can't assign anything - show toast explaining why
          toast.info('No funds available to assign. Enable "Allow overspending" to assign anyway.');
          return;
        }

        // Scale down updates proportionally
        // Only apply to positive changes (increases in assignment)
        const totalPositiveChange = updatesWithChanges
          .filter((u) => u.change > 0n)
          .reduce((sum, u) => sum + u.change, 0n);

        console.log('Capping details:', {
          maxAssignable: maxAssignable.toString(),
          totalPositiveChange: totalPositiveChange.toString(),
          needsScaling: totalPositiveChange > maxAssignable,
        });

        if (totalPositiveChange > maxAssignable) {
          const scaleFactor = Number(maxAssignable) / Number(totalPositiveChange);
          console.log('Scaling with factor:', scaleFactor);

          finalUpdates = updatesWithChanges.map((update) => {
            if (update.change > 0n) {
              // Scale down positive changes
              const scaledChange = BigInt(Math.floor(Number(update.change) * scaleFactor));
              return {
                ...update,
                newAssignedAmount: update.currentAssignedAmount + scaledChange,
              };
            }
            // Keep negative changes (reductions) as-is
            return update;
          });

          // Filter out updates that became zero changes after scaling
          finalUpdates = finalUpdates.filter((update) => update.newAssignedAmount !== update.currentAssignedAmount);

          if (finalUpdates.length === 0) {
            // All updates were too small after scaling - show toast
            toast.info('No funds available to assign. Enable "Allow overspending" to assign anyway.');
            return;
          }
        }
      }
    }

    this.saving.set(true);

    const savePromise = (async () => {
      const updates = finalUpdates.map((update) => ({
        categoryId: update.categoryId,
        assignedAmount: update.newAssignedAmount,
      }));

      await this.convexService.mutation(api.categoryBudgets.batchUpdateCategoryBudgets, {
        workspaceId: workspaceId as Id<'workspace'>,
        yearMonth: Math.trunc(yearMonth),
        updates,
      });
    })();

    const assignmentCount = finalUpdates.length;

    toast.promise(savePromise, {
      loading: 'Loading...',
      success: `Updated ${assignmentCount} assignment${assignmentCount === 1 ? '' : 's'}`,
      error: (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update assignments';
        console.error('Failed to apply quick assign:', errorMessage);
        return errorMessage;
      },
    });

    try {
      await savePromise;
      this.reportingService.capture(TrackingEvent.MONEY_ASSIGNED, { method: 'quick_assign' });

      // Push undo action with previous amounts
      const previousUpdates = finalUpdates.map((update) => ({
        categoryId: update.categoryId,
        assignedAmount: update.currentAssignedAmount,
      }));
      const newUpdates = finalUpdates.map((update) => ({
        categoryId: update.categoryId,
        assignedAmount: update.newAssignedAmount,
      }));
      const capturedYearMonth = Math.trunc(yearMonth);

      this.undoRedoService.pushAction({
        description: `${assignmentCount} assignment${assignmentCount === 1 ? '' : 's'} updated`,
        type: 'budget-quick-assign',
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
            updates: newUpdates,
          });
        },
      });
    } catch (error: unknown) {
      // Error is already handled by toast.promise, but we need to catch it
      // so the promise resolves instead of rejecting
      const errorMessage = error instanceof Error ? error.message : 'Failed to update assignments';
      console.error('Failed to apply quick assign:', errorMessage);
    } finally {
      this.saving.set(false);
    }
  }

  formatAmount(amount: bigint): string {
    return this.currencyService.format(amount);
  }
}
