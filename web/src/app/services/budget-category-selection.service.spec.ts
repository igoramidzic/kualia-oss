import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it } from 'vitest';
import { BudgetCategorySelectionService } from './budget-category-selection.service';
import { CategoryService } from './category.service';

describe('BudgetCategorySelectionService', () => {
  let service: BudgetCategorySelectionService;

  // Mock CategoryService
  let mockCategoryService: {
    categoryHierarchy: ReturnType<
      typeof signal<
        {
          group: { _id: string; name: string; isDeleted: boolean };
          categories: { _id: Id<'category'>; name: string; isDeleted: boolean }[];
        }[]
      >
    >;
  };

  // Helper to create category IDs
  const catId = (id: string) => `cat_${id}` as Id<'category'>;

  beforeEach(() => {
    mockCategoryService = {
      categoryHierarchy: signal([]),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BudgetCategorySelectionService,
        { provide: CategoryService, useValue: mockCategoryService },
      ],
    });

    service = TestBed.inject(BudgetCategorySelectionService);
  });

  describe('basic selection', () => {
    it('should start with no selections', () => {
      expect(service.selectedCategories()).toHaveLength(0);
      expect(service.hasSelections()).toBe(false);
    });

    it('should select a category', () => {
      const categoryId = catId('1');

      service.selectCategory(categoryId);

      expect(service.selectedCategories()).toContain(categoryId);
      expect(service.hasSelections()).toBe(true);
    });

    it('should deselect a category', () => {
      const categoryId = catId('1');

      service.selectCategory(categoryId);
      service.deselectCategory(categoryId);

      expect(service.selectedCategories()).not.toContain(categoryId);
      expect(service.hasSelections()).toBe(false);
    });

    it('should toggle category selection on', () => {
      const categoryId = catId('1');

      service.toggleCategory(categoryId);

      expect(service.selectedCategories()).toContain(categoryId);
    });

    it('should toggle category selection off', () => {
      const categoryId = catId('1');

      service.selectCategory(categoryId);
      service.toggleCategory(categoryId);

      expect(service.selectedCategories()).not.toContain(categoryId);
    });

    it('should check if a specific category is selected', () => {
      const categoryId = catId('1');

      expect(service.isCategorySelected(categoryId)()).toBe(false);

      service.selectCategory(categoryId);

      expect(service.isCategorySelected(categoryId)()).toBe(true);
    });
  });

  describe('bulk selection', () => {
    it('should select multiple categories', () => {
      const categories = [catId('1'), catId('2'), catId('3')];

      service.selectAllCategories(categories);

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.selectedCategories()).toContain(categories[0]);
      expect(service.selectedCategories()).toContain(categories[1]);
      expect(service.selectedCategories()).toContain(categories[2]);
    });

    it('should add to existing selection when selecting multiple', () => {
      const existing = catId('0');
      const newCategories = [catId('1'), catId('2')];

      service.selectCategory(existing);
      service.selectAllCategories(newCategories);

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.selectedCategories()).toContain(existing);
    });

    it('should deselect all categories', () => {
      service.selectAllCategories([catId('1'), catId('2'), catId('3')]);

      service.deselectAllCategories();

      expect(service.selectedCategories()).toHaveLength(0);
      expect(service.hasSelections()).toBe(false);
    });
  });

  describe('visible categories', () => {
    it('should set and get visible category IDs', () => {
      const visibleIds = [catId('1'), catId('2'), catId('3')];

      service.setVisibleCategoryIds(visibleIds);

      expect(service.getVisibleCategoryIds()).toEqual(visibleIds);
    });

    it('should select all visible categories', () => {
      const visibleIds = [catId('1'), catId('2'), catId('3')];

      service.setVisibleCategoryIds(visibleIds);
      service.selectAllVisibleCategories();

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.selectedCategories()).toContain(visibleIds[0]);
      expect(service.selectedCategories()).toContain(visibleIds[1]);
      expect(service.selectedCategories()).toContain(visibleIds[2]);
    });

    it('should not select anything when no visible categories', () => {
      service.setVisibleCategoryIds([]);
      service.selectAllVisibleCategories();

      expect(service.selectedCategories()).toHaveLength(0);
    });
  });

  describe('last clicked tracking', () => {
    it('should start with no last clicked category', () => {
      expect(service.getLastClickedCategoryId()).toBeNull();
    });

    it('should set and get last clicked category ID', () => {
      const categoryId = catId('1');

      service.setLastClickedCategoryId(categoryId);

      expect(service.getLastClickedCategoryId()).toBe(categoryId);
    });

    it('should clear last clicked category ID', () => {
      service.setLastClickedCategoryId(catId('1'));
      service.setLastClickedCategoryId(null);

      expect(service.getLastClickedCategoryId()).toBeNull();
    });

    it('should update last clicked category ID', () => {
      service.setLastClickedCategoryId(catId('1'));
      service.setLastClickedCategoryId(catId('2'));

      expect(service.getLastClickedCategoryId()).toBe(catId('2'));
    });
  });

  describe('range selection (shift+click)', () => {
    beforeEach(() => {
      // Set up visible categories in order: 1, 2, 3, 4, 5
      const visibleIds = [catId('1'), catId('2'), catId('3'), catId('4'), catId('5')];
      service.setVisibleCategoryIds(visibleIds);
    });

    it('should select range from first to third category (forward)', () => {
      service.selectRange(catId('1'), catId('3'));

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.selectedCategories()).toContain(catId('1'));
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('3'));
    });

    it('should select range from third to first category (backward)', () => {
      service.selectRange(catId('3'), catId('1'));

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.selectedCategories()).toContain(catId('1'));
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('3'));
    });

    it('should select single category when from and to are the same', () => {
      service.selectRange(catId('2'), catId('2'));

      expect(service.selectedCategories()).toHaveLength(1);
      expect(service.selectedCategories()).toContain(catId('2'));
    });

    it('should preserve existing selections when selecting range', () => {
      // Pre-select category 5
      service.selectCategory(catId('5'));

      // Select range 1-3
      service.selectRange(catId('1'), catId('3'));

      // Should have 1, 2, 3, and 5 selected
      expect(service.selectedCategories()).toHaveLength(4);
      expect(service.selectedCategories()).toContain(catId('1'));
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('3'));
      expect(service.selectedCategories()).toContain(catId('5'));
    });

    it('should not duplicate selections when ranges overlap', () => {
      // Select range 1-3
      service.selectRange(catId('1'), catId('3'));

      // Select range 2-4 (overlaps with 2, 3)
      service.selectRange(catId('2'), catId('4'));

      // Should have 1, 2, 3, 4 selected (no duplicates)
      expect(service.selectedCategories()).toHaveLength(4);
      expect(service.selectedCategories()).toContain(catId('1'));
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('3'));
      expect(service.selectedCategories()).toContain(catId('4'));
    });

    it('should do nothing when fromId is not in visible categories', () => {
      service.selectRange(catId('not-visible'), catId('3'));

      expect(service.selectedCategories()).toHaveLength(0);
    });

    it('should do nothing when toId is not in visible categories', () => {
      service.selectRange(catId('1'), catId('not-visible'));

      expect(service.selectedCategories()).toHaveLength(0);
    });

    it('should do nothing when neither ID is in visible categories', () => {
      service.selectRange(catId('not-visible-1'), catId('not-visible-2'));

      expect(service.selectedCategories()).toHaveLength(0);
    });

    it('should select full range from first to last', () => {
      service.selectRange(catId('1'), catId('5'));

      expect(service.selectedCategories()).toHaveLength(5);
    });
  });

  describe('shift+click workflow simulation', () => {
    beforeEach(() => {
      // Set up visible categories in order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
      const visibleIds = Array.from({ length: 10 }, (_, i) => catId(String(i + 1)));
      service.setVisibleCategoryIds(visibleIds);
    });

    it('should simulate: click 1, shift+click 5 (select 1-5)', () => {
      // User clicks on category 1 (normal click - single select)
      service.deselectAllCategories();
      service.selectCategory(catId('1'));
      service.setLastClickedCategoryId(catId('1'));

      // User shift+clicks on category 5
      service.selectRange(catId('1'), catId('5'));
      service.setLastClickedCategoryId(catId('5'));

      expect(service.selectedCategories()).toHaveLength(5);
      expect(service.selectedCategories()).toContain(catId('1'));
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('3'));
      expect(service.selectedCategories()).toContain(catId('4'));
      expect(service.selectedCategories()).toContain(catId('5'));
    });

    it('should simulate: click 5, shift+click 10, shift+click 1 (select all 1-10)', () => {
      // User clicks on category 5 (normal click)
      service.deselectAllCategories();
      service.selectCategory(catId('5'));
      service.setLastClickedCategoryId(catId('5'));

      // User shift+clicks on category 10 (select 5-10)
      service.selectRange(catId('5'), catId('10'));
      service.setLastClickedCategoryId(catId('10'));

      expect(service.selectedCategories()).toHaveLength(6); // 5, 6, 7, 8, 9, 10

      // User shift+clicks on category 1 (select 1-10, keeping 5-10)
      service.selectRange(catId('10'), catId('1'));
      service.setLastClickedCategoryId(catId('1'));

      expect(service.selectedCategories()).toHaveLength(10);
      for (let i = 1; i <= 10; i++) {
        expect(service.selectedCategories()).toContain(catId(String(i)));
      }
    });

    it('should simulate: click 3, shift+click 7, then shift+click 1 (keeps all selected)', () => {
      // User clicks on category 3
      service.deselectAllCategories();
      service.selectCategory(catId('3'));
      service.setLastClickedCategoryId(catId('3'));

      // User shift+clicks on category 7 (select 3-7)
      service.selectRange(catId('3'), catId('7'));
      service.setLastClickedCategoryId(catId('7'));

      expect(service.selectedCategories()).toHaveLength(5); // 3, 4, 5, 6, 7

      // User shift+clicks on category 1 (select 1-7, range is from last clicked 7 to 1)
      service.selectRange(catId('7'), catId('1'));
      service.setLastClickedCategoryId(catId('1'));

      // All categories from 1 to 7 should be selected
      expect(service.selectedCategories()).toHaveLength(7);
      for (let i = 1; i <= 7; i++) {
        expect(service.selectedCategories()).toContain(catId(String(i)));
      }
    });

    it('should simulate: toggle checkbox (no shift), then shift+click', () => {
      // User toggles checkbox on category 2 (no shift - toggle single)
      service.toggleCategory(catId('2'));
      service.setLastClickedCategoryId(catId('2'));

      expect(service.selectedCategories()).toHaveLength(1);
      expect(service.selectedCategories()).toContain(catId('2'));

      // User toggles checkbox on category 5 (no shift - toggle single, adds to selection)
      service.toggleCategory(catId('5'));
      service.setLastClickedCategoryId(catId('5'));

      expect(service.selectedCategories()).toHaveLength(2);
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('5'));

      // User shift+clicks checkbox on category 8 (range from 5 to 8)
      service.selectRange(catId('5'), catId('8'));
      service.setLastClickedCategoryId(catId('8'));

      // Should have 2, and 5-8
      expect(service.selectedCategories()).toHaveLength(5);
      expect(service.selectedCategories()).toContain(catId('2'));
      expect(service.selectedCategories()).toContain(catId('5'));
      expect(service.selectedCategories()).toContain(catId('6'));
      expect(service.selectedCategories()).toContain(catId('7'));
      expect(service.selectedCategories()).toContain(catId('8'));
    });
  });

  describe('group selection', () => {
    beforeEach(() => {
      mockCategoryService.categoryHierarchy.set([
        {
          group: { _id: 'group_1', name: 'Group 1', isDeleted: false },
          categories: [
            { _id: catId('1'), name: 'Cat 1', isDeleted: false },
            { _id: catId('2'), name: 'Cat 2', isDeleted: false },
            { _id: catId('3'), name: 'Cat 3', isDeleted: false },
          ],
        },
        {
          group: { _id: 'group_2', name: 'Group 2', isDeleted: false },
          categories: [
            { _id: catId('4'), name: 'Cat 4', isDeleted: false },
            { _id: catId('5'), name: 'Cat 5', isDeleted: false },
          ],
        },
      ]);
    });

    it('should check if group is fully selected', () => {
      expect(service.isGroupFullySelected('group_1')()).toBe(false);

      service.selectAllCategories([catId('1'), catId('2'), catId('3')]);

      expect(service.isGroupFullySelected('group_1')()).toBe(true);
      expect(service.isGroupFullySelected('group_2')()).toBe(false);
    });

    it('should check if group is partially selected', () => {
      expect(service.isGroupPartiallySelected('group_1')()).toBe(false);

      service.selectCategory(catId('1'));

      expect(service.isGroupPartiallySelected('group_1')()).toBe(true);

      service.selectAllCategories([catId('2'), catId('3')]);

      expect(service.isGroupPartiallySelected('group_1')()).toBe(false); // Now fully selected
    });

    it('should get correct checkbox state for group', () => {
      expect(service.getGroupCheckboxState('group_1')()).toBe(false);

      service.selectCategory(catId('1'));

      expect(service.getGroupCheckboxState('group_1')()).toBe('indeterminate');

      service.selectAllCategories([catId('2'), catId('3')]);

      expect(service.getGroupCheckboxState('group_1')()).toBe(true);
    });

    it('should select all categories in a group', () => {
      const groupCategories = [catId('1'), catId('2'), catId('3')];

      service.selectGroupCategories('group_1', groupCategories);

      expect(service.selectedCategories()).toHaveLength(3);
      expect(service.isGroupFullySelected('group_1')()).toBe(true);
    });

    it('should deselect all categories in a group', () => {
      service.selectAllCategories([catId('1'), catId('2'), catId('3'), catId('4')]);

      service.deselectGroupCategories('group_1');

      expect(service.selectedCategories()).toHaveLength(1);
      expect(service.selectedCategories()).toContain(catId('4'));
    });

    it('should toggle group categories', () => {
      const groupCategories = [catId('1'), catId('2'), catId('3')];

      // Toggle on (not fully selected -> select all)
      service.toggleGroupCategories('group_1', groupCategories);

      expect(service.isGroupFullySelected('group_1')()).toBe(true);

      // Toggle off (fully selected -> deselect all)
      service.toggleGroupCategories('group_1', groupCategories);

      expect(service.isGroupFullySelected('group_1')()).toBe(false);
      expect(service.selectedCategories()).toHaveLength(0);
    });
  });

  describe('isAllSelected and isSomeSelected', () => {
    beforeEach(() => {
      mockCategoryService.categoryHierarchy.set([
        {
          group: { _id: 'group_1', name: 'Group 1', isDeleted: false },
          categories: [
            { _id: catId('1'), name: 'Cat 1', isDeleted: false },
            { _id: catId('2'), name: 'Cat 2', isDeleted: false },
          ],
        },
      ]);
    });

    it('should return false for isAllSelected when nothing selected', () => {
      expect(service.isAllSelected()).toBe(false);
    });

    it('should return false for isSomeSelected when nothing selected', () => {
      expect(service.isSomeSelected()).toBe(false);
    });

    it('should return true for isSomeSelected when partially selected', () => {
      service.selectCategory(catId('1'));

      expect(service.isSomeSelected()).toBe(true);
      expect(service.isAllSelected()).toBe(false);
    });

    it('should return true for isAllSelected when all selected', () => {
      service.selectAllCategories([catId('1'), catId('2')]);

      expect(service.isAllSelected()).toBe(true);
      expect(service.isSomeSelected()).toBe(false);
    });
  });

  describe('getAllCategoryIds', () => {
    it('should return all non-deleted category IDs from hierarchy', () => {
      mockCategoryService.categoryHierarchy.set([
        {
          group: { _id: 'group_1', name: 'Group 1', isDeleted: false },
          categories: [
            { _id: catId('1'), name: 'Cat 1', isDeleted: false },
            { _id: catId('2'), name: 'Cat 2', isDeleted: true },
            { _id: catId('3'), name: 'Cat 3', isDeleted: false },
          ],
        },
        {
          group: { _id: 'group_2', name: 'Group 2', isDeleted: true },
          categories: [{ _id: catId('4'), name: 'Cat 4', isDeleted: false }],
        },
      ]);

      const allIds = service.getAllCategoryIds();

      expect(allIds).toHaveLength(2);
      expect(allIds).toContain(catId('1'));
      expect(allIds).toContain(catId('3'));
      expect(allIds).not.toContain(catId('2')); // Deleted category
      expect(allIds).not.toContain(catId('4')); // In deleted group
    });
  });
});
