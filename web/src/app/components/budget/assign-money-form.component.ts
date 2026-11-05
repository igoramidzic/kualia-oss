import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { Id } from 'convex/_generated/dataModel';
import { CurrencyService } from '../../services/currency.service';
import { CurrencyInputComponent } from '../../shared/components/currency-input/currency-input.component';
import { MoveMoneyCategoryPickerComponent } from './available-amount-button/move-money-category-picker.component';

@Component({
  selector: 'app-assign-money-form',
  imports: [CurrencyInputComponent, FormsModule, HlmButton, MoveMoneyCategoryPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div>
        <h3 class="mb-1 text-sm font-semibold">Assign Money</h3>
        <div class="text-muted-foreground text-sm">
          You have {{ formattedAmount() }} ready to assign. Choose a category.
        </div>
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Amount</div>
        <app-currency-input
          [ngModel]="assignAmountValue()"
          (ngModelChange)="onAmountChange($event)"
          (enterEvent)="onEnterKey()"
          [disabled]="saving()"
          inputClass="w-full"
          [autoFocus]="true"
        />
      </div>
      <div>
        <div class="text-muted-foreground mb-2 block text-sm font-medium">Assign to category</div>
        <app-move-money-category-picker
          [selectedCategoryId]="selectedCategoryId()"
          [yearMonth]="yearMonth()"
          [disabled]="saving()"
          [hideReadyToAssign]="true"
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
          [disabled]="saving() || !canAssignMoney()"
          (click)="onAssignMoney()"
        >
          @if (saving()) {
            Assigning...
          } @else {
            Assign Money
          }
        </button>
      </div>
    </div>
  `,
})
export class AssignMoneyFormComponent {
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly readyToAssignAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();
  readonly saving = input.required<boolean>();

  // Outputs
  readonly assignMoney = output<{ amount: number; categoryId: Id<'category'> }>();
  readonly canceled = output<void>();

  // Internal state
  readonly selectedCategoryId = signal<Id<'category'> | null>(null);
  readonly assignAmountValue = signal<number | null>(null);

  constructor() {
    // Initialize assign amount when component is created
    effect(() => {
      const available = this.readyToAssignAmount();
      if (available > 0n) {
        // Default to the available amount
        this.assignAmountValue.set(Number(available));
      } else {
        this.assignAmountValue.set(null);
      }
      // Reset selected category
      this.selectedCategoryId.set(null);
    });
  }

  readonly canAssignMoney = computed(() => {
    const amount = this.assignAmountValue();
    const selectedCategory = this.selectedCategoryId();
    return amount !== null && amount > 0 && selectedCategory !== null;
  });

  readonly formattedAmount = computed(() => {
    return this.currencyService.format(this.readyToAssignAmount());
  });

  onAmountChange(value: number | null): void {
    this.assignAmountValue.set(value);
  }

  onCategorySelected(categoryId: Id<'category'> | 'ready-to-assign'): void {
    // Since hideReadyToAssign is true, this should only be a category ID
    if (categoryId !== 'ready-to-assign') {
      this.selectedCategoryId.set(categoryId);
    }
  }

  onAssignMoney(): void {
    const assignAmount = this.assignAmountValue();
    const selectedCategoryId = this.selectedCategoryId();

    if (assignAmount === null || assignAmount <= 0 || selectedCategoryId === null) {
      return;
    }

    this.assignMoney.emit({
      amount: assignAmount,
      categoryId: selectedCategoryId,
    });
  }

  onEnterKey(): void {
    if (this.canAssignMoney()) {
      this.onAssignMoney();
    }
  }
}
