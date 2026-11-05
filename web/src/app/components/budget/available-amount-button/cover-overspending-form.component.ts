import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { Id } from 'convex/_generated/dataModel';
import { BudgetService } from '../../../services/budget.service';
import { CategoryService } from '../../../services/category.service';
import { CurrencyService } from '../../../services/currency.service';
import { CurrencyInputComponent } from '../../../shared/components/currency-input/currency-input.component';
import { MoveMoneyCategoryPickerComponent } from './move-money-category-picker.component';

@Component({
  selector: 'app-cover-overspending-form',
  imports: [CurrencyInputComponent, FormsModule, HlmButton, MoveMoneyCategoryPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div>
        <h3 class="mb-2 text-sm font-semibold">Cover Overspending</h3>
        <p class="text-muted-foreground text-sm">
          You have overspent by
          <span class="text-destructive font-medium">{{ formatCurrency(-availableAmount()) }}</span>
          in
          <span class="font-medium">{{ getCurrentCategoryName() }}</span
          >. Pick a category to cover this amount.
        </p>
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Move money from</div>
        <app-move-money-category-picker
          [excludeCategoryId]="categoryId()"
          [selectedCategoryId]="selectedCategoryId()"
          [yearMonth]="yearMonth()"
          [disabled]="saving()"
          (categorySelected)="onCategorySelected($event)"
        />
        @if (selectedCategoryId() && sourceCategoryAvailable() !== null) {
          <p class="text-muted-foreground mt-1 text-xs">
            Available: {{ formatCurrency(sourceCategoryAvailable()!) }}
            @if (maxMoveAmount() !== null && maxMoveAmount()! < -availableAmount()) {
              <span class="text-destructive"> (limited to {{ formatCurrency(maxMoveAmount()!) }}) </span>
            }
          </p>
        }
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Amount</div>
        <app-currency-input
          [ngModel]="moveAmountValue()"
          (ngModelChange)="onAmountChange($event)"
          (enterEvent)="onEnterKey()"
          [disabled]="saving()"
          inputClass="w-full"
        />
      </div>
      <div class="flex justify-end gap-2">
        <button hlmBtn variant="outline" size="sm" type="button" [disabled]="saving()" (click)="canceled.emit()">
          Cancel
        </button>
        <button
          hlmBtn
          variant="default"
          size="sm"
          type="button"
          [disabled]="saving() || !canMoveMoney()"
          (click)="onMoveMoney()"
        >
          @if (saving()) {
            Moving...
          } @else {
            Move Money
          }
        </button>
      </div>
    </div>
  `,
})
export class CoverOverspendingFormComponent {
  private readonly categoryService = inject(CategoryService);
  private readonly budgetService = inject(BudgetService);
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly categoryId = input.required<Id<'category'>>();
  readonly availableAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();
  readonly saving = input.required<boolean>();

  // Outputs
  readonly moveMoney = output<{ amount: number; sourceCategoryId: Id<'category'> | 'ready-to-assign' }>();
  readonly canceled = output<void>();

  // Internal state
  readonly selectedCategoryId = signal<Id<'category'> | 'ready-to-assign' | null>(null);
  readonly moveAmountValue = signal<number | null>(null);

  constructor() {
    // Preselect RTA if it's positive
    effect(() => {
      const readyToAssign = this.budgetService.readyToAssign();
      const currentSelection = this.selectedCategoryId();

      // Only preselect if nothing is selected yet and RTA is positive
      if (currentSelection === null && readyToAssign > 0n) {
        this.selectedCategoryId.set('ready-to-assign');
      }
    });

    // Update move amount when category is selected for covering overspending
    effect(() => {
      const selectedId = this.selectedCategoryId();
      const maxAmount = this.maxMoveAmount();

      if (selectedId && maxAmount !== null) {
        // Set the move amount to the maximum available (min of overspending and source available)
        this.moveAmountValue.set(Number(maxAmount));
      }
    });
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  readonly canMoveMoney = computed(() => {
    const amount = this.moveAmountValue();
    const selectedCategory = this.selectedCategoryId();
    return amount !== null && amount > 0 && selectedCategory !== null;
  });

  // Get available amount for selected source category (when covering overspending)
  readonly sourceCategoryAvailable = computed(() => {
    const selectedId = this.selectedCategoryId();
    if (!selectedId) {
      return null;
    }

    if (selectedId === 'ready-to-assign') {
      // For ready-to-assign, return the workspace readyToAssign value
      return this.budgetService.readyToAssign();
    }

    const yearMonth = this.yearMonth();
    const months = this.budgetService.months();
    const currentMonthData = months.find((m) => m.yearMonth === yearMonth);
    const sourceBudget = currentMonthData?.budgetData[selectedId];
    return sourceBudget?.available ?? null;
  });

  // Calculate maximum amount that can be moved (for covering overspending)
  readonly maxMoveAmount = computed(() => {
    const overspendingAmount = -this.availableAmount(); // Convert negative to positive
    const sourceAvailable = this.sourceCategoryAvailable();

    if (sourceAvailable === null) {
      return null;
    }

    // Take the minimum of overspending amount and source available
    return sourceAvailable < overspendingAmount ? sourceAvailable : overspendingAmount;
  });

  getCurrentCategoryName(): string {
    const category = this.categoryService.categories().find((c) => c._id === this.categoryId());
    return category?.name ?? 'Unknown';
  }

  onAmountChange(value: number | null): void {
    // When covering overspending, limit the amount to what's available from source category
    if (value !== null && value > 0) {
      const maxAmount = this.maxMoveAmount();
      if (maxAmount !== null && value > Number(maxAmount)) {
        // Cap the value to the maximum available
        this.moveAmountValue.set(Number(maxAmount));
        return;
      }
    }
    this.moveAmountValue.set(value);
  }

  onCategorySelected(categoryId: Id<'category'> | 'ready-to-assign'): void {
    this.selectedCategoryId.set(categoryId);
  }

  onMoveMoney(): void {
    const moveAmount = this.moveAmountValue();
    const selectedCategoryId = this.selectedCategoryId();

    if (moveAmount === null || moveAmount <= 0 || selectedCategoryId === null) {
      return;
    }

    // Ensure we don't exceed what's available from source
    let finalMoveAmount = moveAmount;
    const maxAmount = this.maxMoveAmount();
    if (maxAmount !== null && moveAmount > Number(maxAmount)) {
      finalMoveAmount = Number(maxAmount);
    }

    this.moveMoney.emit({
      amount: finalMoveAmount,
      sourceCategoryId: selectedCategoryId,
    });
  }

  onEnterKey(): void {
    if (this.canMoveMoney()) {
      this.onMoveMoney();
    }
  }
}
