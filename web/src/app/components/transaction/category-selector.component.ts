import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoCategory as Box,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoSplit as Split,
} from '@kualia/icons';
import { BudgetService } from '../../services/budget.service';
import { Category, CategoryGroup, CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';
import { CurrentMonthService } from '../../services/current-month.service';
import { HlmTooltip } from '../../ui/tooltip/src';

interface GroupedCategory {
  categoryGroupId: string | null;
  categoryGroupName: string;
  categories: Category[];
}

interface TypeGroup {
  type: 'income' | 'expense' | 'transfer';
  label: string;
  groups: GroupedCategory[];
}

const READY_TO_ASSIGN_VALUE = '__READY_TO_ASSIGN__';
const NO_CATEGORY_VALUE = '__NO_CATEGORY__';

@Component({
  selector: 'app-category-selector',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports, HlmButton, HlmTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="comboboxValue()"
      (valueChange)="onValueChange($event)"
      [disabled]="disabled()"
      sideOffset="5"
      autoFocus="first-tabbable"
      [filter]="noopFilter"
    >
      <hlm-combobox-trigger [class]="buttonClass()" [variant]="variant()" [showIcon]="false" stopPropagation>
        <span class="flex min-w-0 flex-1 items-center gap-2">
          @if (customEmptyIcon(); as customIcon) {
            <nucleo-icon
              [icon]="customIcon"
              [size]="14"
              [class]="(isMissingCategoryState() ? 'text-destructive' : 'text-muted-foreground') + ' flex-shrink-0'"
            />
          } @else {
            <nucleo-icon
              [icon]="isMissingCategoryState() ? AlertCircle : Box"
              [size]="14"
              [class]="(isMissingCategoryState() ? 'text-destructive' : 'text-muted-foreground') + ' flex-shrink-0'"
            />
          }
          <span
            [class]="
              (isMissingCategoryState() ? 'text-destructive' : '') +
              (isPromptCategoryState() ? 'text-muted-foreground' : '') +
              ' max-w-80 min-w-0 flex-1 truncate text-left'
            "
            >{{ displayCategory() }}</span
          >
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="!max-h-100 !w-100 **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border flex items-center border-b">
          <div class="min-w-0 flex-1">
            <hlm-combobox-input
              placeholder="Search categories..."
              [showTrigger]="false"
              (input)="searchQuery.set($any($event.target).value)"
            />
          </div>
          @if (showSplitButton()) {
            <button
              type="button"
              hlmBtn
              variant="ghost"
              size="sm"
              class="h-9 w-9 flex-shrink-0 p-0"
              [hlmTooltip]="'Split Transaction'"
              (click)="onSplitClick($event)"
            >
              <nucleo-icon [icon]="SplitIcon" [size]="16" class="-rotate-90" />
            </button>
          }
        </div>
        <div hlmComboboxList>
          @if (allowReadyToAssign()) {
            <div hlmComboboxGroup>
              <hlm-combobox-item [value]="READY_TO_ASSIGN_VALUE">
                <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span class="min-w-0 flex-1 truncate text-left">Ready to Assign</span>
                  @if (showAvailableAmounts()) {
                    <span [class]="availableAmountClass(readyToAssignAvailableAmount())">
                      {{ formatAvailableAmount(readyToAssignAvailableAmount()) }}
                    </span>
                  }
                </div>
              </hlm-combobox-item>
            </div>
          }
          @if (filteredSuggestedCategories().length > 0) {
            <div hlmComboboxGroup>
              <div hlmComboboxLabel [class]="groupLabelClass">Suggested</div>
              @for (category of filteredSuggestedCategories(); track category._id) {
                <hlm-combobox-item [value]="category._id">
                  <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <span [class]="categoryRowNameClass">{{ category.name }}</span>
                    @if (showAvailableAmountForCategory(category)) {
                      <span [class]="availableAmountClass(availableAmountForCategory(category._id))">
                        {{ formatAvailableAmount(availableAmountForCategory(category._id)) }}
                      </span>
                    }
                  </div>
                </hlm-combobox-item>
              }
            </div>
          }
          @if (allowNone()) {
            <div hlmComboboxGroup>
              <hlm-combobox-item [value]="NO_CATEGORY_VALUE">
                <span class="text-muted-foreground min-w-0 flex-1 truncate text-left">No category</span>
              </hlm-combobox-item>
            </div>
          }
          @for (typeGroup of filteredTypeGroups(); track typeGroup.type) {
            @if (typeGroup.groups.length > 0) {
              @for (group of typeGroup.groups; track group.categoryGroupId ?? 'ungrouped') {
                <div hlmComboboxGroup class="min-w-0 overflow-hidden">
                  @if (group.categoryGroupName && group.categoryGroupId) {
                    <div hlmComboboxLabel [class]="groupLabelClass">
                      <span class="inline-block max-w-full truncate">{{ group.categoryGroupName }}</span>
                    </div>
                  }
                  @for (category of group.categories; track category._id) {
                    <hlm-combobox-item [value]="category._id">
                      <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <span [class]="categoryRowNameClass">{{ category.name }}</span>
                        @if (showAvailableAmountForCategory(category)) {
                          <span [class]="availableAmountClass(availableAmountForCategory(category._id))">
                            {{ formatAvailableAmount(availableAmountForCategory(category._id)) }}
                          </span>
                        }
                      </div>
                    </hlm-combobox-item>
                  }
                </div>
              }
            }
          }
        </div>
        <hlm-combobox-empty>No categories found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
})
export class CategorySelectorComponent {
  // Injected services
  private readonly categoryService = inject(CategoryService);
  private readonly budgetService = inject(BudgetService);
  private readonly currencyService = inject(CurrencyService);
  private readonly currentMonthService = inject(CurrentMonthService);

  // Constants
  readonly READY_TO_ASSIGN_VALUE = READY_TO_ASSIGN_VALUE;
  readonly NO_CATEGORY_VALUE = NO_CATEGORY_VALUE;
  readonly groupLabelClass =
    'text-foreground mb-1 mt-2 flex min-h-8 max-w-full min-w-0 items-center overflow-hidden px-2 text-sm font-bold';
  readonly categoryRowNameClass = 'min-w-0 flex-1 truncate text-left';

  // Inputs
  readonly categoryId = input<string | null>(null);
  readonly isReadyToAssign = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');
  readonly allowNone = input<boolean>(true);
  readonly allowReadyToAssign = input<boolean>(true);
  readonly allowCreditCard = input<boolean>(true);
  readonly showSplitButton = input<boolean>(false);
  readonly customButtonLabel = input<string | undefined>(undefined);
  readonly customEmptyIcon = input<typeof Box | typeof Plus | undefined>(undefined);
  readonly highlightMissingCategory = input<boolean>(true);
  readonly showSelectPrompt = input<boolean>(false);
  readonly showAvailableAmounts = input<boolean>(true);
  readonly yearMonth = input<number | null>(null);
  // Suggested category IDs from merchant history (only show section when 2+ suggestions)
  readonly suggestedCategoryIds = input<string[]>([]);

  // Outputs
  readonly categoryChange = output<string | null | 'ready-to-assign'>();
  readonly splitClick = output<void>();

  // Internal state
  readonly searchQuery = signal<string>('');

  // Icons
  readonly Box = Box;
  readonly Plus = Plus;
  readonly SplitIcon = Split;
  readonly AlertCircle = AlertCircle;

  // No-op filter to disable combobox internal filtering (we handle filtering ourselves)
  readonly noopFilter = () => true;

  // Computed values
  readonly categories = computed(() => {
    const selectedCategoryId = this.categoryId();
    const allCategories = this.categoryService
      .categories()
      .filter(
        (category: Category) => !category.isDeleted && (!category.isArchived || category._id === selectedCategoryId)
      );
    if (!this.allowCreditCard()) {
      return allCategories.filter((c: Category) => c.type !== 'credit_card');
    }
    return allCategories;
  });
  readonly categoryGroups = computed(() => this.categoryService.activeGroups());
  readonly availableBudgetMonth = computed(() => {
    const yearMonth = this.yearMonth() ?? this.currentMonthService.currentYearMonth();
    return this.budgetService.months().find((month) => month.yearMonth === yearMonth) ?? null;
  });

  readonly selectedCategory = computed(() => {
    const id = this.categoryId();
    if (!id) return null;
    return this.categories().find((category: Category) => category._id === id) ?? null;
  });

  // Suggested categories from merchant history
  readonly suggestedCategories = computed(() => {
    const ids = this.suggestedCategoryIds();
    if (ids.length === 0) return [];
    return ids
      .map((id) => this.categories().find((c: Category) => c._id === id))
      .filter((c): c is Category => c !== undefined);
  });

  // Filtered suggested categories based on search
  readonly filteredSuggestedCategories = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.suggestedCategories();
    return this.suggestedCategories().filter((c) => c.name.toLowerCase().includes(query));
  });

  readonly isMissingCategoryState = computed(() => {
    return this.highlightMissingCategory() && !this.categoryId() && !this.isReadyToAssign() && !this.showSelectPrompt();
  });

  readonly isPromptCategoryState = computed(() => {
    return !this.categoryId() && !this.isReadyToAssign() && this.showSelectPrompt();
  });

  readonly displayCategory = computed(() => {
    // Use custom button label if provided
    const customLabel = this.customButtonLabel();
    if (customLabel !== undefined) {
      return customLabel;
    }

    if (this.isReadyToAssign()) {
      return 'Ready to Assign';
    }
    const category = this.selectedCategory();
    if (!category) {
      return this.showSelectPrompt() ? 'Select category' : 'Uncategorized';
    }
    return category.name;
  });

  // Convert current state to combobox value
  readonly comboboxValue = computed(() => {
    if (this.isReadyToAssign()) return READY_TO_ASSIGN_VALUE;
    const id = this.categoryId();
    if (id) return id;
    return this.allowNone() ? NO_CATEGORY_VALUE : '';
  });

  readonly typeGroups = computed((): TypeGroup[] => {
    const categories = this.categories();
    const categoryGroups = this.categoryGroups();

    const typeOrder: ('income' | 'expense' | 'transfer')[] = ['income', 'expense', 'transfer'];
    const typeLabels: Record<'income' | 'expense' | 'transfer', string> = {
      income: 'Income',
      expense: 'Expenses',
      transfer: 'Transfer',
    };

    return typeOrder.map((type) => {
      const typeCategoriesMap = new Map<string | null, Category[]>();

      // Filter categories by type
      const typeCategories = categories.filter((c: Category) => c.type === type);

      // Group by categoryGroupId
      typeCategories.forEach((category: Category) => {
        const groupId = category.categoryGroupId ?? null;
        const existing = typeCategoriesMap.get(groupId) ?? [];
        existing.push(category);
        typeCategoriesMap.set(groupId, existing);
      });

      // Sort categories within each group alphabetically
      typeCategoriesMap.forEach((cats) => {
        cats.sort((a, b) => a.name.localeCompare(b.name));
      });

      // Create GroupedCategory objects
      const groups: GroupedCategory[] = [];

      // Add grouped categories first (sorted by sortOrder, then by name)
      const groupedEntries = Array.from(typeCategoriesMap.entries())
        .filter(([groupId]) => groupId !== null)
        .map(([groupId, cats]) => {
          const group = categoryGroups.find((g: CategoryGroup) => g._id === groupId);
          return {
            categoryGroupId: groupId,
            categoryGroupName: group?.name ?? 'Unknown Group',
            categories: cats,
            sortOrder: group?.sortOrder ?? 999999,
            name: group?.name ?? '',
          };
        })
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          }
          return a.name.localeCompare(b.name);
        });

      groups.push(
        ...groupedEntries.map(({ categoryGroupId, categoryGroupName, categories }) => ({
          categoryGroupId,
          categoryGroupName,
          categories,
        }))
      );

      // Add ungrouped categories at the end
      const ungrouped = typeCategoriesMap.get(null);
      if (ungrouped && ungrouped.length > 0) {
        groups.push({
          categoryGroupId: null,
          categoryGroupName: '',
          categories: ungrouped,
        });
      }

      return {
        type,
        label: typeLabels[type],
        groups,
      };
    });
  });

  readonly filteredTypeGroups = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) {
      return this.typeGroups();
    }

    return this.typeGroups()
      .map((typeGroup) => ({
        ...typeGroup,
        groups: typeGroup.groups
          .map((group) => ({
            ...group,
            categories: group.categories.filter((c) => c.name.toLowerCase().includes(query)),
          }))
          .filter((group) => group.categories.length > 0),
      }))
      .filter((typeGroup) => typeGroup.groups.length > 0);
  });

  onValueChange(value: string | null | undefined) {
    if (value === undefined) return;

    if (value === READY_TO_ASSIGN_VALUE) {
      this.categoryChange.emit('ready-to-assign');
    } else if (value === NO_CATEGORY_VALUE) {
      this.categoryChange.emit(null);
    } else {
      this.categoryChange.emit(value);
    }
  }

  onSplitClick(event: Event) {
    event.stopPropagation();
    this.splitClick.emit();
  }

  readyToAssignAvailableAmount(): bigint {
    return this.budgetService.readyToAssign();
  }

  availableAmountForCategory(categoryId: Category['_id']): bigint {
    return this.availableBudgetMonth()?.budgetData[categoryId]?.available ?? 0n;
  }

  showAvailableAmountForCategory(category: Category): boolean {
    if (!this.showAvailableAmounts()) return false;
    return this.availableBudgetMonth()?.budgetData[category._id] !== undefined;
  }

  formatAvailableAmount(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  availableAmountClass(amount: bigint): string {
    const baseClass = 'shrink-0 tabular-nums text-xs';
    if (amount < 0n) {
      return `${baseClass} text-destructive`;
    }
    if (amount === 0n) {
      return `${baseClass} text-muted-foreground`;
    }
    return `${baseClass} text-foreground`;
  }
}
