import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { Id } from 'convex/_generated/dataModel';
import { nucleoCategory as Box, NucleoIcon } from '@kualia/icons';
import { BudgetService } from '../../../services/budget.service';
import { Category, CategoryGroup, CategoryService } from '../../../services/category.service';
import { CurrencyService } from '../../../services/currency.service';

interface GroupedCategory {
  categoryGroupId: string | null;
  categoryGroupName: string;
  categories: Category[];
}

interface TypeGroup {
  type: CategoryGroup['type'];
  label: string;
  groups: GroupedCategory[];
}

const READY_TO_ASSIGN_VALUE = '__READY_TO_ASSIGN__';

@Component({
  selector: 'app-move-money-category-picker',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="comboboxValue()"
      (valueChange)="onValueChange($event)"
      [disabled]="disabled()"
      align="end"
      sideOffset="5"
      autoFocus="first-tabbable"
      [filter]="noopFilter"
    >
      <hlm-combobox-trigger class="w-full justify-between">
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <nucleo-icon [icon]="Box" [size]="14" class="text-muted-foreground flex-shrink-0" />
          <span [class]="(selectedCategoryId() ? '' : 'text-muted-foreground') + ' min-w-0 flex-1 truncate text-left'">
            {{ getSelectedCategoryName() ?? 'Select category...' }}
          </span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="!w-100 **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search categories..."
            [showTrigger]="false"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>
        <div hlmComboboxList>
          @if (!hideReadyToAssign()) {
            <div hlmComboboxGroup>
              <hlm-combobox-item [value]="READY_TO_ASSIGN_VALUE">
                <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span class="min-w-0 flex-1 truncate text-left">Ready to Assign</span>
                  <span [class]="availableAmountClass(readyToAssignAvailableAmount())">
                    {{ formatAvailableAmount(readyToAssignAvailableAmount()) }}
                  </span>
                </div>
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
                        <span [class]="availableAmountClass(availableAmountForCategory(category._id))">
                          {{ formatAvailableAmount(availableAmountForCategory(category._id)) }}
                        </span>
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
export class MoveMoneyCategoryPickerComponent {
  private readonly categoryService = inject(CategoryService);
  private readonly budgetService = inject(BudgetService);
  private readonly currencyService = inject(CurrencyService);

  // Constants
  readonly READY_TO_ASSIGN_VALUE = READY_TO_ASSIGN_VALUE;
  readonly groupLabelClass =
    'text-foreground mb-1 mt-2 flex min-h-8 max-w-full min-w-0 items-center overflow-hidden px-2 text-sm font-bold';
  readonly categoryRowNameClass = 'min-w-0 flex-1 truncate text-left';

  // Inputs
  readonly excludeCategoryId = input<Id<'category'> | Id<'category'>[] | null>(null);
  readonly selectedCategoryId = input<Id<'category'> | 'ready-to-assign' | null>(null);
  readonly yearMonth = input.required<number>();
  readonly disabled = input<boolean>(false);
  readonly hideReadyToAssign = input<boolean>(false);

  // Outputs
  readonly categorySelected = output<Id<'category'> | 'ready-to-assign'>();

  // Internal state
  readonly searchQuery = signal<string>('');

  // Disable the combobox's value-based filtering because category values are IDs.
  // Category names are filtered by filteredTypeGroups instead.
  readonly noopFilter = () => true;

  // Icons
  readonly Box = Box;

  // Convert selectedCategoryId to combobox value
  readonly comboboxValue = computed(() => {
    const id = this.selectedCategoryId();
    if (id === 'ready-to-assign') return READY_TO_ASSIGN_VALUE;
    return id ?? '';
  });

  readonly currentMonthData = computed(() => {
    const yearMonth = this.yearMonth();
    return this.budgetService.months().find((month) => month.yearMonth === yearMonth) ?? null;
  });

  readonly excludedCategoryIds = computed(() => {
    const excludeId = this.excludeCategoryId();
    return new Set(Array.isArray(excludeId) ? excludeId : excludeId ? [excludeId] : []);
  });

  readonly typeGroups = computed((): TypeGroup[] => {
    const hierarchy = this.categoryService.categoryHierarchy();
    const excludedIds = this.excludedCategoryIds();
    const selectedCategoryId = this.selectedCategoryId();

    const typeOrder: CategoryGroup['type'][] = ['expense', 'credit_card'];
    const typeLabels: Record<CategoryGroup['type'], string> = {
      expense: 'Expenses',
      credit_card: 'Credit Cards',
    };

    return typeOrder.map((type) => {
      const groups = hierarchy
        .filter((groupData) => !groupData.group.isDeleted && groupData.group.type === type)
        .map((groupData) => ({
          categoryGroupId: groupData.group._id,
          categoryGroupName: groupData.group.name,
          categories: groupData.categories.filter(
            (category) =>
              !excludedIds.has(category._id) &&
              !category.isDeleted &&
              (!category.isArchived || category._id === selectedCategoryId)
          ),
          sortOrder: groupData.group.sortOrder,
        }))
        .filter((group) => group.categories.length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        type,
        label: typeLabels[type],
        groups: groups.map(({ categoryGroupId, categoryGroupName, categories }) => ({
          categoryGroupId,
          categoryGroupName,
          categories,
        })),
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

  getSelectedCategoryName(): string | null {
    const selectedId = this.selectedCategoryId();
    if (!selectedId) return null;
    if (selectedId === 'ready-to-assign') return 'Ready to Assign';
    const category = this.categoryService
      .categoryHierarchy()
      .flatMap((groupData) => groupData.categories)
      .find((c) => c._id === selectedId);
    return category?.name ?? null;
  }

  readyToAssignAvailableAmount(): bigint {
    return this.budgetService.readyToAssign();
  }

  availableAmountForCategory(categoryId: Id<'category'>): bigint {
    return this.currentMonthData()?.budgetData[categoryId]?.available ?? 0n;
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

  onValueChange(value: string | null | undefined): void {
    if (!value) return;

    if (value === READY_TO_ASSIGN_VALUE) {
      this.categorySelected.emit('ready-to-assign');
    } else {
      this.categorySelected.emit(value as Id<'category'>);
    }
    this.searchQuery.set('');
  }
}
