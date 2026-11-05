import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { PlannedMonthEntryView } from '../../services/planned-transaction.service';
import { PlannedCalendarViewComponent } from './planned-calendar-view';

describe('PlannedCalendarViewComponent', () => {
  it('falls back to the live merchant name when the planned projection omits it', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        {
          provide: MerchantService,
          useValue: {
            merchants: signal([{ _id: 'merchant-1', name: 'Coffee Shop', logoUrl: 'https://example.com/logo.png' }]),
          },
        },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new PlannedCalendarViewComponent());
    const view = {
      base: { merchantId: 'merchant-1', merchantName: undefined },
      entry: { isTransfer: false },
    } as PlannedMonthEntryView;

    expect(component.displayName(view)).toBe('Coffee Shop');
  });

  it('emits the selected action with the planned transaction', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        { provide: MerchantService, useValue: { merchants: signal([]) } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new PlannedCalendarViewComponent());
    const emitted = vi.fn();
    component.action.subscribe(emitted);
    const view = { base: { _id: 'scheduled-1' } } as PlannedMonthEntryView;

    component.onAction('pause', view);

    expect(emitted).toHaveBeenCalledWith({ action: 'pause', planned: view.base });
  });

  it.each([
    { status: 'paid', date: '2026-09-16', scheduleStatus: 'active' },
    { status: 'skipped', date: '2026-09-16', scheduleStatus: 'active' },
    { status: 'upcoming', date: '2026-10-16', scheduleStatus: 'active' },
    { status: 'upcoming', date: '2026-09-16', scheduleStatus: 'paused' },
  ])('does not enter or skip a $status occurrence on $date ($scheduleStatus)', ({ status, date, scheduleStatus }) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        { provide: MerchantService, useValue: { merchants: signal([]) } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new PlannedCalendarViewComponent());
    const emitted = vi.fn();
    component.action.subscribe(emitted);
    const view = {
      base: { _id: 'scheduled-1', status: scheduleStatus, nextDate: '2026-09-16' },
      entry: { occurrenceDate: date, coverage: { status } },
    } as PlannedMonthEntryView;

    component.onAction('enter', view);
    component.onAction('skip', view);

    expect(component.canActOnOccurrence(view)).toBe(false);
    expect(emitted).not.toHaveBeenCalled();
  });

  it.each(['upcoming', 'overdue'])('allows entering the current %s occurrence', (status) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        { provide: MerchantService, useValue: { merchants: signal([]) } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new PlannedCalendarViewComponent());
    const emitted = vi.fn();
    component.action.subscribe(emitted);
    const view = {
      base: { _id: 'scheduled-1', status: 'active', nextDate: '2026-09-16' },
      entry: { occurrenceDate: '2026-09-16', coverage: { status } },
    } as PlannedMonthEntryView;

    component.onAction('enter', view);

    expect(emitted).toHaveBeenCalledWith({ action: 'enter', planned: view.base });
  });
});
