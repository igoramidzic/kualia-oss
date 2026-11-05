import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import type { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import {
  ScheduledTransactionService,
  type ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { UndoRedoService, type UndoableAction } from '../../services/undo-redo.service';
import { PlannedTransactionComponent } from './planned-transaction';
import { PlannedTransactionPageService } from './planned-transaction-page.service';

vi.mock('ngx-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

function createScheduled(
  overrides: Partial<ScheduledTransactionWithRelations> = {}
): ScheduledTransactionWithRelations {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: Date.now(),
    workspaceId: 'workspace-1' as Id<'workspace'>,
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    merchantId: 'merchant-1' as Id<'merchant'>,
    merchantName: 'Test Merchant',
    notes: undefined,
    entryStatus: 'pending',
    movements: [{ amount: -5000n, categoryId: 'category-1' as Id<'category'> }],
    recurrence: 'once',
    anchorDate: '2026-08-01',
    nextDate: '2026-08-01',
    nextRunAt: 1785578400000,
    status: 'active',
    executionCount: 0,
    lastEnteredAt: undefined,
    lastEnteredTransactionId: undefined,
    createdBy: undefined,
    updatedAt: '2026-07-09T00:00:00.000Z',
    deletedAt: undefined,
    isDeleted: false,
    ...overrides,
  };
}

describe('PlannedTransactionComponent', () => {
  let fixture: ComponentFixture<PlannedTransactionComponent>;
  let component: PlannedTransactionComponent;
  let scheduled: WritableSignal<ScheduledTransactionWithRelations | null>;
  let merchants: WritableSignal<{ _id: Id<'merchant'>; name: string }[]>;
  let deleteScheduledTransaction: ReturnType<typeof vi.fn>;
  let restoreScheduledTransaction: ReturnType<typeof vi.fn>;
  let pushAction: ReturnType<typeof vi.fn<(action: UndoableAction) => void>>;
  let navigateToPlanned: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    scheduled = signal<ScheduledTransactionWithRelations | null>(createScheduled());
    merchants = signal([]);
    deleteScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    restoreScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    pushAction = vi.fn<(action: UndoableAction) => void>();
    navigateToPlanned = vi.fn();

    const pageService = {
      scheduled,
      isLoading: signal(false),
      load: vi.fn<(_: Id<'scheduledTransaction'>) => Promise<void>>().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [PlannedTransactionComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map<string, string>()) } },
        {
          provide: CurrencyService,
          useValue: {
            format: (amount: number | bigint) => {
              const value = typeof amount === 'bigint' ? Number(amount) : amount;
              const sign = value < 0 ? '-' : '';
              return `${sign}$${(Math.abs(value) / 100).toFixed(2)}`;
            },
          },
        },
        { provide: MerchantService, useValue: { merchants } },
        {
          provide: NavigationService,
          useValue: {
            getPlannedRoute: () => ['/kualia', 'planned'],
            navigateToPlanned,
          },
        },
        {
          provide: ScheduledTransactionService,
          useValue: { deleteScheduledTransaction, restoreScheduledTransaction },
        },
        { provide: UndoRedoService, useValue: { pushAction, undo: vi.fn() } },
      ],
    })
      .overrideComponent(PlannedTransactionComponent, {
        set: { template: '', providers: [{ provide: PlannedTransactionPageService, useValue: pageService }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PlannedTransactionComponent);
    component = fixture.componentInstance;
  });

  it('matches the transaction header label for planned transfers', () => {
    scheduled.set(
      createScheduled({
        transactionType: 'transfer',
        merchantId: undefined,
        merchantName: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        movements: [{ amount: 5000n }],
      })
    );

    expect(component.display()).toEqual({ prefix: 'Transfer', amount: '-$50.00' });
  });

  it('falls back to the loaded merchant when the planned response omits its name', () => {
    merchants.set([{ _id: 'merchant-1' as Id<'merchant'>, name: 'Loaded Merchant' }]);
    scheduled.set(createScheduled({ merchantName: undefined }));

    expect(component.display()).toEqual({ prefix: 'Loaded Merchant', amount: '$50.00' });
  });

  it('deletes with undo before navigating back to planned transactions', async () => {
    await component.deleteScheduled();

    expect(deleteScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(pushAction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Planned transaction deleted',
        type: 'planned-transaction-delete',
      })
    );
    expect(toast).toHaveBeenCalledWith(
      'Planned transaction deleted',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );
    expect(navigateToPlanned).toHaveBeenCalled();

    const action = pushAction.mock.calls[0]?.[0];
    await action?.undo();
    await action?.redo();

    expect(restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(deleteScheduledTransaction).toHaveBeenCalledTimes(2);
  });
});
