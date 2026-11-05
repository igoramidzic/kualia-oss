import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionSelectionService } from '../../services/transaction-selection.service';
import { TransactionService } from '../../services/transaction.service';
import { UndoRedoService, type UndoableAction } from '../../services/undo-redo.service';
import { BulkActionsToolbarComponent } from './bulk-actions-toolbar';

vi.mock('ngx-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

describe('BulkActionsToolbarComponent planned deletion undo', () => {
  let component: BulkActionsToolbarComponent;
  let selectedTransactionIds: WritableSignal<Set<Id<'transaction'>>>;
  let selectedScheduledIds: WritableSignal<Set<Id<'scheduledTransaction'>>>;
  let deleteTransactions: ReturnType<typeof vi.fn>;
  let restoreTransactions: ReturnType<typeof vi.fn>;
  let deleteScheduledTransaction: ReturnType<typeof vi.fn>;
  let restoreScheduledTransaction: ReturnType<typeof vi.fn>;
  let pushAction: ReturnType<typeof vi.fn<(action: UndoableAction) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    selectedTransactionIds = signal(new Set<Id<'transaction'>>());
    selectedScheduledIds = signal(new Set<Id<'scheduledTransaction'>>());
    deleteTransactions = vi.fn().mockResolvedValue(true);
    restoreTransactions = vi.fn().mockResolvedValue(true);
    deleteScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    restoreScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    pushAction = vi.fn<(action: UndoableAction) => void>();

    TestBed.configureTestingModule({
      providers: [
        { provide: TransactionService, useValue: { deleteTransactions, restoreTransactions } },
        {
          provide: ScheduledTransactionService,
          useValue: { deleteScheduledTransaction, restoreScheduledTransaction },
        },
        {
          provide: TransactionSelectionService,
          useValue: {
            selectedTransactionIds: selectedTransactionIds.asReadonly(),
            selectedScheduledIds: selectedScheduledIds.asReadonly(),
            deselectAll: vi.fn(),
          },
        },
        { provide: UndoRedoService, useValue: { pushAction, undo: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new BulkActionsToolbarComponent());
  });

  it('undoes and redoes a planned-only bulk deletion', async () => {
    selectedScheduledIds.set(
      new Set(['scheduled-1' as Id<'scheduledTransaction'>, 'scheduled-2' as Id<'scheduledTransaction'>])
    );

    await component.bulkDelete();

    expect(deleteScheduledTransaction).toHaveBeenCalledTimes(2);
    expect(pushAction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '2 planned transactions deleted',
        type: 'planned-transaction-bulk-delete',
      })
    );
    expect(toast).toHaveBeenCalledWith(
      'Deleted 2 planned transactions',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );

    const action = pushAction.mock.calls[0]?.[0];
    await action?.undo();
    await action?.redo();

    expect(restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-2');
    expect(deleteScheduledTransaction).toHaveBeenCalledTimes(4);
  });

  it('restores both regular and planned transactions from a mixed deletion', async () => {
    selectedTransactionIds.set(new Set(['transaction-1' as Id<'transaction'>]));
    selectedScheduledIds.set(new Set(['scheduled-1' as Id<'scheduledTransaction'>]));

    await component.bulkDelete();
    const action = pushAction.mock.calls[0]?.[0];
    await action?.undo();

    expect(restoreTransactions).toHaveBeenCalledWith(['transaction-1']);
    expect(restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
  });
});
