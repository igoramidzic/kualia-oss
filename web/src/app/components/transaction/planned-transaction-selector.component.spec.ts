import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService, type Merchant } from '../../services/merchant.service';
import {
  ScheduledTransactionService,
  type ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { PlannedTransactionSelectorComponent } from './planned-transaction-selector.component';

function createPlanned(overrides: Partial<ScheduledTransactionWithRelations> = {}): ScheduledTransactionWithRelations {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: Date.now(),
    workspaceId: 'workspace-1' as Id<'workspace'>,
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    merchantId: 'merchant-1' as Id<'merchant'>,
    entryStatus: 'pending',
    movements: [{ amount: -5000n }],
    recurrence: 'monthly',
    anchorDate: '2026-07-01',
    nextDate: '2026-08-01',
    status: 'active',
    executionCount: 0,
    updatedAt: '2026-07-09T00:00:00.000Z',
    isDeleted: false,
    transactionType: 'regular',
    ...overrides,
  };
}

describe('PlannedTransactionSelectorComponent', () => {
  let fixture: ComponentFixture<PlannedTransactionSelectorComponent>;
  let component: PlannedTransactionSelectorComponent;
  let plannedTransactions: WritableSignal<ScheduledTransactionWithRelations[]>;
  let merchants: WritableSignal<Merchant[]>;

  beforeEach(async () => {
    plannedTransactions = signal<ScheduledTransactionWithRelations[]>([]);
    merchants = signal<Merchant[]>([]);

    await TestBed.configureTestingModule({
      imports: [PlannedTransactionSelectorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ScheduledTransactionService, useValue: { scheduledTransactions: plannedTransactions } },
        { provide: MerchantService, useValue: { merchants } },
        { provide: CurrencyService, useValue: { format: (amount: bigint) => `$${Number(amount) / 100}` } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlannedTransactionSelectorComponent);
    component = fixture.componentInstance;
  });

  it('falls back to the merchant store when the populated payee name is missing', () => {
    merchants.set([
      {
        _id: 'merchant-1' as Id<'merchant'>,
        name: 'Coffee Shop',
      } as Merchant,
    ]);

    expect(component.displayName(createPlanned({ merchantName: undefined }))).toBe('Coffee Shop');
  });

  it('only suggests planned transactions matching the transaction type', () => {
    plannedTransactions.set([
      createPlanned({ _id: 'regular-1' as Id<'scheduledTransaction'> }),
      createPlanned({
        _id: 'transfer-1' as Id<'scheduledTransaction'>,
        transactionType: 'transfer',
        merchantId: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        transferToAccountName: 'Savings',
        movements: [{ amount: 5000n }],
      }),
    ]);
    fixture.componentRef.setInput('transactionType', 'transfer');
    fixture.componentRef.setInput('transactionAmount', -5000n);

    expect(component.matchingPlanned().map((planned) => planned._id)).toEqual(['transfer-1']);
    expect(component.suggestedMatches().map((planned) => planned._id)).toEqual(['transfer-1']);
  });

  it('does not suggest an expense schedule for a refund from the same payee', () => {
    plannedTransactions.set([createPlanned()]);
    fixture.componentRef.setInput('transactionMerchantId', 'merchant-1');
    fixture.componentRef.setInput('transactionAmount', 5000n);

    expect(component.suggestedMatches()).toEqual([]);
    expect(component.matchingPlanned()).toEqual([]);
  });

  it('keeps different-account schedules selectable without suggesting them', () => {
    plannedTransactions.set([createPlanned()]);
    fixture.componentRef.setInput('transactionMerchantId', 'merchant-1');
    fixture.componentRef.setInput('transactionAmount', -5000n);
    fixture.componentRef.setInput('transactionBankAccountId', 'bank-2');

    expect(component.suggestedMatches()).toEqual([]);
    expect(component.filteredPlanned().map((planned) => planned._id)).toEqual(['scheduled-1']);
  });

  it('matches the receiving side of a transfer only to the correct account direction', () => {
    plannedTransactions.set([
      createPlanned({
        transactionType: 'transfer',
        merchantId: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        movements: [{ amount: 5000n }],
      }),
    ]);
    fixture.componentRef.setInput('transactionType', 'transfer');
    fixture.componentRef.setInput('transactionAmount', 5000n);
    fixture.componentRef.setInput('transactionBankAccountId', 'bank-2');
    fixture.componentRef.setInput('transferPairAccountId', 'bank-1');
    expect(component.suggestedMatches().map((planned) => planned._id)).toEqual(['scheduled-1']);

    fixture.componentRef.setInput('transactionAmount', -5000n);
    expect(component.suggestedMatches()).toEqual([]);
  });

  it('selects the exact due date shown alongside the schedule', () => {
    const planned = createPlanned({ nextDate: '2026-09-16' });
    const selected = vi.fn();
    component.plannedTransactionChange.subscribe(selected);

    component.selectPlanned(planned);

    expect(component.formatDueDate(planned)).toBe('Sep 16, 2026');
    expect(selected).toHaveBeenCalledWith({ scheduledTransactionId: 'scheduled-1', occurrenceDate: '2026-09-16' });
  });
});
