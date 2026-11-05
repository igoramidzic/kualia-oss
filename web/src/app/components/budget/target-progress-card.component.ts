import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NucleoIcon, nucleoTarget as Target } from '@kualia/icons';
import { BudgetCategorySelectionService } from '../../services/budget-category-selection.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';

@Component({
  selector: 'app-target-progress-card',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isVisible()) {
      <div class="border-border bg-card overflow-hidden rounded-lg border p-3">
        <!-- Header row -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <nucleo-icon [icon]="targetIcon" class="text-muted-foreground h-3.5 w-3.5" />
            <span class="text-muted-foreground text-xs">Target Progress</span>
          </div>
          <span class="text-xs font-medium">{{ percentageFunded() }}%</span>
        </div>

        <!-- Progress bar -->
        <div class="bg-accent mt-2 h-1.5 w-full overflow-hidden rounded-full">
          @if (hasTargets()) {
            <div
              class="bg-primary h-full rounded-full transition-all duration-300 ease-in-out"
              [style.width.%]="progressPercent()"
            ></div>
          }
        </div>

        <!-- Funded of Target -->
        <div class="text-muted-foreground mt-1.5 text-xs">
          @if (hasTargets()) {
            <span class="text-primary font-medium">{{ formatCurrency(totalFunded()) }}</span>
            <span> of </span>
            <span class="font-medium">{{ formatCurrency(totalTargetAmount()) }}</span>
            <span> funded</span>
          } @else {
            <span>No targets set</span>
          }
        </div>
      </div>
    }
  `,
})
export class TargetProgressCardComponent {
  protected readonly targetIcon = Target;

  private readonly budgetService = inject(BudgetService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly selectionService = inject(BudgetCategorySelectionService);
  private readonly currencyService = inject(CurrencyService);
  private readonly categoryService = inject(CategoryService);

  private readonly currentMonthData = computed(() => {
    const yearMonth = this.budgetMonthService.getLastViewedMonth();
    const months = this.budgetService.months();
    return months.find((m) => m.yearMonth === yearMonth);
  });

  /** Set of archived category IDs for quick lookup */
  private readonly archivedCategoryIds = computed(() => {
    const hierarchy = this.categoryService.categoryHierarchy();
    const archived = new Set<string>();
    for (const group of hierarchy) {
      for (const cat of group.categories) {
        if (cat.isArchived) archived.add(cat._id);
      }
    }
    return archived;
  });

  /** Set of category IDs that have enableTarget === true */
  private readonly targetEnabledCategoryIds = computed(() => {
    const hierarchy = this.categoryService.categoryHierarchy();
    const enabled = new Set<string>();
    for (const group of hierarchy) {
      for (const cat of group.categories) {
        if (cat.enableTarget) enabled.add(cat._id);
      }
    }
    return enabled;
  });

  private readonly targetSummary = computed(() => {
    const monthData = this.currentMonthData();
    if (!monthData) return { totalTargetAmount: 0n, totalFunded: 0n, totalRemainingToFund: 0n, percentageFunded: 0 };

    const selectedCategories = this.selectionService.selectedCategories();
    const hasSelection = selectedCategories.length > 0;

    // When no selection, use the pre-computed summary from the backend (matches iOS exactly)
    if (!hasSelection) {
      const s = monthData.summary;
      return {
        totalTargetAmount: s.totalTargetAmount,
        totalFunded: s.totalFunded,
        totalRemainingToFund: s.totalRemainingToFund,
        percentageFunded: s.percentageFunded,
      };
    }

    // When categories are selected, compute from per-category data
    // Mirrors the backend logic in queries.ts
    const budgetData = monthData.budgetData;
    const archived = this.archivedCategoryIds();
    const targetEnabled = this.targetEnabledCategoryIds();

    let totalTargetAmount = 0n;
    let totalFunded = 0n;
    let totalRemainingToFund = 0n;

    for (const categoryId of selectedCategories) {
      const data = budgetData[categoryId];
      if (!data) continue;

      // Skip archived categories (matches backend)
      if (archived.has(categoryId)) continue;

      // Skip snoozed categories (matches backend)
      if (data.target.isSnoozed) continue;

      const hasActiveTarget = data.target.targetAmount !== undefined;
      const hasMonthlyNeed = data.target.assignmentNeeded > 0n;
      const categoryHasTargetDefined = targetEnabled.has(categoryId);

      if (hasMonthlyNeed && (hasActiveTarget || categoryHasTargetDefined)) {
        const monthlyNeed = data.target.assignmentNeeded;
        totalTargetAmount += monthlyNeed;
        totalFunded += monthlyNeed - data.target.remainingToAssign;
        totalRemainingToFund += data.target.remainingToAssign;
      }
    }

    const percentageFunded =
      totalTargetAmount > 0n ? Math.floor(Number((totalFunded * 100n) / totalTargetAmount)) : 100;

    return { totalTargetAmount, totalFunded, totalRemainingToFund, percentageFunded };
  });

  readonly isVisible = computed(() => {
    // Show when there are targets, or when there's a selection (even with no targets)
    return this.targetSummary().totalTargetAmount > 0n || this.selectionService.hasSelections();
  });
  readonly hasTargets = computed(() => this.targetSummary().totalTargetAmount > 0n);
  readonly totalTargetAmount = computed(() => this.targetSummary().totalTargetAmount);
  readonly totalFunded = computed(() => this.targetSummary().totalFunded);
  readonly percentageFunded = computed(() => Math.min(this.targetSummary().percentageFunded, 999));

  readonly progressPercent = computed(() => {
    const pct = this.targetSummary().percentageFunded;
    return Math.min(pct, 100);
  });

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }
}
