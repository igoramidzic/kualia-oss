import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { Id } from 'convex/_generated/dataModel';
import { CategoryService } from '../../../services/category.service';
import { CurrencyInputComponent } from '../../../shared/components/currency-input/currency-input.component';
import { MoveMoneyCategoryPickerComponent } from './move-money-category-picker.component';

@Component({
  selector: 'app-move-money-form',
  imports: [CurrencyInputComponent, FormsModule, HlmButton, MoveMoneyCategoryPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div>
        <h3 class="mb-1 text-sm font-semibold">Move Money From</h3>
        <div class="text-muted-foreground text-sm">{{ getCurrentCategoryName() }}</div>
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Amount</div>
        <app-currency-input
          [ngModel]="moveAmountValue()"
          (ngModelChange)="onAmountChange($event)"
          (enterEvent)="onEnterKey()"
          [disabled]="saving()"
          inputClass="w-full"
          [autoFocus]="true"
        />
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Move money to</div>
        <app-move-money-category-picker
          [excludeCategoryId]="categoryId()"
          [selectedCategoryId]="selectedCategoryId()"
          [yearMonth]="yearMonth()"
          [disabled]="saving()"
          (categorySelected)="onCategorySelected($event)"
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
export class MoveMoneyFormComponent {
  private readonly categoryService = inject(CategoryService);

  // Inputs
  readonly categoryId = input.required<Id<'category'>>();
  readonly availableAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();
  readonly saving = input.required<boolean>();

  // Outputs
  readonly moveMoney = output<{ amount: number; targetCategoryId: Id<'category'> | 'ready-to-assign' }>();
  readonly canceled = output<void>();

  // Internal state
  readonly selectedCategoryId = signal<Id<'category'> | 'ready-to-assign' | null>(null);
  readonly moveAmountValue = signal<number | null>(null);

  constructor() {
    // Initialize move amount when component is created
    effect(() => {
      const available = this.availableAmount();
      if (available > 0n) {
        // For positive amounts, default to the available amount
        this.moveAmountValue.set(Number(available));
      } else {
        this.moveAmountValue.set(null);
      }
      // Reset selected category
      this.selectedCategoryId.set(null);
    });
  }

  readonly canMoveMoney = computed(() => {
    const amount = this.moveAmountValue();
    const selectedCategory = this.selectedCategoryId();
    return amount !== null && amount > 0 && selectedCategory !== null;
  });

  getCurrentCategoryName(): string {
    const category = this.categoryService.categories().find((c) => c._id === this.categoryId());
    return category?.name ?? 'Unknown';
  }

  onAmountChange(value: number | null): void {
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

    this.moveMoney.emit({
      amount: moveAmount,
      targetCategoryId: selectedCategoryId,
    });
  }

  onEnterKey(): void {
    if (this.canMoveMoney()) {
      this.onMoveMoney();
    }
  }
}
