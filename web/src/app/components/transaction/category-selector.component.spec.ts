import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../services/budget.service';
import { Category, CategoryGroup, CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';
import { CurrentMonthService } from '../../services/current-month.service';
import { CategorySelectorComponent } from './category-selector.component';

describe('CategorySelectorComponent', () => {
  const catId = (id: string) => `cat_${id}` as Id<'category'>;
  const groupId = (id: string) => `group_${id}` as Id<'categoryGroup'>;

  let fixture: ComponentFixture<CategorySelectorComponent>;
  let component: CategorySelectorComponent;

  const groceriesCategory = {
    _id: catId('groceries'),
    name: 'Groceries',
    type: 'expense',
    categoryGroupId: groupId('needs'),
    isDeleted: false,
  } as Category;

  const diningCategory = {
    _id: catId('dining'),
    name: 'Dining Out',
    type: 'expense',
    categoryGroupId: groupId('wants'),
    isDeleted: false,
  } as Category;

  const archivedCategory = {
    _id: catId('archived'),
    name: 'Old Category',
    type: 'expense',
    categoryGroupId: groupId('wants'),
    isDeleted: false,
    isArchived: true,
  } as Category;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategorySelectorComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CategoryService,
          useValue: {
            categories: signal<Category[]>([groceriesCategory, diningCategory, archivedCategory]),
            activeGroups: signal<CategoryGroup[]>([
              {
                _id: groupId('needs'),
                name: 'Needs',
                type: 'expense',
                sortOrder: 1,
                isDeleted: false,
              } as CategoryGroup,
              {
                _id: groupId('wants'),
                name: 'Wants',
                type: 'expense',
                sortOrder: 2,
                isDeleted: false,
              } as CategoryGroup,
            ]),
          },
        },
        {
          provide: BudgetService,
          useValue: {
            months: signal([
              {
                yearMonth: 202606,
                budgetData: {
                  [catId('groceries')]: { available: 12_345n },
                },
              },
              {
                yearMonth: 202607,
                budgetData: {
                  [catId('groceries')]: { available: -5_00n },
                },
              },
            ]),
            readyToAssign: signal(77_00n),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            format: (amount: bigint) => {
              const negative = amount < 0n;
              const absolute = negative ? -amount : amount;
              return `${negative ? '-' : ''}$${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
            },
          },
        },
        {
          provide: CurrentMonthService,
          useValue: {
            currentYearMonth: signal(202606),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CategorySelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows available amounts for categories with budget data in the selected month', () => {
    fixture.componentRef.setInput('yearMonth', 202607);
    fixture.detectChanges();

    expect(component.showAvailableAmountForCategory(groceriesCategory)).toBe(true);
    expect(component.availableAmountForCategory(groceriesCategory._id)).toBe(-5_00n);
    expect(component.formatAvailableAmount(component.availableAmountForCategory(groceriesCategory._id))).toBe('-$5.00');
    expect(component.availableAmountClass(-5_00n)).toContain('text-destructive');
  });

  it('hides the available amount for categories without budget data', () => {
    expect(component.showAvailableAmountForCategory(diningCategory)).toBe(false);
    expect(component.availableAmountForCategory(diningCategory._id)).toBe(0n);
  });

  it('falls back to the current month when no month input is provided', () => {
    expect(component.availableAmountForCategory(groceriesCategory._id)).toBe(12_345n);
  });

  it('formats Ready to Assign with the same balance formatter', () => {
    expect(component.readyToAssignAvailableAmount()).toBe(77_00n);
    expect(component.formatAvailableAmount(component.readyToAssignAvailableAmount())).toBe('$77.00');
  });

  it('uses bolder same-size group labels without a background band', () => {
    expect(component.groupLabelClass).not.toContain('bg-');
    expect(component.groupLabelClass).toContain('text-sm');
    expect(component.groupLabelClass).toContain('font-bold');
  });

  it('does not add extra category-name indent beyond the selected-check gutter', () => {
    expect(component.categoryRowNameClass).not.toContain('pl-3');
    expect(component.categoryRowNameClass).toContain('text-left');
  });

  it('shows an archived category only while it is selected', () => {
    expect(component.categories()).not.toContain(archivedCategory);

    fixture.componentRef.setInput('categoryId', archivedCategory._id);
    fixture.detectChanges();

    expect(component.categories()).toContain(archivedCategory);
    expect(component.displayCategory()).toBe('Old Category');

    fixture.componentRef.setInput('categoryId', groceriesCategory._id);
    fixture.detectChanges();

    expect(component.categories()).not.toContain(archivedCategory);
  });

  it('does not suggest an archived category unless it is selected', () => {
    fixture.componentRef.setInput('suggestedCategoryIds', [archivedCategory._id]);
    fixture.detectChanges();

    expect(component.suggestedCategories()).toEqual([]);

    fixture.componentRef.setInput('categoryId', archivedCategory._id);
    fixture.detectChanges();

    expect(component.suggestedCategories()).toEqual([archivedCategory]);
  });
});
