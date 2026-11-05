import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { Id } from 'convex/_generated/dataModel';
import type { CategoryTargetInfo } from 'convex/categoryBudgets/types';
import { CategoryTarget } from 'convex/categoryTargets/types';
import {
  nucleoCircleOutline as Circle,
  nucleoWarningCircle as CircleAlert,
  nucleoCheckCircle as CircleCheck,
  nucleoCircleDashed as CircleDotDashed,
  nucleoArrowUp as CircleFadingArrowUp,
  NucleoIcon,
  type NucleoIconData,
  nucleoMoon as Moon,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { CategoryTargetDialogComponent } from '../dialogs/category-target-dialog/category-target-dialog';

@Component({
  selector: 'app-category-target-indicator',
  imports: [NucleoIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button hlmBtn variant="ghost" size="sm" type="button" class="w-7 shrink-0" (click)="handleClick($event)">
      @if (isSnoozed()) {
        <nucleo-icon [icon]="Moon" [size]="16" class="text-muted-foreground" />
      } @else {
        <nucleo-icon [icon]="targetIcon()" [size]="16" [class]="progressColorClass()" />
      }
    </button>
  `,
})
export class CategoryTargetIndicatorComponent {
  private readonly currencyService = inject(CurrencyService);
  private readonly dialogService = inject(HlmDialogService);

  // Required inputs for dialog
  readonly categoryId = input.required<Id<'category'>>();
  readonly categoryName = input.required<string>();
  readonly existingTarget = input.required<CategoryTarget>();
  readonly enableTarget = input<boolean>(false);
  readonly isSnoozed = input<boolean>(false);

  // Existing inputs
  readonly target = input.required<CategoryTargetInfo | undefined>();
  readonly assignedAmount = input.required<bigint>();
  readonly available = input<bigint | undefined>();
  readonly yearMonth = input.required<number>();
  readonly currentYearMonth = input.required<number>();

  readonly Circle = Circle;
  readonly CircleAlert = CircleAlert;
  readonly CircleCheck = CircleCheck;
  readonly CircleDotDashed = CircleDotDashed;
  readonly CircleFadingArrowUp = CircleFadingArrowUp;
  readonly Moon = Moon;

  // Backend has calculated everything for us:
  // - assignmentNeeded: total amount needed for this month (includes target + covering overspending)
  // - remainingToAssign: how much more we need to assign (assignmentNeeded - assignedAmount)
  readonly needed = computed(() => {
    const targetInfo = this.target();
    return targetInfo?.assignmentNeeded ?? 0n;
  });

  readonly remaining = computed(() => {
    const targetInfo = this.target();
    return targetInfo?.remainingToAssign ?? 0n;
  });

  readonly isComplete = computed(() => this.remaining() === 0n);

  // Only show positive assignments in the display (negative assignments don't count towards target)
  readonly positiveAssigned = computed(() => {
    const assigned = this.assignedAmount();
    return assigned > 0n ? assigned : 0n;
  });

  // Calculate progress percentage for color coding
  readonly progress = computed(() => {
    const needed = this.needed();
    const remaining = this.remaining();
    return needed > 0n ? ((needed - remaining) * 100n) / needed : 100n;
  });

  // Determine color based on progress
  readonly progressColorClass = computed(() => {
    // Check if actually overspent (available < 0 means actually overspent)
    const isOverspent = this.available() !== undefined && this.available()! < 0n;

    // No target - use muted color if not overspent
    if (!this.hasTarget()) {
      if (isOverspent) {
        return 'text-destructive';
      }
      return 'text-muted-foreground/50';
    }

    // Check if actually overspent FIRST - this takes precedence
    if (isOverspent) {
      return 'text-destructive';
    }
    if (this.isComplete() || this.isFullyFunded()) return 'text-green-600 dark:text-green-400';
    // If we have a target and assigned $0 or negative, use yellow
    if (this.assignedAmount() <= 0n && this.remaining() > 0n) {
      return 'text-yellow-600 dark:text-yellow-400';
    }
    if (this.progress() >= 50n) return 'text-yellow-600 dark:text-yellow-400';
    // Behind on target but not overspent - use yellow
    return 'text-yellow-600 dark:text-yellow-400';
  });

  // Check if target is fully funded (no assignment needed)
  readonly isFullyFunded = computed(() => this.needed() === 0n);

  // Determine if this is a future month
  readonly isFutureMonth = computed(() => this.yearMonth() > this.currentYearMonth());

  // Check if we have a target
  readonly hasTarget = computed(() => {
    const targetInfo = this.target();
    return targetInfo?.targetAmount !== undefined;
  });

  // Determine which icon to show based on state
  readonly targetIcon = computed((): NucleoIconData => {
    const targetInfo = this.target();
    const hasTarget = targetInfo?.targetAmount !== undefined;

    // Check if actually overspent FIRST - this takes precedence (even if no target)
    const isOverspent = this.available() !== undefined && this.available()! < 0n;
    if (isOverspent) {
      return this.CircleAlert;
    }

    // No target
    if (!hasTarget) {
      return this.Circle;
    }

    // Fully funded or target hit (complete)
    if (this.isFullyFunded() || this.isComplete()) {
      return this.CircleCheck;
    }

    // Assigned $0 or negative but still need to hit target
    if (this.assignedAmount() <= 0n && this.remaining() > 0n) {
      return this.CircleDotDashed;
    }

    // Yellow scenario (progress >= 50% but not complete)
    if (this.progress() >= 50n && !this.isComplete()) {
      return this.CircleFadingArrowUp;
    }

    // Behind on target but not overspent (progress < 50% but available >= 0)
    // Use yellow arrow to indicate progress needed
    if (this.progress() < 50n) {
      return this.CircleFadingArrowUp;
    }

    // Default to circle if complete (shouldn't happen due to isFullyFunded check above)
    return this.Circle;
  });

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  handleClick(event: Event): void {
    event.stopPropagation();
    this.openTargetDialog();
  }

  private openTargetDialog(): void {
    const dialogRef = this.dialogService.open(CategoryTargetDialogComponent, {
      context: {
        categoryId: this.categoryId(),
        categoryName: this.categoryName(),
        existingTarget: this.existingTarget(),
        enableTarget: this.enableTarget(),
        onClose: () => {
          dialogRef.close();
        },
      },
    });
  }
}
