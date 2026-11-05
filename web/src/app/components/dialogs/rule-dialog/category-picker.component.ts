import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { Id } from 'convex/_generated/dataModel';
import { nucleoCategory as Box, nucleoCheck as Check, NucleoIcon, type NucleoIconData } from '@kualia/icons';
import { Category, CategoryHierarchy, CategoryService } from '../../../services/category.service';
import { IconService } from '../../../services/icon.service';

interface GroupedCategory {
  categoryGroupId: string | null;
  categoryGroupName: string;
  categories: Category[];
}

@Component({
  selector: 'app-rule-category-picker',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="categoryId()"
      (valueChange)="selectCategory($event)"
      sideOffset="5"
      autoFocus="first-tabbable"
      [filter]="noopFilter"
    >
      <hlm-combobox-trigger class="h-9 w-full justify-between" variant="outline">
        <span class="flex min-w-0 items-center gap-2" [class.text-muted-foreground]="!selectedCategory()">
          @if (selectedCategory()) {
            @if (getCategoryIcon(selectedCategory()!); as iconData) {
              <nucleo-icon [icon]="iconData" size="14" class="text-muted-foreground flex-shrink-0" />
            } @else {
              <nucleo-icon [icon]="Box" size="14" class="text-muted-foreground flex-shrink-0" />
            }
          } @else {
            <nucleo-icon [icon]="Box" size="14" class="text-muted-foreground flex-shrink-0" />
          }
          <span class="min-w-0 truncate">{{ displayCategory() }}</span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="!max-h-100 !w-100 **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search categories..."
            [showTrigger]="false"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>
        <div hlmComboboxList>
          @for (group of filteredGroups(); track group.categoryGroupId ?? 'ungrouped') {
            <div hlmComboboxGroup class="min-w-0 overflow-hidden">
              @if (group.categoryGroupName && group.categoryGroupId) {
                <div hlmComboboxLabel class="max-w-full min-w-0 overflow-hidden">
                  <span class="inline-block max-w-full truncate">{{ group.categoryGroupName }}</span>
                </div>
              }
              @for (category of group.categories; track category._id) {
                <hlm-combobox-item [value]="category._id">
                  <div class="flex w-full min-w-0 items-center justify-between gap-2">
                    <span class="flex min-w-0 items-center gap-2">
                      @if (getCategoryIcon(category); as iconData) {
                        <nucleo-icon [icon]="iconData" size="16" class="text-muted-foreground flex-shrink-0" />
                      } @else {
                        <nucleo-icon [icon]="Box" size="16" class="text-muted-foreground flex-shrink-0" />
                      }
                      <span class="min-w-0 truncate">{{ category.name }}</span>
                    </span>
                    @if (category._id === categoryId()) {
                      <nucleo-icon [icon]="Check" size="14" class="flex-shrink-0" />
                    }
                  </div>
                </hlm-combobox-item>
              }
            </div>
          }
        </div>
        <hlm-combobox-empty>No categories found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
})
export class RuleCategoryPickerComponent {
  private readonly categoryService = inject(CategoryService);
  private readonly iconService = inject(IconService);

  readonly Check = Check;
  readonly Box = Box;

  // No-op filter to disable combobox internal filtering (we handle filtering ourselves)
  readonly noopFilter = () => true;

  readonly categoryId = input<Id<'category'> | null>(null);

  readonly categoryChange = output<Id<'category'>>();

  readonly searchQuery = signal<string>('');

  readonly categories = computed(() => {
    const selectedCategoryId = this.categoryId();
    return this.categoryService
      .categories()
      .filter((category) => !category.isDeleted && (!category.isArchived || category._id === selectedCategoryId));
  });
  readonly categoryHierarchy = computed(() => this.categoryService.categoryHierarchy());

  readonly selectedCategory = computed(() => {
    const id = this.categoryId();
    if (!id) return null;
    return this.categories().find((c) => c._id === id) ?? null;
  });

  readonly displayCategory = computed(() => {
    const category = this.selectedCategory();
    return category?.name ?? 'Select Category';
  });

  readonly groups = computed((): GroupedCategory[] => {
    const selectableCategoryIds = new Set(this.categories().map((category) => category._id));

    return this.categoryHierarchy()
      .map((item: CategoryHierarchy[number]) => ({
        categoryGroupId: item.group._id,
        categoryGroupName: item.group.name,
        categories: item.categories.filter((category) => selectableCategoryIds.has(category._id)),
      }))
      .filter((group) => group.categories.length > 0);
  });

  readonly filteredGroups = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) {
      return this.groups();
    }

    return this.groups()
      .map((group) => ({
        ...group,
        categories: group.categories.filter((c) => c.name.toLowerCase().includes(query)),
      }))
      .filter((group) => group.categories.length > 0);
  });

  selectCategory(categoryId: string | null | undefined): void {
    if (categoryId) {
      this.categoryChange.emit(categoryId as Id<'category'>);
    }
  }

  getCategoryIcon(category: Category): NucleoIconData | null {
    if (!category.iconName) return null;
    return this.iconService.getIconByName(category.iconName);
  }
}
