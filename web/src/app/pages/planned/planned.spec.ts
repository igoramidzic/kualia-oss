import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { toast } from 'ngx-sonner';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatService } from '../../services/ai-chat.service';
import { CurrencyService } from '../../services/currency.service';
import { NavigationService } from '../../services/navigation.service';
import {
  PlannedBaseTransaction,
  PlannedMonthEntryView,
  PlannedMonthlySummary,
  PlannedTransactionService,
} from '../../services/planned-transaction.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionService } from '../../services/transaction.service';
import { UndoRedoService, type UndoableAction } from '../../services/undo-redo.service';
import { PlannedComponent } from './planned';

vi.mock('ngx-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

describe('PlannedComponent', () => {
  let component: PlannedComponent;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let openCreateDialog: ReturnType<typeof vi.fn>;
  let navigateToPlannedTransaction: ReturnType<typeof vi.fn>;
  let navigateToTransaction: ReturnType<typeof vi.fn>;
  let enterNow: ReturnType<typeof vi.fn>;
  let deleteScheduledTransaction: ReturnType<typeof vi.fn>;
  let restoreScheduledTransaction: ReturnType<typeof vi.fn>;
  let pushAction: ReturnType<typeof vi.fn<(action: UndoableAction) => void>>;

  beforeEach(() => {
    const selectedViewMode = signal<'list' | 'calendar'>('calendar');

    queryParams$ = new BehaviorSubject<Record<string, string>>({});
    openCreateDialog = vi.fn();
    navigateToPlannedTransaction = vi.fn();
    navigateToTransaction = vi.fn();
    enterNow = vi.fn().mockResolvedValue({ transactionId: 'transaction-1', status: 'completed' });
    deleteScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    restoreScheduledTransaction = vi.fn().mockResolvedValue(undefined);
    pushAction = vi.fn<(action: UndoableAction) => void>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: PlannedTransactionService,
          useValue: {
            selectedViewMode: selectedViewMode.asReadonly(),
            selectedYearMonth: signal(202401).asReadonly(),
            selectedMonthEntries: signal<PlannedMonthEntryView[]>([]).asReadonly(),
            availableRange: signal<{ minYearMonth: number; maxYearMonth: number } | null>(null).asReadonly(),
            canNavigatePrevious: signal(false).asReadonly(),
            canNavigateNext: signal(false).asReadonly(),
            selectedMonthSummary: signal<PlannedMonthlySummary | null>(null).asReadonly(),
            loading: signal(false).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
            allPlannedTransactions: signal<PlannedBaseTransaction[]>([]).asReadonly(),
            navigateToMonth: vi.fn(),
            navigateToPreviousMonth: vi.fn(),
            navigateToNextMonth: vi.fn(),
            setViewMode: vi.fn((mode: 'list' | 'calendar') => selectedViewMode.set(mode)),
          },
        },
        { provide: TransactionService, useValue: { openCreateDialog } },
        {
          provide: ScheduledTransactionService,
          useValue: {
            enterNow,
            updateScheduledTransaction: vi.fn(),
            skip: vi.fn(),
            deleteScheduledTransaction,
            restoreScheduledTransaction,
          },
        },
        { provide: UndoRedoService, useValue: { pushAction, undo: vi.fn() } },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: NavigationService,
          useValue: { navigateToPlannedTransaction, navigateToTransaction },
        },
        { provide: CurrencyService, useValue: { format: (amount: bigint) => `$${Number(amount) / 100}` } },
        { provide: AiChatService, useValue: { shouldCaptureShortcuts: () => false } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new PlannedComponent());
  });

  it('builds responsive tab filters for monthly and all planned views', () => {
    const filters = component.plannedFilters();
    const monthly = filters.find((filter) => filter.id === 'monthly');
    const all = filters.find((filter) => filter.id === 'all');

    expect(monthly?.label).toBe('Monthly');
    expect(monthly?.queryParams).toEqual({});
    expect(monthly?.isActive).toBe(true);
    expect(all?.label).toBe('All Planned');
    expect(all?.queryParams).toEqual({ tab: 'all' });
    expect(all?.isActive).toBe(false);
  });

  it('preserves relevant query params when switching tabs', () => {
    queryParams$.next({ month: '202605', view: 'list' });

    let filters = component.plannedFilters();
    expect(filters.find((filter) => filter.id === 'monthly')?.queryParams).toEqual({
      month: '202605',
      view: 'list',
    });
    expect(filters.find((filter) => filter.id === 'all')?.queryParams).toEqual({
      month: '202605',
      tab: 'all',
    });

    queryParams$.next({ month: '202605', tab: 'all' });

    filters = component.plannedFilters();
    expect(filters.find((filter) => filter.id === 'monthly')?.isActive).toBe(false);
    expect(filters.find((filter) => filter.id === 'all')?.isActive).toBe(true);
  });

  it('opens the create-transaction dialog prefilled with the first of a non-current month', () => {
    component.openCreateDialog();

    expect(openCreateDialog).toHaveBeenCalledWith({ initialDate: '2024-01-01' });
  });

  it('opens the create-transaction dialog prefilled with a calendar date', () => {
    component.openCreateDialogWithDate('2026-06-15');

    expect(openCreateDialog).toHaveBeenCalledWith({ initialDate: '2026-06-15' });
  });

  it('opens the planned transaction when a paid calendar occurrence has a linked transaction', () => {
    const view = {
      base: { _id: 'scheduled-1' },
      entry: {
        coverage: {
          status: 'paid',
          linkedTransactions: [{ transactionId: 'transaction-1' }],
        },
      },
    } as unknown as PlannedMonthEntryView;

    component.onCalendarEntryClick(view);

    expect(navigateToPlannedTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(navigateToTransaction).not.toHaveBeenCalled();
  });

  it('enters a planned transaction from a context-menu action', async () => {
    const planned = { _id: 'scheduled-1' } as PlannedBaseTransaction;

    await component.onPlannedAction({ action: 'enter', planned });

    expect(enterNow).toHaveBeenCalledWith('scheduled-1');
  });

  it('registers planned deletion as undoable', async () => {
    const planned = { _id: 'scheduled-1' } as PlannedBaseTransaction;

    await component.onPlannedAction({ action: 'delete', planned });

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

    const action = pushAction.mock.calls[0]?.[0];
    await action?.undo();
    await action?.redo();

    expect(restoreScheduledTransaction).toHaveBeenCalledWith('scheduled-1');
    expect(deleteScheduledTransaction).toHaveBeenCalledTimes(2);
  });
});
