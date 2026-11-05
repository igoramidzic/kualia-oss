import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';
import { CurrentMonthService } from '../../services/current-month.service';
import { Split, TransactionSplitsComponent } from './transaction-splits.component';

describe('TransactionSplitsComponent', () => {
  let component: TransactionSplitsComponent;
  let fixture: ComponentFixture<TransactionSplitsComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [TransactionSplitsComponent],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            categories: signal([]),
            activeGroups: signal([]),
          },
        },
        {
          provide: BudgetService,
          useValue: {
            months: signal([]),
            readyToAssign: signal(0n),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            currencyCode: signal('USD'),
            format: (amount: bigint) =>
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
              }).format(Number(amount) / 100),
          },
        },
        {
          provide: CurrentMonthService,
          useValue: {
            currentYearMonth: signal(202606),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(TransactionSplitsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactionAmount', 5000n);
    fixture.componentRef.setInput('splits', []);
    fixture.componentRef.setInput('initialSplits', []);
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should expose icons', () => {
      expect(component.PlusIcon).toBeDefined();
      expect(component.XIcon).toBeDefined();
      expect(component.SplitIcon).toBeDefined();
    });

    it('should expose Number constructor', () => {
      expect(component.Number).toBe(Number);
    });
  });

  describe('computed values', () => {
    describe('splitsSum', () => {
      it('should calculate sum of all splits', () => {
        const splits: Split[] = [
          { amount: 1000n, categoryId: 'cat1' },
          { amount: 2000n, categoryId: 'cat2' },
          { amount: 3000n, categoryId: 'cat3' },
        ];

        fixture.componentRef.setInput('transactionAmount', 6000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.splitsSum()).toBe(6000n);
      });

      it('should return 0n for empty splits array', () => {
        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', []);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.splitsSum()).toBe(0n);
      });

      it('should handle negative amounts in splits', () => {
        const splits: Split[] = [
          { amount: -1000n, categoryId: 'cat1' },
          { amount: 2000n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 1000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.splitsSum()).toBe(1000n);
      });
    });

    describe('remainingAmount', () => {
      it('should calculate remaining amount when under-allocated', () => {
        const splits: Split[] = [
          { amount: 1000n, categoryId: 'cat1' },
          { amount: 2000n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(2000n); // 5000 - 3000
      });

      it('should return 0n when fully allocated', () => {
        const splits: Split[] = [
          { amount: 2500n, categoryId: 'cat1' },
          { amount: 2500n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(0n);
      });

      it('should return negative when over-allocated', () => {
        const splits: Split[] = [
          { amount: 3000n, categoryId: 'cat1' },
          { amount: 3000n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(-1000n); // 5000 - 6000
      });

      it('should calculate remaining amount from absolute values for outflows', () => {
        const splits: Split[] = [
          { amount: -2500n, categoryId: 'cat1' },
          { amount: -2500n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', -5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(0n);
        expect(component.isValid()).toBe(true);
      });

      it('should treat smaller outflow split totals as under-allocated', () => {
        const splits: Split[] = [{ amount: -3000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', -5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(2000n);
        expect(component.isUnderAllocated()).toBe(true);
        expect(component.isOverAllocated()).toBe(false);
      });
    });

    describe('isValid', () => {
      it('should return true when splits are valid', () => {
        const splits: Split[] = [
          { amount: 2500n, categoryId: 'cat1' },
          { amount: 2500n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isValid()).toBe(true);
      });

      it('should return false when splits array is empty', () => {
        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', []);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isValid()).toBe(false);
      });

      it('should return false when remaining amount is not zero', () => {
        const splits: Split[] = [
          { amount: 2000n, categoryId: 'cat1' },
          { amount: 2000n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isValid()).toBe(false);
      });

      it('should return false when any split has zero amount', () => {
        const splits: Split[] = [
          { amount: 5000n, categoryId: 'cat1' },
          { amount: 0n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isValid()).toBe(false);
      });

      it('should return false when over-allocated', () => {
        const splits: Split[] = [
          { amount: 3000n, categoryId: 'cat1' },
          { amount: 3000n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isValid()).toBe(false);
      });

      it('should return false when a split sign does not match the transaction sign', () => {
        const splits: Split[] = [
          { amount: -2500n, categoryId: 'cat1' },
          { amount: 2500n, categoryId: 'cat2' },
        ];

        fixture.componentRef.setInput('transactionAmount', -5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmount()).toBe(0n);
        expect(component.isValid()).toBe(false);
      });
    });

    describe('isOverAllocated and isUnderAllocated', () => {
      it('should detect over-allocation', () => {
        const splits: Split[] = [{ amount: 6000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isOverAllocated()).toBe(true);
        expect(component.isUnderAllocated()).toBe(false);
      });

      it('should detect under-allocation', () => {
        const splits: Split[] = [{ amount: 3000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isOverAllocated()).toBe(false);
        expect(component.isUnderAllocated()).toBe(true);
      });

      it('should detect full allocation', () => {
        const splits: Split[] = [{ amount: 5000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.isOverAllocated()).toBe(false);
        expect(component.isUnderAllocated()).toBe(false);
      });
    });

    describe('remainingAmountText', () => {
      it('should show "Over by" text when over-allocated', () => {
        const splits: Split[] = [{ amount: 6000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmountText()).toContain('Over by');
        expect(component.remainingAmountText()).toContain('$10.00');
      });

      it('should show "Remaining" text when under-allocated', () => {
        const splits: Split[] = [{ amount: 3000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmountText()).toContain('Remaining');
        expect(component.remainingAmountText()).toContain('$20.00');
      });

      it('should show "Fully allocated" when amount matches', () => {
        const splits: Split[] = [{ amount: 5000n, categoryId: 'cat1' }];

        fixture.componentRef.setInput('transactionAmount', 5000n);
        fixture.componentRef.setInput('splits', splits);
        fixture.componentRef.setInput('initialSplits', []);
        fixture.detectChanges();

        expect(component.remainingAmountText()).toBe('Fully allocated');
      });
    });
  });

  describe('event handlers', () => {
    describe('onCategoryChange', () => {
      it('should emit updateSplitCategory with regular category', () => {
        const emitSpy = vi.fn();
        component.updateSplitCategory.subscribe(emitSpy);

        component.onCategoryChange(0, 'category-123');

        expect(emitSpy).toHaveBeenCalledWith({
          index: 0,
          categoryId: 'category-123',
          readyToAssign: false,
        });
      });

      it('should emit updateSplitCategory with ready-to-assign', () => {
        const emitSpy = vi.fn();
        component.updateSplitCategory.subscribe(emitSpy);

        component.onCategoryChange(1, 'ready-to-assign');

        expect(emitSpy).toHaveBeenCalledWith({
          index: 1,
          categoryId: null,
          readyToAssign: true,
        });
      });

      it('should emit updateSplitCategory with null category', () => {
        const emitSpy = vi.fn();
        component.updateSplitCategory.subscribe(emitSpy);

        component.onCategoryChange(2, null);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 2,
          categoryId: null,
          readyToAssign: false,
        });
      });
    });

    describe('onAmountChange', () => {
      it('should emit updateSplitAmount with bigint value', () => {
        const emitSpy = vi.fn();
        component.updateSplitAmount.subscribe(emitSpy);

        component.onAmountChange(0, 5000);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 0,
          amount: 5000n,
        });
      });

      it('should emit outflow split amounts as negative values', () => {
        const emitSpy = vi.fn();
        component.updateSplitAmount.subscribe(emitSpy);
        fixture.componentRef.setInput('transactionAmount', -5000n);

        component.onAmountChange(0, 2500);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 0,
          amount: -2500n,
        });
      });

      it('should use the explicit amount sign when the transaction amount is zero', () => {
        const emitSpy = vi.fn();
        component.updateSplitAmount.subscribe(emitSpy);
        fixture.componentRef.setInput('transactionAmount', 0n);
        fixture.componentRef.setInput('amountSign', 'outflow');

        component.onAmountChange(0, 2500);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 0,
          amount: -2500n,
        });
      });

      it('should handle zero amount', () => {
        const emitSpy = vi.fn();
        component.updateSplitAmount.subscribe(emitSpy);

        component.onAmountChange(1, 0);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 1,
          amount: 0n,
        });
      });

      it('should remove manually entered negative signs before applying the transaction sign', () => {
        const emitSpy = vi.fn();
        component.updateSplitAmount.subscribe(emitSpy);
        fixture.componentRef.setInput('transactionAmount', -5000n);

        component.onAmountChange(2, -1000);

        expect(emitSpy).toHaveBeenCalledWith({
          index: 2,
          amount: -1000n,
        });
      });
    });

    describe('onAddSplitWithCategory', () => {
      it('should emit addSplit event with regular category', () => {
        const emitSpy = vi.fn();
        component.addSplit.subscribe(emitSpy);

        component.onAddSplitWithCategory('category-123');

        expect(emitSpy).toHaveBeenCalledWith({
          categoryId: 'category-123',
          readyToAssign: false,
        });
      });

      it('should emit addSplit event with ready-to-assign', () => {
        const emitSpy = vi.fn();
        component.addSplit.subscribe(emitSpy);

        component.onAddSplitWithCategory('ready-to-assign');

        expect(emitSpy).toHaveBeenCalledWith({
          categoryId: null,
          readyToAssign: true,
        });
      });

      it('should not emit when category is null', () => {
        const emitSpy = vi.fn();
        component.addSplit.subscribe(emitSpy);

        component.onAddSplitWithCategory(null);

        expect(emitSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('formatCurrency', () => {
    it('should format positive amounts correctly', () => {
      expect(component.formatCurrency(5000n)).toBe('$50.00');
      expect(component.formatCurrency(12345n)).toBe('$123.45');
      expect(component.formatCurrency(100n)).toBe('$1.00');
    });

    it('should format zero correctly', () => {
      expect(component.formatCurrency(0n)).toBe('$0.00');
    });

    it('should format negative amounts correctly', () => {
      expect(component.formatCurrency(-5000n)).toBe('-$50.00');
      expect(component.formatCurrency(-12345n)).toBe('-$123.45');
    });

    it('should handle large amounts', () => {
      expect(component.formatCurrency(1000000n)).toBe('$10,000.00');
      expect(component.formatCurrency(123456789n)).toBe('$1,234,567.89');
    });
  });

  describe('displaySplitAmount', () => {
    it('should display split amounts without their stored sign', () => {
      expect(component.displaySplitAmount({ amount: -5000n })).toBe(5000);
      expect(component.displaySplitAmount({ amount: 5000n })).toBe(5000);
    });

    it('should display empty split amounts as null', () => {
      expect(component.displaySplitAmount({})).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should handle a complete split transaction workflow', () => {
      const splits: Split[] = [
        { amount: 2500n, categoryId: 'cat1' },
        { amount: 1500n, categoryId: 'cat2' },
        { amount: 1000n, readyToAssign: true },
      ];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      // Verify calculations
      expect(component.splitsSum()).toBe(5000n);
      expect(component.remainingAmount()).toBe(0n);
      expect(component.isValid()).toBe(true);
      expect(component.remainingAmountText()).toBe('Fully allocated');
    });

    it('should invalidate when a split amount becomes zero', () => {
      const splits: Split[] = [
        { amount: 5000n, categoryId: 'cat1' },
        { amount: 0n, categoryId: 'cat2' },
      ];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      expect(component.isValid()).toBe(false);
      expect(component.splitsSum()).toBe(5000n);
      expect(component.remainingAmount()).toBe(0n);
    });

    it('should handle single split equaling transaction amount', () => {
      const splits: Split[] = [{ amount: 5000n, categoryId: 'cat1' }];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      expect(component.isValid()).toBe(true);
      expect(component.remainingAmountText()).toBe('Fully allocated');
    });

    it('should handle multiple splits with ready-to-assign', () => {
      const splits: Split[] = [
        { amount: 2000n, categoryId: 'cat1' },
        { amount: 2000n, readyToAssign: true },
        { amount: 1000n, categoryId: 'cat2' },
      ];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      expect(component.splitsSum()).toBe(5000n);
      expect(component.isValid()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very large transaction amounts', () => {
      const splits: Split[] = [
        { amount: 1000000000n, categoryId: 'cat1' }, // $10,000,000.00
      ];

      fixture.componentRef.setInput('transactionAmount', 1000000000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      expect(component.splitsSum()).toBe(1000000000n);
      expect(component.isValid()).toBe(true);
    });

    it('should handle splits with undefined categoryId', () => {
      const splits: Split[] = [{ amount: 5000n }];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', splits);
      fixture.componentRef.setInput('initialSplits', []);
      fixture.detectChanges();

      expect(component.isValid()).toBe(true);
    });

    it('should recalculate when splits array reference changes', () => {
      const initialSplits: Split[] = [{ amount: 3000n, categoryId: 'cat1' }];

      fixture.componentRef.setInput('transactionAmount', 5000n);
      fixture.componentRef.setInput('splits', initialSplits);
      fixture.componentRef.setInput('initialSplits', initialSplits);
      fixture.detectChanges();

      expect(component.splitsSum()).toBe(3000n);
      expect(component.isUnderAllocated()).toBe(true);

      // Update with new array reference
      const updatedSplits: Split[] = [
        { amount: 2500n, categoryId: 'cat1' },
        { amount: 2500n, categoryId: 'cat2' },
      ];

      fixture.componentRef.setInput('splits', updatedSplits);
      fixture.detectChanges();

      expect(component.splitsSum()).toBe(5000n);
      expect(component.isValid()).toBe(true);
    });
  });
});
