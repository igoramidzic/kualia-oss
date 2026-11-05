import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import type {
  ScheduledTransactionWithRelations,
  UpdateScheduledTransactionInput,
  UpdateScheduledTransactionResult,
} from '../../services/scheduled-transaction.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { UndoRedoService, type UndoableAction } from '../../services/undo-redo.service';
import { ScheduledTransactionRowComponent } from './scheduled-transaction-row';

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
    movements: [
      {
        amount: -5000n,
        categoryId: 'category-1' as Id<'category'>,
        readyToAssign: false,
      },
    ],
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

describe('ScheduledTransactionRowComponent', () => {
  let fixture: ComponentFixture<ScheduledTransactionRowComponent>;
  let component: ScheduledTransactionRowComponent;
  let scheduledService: {
    deleteScheduledTransaction: ReturnType<typeof vi.fn<(id: Id<'scheduledTransaction'>) => Promise<void>>>;
    restoreScheduledTransaction: ReturnType<typeof vi.fn<(id: Id<'scheduledTransaction'>) => Promise<void>>>;
    updateScheduledTransaction: ReturnType<
      typeof vi.fn<(input: UpdateScheduledTransactionInput) => Promise<UpdateScheduledTransactionResult>>
    >;
    confirmEnterDueDate: ReturnType<
      typeof vi.fn<(scheduled: ScheduledTransactionWithRelations, dateIso: string) => Promise<boolean>>
    >;
  };
  let undoRedoService: {
    pushAction: ReturnType<typeof vi.fn<(action: UndoableAction) => void>>;
    undo: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();

    scheduledService = {
      deleteScheduledTransaction: vi
        .fn<(id: Id<'scheduledTransaction'>) => Promise<void>>()
        .mockResolvedValue(undefined),
      restoreScheduledTransaction: vi
        .fn<(id: Id<'scheduledTransaction'>) => Promise<void>>()
        .mockResolvedValue(undefined),
      updateScheduledTransaction: vi
        .fn<(input: UpdateScheduledTransactionInput) => Promise<UpdateScheduledTransactionResult>>()
        .mockResolvedValue({
          entered: false,
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          status: 'active',
          nextDate: '2026-08-01',
        }),
      confirmEnterDueDate: vi.fn<(scheduled: ScheduledTransactionWithRelations, dateIso: string) => Promise<boolean>>(),
    };
    undoRedoService = {
      pushAction: vi.fn<(action: UndoableAction) => void>(),
      undo: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ScheduledTransactionRowComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ScheduledTransactionService, useValue: scheduledService },
        { provide: UndoRedoService, useValue: undoRedoService },
        {
          provide: CurrencyService,
          useValue: {
            format: (amount: bigint) => `$${(Number(amount) / 100).toFixed(2)}`,
          },
        },
        { provide: MerchantService, useValue: { merchants: signal([]), findOrCreateMerchant: vi.fn() } },
        {
          provide: NavigationService,
          useValue: { getPlannedTransactionRoute: () => ['/kualia', 'planned', 'scheduled-1'] },
        },
      ],
    })
      .overrideComponent(ScheduledTransactionRowComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(ScheduledTransactionRowComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('scheduled', createScheduled());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the scheduled transaction from the context menu', async () => {
    await component.onContextMenuDelete();

    expect(scheduledService.deleteScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(undoRedoService.pushAction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Planned transaction deleted',
        type: 'planned-transaction-delete',
      })
    );
    expect(toast).toHaveBeenCalledWith(
      'Planned transaction deleted',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );
    expect(component.isDeleting()).toBe(false);
  });

  it('restores and re-deletes the planned transaction through its undo action', async () => {
    await component.onContextMenuDelete();
    const action = undoRedoService.pushAction.mock.calls[0]?.[0];

    await action?.undo();
    await action?.redo();

    expect(scheduledService.restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(scheduledService.deleteScheduledTransaction).toHaveBeenCalledTimes(2);
  });

  it('shows an error when context menu delete fails', async () => {
    scheduledService.deleteScheduledTransaction.mockRejectedValueOnce(new Error('Cannot delete schedule'));

    await component.onContextMenuDelete();

    expect(scheduledService.deleteScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(toast.error).toHaveBeenCalledWith('Cannot delete schedule');
    expect(component.isDeleting()).toBe(false);
  });

  it('does not re-date to today or earlier when entry confirmation is canceled', async () => {
    scheduledService.confirmEnterDueDate.mockResolvedValueOnce(false);

    await component.onDateChange(new Date(2020, 0, 1));

    expect(scheduledService.confirmEnterDueDate).toHaveBeenCalledWith(expect.any(Object), '2020-01-01');
    expect(scheduledService.updateScheduledTransaction).not.toHaveBeenCalled();
  });

  it('sends enterDue when a due date change is confirmed', async () => {
    scheduledService.confirmEnterDueDate.mockResolvedValueOnce(true);
    scheduledService.updateScheduledTransaction.mockResolvedValueOnce({
      entered: true,
      scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      transactionId: 'transaction-1' as Id<'transaction'>,
      status: 'active',
      nextDate: '2020-02-01',
    });

    await component.onDateChange(new Date(2020, 0, 1));

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      date: '2020-01-01',
      enterDue: true,
    });
  });
});
