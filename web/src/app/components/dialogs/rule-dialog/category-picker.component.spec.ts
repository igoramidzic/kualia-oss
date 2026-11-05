import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it } from 'vitest';
import { Category, CategoryGroup, CategoryService } from '../../../services/category.service';
import { IconService } from '../../../services/icon.service';
import { RuleCategoryPickerComponent } from './category-picker.component';

describe('RuleCategoryPickerComponent', () => {
  const catId = (id: string) => `cat_${id}` as Id<'category'>;
  const groupId = (id: string) => `group_${id}` as Id<'categoryGroup'>;

  let fixture: ComponentFixture<RuleCategoryPickerComponent>;
  let component: RuleCategoryPickerComponent;

  const group = {
    _id: groupId('expenses'),
    name: 'Expenses',
    type: 'expense',
    sortOrder: 1,
    isDeleted: false,
  } as CategoryGroup;

  const activeCategory = {
    _id: catId('groceries'),
    name: 'Groceries',
    type: 'expense',
    categoryGroupId: group._id,
    isDeleted: false,
    isArchived: false,
  } as Category;

  const archivedCategory = {
    _id: catId('old-groceries'),
    name: 'Old Groceries',
    type: 'expense',
    categoryGroupId: group._id,
    isDeleted: false,
    isArchived: true,
  } as Category;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleCategoryPickerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CategoryService,
          useValue: {
            categories: signal<Category[]>([activeCategory, archivedCategory]),
            categoryHierarchy: signal([
              {
                group,
                categories: [activeCategory, archivedCategory],
              },
            ]),
          },
        },
        {
          provide: IconService,
          useValue: {
            getIconByName: () => null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RuleCategoryPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows an archived category only while it is selected', () => {
    expect(component.groups()[0]?.categories).toEqual([activeCategory]);

    fixture.componentRef.setInput('categoryId', archivedCategory._id);
    fixture.detectChanges();

    expect(component.groups()[0]?.categories).toEqual([activeCategory, archivedCategory]);
    expect(component.displayCategory()).toBe('Old Groceries');

    fixture.componentRef.setInput('categoryId', activeCategory._id);
    fixture.detectChanges();

    expect(component.groups()[0]?.categories).toEqual([activeCategory]);
  });
});
