import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { PlannedBaseTransaction } from '../../services/planned-transaction.service';
import { PlannedTransactionRowComponent } from './planned-transaction-row';

describe('PlannedTransactionRowComponent', () => {
  it('falls back to the live merchant name when the planned projection omits it', () => {
    TestBed.configureTestingModule({
      imports: [PlannedTransactionRowComponent],
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
    const fixture = TestBed.createComponent(PlannedTransactionRowComponent);
    fixture.componentRef.setInput('base', {
      merchantId: 'merchant-1',
      merchantName: undefined,
      transactionType: 'regular',
    });

    expect(fixture.componentInstance.displayName()).toBe('Coffee Shop');
  });

  it('emits a context-menu action for the row schedule', () => {
    TestBed.configureTestingModule({
      imports: [PlannedTransactionRowComponent],
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        { provide: MerchantService, useValue: { merchants: signal([]) } },
      ],
    });
    const fixture = TestBed.createComponent(PlannedTransactionRowComponent);
    const base = { _id: 'scheduled-1' } as PlannedBaseTransaction;
    fixture.componentRef.setInput('base', base);
    const emitted = vi.fn();
    fixture.componentInstance.action.subscribe(emitted);

    fixture.componentInstance.onAction('delete');

    expect(emitted).toHaveBeenCalledWith({ action: 'delete', planned: base });
  });

  it('only enters or skips the current unpaid occurrence', () => {
    TestBed.configureTestingModule({
      imports: [PlannedTransactionRowComponent],
      providers: [
        { provide: CurrencyService, useValue: { format: () => '$10.00' } },
        { provide: MerchantService, useValue: { merchants: signal([]) } },
      ],
    });
    const fixture = TestBed.createComponent(PlannedTransactionRowComponent);
    const base = { _id: 'scheduled-1', status: 'active', nextDate: '2026-09-16' } as PlannedBaseTransaction;
    fixture.componentRef.setInput('base', base);
    fixture.componentRef.setInput('entry', { occurrenceDate: '2026-10-16', coverage: { status: 'upcoming' } });
    const emitted = vi.fn();
    fixture.componentInstance.action.subscribe(emitted);

    fixture.componentInstance.onAction('enter');
    fixture.componentInstance.onAction('skip');
    expect(emitted).not.toHaveBeenCalled();

    fixture.componentRef.setInput('entry', { occurrenceDate: '2026-09-16', coverage: { status: 'paid' } });
    fixture.componentInstance.onAction('enter');
    expect(emitted).not.toHaveBeenCalled();

    fixture.componentRef.setInput('entry', { occurrenceDate: '2026-09-16', coverage: { status: 'overdue' } });
    fixture.componentInstance.onAction('enter');
    expect(emitted).toHaveBeenCalledWith({ action: 'enter', planned: base });
  });
});
