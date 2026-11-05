import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoSplit as SplitIcon,
  nucleoClose as X,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { CurrencyInputComponent } from '../../shared/components/currency-input/currency-input.component';
import { CategorySelectorComponent } from './category-selector.component';

export interface Split {
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  amount?: bigint;
}

export type SplitAmountSign = 'inflow' | 'outflow';

@Component({
  selector: 'app-transaction-splits',
  imports: [FormsModule, HlmButton, NucleoIcon, CurrencyInputComponent, CategorySelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-lg space-y-3">
      <div class="text-muted-foreground text-xs select-none">Splits</div>

      <div class="space-y-2">
        @for (split of splits(); track $index) {
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <app-category-selector
                [categoryId]="split.readyToAssign ? null : (split.categoryId ?? null)"
                [isReadyToAssign]="split.readyToAssign ?? false"
                [allowNone]="false"
                [yearMonth]="yearMonth()"
                [disabled]="saving()"
                variant="ghost"
                buttonClass="w-full justify-between px-2 text-sm"
                (categoryChange)="onCategoryChange($index, $event)"
              />
            </div>
            <div class="w-32">
              <app-currency-input
                [ngModel]="displaySplitAmount(split)"
                [disabled]="saving()"
                [allowNegative]="false"
                [inputClass]="'w-full rounded-md border bg-transparent px-2 py-1 text-left text-sm outline-none focus:outline-none focus:ring-1 focus:ring-ring'"
                (ngModelChange)="onAmountChange($index, $event)"
                (enterEvent)="onAmountEnter()"
              />
            </div>
            <button
              type="button"
              hlmBtn
              variant="ghost"
              size="sm"
              class="h-8 w-8 p-0"
              [disabled]="saving()"
              (click)="removeSplit.emit($index)"
            >
              <nucleo-icon [icon]="XIcon" [size]="16" />
            </button>
          </div>
        }
      </div>

      <div class="flex items-center justify-between gap-2 border-t pt-3">
        <div class="flex items-center gap-2">
          <app-category-selector
            [categoryId]="null"
            [isReadyToAssign]="false"
            [allowNone]="false"
            [disabled]="saving()"
            [customButtonLabel]="'Add split'"
            [customEmptyIcon]="PlusIcon"
            [highlightMissingCategory]="false"
            [yearMonth]="yearMonth()"
            variant="ghost"
            buttonClass="w-fit justify-between px-2 text-xs"
            (categoryChange)="onAddSplitWithCategory($event)"
          />
          <div
            class="text-sm"
            [class.text-destructive]="isOverAllocated() || isUnderAllocated()"
            [class.text-muted-foreground]="!isOverAllocated() && !isUnderAllocated()"
          >
            {{ remainingAmountText() }}
          </div>
        </div>
        @if (showActions()) {
          <div class="flex items-center gap-2">
            <button
              type="button"
              hlmBtn
              variant="ghost"
              size="sm"
              class="text-xs"
              [disabled]="!hasChanges()"
              (click)="cancelSplit.emit()"
            >
              Cancel
            </button>
            <button
              type="button"
              hlmBtn
              variant="default"
              size="sm"
              class="w-12 text-xs"
              [disabled]="!canSave() || saving()"
              (click)="save.emit()"
            >
              @if (saving()) {
                <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
              } @else {
                Save
              }
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class TransactionSplitsComponent {
  private readonly currencyService = inject(CurrencyService);

  // Icons
  readonly PlusIcon = Plus;
  readonly XIcon = X;
  readonly SplitIcon = SplitIcon;
  readonly LoaderCircle = LoaderCircle;
  readonly Number = Number;

  // Inputs
  readonly transactionAmount = input.required<bigint>();
  readonly amountSign = input<SplitAmountSign | null>(null);
  readonly yearMonth = input<number | null>(null);
  readonly splits = input.required<Split[]>();
  readonly initialSplits = input.required<Split[]>();
  readonly saving = input<boolean>(false);
  readonly showActions = input<boolean>(true);

  // Outputs
  readonly addSplit = output<{ categoryId: string | null; readyToAssign: boolean }>();
  readonly removeSplit = output<number>();
  readonly updateSplitCategory = output<{ index: number; categoryId: string | null; readyToAssign: boolean }>();
  readonly updateSplitAmount = output<{ index: number; amount: bigint | undefined }>();
  readonly save = output<void>();
  readonly cancelSplit = output<void>();

  // Computed values
  readonly splitsSum = computed(() => {
    return this.splits().reduce((sum, split) => sum + (split.amount ?? 0n), 0n);
  });

  readonly allocatedAmount = computed(() => {
    return this.splits().reduce((sum, split) => sum + this.absoluteBigInt(split.amount ?? 0n), 0n);
  });

  readonly remainingAmount = computed(() => {
    return this.absoluteBigInt(this.transactionAmount()) - this.allocatedAmount();
  });

  readonly hasChanges = computed(() => {
    const current = this.splits();
    const initial = this.initialSplits();

    // Compare arrays - check length first
    if (current.length !== initial.length) return true;

    // Deep compare each split
    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const init = initial[i];

      if (curr.categoryId !== init.categoryId) return true;
      if (curr.readyToAssign !== init.readyToAssign) return true;
      if (curr.amount !== init.amount) return true;
    }

    return false;
  });

  readonly isValid = computed(() => {
    if (this.splits().length === 0) return false;
    if (this.remainingAmount() !== 0n) return false;
    if (this.splits().some((split) => split.amount === undefined || split.amount === 0n)) return false;
    if (this.splits().some((split) => !this.splitAmountMatchesTransactionSign(split.amount))) return false;
    return true;
  });

  readonly canSave = computed(() => {
    return this.isValid() && this.hasChanges() && !this.saving();
  });

  readonly isOverAllocated = computed(() => this.remainingAmount() < 0n);
  readonly isUnderAllocated = computed(() => this.remainingAmount() > 0n);

  readonly remainingAmountText = computed(() => {
    const remaining = this.remainingAmount();
    if (this.isOverAllocated()) {
      return `Over by ${this.formatCurrency(-remaining)}`;
    } else if (this.isUnderAllocated()) {
      return `Remaining: ${this.formatCurrency(remaining)}`;
    } else {
      return 'Fully allocated';
    }
  });

  onCategoryChange(index: number, categoryId: string | null | 'ready-to-assign') {
    if (categoryId === 'ready-to-assign') {
      this.updateSplitCategory.emit({ index, categoryId: null, readyToAssign: true });
    } else {
      this.updateSplitCategory.emit({ index, categoryId, readyToAssign: false });
    }
  }

  onAmountChange(index: number, amount: number | null) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      this.updateSplitAmount.emit({ index, amount: undefined });
    } else {
      const absoluteAmount = BigInt(Math.round(Math.abs(amount)));
      this.updateSplitAmount.emit({ index, amount: absoluteAmount * this.splitAmountMultiplier() });
    }
  }

  onAddSplitWithCategory(categoryId: string | null | 'ready-to-assign') {
    // Only add split if a category was selected
    if (categoryId === 'ready-to-assign') {
      this.addSplit.emit({
        categoryId: null,
        readyToAssign: true,
      });
    } else if (categoryId !== null) {
      this.addSplit.emit({
        categoryId,
        readyToAssign: false,
      });
    }
  }

  onAmountEnter() {
    // Save if save is enabled
    if (this.canSave()) {
      this.save.emit();
    }
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  displaySplitAmount(split: Split): number | null {
    if (split.amount === undefined || split.amount === null) return null;
    return Number(this.absoluteBigInt(split.amount));
  }

  private splitAmountMultiplier(): bigint {
    const explicitSign = this.amountSign();
    if (explicitSign) {
      return explicitSign === 'outflow' ? -1n : 1n;
    }
    return this.transactionAmount() < 0n ? -1n : 1n;
  }

  private splitAmountMatchesTransactionSign(amount: bigint | undefined): boolean {
    if (amount === undefined || amount === 0n) return true;
    return amount * this.splitAmountMultiplier() > 0n;
  }

  private absoluteBigInt(value: bigint): bigint {
    return value < 0n ? -value : value;
  }
}
