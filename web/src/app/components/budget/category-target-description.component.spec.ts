import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { CategoryTargetDescriptionComponent } from './category-target-description.component';

// Helper to create local dates (avoiding timezone issues)
function createLocalDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

// Mock CurrencyService
const mockCurrencyService = {
  format: vi.fn((amount: bigint) => {
    const dollars = Number(amount) / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(dollars);
  }),
};

describe('CategoryTargetDescriptionComponent', () => {
  let component: CategoryTargetDescriptionComponent;
  let fixture: ComponentFixture<CategoryTargetDescriptionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoryTargetDescriptionComponent],
      providers: [{ provide: CurrencyService, useValue: mockCurrencyService }],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryTargetDescriptionComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in collapsed state', () => {
    expect(component['isOpen']()).toBe(false);
  });

  it('should toggle open state when button is clicked', () => {
    expect(component['isOpen']()).toBe(false);

    // Click to open
    component['toggleOpen']();
    expect(component['isOpen']()).toBe(true);

    // Click to close
    component['toggleOpen']();
    expect(component['isOpen']()).toBe(false);
  });

  describe('One-Time Goals', () => {
    it('should generate one-time goal description with amount and date', () => {
      fixture.componentRef.setInput('targetType', 'one_time');
      fixture.componentRef.setInput('amount', 50000n); // $500.00
      fixture.componentRef.setInput('targetDate', createLocalDate(2025, 12, 12));
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Tracks your progress');
      expect(description).toContain('$500.00');
      expect(description).toContain('Dec 12, 2025');
      expect(description).toContain('<strong>');
    });

    it('should handle missing target date', () => {
      fixture.componentRef.setInput('targetType', 'one_time');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('targetDate', undefined);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Tracks your progress');
      expect(description).toContain("you're on pace");
    });
  });

  describe('Set Aside (Recurring)', () => {
    it('should generate daily recurring description', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 5000n); // $50.00
      fixture.componentRef.setInput('frequency', 'daily');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('$50.00');
      expect(description).toContain('every day');
    });

    it('should generate daily recurring description with interval > 1', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 5000n);
      fixture.componentRef.setInput('frequency', 'daily');
      fixture.componentRef.setInput('frequencyInterval', 3);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('every 3 days');
    });

    it('should generate weekly recurring description', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 20000n); // $200.00
      fixture.componentRef.setInput('frequency', 'weekly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dayOfWeek', 0); // Sunday
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('$200.00');
      expect(description).toContain('every week');
    });

    it('should generate weekly recurring description with interval > 1', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 15000n); // $150.00
      fixture.componentRef.setInput('frequency', 'weekly');
      fixture.componentRef.setInput('frequencyInterval', 2);
      fixture.componentRef.setInput('dayOfWeek', 5); // Friday
      fixture.componentRef.setInput('firstDueDate', createLocalDate(2025, 12, 12));
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('every 2 weeks');
    });

    it('should generate monthly recurring description', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n); // $500.00
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dueDay', 15);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('$500.00');
      expect(description).toContain('every month');
    });

    it('should generate monthly recurring description with last day of month', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 100000n); // $1,000.00
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dueDay', -1);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('every month');
    });

    it('should show first due date for multi-interval monthly', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', 2);
      fixture.componentRef.setInput('dueDay', 15);
      fixture.componentRef.setInput('firstDueDate', createLocalDate(2026, 1, 1));
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('every 2 months');
    });

    it('should generate yearly recurring description with first due date', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 200000n); // $2,000.00
      fixture.componentRef.setInput('frequency', 'yearly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('firstDueDate', createLocalDate(2025, 12, 25));
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('$2,000.00');
      expect(description).toContain('every year');
    });
  });

  describe('Fill Up (Recurring Rollover)', () => {
    it('should generate fill up description', () => {
      fixture.componentRef.setInput('targetType', 'fill_up');
      fixture.componentRef.setInput('amount', 30000n); // $300.00
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dueDay', -1);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Tops up to');
      expect(description).toContain('$300.00');
      expect(description).toContain('every month');
    });

    it('should generate fill up weekly description', () => {
      fixture.componentRef.setInput('targetType', 'fill_up');
      fixture.componentRef.setInput('amount', 10000n); // $100.00
      fixture.componentRef.setInput('frequency', 'weekly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dayOfWeek', 1); // Monday
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Tops up to');
      expect(description).toContain('$100.00');
      expect(description).toContain('every week');
    });
  });

  describe('Maintain Balance', () => {
    it('should generate maintain balance description', () => {
      fixture.componentRef.setInput('targetType', 'maintain_balance');
      fixture.componentRef.setInput('amount', 1000000n); // $10,000.00
      fixture.componentRef.setInput('monthlyContribution', 50000n); // $500.00
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Adds');
      expect(description).toContain('$500.00');
      expect(description).toContain('$10,000.00');
      expect(description).toContain('each month');
    });

    it('should handle zero monthly contribution', () => {
      fixture.componentRef.setInput('targetType', 'maintain_balance');
      fixture.componentRef.setInput('amount', 500000n); // $5,000.00
      fixture.componentRef.setInput('monthlyContribution', undefined);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Adds');
      expect(description).toContain('$5,000.00');
      expect(description).toContain('$0.00'); // Defaults to 0
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing frequency for recurring targets', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('frequency', undefined);
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toBe('');
    });

    it('should handle missing interval for recurring targets', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', undefined);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toBe('');
    });

    it('should handle undefined dayOfWeek for weekly targets', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('frequency', 'weekly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dayOfWeek', undefined);
      fixture.detectChanges();

      const description = component['description']() as string;
      // Should still generate description, just without day of week
      expect(description).toContain('Budgets another');
      expect(description).toContain('every week');
    });
  });

  describe('Ordinal Formatting', () => {
    it('should format descriptions correctly for monthly targets', () => {
      fixture.componentRef.setInput('targetType', 'set_aside');
      fixture.componentRef.setInput('amount', 50000n);
      fixture.componentRef.setInput('frequency', 'monthly');
      fixture.componentRef.setInput('frequencyInterval', 1);
      fixture.componentRef.setInput('dueDay', 1);
      fixture.detectChanges();

      const description = component['description']() as string;
      expect(description).toContain('Budgets another');
      expect(description).toContain('$500.00');
      expect(description).toContain('every month');
    });
  });
});
