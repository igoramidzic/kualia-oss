import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionDatePickerComponent } from './transaction-date-picker.component';

describe('TransactionDatePickerComponent', () => {
  let fixture: ComponentFixture<TransactionDatePickerComponent>;
  let component: TransactionDatePickerComponent;
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

  beforeAll(() => {
    // jsdom does not implement scrolling used by the select's keyboard navigation.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterAll(() => {
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [TransactionDatePickerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionDatePickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('date', new Date(2026, 6, 9));
  });

  it('ignores an empty calendar selection without emitting an invalid date', () => {
    const emitted: Date[] = [];
    component.dateChange.subscribe((date) => emitted.push(date));
    component.popoverState.set('open');

    component.onCalendarDateChange(undefined);

    expect(emitted).toEqual([]);
    expect(component.popoverState()).toBe('closed');
  });

  it('emits a valid calendar date and closes the popover', () => {
    const emitted: Date[] = [];
    const selectedDate = new Date(2026, 6, 10);
    component.dateChange.subscribe((date) => emitted.push(date));
    component.popoverState.set('open');

    component.onCalendarDateChange(selectedDate);

    expect(emitted).toEqual([selectedDate]);
    expect(component.popoverState()).toBe('closed');
  });

  it('emits recurrence changes without closing the popover', () => {
    const emitted: string[] = [];
    component.recurrenceChange.subscribe((recurrence) => emitted.push(recurrence));
    component.popoverState.set('open');

    component.onRecurrenceChange('monthly');

    expect(emitted).toEqual(['monthly']);
    expect(component.popoverState()).toBe('open');
  });

  it('renders the frequency choices in a themed select and emits the selected recurrence', async () => {
    const emitted: string[] = [];
    component.recurrenceChange.subscribe((recurrence) => emitted.push(recurrence));
    fixture.componentRef.setInput('showRecurrence', true);
    fixture.componentRef.setInput('recurrence', 'every_three_weeks');
    component.popoverState.set('open');
    await fixture.whenStable();

    const trigger = document.getElementById(component.recurrenceSelectId);
    expect(trigger?.tagName).toBe('BUTTON');
    expect(trigger?.textContent).toContain('Every 3 weeks');
    trigger?.click();
    await fixture.whenStable();

    const menu = document.querySelector('hlm-select-content');
    expect(menu?.classList.contains('bg-popover')).toBe(true);
    expect(menu?.classList.contains('text-popover-foreground')).toBe(true);
    const options = Array.from(menu?.querySelectorAll<HTMLElement>('hlm-select-item') ?? []);
    expect(options).toHaveLength(14);
    const monthly = options.find((option) => option.textContent?.trim() === 'Monthly');
    expect(monthly).toBeDefined();
    monthly?.click();
    await fixture.whenStable();

    expect(emitted).toEqual(['monthly']);
    expect(component.popoverState()).toBe('open');
  });

  it('ignores empty select values', () => {
    const emitted: string[] = [];
    component.recurrenceChange.subscribe((recurrence) => emitted.push(recurrence));

    component.onRecurrenceChange(null);
    component.onRecurrenceChange(undefined);

    expect(emitted).toEqual([]);
  });

  it('emits make recurring and closes the popover', () => {
    let emitted = false;
    component.makeRecurring.subscribe(() => {
      emitted = true;
    });
    component.popoverState.set('open');

    component.onMakeRecurringClick();

    expect(emitted).toBe(true);
    expect(component.popoverState()).toBe('closed');
  });
});
