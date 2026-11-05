import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../services/budget.service';
import { CategoryService } from '../../../services/category.service';
import { CurrencyService } from '../../../services/currency.service';
import { MoveMoneyCategoryPickerComponent } from './move-money-category-picker.component';

interface TestCategory {
  _id: Id<'category'>;
  name: string;
  isDeleted: boolean;
  isArchived: boolean;
}

interface TestCategoryGroup {
  _id: Id<'categoryGroup'>;
  name: string;
  isDeleted: boolean;
  sortOrder: number;
  type: 'expense' | 'credit_card';
}

interface TestCategoryHierarchyItem {
  group: TestCategoryGroup;
  categories: TestCategory[];
}

interface TestBudgetMonth {
  yearMonth: number;
  budgetData: Record<string, { available: bigint }>;
}

describe('MoveMoneyCategoryPickerComponent', () => {
  const catId = (id: string) => `cat_${id}` as Id<'category'>;
  const groupId = (id: string) => `group_${id}` as Id<'categoryGroup'>;

  let mockCategoryService: {
    categoryHierarchy: ReturnType<typeof signal<TestCategoryHierarchyItem[]>>;
  };
  let mockBudgetService: {
    months: ReturnType<typeof signal<TestBudgetMonth[]>>;
    readyToAssign: ReturnType<typeof signal<bigint>>;
  };

  const formatCurrency = (amount: bigint): string => {
    const isNegative = amount < 0n;
    const absoluteAmount = isNegative ? -amount : amount;
    const dollars = absoluteAmount / 100n;
    const cents = (absoluteAmount % 100n).toString().padStart(2, '0');
    return `${isNegative ? '-' : ''}$${dollars}.${cents}`;
  };

  beforeEach(() => {
    mockCategoryService = {
      categoryHierarchy: signal([
        {
          group: {
            _id: groupId('monthly'),
            name: 'Monthly Bills',
            isDeleted: false,
            sortOrder: 1,
            type: 'expense',
          },
          categories: [
            {
              _id: catId('utilities'),
              name: '💡 Utilities',
              isDeleted: false,
              isArchived: false,
            },
            {
              _id: catId('mortgage'),
              name: 'Mortgage',
              isDeleted: false,
              isArchived: false,
            },
            {
              _id: catId('old-rent'),
              name: 'Old Rent',
              isDeleted: false,
              isArchived: true,
            },
          ],
        },
        {
          group: {
            _id: groupId('debt'),
            name: 'Debt',
            isDeleted: false,
            sortOrder: 2,
            type: 'credit_card',
          },
          categories: [
            {
              _id: catId('visa'),
              name: 'Visa',
              isDeleted: false,
              isArchived: false,
            },
          ],
        },
      ]),
    };

    mockBudgetService = {
      months: signal([
        {
          yearMonth: 202511,
          budgetData: {
            [catId('utilities')]: { available: 12_345n },
            [catId('mortgage')]: { available: -5_00n },
            [catId('visa')]: { available: 0n },
          },
        },
      ]),
      readyToAssign: signal(33_00n),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MoveMoneyCategoryPickerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: CurrencyService, useValue: { format: formatCurrency } },
      ],
    });
  });

  const createComponent = () => {
    const fixture = TestBed.createComponent(MoveMoneyCategoryPickerComponent);
    fixture.componentRef.setInput('yearMonth', 202511);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  const createFixture = () => {
    const fixture = TestBed.createComponent(MoveMoneyCategoryPickerComponent);
    fixture.componentRef.setInput('yearMonth', 202511);
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
  });

  it('keeps categories in budget-page order within each group', () => {
    const component = createComponent();

    const expenseGroup = component.typeGroups().find((typeGroup) => typeGroup.type === 'expense')?.groups[0];

    expect(expenseGroup?.categories.map((category) => category.name)).toEqual(['💡 Utilities', 'Mortgage']);
  });

  it('shows available amounts for category and Ready to Assign rows', () => {
    const component = createComponent();

    expect(component.availableAmountForCategory(catId('utilities'))).toBe(12_345n);
    expect(component.formatAvailableAmount(component.availableAmountForCategory(catId('utilities')))).toBe('$123.45');
    expect(component.availableAmountForCategory(catId('mortgage'))).toBe(-5_00n);
    expect(component.readyToAssignAvailableAmount()).toBe(33_00n);
    expect(component.formatAvailableAmount(component.readyToAssignAvailableAmount())).toBe('$33.00');
  });

  it('shows an archived category only while it is selected', () => {
    const fixture = createFixture();
    const archivedCategoryId = catId('old-rent');
    const listedCategoryIds = () =>
      fixture.componentInstance
        .typeGroups()
        .flatMap((typeGroup) => typeGroup.groups)
        .flatMap((group) => group.categories)
        .map((category) => category._id);

    expect(listedCategoryIds()).not.toContain(archivedCategoryId);

    fixture.componentRef.setInput('selectedCategoryId', archivedCategoryId);
    fixture.detectChanges();

    expect(listedCategoryIds()).toContain(archivedCategoryId);

    fixture.componentRef.setInput('selectedCategoryId', catId('mortgage'));
    fixture.detectChanges();

    expect(listedCategoryIds()).not.toContain(archivedCategoryId);
  });

  it('opens the category menu end-aligned with standard width', async () => {
    const fixture = createFixture();

    const combobox = fixture.nativeElement.querySelector('hlm-combobox') as HTMLElement | null;
    expect(combobox?.getAttribute('align')).toBe('end');

    const trigger = fixture.nativeElement.querySelector('button[data-slot="combobox-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const content = Array.from(document.querySelectorAll<HTMLElement>('div')).find((element) =>
      element.className.includes('group/combobox-content')
    );

    expect(content?.className).toContain('!w-100');
  });

  it('finds an emoji-prefixed category by its text name', async () => {
    const fixture = createFixture();
    const trigger = fixture.nativeElement.querySelector('button[data-slot="combobox-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="Search categories..."]')!;
    searchInput.value = 'Utilities';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    const categoryItems = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]'));
    expect(categoryItems.some((item) => item.textContent?.includes('💡 Utilities'))).toBe(true);
    expect(categoryItems.some((item) => item.textContent?.includes('Mortgage'))).toBe(false);
  });
});
