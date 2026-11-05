import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import type { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmSkipPlannedTransaction } from '../../components/dialogs/skip-planned-transaction-dialog/skip-planned-transaction-dialog';
import { BankAccountService, type BankAccountWithRelations } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import type {
  EnterScheduledTransactionNowResult,
  ScheduledTransactionWithRelations,
  SkipScheduledTransactionResult,
  UpdateScheduledTransactionInput,
  UpdateScheduledTransactionResult,
} from '../../services/scheduled-transaction.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { PlannedTransactionPageService } from '../planned-transaction/planned-transaction-page.service';
import { PlannedTransactionDetailsComponent } from './planned-transaction-details';

vi.mock('ngx-sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../components/dialogs/skip-planned-transaction-dialog/skip-planned-transaction-dialog', () => ({
  confirmSkipPlannedTransaction: vi.fn(),
}));

const confirmSkipMock = vi.mocked(confirmSkipPlannedTransaction);

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

function createBankAccount(id: string, accountType: string): BankAccountWithRelations {
  return {
    _id: id as Id<'bankAccount'>,
    name: id,
    accountType,
    isDeleted: false,
    isClosed: false,
  } as BankAccountWithRelations;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('PlannedTransactionDetailsComponent', () => {
  let fixture: ComponentFixture<PlannedTransactionDetailsComponent>;
  let component: PlannedTransactionDetailsComponent;
  let scheduled: WritableSignal<ScheduledTransactionWithRelations | null>;
  let bankAccounts: WritableSignal<BankAccountWithRelations[]>;
  let pageService: {
    scheduled: WritableSignal<ScheduledTransactionWithRelations | null>;
    isLoading: WritableSignal<boolean>;
    sortedTransactions: WritableSignal<TransactionWithRelations[]>;
    transactionsLoading: WritableSignal<boolean>;
    loadingMore: WritableSignal<boolean>;
    hasMore: WritableSignal<boolean>;
    transactionsError: WritableSignal<string | null>;
    reload: ReturnType<typeof vi.fn<(options?: { refreshLinkedTransactions?: boolean }) => Promise<void>>>;
    loadMore: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
  let scheduledService: {
    enterNow: ReturnType<
      typeof vi.fn<(scheduledTransactionId: Id<'scheduledTransaction'>) => Promise<EnterScheduledTransactionNowResult>>
    >;
    updateScheduledTransaction: ReturnType<
      typeof vi.fn<(input: UpdateScheduledTransactionInput) => Promise<UpdateScheduledTransactionResult>>
    >;
    skip: ReturnType<
      typeof vi.fn<(scheduledTransactionId: Id<'scheduledTransaction'>) => Promise<SkipScheduledTransactionResult>>
    >;
    confirmEnterDueDate: ReturnType<
      typeof vi.fn<(scheduled: ScheduledTransactionWithRelations, dateIso: string) => Promise<boolean>>
    >;
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();

    scheduled = signal<ScheduledTransactionWithRelations | null>(createScheduled());
    bankAccounts = signal<BankAccountWithRelations[]>([]);
    pageService = {
      scheduled,
      isLoading: signal(false),
      sortedTransactions: signal<TransactionWithRelations[]>([]),
      transactionsLoading: signal(false),
      loadingMore: signal(false),
      hasMore: signal(false),
      transactionsError: signal(null),
      reload: vi
        .fn<(options?: { refreshLinkedTransactions?: boolean }) => Promise<void>>()
        .mockResolvedValue(undefined),
      loadMore: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    scheduledService = {
      enterNow: vi
        .fn<(scheduledTransactionId: Id<'scheduledTransaction'>) => Promise<EnterScheduledTransactionNowResult>>()
        .mockResolvedValue({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          transactionId: 'transaction-1' as Id<'transaction'>,
          status: 'completed',
        }),
      updateScheduledTransaction: vi
        .fn<(input: UpdateScheduledTransactionInput) => Promise<UpdateScheduledTransactionResult>>()
        .mockResolvedValue({
          entered: false,
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          status: 'active',
          nextDate: '2026-08-01',
        }),
      skip: vi
        .fn<(scheduledTransactionId: Id<'scheduledTransaction'>) => Promise<SkipScheduledTransactionResult>>()
        .mockResolvedValue({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          status: 'active',
          nextDate: '2026-09-01',
        }),
      confirmEnterDueDate: vi.fn<(scheduled: ScheduledTransactionWithRelations, dateIso: string) => Promise<boolean>>(),
    };

    await TestBed.configureTestingModule({
      imports: [PlannedTransactionDetailsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlannedTransactionPageService, useValue: pageService },
        { provide: ScheduledTransactionService, useValue: scheduledService },
        {
          provide: CurrencyService,
          useValue: {
            currencyCode: signal('USD'),
            format: (amount: bigint) => `$${(Number(amount) / 100).toFixed(2)}`,
          },
        },
        {
          provide: BankAccountService,
          useValue: { bankAccounts, activeBankAccounts: bankAccounts },
        },
        { provide: MerchantService, useValue: { merchants: signal([]), findOrCreateMerchant: vi.fn() } },
        {
          provide: NavigationService,
          useValue: {
            getPlannedRoute: () => ['/kualia', 'planned'],
            navigateToTransaction: vi.fn(),
          },
        },
        { provide: HlmDialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlannedTransactionDetailsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the next due date for an active schedule', () => {
    scheduled.set(createScheduled({ status: 'active', nextDate: '2026-08-15' }));

    expect(component.isCompleted()).toBe(false);
    expect(component.isEditable()).toBe(true);
    expect(component.nextDueDateLabel()).toBe('Aug 15, 2026');
  });

  it('renders interactive controls for automatic entry and reminders', async () => {
    scheduled.set(createScheduled({ reminderEnabled: true, reminderOffset: 'on_due_date' }));
    fixture.detectChanges();
    await fixture.whenStable();

    const automaticEntryButton = fixture.nativeElement.querySelector('button[aria-label="Toggle automatic entry"]');
    expect(automaticEntryButton?.textContent).toContain('Enter automatically');
    expect(automaticEntryButton?.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).not.toContain('Entered into the register on the due date');
    expect(fixture.nativeElement.textContent).not.toContain('Off: shows as due until you enter it');
    const reminderTrigger = fixture.nativeElement.querySelector('hlm-select-trigger[aria-label="Reminder"]');
    const reminderSelect = reminderTrigger?.closest('hlm-select');
    expect(reminderSelect?.classList.contains('inline-block')).toBe(true);
    expect(reminderSelect?.classList.contains('block')).toBe(false);
    expect(reminderTrigger?.textContent).toContain('On due date');
    expect(reminderTrigger?.textContent).not.toContain('on_due_date');
    expect(fixture.nativeElement.querySelector('app-payee-selector app-entity-mark')).not.toBeNull();

    const propertiesRow = fixture.nativeElement.querySelector('[data-testid="properties-row"]');
    const dueRow = fixture.nativeElement.querySelector('[data-testid="due-row"]');
    const statusRow = fixture.nativeElement.querySelector('[data-testid="status-row"]');
    expect(propertiesRow?.querySelector('app-payee-selector')).not.toBeNull();
    expect(propertiesRow?.querySelector('app-transaction-date-picker')).toBeNull();
    const propertyTriggers = propertiesRow?.querySelectorAll('[data-slot="combobox-trigger"]') ?? [];
    expect(propertyTriggers.length).toBeGreaterThan(0);
    expect([...propertyTriggers].every((trigger: Element) => trigger.classList.contains('h-8'))).toBe(true);
    expect(dueRow?.querySelector('app-transaction-date-picker')).not.toBeNull();
    expect(reminderSelect?.parentElement).toBe(dueRow);
    expect(automaticEntryButton?.parentElement).toBe(dueRow);
    expect(propertiesRow?.nextElementSibling).toBe(dueRow);
    expect(dueRow?.nextElementSibling).toBe(statusRow);
  });

  it('shows and locks an optimistic field value until the mutation settles, then rolls back on failure', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const deferred = createDeferred<UpdateScheduledTransactionResult>();
    scheduledService.updateScheduledTransaction.mockReturnValueOnce(deferred.promise);

    const update = component.onBankAccountChange('bank-2');
    fixture.detectChanges();

    expect(component.displayBankAccountId()).toBe('bank-2');
    expect(component.savingBankAccount()).toBe(true);
    const accountButton = fixture.nativeElement.querySelector('app-bank-account-selector button');
    expect(accountButton?.disabled).toBe(true);

    deferred.reject(new Error('Update failed'));
    await update;

    expect(component.displayBankAccountId()).toBe('bank-1');
    expect(component.savingBankAccount()).toBe(false);
  });

  it('disables every properties editor for a completed schedule', async () => {
    scheduled.set(createScheduled({ status: 'completed' }));
    fixture.detectChanges();
    await fixture.whenStable();

    const propertiesRow = fixture.nativeElement.querySelector('[data-testid="properties-row"]');
    const propertyTriggers = propertiesRow?.querySelectorAll('[data-slot="combobox-trigger"]') ?? [];

    expect(propertyTriggers).toHaveLength(3);
    expect([...propertyTriggers].every((trigger: HTMLButtonElement) => trigger.disabled)).toBe(true);
    expect(
      [...propertyTriggers].every((trigger: HTMLButtonElement) => trigger.classList.contains('disabled:opacity-50'))
    ).toBe(true);
  });

  it('hides transfer categories unless the transfer crosses the budget boundary', async () => {
    bankAccounts.set([createBankAccount('bank-1', 'banking_checking'), createBankAccount('bank-2', 'banking_savings')]);
    scheduled.set(
      createScheduled({
        transactionType: 'transfer',
        merchantId: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
      })
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const propertiesRow = fixture.nativeElement.querySelector('[data-testid="properties-row"]');
    expect(component.isCrossBudgetTransfer()).toBe(false);
    expect(propertiesRow?.querySelector('app-category-selector')).toBeNull();
    expect(propertiesRow?.textContent).toContain('Transfer');

    bankAccounts.set([
      createBankAccount('bank-1', 'banking_checking'),
      createBankAccount('bank-2', 'investment_brokerage'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isCrossBudgetTransfer()).toBe(true);
    expect(propertiesRow?.querySelector('app-category-selector')).not.toBeNull();
  });

  it('places the active schedule actions in the next due section', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const nextDueSection = fixture.nativeElement.querySelector('[data-testid="next-due-section"]');
    expect(nextDueSection?.textContent).toContain('Enter now');
    expect(nextDueSection?.textContent).toContain('Skip');
    expect(nextDueSection?.textContent).toContain('Pause');
  });

  it('reveals entered transaction content with a fade instead of a loading spinner', async () => {
    pageService.transactionsLoading.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Loading transactions');

    pageService.transactionsLoading.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    const emptyState = [...fixture.nativeElement.querySelectorAll('p.fade-in')].find((element: Element) =>
      element.textContent?.includes('No transactions entered')
    );
    expect(emptyState).toBeDefined();
  });

  it('does not enter a completed schedule again', async () => {
    scheduled.set(
      createScheduled({
        status: 'completed',
        executionCount: 1,
        lastEnteredAt: '2026-08-01T12:00:00.000Z',
        lastEnteredTransactionId: 'transaction-1' as Id<'transaction'>,
        nextRunAt: undefined,
      })
    );

    await component.enterNow();

    expect(scheduledService.enterNow).not.toHaveBeenCalled();
    expect(pageService.reload).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Schedule completed', {
      description: 'This planned transaction has already been entered.',
    });
  });

  it('still enters an active schedule', async () => {
    await component.enterNow();

    expect(scheduledService.enterNow).toHaveBeenCalledWith('scheduled-1');
    expect(pageService.reload).toHaveBeenCalledWith({ refreshLinkedTransactions: true });
    expect(toast.success).toHaveBeenCalledWith(
      'Transaction entered',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'View' }),
      })
    );
  });

  it('does not re-date to today or earlier when entry confirmation is canceled', async () => {
    scheduledService.confirmEnterDueDate.mockResolvedValueOnce(false);

    await component.selectDate(new Date(2020, 0, 1));

    expect(scheduledService.confirmEnterDueDate).toHaveBeenCalledWith(expect.any(Object), '2020-01-01');
    expect(scheduledService.updateScheduledTransaction).not.toHaveBeenCalled();
    expect(pageService.reload).not.toHaveBeenCalled();
  });

  it('sends enterDue when a due date change is confirmed', async () => {
    scheduledService.confirmEnterDueDate.mockResolvedValueOnce(true);
    scheduledService.updateScheduledTransaction.mockResolvedValueOnce({
      entered: true,
      scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      transactionId: 'transaction-1' as Id<'transaction'>,
      status: 'completed',
    });

    await component.selectDate(new Date(2020, 0, 1));

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      date: '2020-01-01',
      enterDue: true,
    });
    expect(pageService.reload).toHaveBeenCalledWith({ refreshLinkedTransactions: true });
  });

  it('converts a transfer schedule to a regular merchant schedule from the payee picker', async () => {
    scheduled.set(
      createScheduled({
        transactionType: 'transfer',
        merchantId: undefined,
        merchantName: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        movements: [{ amount: 5000n }],
      })
    );
    component.amountAbs.set(5000);

    await component.onPayeeChange({ type: 'merchant', id: 'merchant-2' });

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      transferToAccountId: null,
      merchantId: 'merchant-2',
      movements: [{ amount: -5000n }],
    });
  });

  it('converts a regular schedule to a transfer schedule from the payee picker', async () => {
    component.amountAbs.set(5000);

    await component.onPayeeChange({ type: 'bankAccount', id: 'bank-2' });

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'transfer',
      transferToAccountId: 'bank-2',
      merchantId: null,
      movements: [{ amount: 5000n, categoryId: 'category-1' }],
      bankAccountId: 'bank-1',
    });
  });

  it('swaps transfer accounts when changing the transfer direction', async () => {
    scheduled.set(
      createScheduled({
        transactionType: 'transfer',
        merchantId: undefined,
        merchantName: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        movements: [{ amount: 5000n }],
      })
    );
    component.amountSign.set('outflow');

    await component.onSignChange('inflow');

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'transfer',
      bankAccountId: 'bank-2',
      transferToAccountId: 'bank-1',
      merchantId: null,
    });
    expect(component.amountSign()).toBe('inflow');
  });

  it('keeps a transfer movement amount positive when changing its category', async () => {
    scheduled.set(
      createScheduled({
        transactionType: 'transfer',
        merchantId: undefined,
        merchantName: undefined,
        transferToAccountId: 'bank-2' as Id<'bankAccount'>,
        movements: [{ amount: 5000n }],
      })
    );
    component.amountAbs.set(5000);
    component.amountSign.set('outflow');

    await component.selectCategory('category-2');

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'transfer',
      bankAccountId: 'bank-1',
      transferToAccountId: 'bank-2',
      merchantId: null,
      movements: [{ amount: 5000n, categoryId: 'category-2' }],
    });
  });

  it('switches the schedule to manual entry mode', async () => {
    await component.onEntryModeToggle(false);

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      entryMode: 'manual',
    });
    expect(pageService.reload).not.toHaveBeenCalled();
  });

  it('pauses an active schedule', async () => {
    scheduledService.updateScheduledTransaction.mockResolvedValueOnce({
      entered: false,
      scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      status: 'paused',
      nextDate: '2026-08-01',
    });

    await component.togglePaused();

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      paused: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Planned transaction paused');
    expect(pageService.reload).toHaveBeenCalledWith();
  });

  it('resumes a paused schedule and surfaces the next occurrence', async () => {
    scheduled.set(createScheduled({ status: 'paused' }));
    scheduledService.updateScheduledTransaction.mockResolvedValueOnce({
      entered: false,
      scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      status: 'active',
      nextDate: '2026-09-01',
    });

    await component.togglePaused();

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      paused: false,
    });
    expect(toast.success).toHaveBeenCalledWith('Planned transaction resumed', {
      description: 'Next occurrence on Sep 1, 2026',
    });
  });

  it('does not skip when the confirmation is canceled', async () => {
    confirmSkipMock.mockResolvedValueOnce(false);

    await component.skip();

    expect(scheduledService.skip).not.toHaveBeenCalled();
    expect(pageService.reload).not.toHaveBeenCalled();
  });

  it('skips a repeating schedule and surfaces the next occurrence', async () => {
    confirmSkipMock.mockResolvedValueOnce(true);

    await component.skip();

    expect(scheduledService.skip).toHaveBeenCalledWith('scheduled-1');
    expect(toast.success).toHaveBeenCalledWith('Occurrence skipped', {
      description: 'Next occurrence on Sep 1, 2026',
    });
    expect(pageService.reload).toHaveBeenCalledWith();
  });

  it('reports completion when skipping a once schedule', async () => {
    confirmSkipMock.mockResolvedValueOnce(true);
    scheduledService.skip.mockResolvedValueOnce({
      scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      status: 'completed',
    });

    await component.skip();

    expect(toast.success).toHaveBeenCalledWith('Schedule completed', {
      description: 'The one-time schedule was skipped and completed.',
    });
  });

  it('defaults reminders to none', () => {
    expect(component.reminderSelection()).toBe('none');
    expect(component.reminderToString('none')).toBe('No reminder');
  });

  it('enables reminders by selecting an offset', async () => {
    await component.selectReminder('on_due_date');

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      reminderEnabled: true,
      reminderOffset: 'on_due_date',
    });
  });

  it('updates the reminder offset', async () => {
    scheduled.set(createScheduled({ reminderEnabled: true, reminderOffset: 'on_due_date' }));

    await component.selectReminder('1_week_before');

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      reminderEnabled: true,
      reminderOffset: '1_week_before',
    });
  });

  it('disables reminders by selecting none', async () => {
    scheduled.set(createScheduled({ reminderEnabled: true, reminderOffset: '1_day_before' }));

    await component.selectReminder('none');

    expect(scheduledService.updateScheduledTransaction).toHaveBeenCalledWith({
      scheduledTransactionId: 'scheduled-1',
      transactionType: 'regular',
      reminderEnabled: false,
      reminderOffset: null,
    });
  });
});
