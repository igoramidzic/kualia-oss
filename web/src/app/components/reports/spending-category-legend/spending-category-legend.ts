import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoChevronDown as ChevronDown, nucleoChevronUp as ChevronUp, NucleoIcon } from '@kualia/icons';
import { CurrencyService } from '../../../services/currency.service';
import { CategorySpendingData } from '../../../services/spending-report.service';

// Maximum categories to show before "Show all" toggle (11 + "Everything Else" = 12 total for 4 rows × 3 columns)
const DEFAULT_VISIBLE_COUNT = 11;

// Predefined color palette (matches chart)
const CATEGORY_COLORS = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#a855f7', // purple-500
];

// Color for "Everything else" segment (12th color in palette)
const EVERYTHING_ELSE_COLOR = CATEGORY_COLORS[11]; // purple-500

@Component({
  selector: 'app-spending-category-legend',
  imports: [DecimalPipe, HlmButton, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        @for (item of visibleItems(); track item.categoryId; let i = $index) {
          <button
            type="button"
            [class]="getItemClass(item.categoryId)"
            (click)="itemClick.emit(item)"
            (mouseenter)="itemHover.emit(item.categoryId)"
            (mouseleave)="itemHover.emit(null)"
          >
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" [style.backgroundColor]="getColor(i)"></span>
              <span class="min-w-0 flex-1 truncate text-sm">{{ item.categoryName }}</span>
            </div>
            <div class="text-muted-foreground pl-[18px] text-sm">
              {{ formatCurrency(item.outflowAmount) }} ({{ item.actualPercent | number: '1.0-1' }}%)
            </div>
          </button>
        }
        @if (everythingElse(); as elseData) {
          <div class="flex flex-col gap-0.5 rounded-lg p-2 text-left">
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" [style.backgroundColor]="everythingElseColor"></span>
              <span class="min-w-0 flex-1 truncate text-sm">Everything else</span>
            </div>
            <div class="text-muted-foreground pl-[18px] text-sm">
              {{ formatCurrency(elseData.amount) }} ({{ elseData.percent | number: '1.0-1' }}%)
            </div>
          </div>
        }
      </div>

      @if (hasMoreItems()) {
        <div class="mt-4 flex justify-center">
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            class="text-primary h-8 text-sm"
            (click)="toggleShowAll.emit(!showAll())"
          >
            @if (showAll()) {
              Show less
              <nucleo-icon [icon]="ChevronUp" class="ml-1 h-4 w-4" />
            } @else {
              Show all categories
              <nucleo-icon [icon]="ChevronDown" class="ml-1 h-4 w-4" />
            }
          </button>
        </div>
      }
    </div>
  `,
})
export class SpendingCategoryLegendComponent {
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly items = input<CategorySpendingData[]>([]);
  readonly showAll = input<boolean>(false);
  readonly selectedId = input<string | null>(null);

  // Outputs
  readonly toggleShowAll = output<boolean>();
  readonly itemClick = output<CategorySpendingData>();
  readonly itemHover = output<string | null>();

  // Icons
  readonly ChevronDown = ChevronDown;
  readonly ChevronUp = ChevronUp;

  // Sorted items by gross outflow.
  readonly sortedItems = computed(() => {
    const items = this.items();
    if (!items) return [];
    return [...items].sort((a, b) => Number(b.outflowAmount - a.outflowAmount));
  });

  // Visible items based on showAll toggle
  readonly visibleItems = computed(() => {
    const sorted = this.sortedItems();
    if (this.showAll()) {
      return sorted;
    }
    return sorted.slice(0, DEFAULT_VISIBLE_COUNT);
  });

  // Total count of items
  readonly totalCount = computed(() => this.sortedItems().length);

  // Whether there are more items to show
  readonly hasMoreItems = computed(() => this.totalCount() > DEFAULT_VISIBLE_COUNT);

  // "Everything else" data when collapsed
  readonly everythingElse = computed(() => {
    // Only show when collapsed and there are more items
    if (this.showAll() || !this.hasMoreItems()) {
      return null;
    }

    const sorted = this.sortedItems();
    const hiddenItems = sorted.slice(DEFAULT_VISIBLE_COUNT);
    const amount = hiddenItems.reduce((sum, item) => sum + item.outflowAmount, 0n);

    // Calculate total from all items
    const total = sorted.reduce((sum, item) => sum + item.outflowAmount, 0n);
    const percent = total > 0n ? (Number(amount) / Number(total)) * 100 : 0;

    return { amount, percent };
  });

  // Color for "Everything else" entry
  readonly everythingElseColor = EVERYTHING_ELSE_COLOR;

  // Format currency
  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  // Get color for item at index
  getColor(index: number): string {
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  }

  // Get class for item button
  getItemClass(categoryId: string): string {
    const baseClass = 'flex flex-col gap-0.5 rounded-lg p-2 text-left transition-colors hover:bg-accent/50';
    if (this.selectedId() === categoryId) {
      return `${baseClass} bg-accent/50 ring-2 ring-primary/50`;
    }
    return baseClass;
  }
}
