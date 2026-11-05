import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CategoryBudgetData } from 'convex/categoryBudgets/types';

type ProgressState = 'noTarget' | 'underfunded' | 'fullyFunded' | 'overspent';

@Component({
  selector: 'app-category-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .stripe-pattern {
        background-image: repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 2px,
          rgba(0, 0, 0, 0.15) 2px,
          rgba(0, 0, 0, 0.15) 3px
        );
      }

      .stripe-pattern-dark {
        background-image: repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, 0.2) 2px,
          rgba(255, 255, 255, 0.2) 3px
        );
      }
    `,
  ],
  template: `
    <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      @if (fundedWidthPercent() > 0) {
        <!-- Funded bar container - clips both spent and available portions -->
        <div
          class="absolute inset-y-0 left-0 flex overflow-hidden rounded-full transition-all duration-300 ease-in-out"
          [style.width.%]="fundedWidthPercent()"
          [style.min-width.px]="4"
        >
          <!-- Spent portion (left side) - muted color with stripes -->
          @if (spentWidthPercent() > 0) {
            <div
              class="stripe-pattern dark:stripe-pattern-dark h-full flex-shrink-0 transition-all duration-300 ease-in-out"
              [class]="spentBarClasses()"
              [style.width.%]="spentOfFundedPercent()"
            ></div>
          }

          <!-- Available portion (right side) - solid bright color -->
          @if (spentOfFundedPercent() < 100) {
            <div class="h-full flex-1 transition-all duration-300 ease-in-out" [class]="availableBarClasses()"></div>
          }
        </div>
      }
    </div>
  `,
})
export class CategoryProgressBarComponent {
  readonly budgetData = input.required<CategoryBudgetData>();

  protected readonly progressState = computed<ProgressState>(() => {
    const data = this.budgetData();
    const available = data.available;
    const target = data.target;

    // Check overspent first (negative available)
    if (available < 0n) {
      return 'overspent';
    }

    // Check if has explicit target
    const hasTarget = target.targetAmount !== undefined && target.targetAmount > 0n;

    if (hasTarget) {
      // Has target - check if underfunded
      if (target.remainingToAssign > 0n) {
        return 'underfunded';
      }
      return 'fullyFunded';
    }

    // No target
    return 'noTarget';
  });

  // Use fundedRatio from backend for overall progress bar width
  // This handles multi-month targets, maintain balance, etc.
  protected readonly fundedRatio = computed(() => {
    const data = this.budgetData();
    return data.target.fundedRatio;
  });

  // Spent portion of the funded bar (0.0 to 1.0), calculated by backend.
  // Backend handles negative-carryover adjustment so prior-month overspend doesn't leak through.
  protected readonly spentRatio = computed(() => {
    return this.budgetData().target.spentRatio;
  });

  protected readonly fundedWidthPercent = computed(() => {
    return this.fundedRatio() * 100;
  });

  protected readonly spentWidthPercent = computed(() => {
    return this.spentRatio() * 100;
  });

  // Spent as percentage of the funded portion (for flex layout within funded bar)
  protected readonly spentOfFundedPercent = computed(() => {
    const funded = this.fundedRatio();
    const spent = this.spentRatio();

    if (funded <= 0) {
      return 0;
    }

    // Spent ratio relative to funded width
    return Math.min((spent / funded) * 100, 100);
  });

  // Bright solid color for available (unspent) portion
  protected readonly availableBarClasses = computed(() => {
    const state = this.progressState();

    switch (state) {
      case 'overspent':
        return 'bg-red-500 dark:bg-red-500';
      case 'underfunded':
        return 'bg-amber-500 dark:bg-amber-500';
      case 'fullyFunded':
      case 'noTarget':
      default:
        return 'bg-emerald-500 dark:bg-emerald-500';
    }
  });

  // Muted color for spent portion (distinctly lighter/more muted)
  protected readonly spentBarClasses = computed(() => {
    const state = this.progressState();

    switch (state) {
      case 'overspent':
        return 'bg-red-200 dark:bg-red-900';
      case 'underfunded':
        return 'bg-amber-200 dark:bg-amber-900';
      case 'fullyFunded':
      case 'noTarget':
      default:
        return 'bg-emerald-200 dark:bg-emerald-900';
    }
  });
}
