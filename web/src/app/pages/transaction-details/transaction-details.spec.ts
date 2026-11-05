import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { EMPTY } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayeeChangeEvent } from '../../components/transaction/payee-selector.component';
import { BankAccountService, BankAccountWithRelations } from '../../services/bank-account.service';
import { BudgetService } from '../../services/budget.service';
import { Category, CategoryService } from '../../services/category.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { CurrentMonthService } from '../../services/current-month.service';
import { Merchant, MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';
import { UndoRedoService, type UndoableAction } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { TransactionPageService } from '../transaction/transaction-page.service';
import { TransactionDetailsComponent } from './transaction-details';

// Helper function to create mock transaction
function createMockTransaction(overrides?: Partial<TransactionWithRelations>): TransactionWithRelations {
  return {
    _id: 'tx-1' as Id<'transaction'>,
    _creationTime: Date.now(),
    amount: -5000n,
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    bankAccount: {
      _id: 'bank-1' as Id<'bankAccount'>,
      _creationTime: Date.now(),
      name: 'Checking',
      workspaceId: 'workspace-1' as Id<'workspace'>,
      isDeleted: false,
    } as BankAccountWithRelations,
    merchant: null,
    merchantName: null,
    merchantLogo: null,
    merchantId: undefined,
    project: null,
    movements: [
      {
        _id: 'movement-1' as Id<'movement'>,
        _creationTime: Date.now(),
        amount: -5000n,
        transactionId: 'tx-1' as Id<'transaction'>,
        categoryId: undefined,
        category: null,
        readyToAssign: false,
      } as TransactionWithRelations['movements'][0],
    ],
    transferPairAccountName: null,
    transferPairAccountLogo: null,
    transferPairId: null,
    date: '2024-01-15',
    importDetails: null,
    type: 'expense',
    status: 'cleared',
    notes: undefined,
    ...overrides,
  } as TransactionWithRelations;
}

function createMockMerchant(overrides?: Partial<Merchant>): Merchant {
  return {
    _id: 'merchant-1' as Id<'merchant'>,
    _creationTime: Date.now(),
    name: 'Test Merchant',
    workspaceId: 'workspace-1' as Id<'workspace'>,
    isDeleted: false,
    transactionCount: 5,
    logoUrl: undefined,
    ...overrides,
  } as Merchant;
}

function createMockBankAccount(overrides?: Partial<BankAccountWithRelations>): BankAccountWithRelations {
  return {
    _id: 'bank-1' as Id<'bankAccount'>,
    _creationTime: Date.now(),
    name: 'Checking Account',
    workspaceId: 'workspace-1' as Id<'workspace'>,
    isDeleted: false,
    institution: null,
    ...overrides,
  } as BankAccountWithRelations;
}

describe('TransactionDetailsComponent - Payee Selector Integration', () => {
  let component: TransactionDetailsComponent;
  let fixture: ComponentFixture<TransactionDetailsComponent>;
  let mockTransactionPageService: {
    transaction: ReturnType<typeof signal<TransactionWithRelations | null>>;
    populatedTransaction: ReturnType<typeof signal<TransactionWithRelations | null>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    setTransaction: ReturnType<typeof vi.fn>;
    setLoading: ReturnType<typeof vi.fn>;
    setTransactionAmountEdit: ReturnType<typeof vi.fn>;
  };
  let mockTransactionService: {
    updateTransaction: ReturnType<typeof vi.fn>;
    convertToTransfer: ReturnType<typeof vi.fn>;
    convertFromTransfer: ReturnType<typeof vi.fn>;
    updateTransfer: ReturnType<typeof vi.fn>;
    fetchTransactionById: ReturnType<typeof vi.fn>;
    rejectTransferSuggestion: ReturnType<typeof vi.fn>;
    approveTransactionLink: ReturnType<typeof vi.fn>;
    unlinkTransaction: ReturnType<typeof vi.fn>;
  };
  let mockMerchantService: {
    merchants: ReturnType<typeof signal<Merchant[]>>;
    findOrCreateMerchant: ReturnType<typeof vi.fn>;
    updateMerchant: ReturnType<typeof vi.fn>;
  };
  let mockBankAccountService: {
    bankAccounts: ReturnType<typeof signal<BankAccountWithRelations[]>>;
    activeBankAccounts: ReturnType<typeof signal<BankAccountWithRelations[]>>;
  };
  let mockCategoryService: {
    categories: ReturnType<typeof signal<Category[]>>;
    sortedCategories: ReturnType<typeof signal<Category[]>>;
    activeGroups: ReturnType<typeof signal<unknown[]>>;
  };
  let mockWorkspaceService: {
    workspaceId: ReturnType<typeof signal<string | null>>;
    workspaceShortId: ReturnType<typeof signal<string | null>>;
  };
  let mockConvexService: {
    mutation: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    const transaction = createMockTransaction();
    const merchants = [
      createMockMerchant({ _id: 'merchant-1' as Id<'merchant'>, name: 'Amazon' }),
      createMockMerchant({ _id: 'merchant-2' as Id<'merchant'>, name: 'Walmart' }),
    ];
    const bankAccounts = [
      createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }),
      createMockBankAccount({ _id: 'bank-2' as Id<'bankAccount'>, name: 'Savings' }),
    ];

    mockTransactionPageService = {
      transaction: signal<TransactionWithRelations | null>(transaction),
      populatedTransaction: signal<TransactionWithRelations | null>(transaction),
      isLoading: signal(false),
      setTransaction: vi.fn(),
      setLoading: vi.fn(),
      setTransactionAmountEdit: vi.fn(),
    };

    mockTransactionService = {
      updateTransaction: vi.fn().mockResolvedValue(undefined),
      convertToTransfer: vi.fn().mockResolvedValue({ success: true }),
      convertFromTransfer: vi.fn().mockResolvedValue(undefined),
      updateTransfer: vi.fn().mockResolvedValue(undefined),
      fetchTransactionById: vi.fn().mockResolvedValue(transaction),
      rejectTransferSuggestion: vi.fn().mockResolvedValue(true),
      approveTransactionLink: vi.fn().mockResolvedValue(true),
      unlinkTransaction: vi.fn().mockResolvedValue(true),
    };

    mockMerchantService = {
      merchants: signal(merchants),
      findOrCreateMerchant: vi
        .fn()
        .mockResolvedValue(createMockMerchant({ _id: 'new-merchant' as Id<'merchant'>, name: 'New Merchant' })),
      updateMerchant: vi.fn().mockResolvedValue(true),
    };

    const bankAccountSignal = signal(bankAccounts);
    mockBankAccountService = {
      bankAccounts: bankAccountSignal,
      activeBankAccounts: bankAccountSignal,
    };

    mockCategoryService = {
      categories: signal([]),
      sortedCategories: signal([]),
      activeGroups: signal([]),
    };

    mockWorkspaceService = {
      workspaceId: signal('workspace-1'),
      workspaceShortId: signal('ws1'),
    };

    mockConvexService = {
      mutation: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [TransactionDetailsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TransactionPageService, useValue: mockTransactionPageService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: MerchantService, useValue: mockMerchantService },
        { provide: BankAccountService, useValue: mockBankAccountService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BudgetService, useValue: { months: signal([]), readyToAssign: signal(0n) } },
        {
          provide: CurrencyService,
          useValue: {
            currencyCode: signal('USD'),
            format: (amount: bigint) => `$${(Number(amount) / 100).toFixed(2)}`,
          },
        },
        { provide: CurrentMonthService, useValue: { currentYearMonth: signal(202606) } },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: ConvexService, useValue: mockConvexService },
        { provide: LocalAuthService, useValue: {} },
        { provide: NavigationService, useValue: {} },
        { provide: ScheduledTransactionService, useValue: { scheduledTransactions: signal([]) } },
        { provide: Router, useValue: { navigate: vi.fn(), events: EMPTY, url: '/ws/transactions' } },
        { provide: ActivatedRoute, useValue: { params: signal({}) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionDetailsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('bank match review', () => {
    it.each(['needs_review', 'reviewed'] as const)('offers unlink for a %s match', (reviewStatus) => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          reviewStatus,
          linkedRawTransactionId: 'raw' as Id<'transactionImportRaw'>,
          importDetails: { provider: 'plaid', amount: -5000n, date: '2024-01-15' },
        })
      );
      fixture.detectChanges();
      const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
      expect(buttons.some((button) => button.textContent?.includes('Not the same transaction'))).toBe(true);
    });

    it('does not offer unlink for an ordinary unmatched bank import', () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          reviewStatus: 'reviewed',
          importDetails: { provider: 'plaid', amount: -5000n, date: '2024-01-15' },
        })
      );
      fixture.detectChanges();
      const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
      expect(buttons.some((button) => button.textContent?.includes('Not the same transaction'))).toBe(false);
    });

    it('offers date resolution even when the bank posts only one day later', () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          reviewStatus: 'needs_review',
          linkedRawTransactionId: 'raw' as Id<'transactionImportRaw'>,
          importDetails: { provider: 'plaid', amount: -5000n, date: '2024-01-16' },
        })
      );
      expect(component.hasLinkDiscrepancies()).toBe(true);
    });

    it.each(['confirmLinkDirectly', 'unlinkDirectly', 'onLinkApproved', 'onLinkUnlinked'] as const)(
      '%s refreshes bank metadata and resolved amounts',
      async (action) => {
        const refreshed = createMockTransaction({ amount: -5500n, reviewStatus: 'reviewed' });
        mockTransactionService.fetchTransactionById.mockResolvedValue(refreshed);
        await component[action]();
        expect(mockTransactionService.fetchTransactionById).toHaveBeenCalledWith('tx-1');
        expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith(refreshed);
      }
    );

    it('does not claim a failed unlink succeeded', async () => {
      mockTransactionService.unlinkTransaction.mockResolvedValue(false);
      await component.unlinkDirectly();
      expect(mockTransactionPageService.setTransaction).not.toHaveBeenCalled();
      expect(component.savingLinkApproval()).toBe(false);
    });
  });

  describe('payeeBankAccounts computed', () => {
    it('should return all bank accounts including current transaction bank account', () => {
      const result = component.payeeBankAccounts();
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.name)).toContain('Checking');
      expect(result.map((a) => a.name)).toContain('Savings');
    });

    it('should return all accounts if no current transaction bank account', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ bankAccountId: undefined }));
      const result = component.payeeBankAccounts();
      expect(result).toHaveLength(2);
    });
  });

  describe('displayMerchantId computed', () => {
    it('should return transaction merchantId when no optimistic update', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ merchantId: 'merchant-1' as Id<'merchant'> }));
      expect(component.displayMerchantId()).toBe('merchant-1');
    });

    it('should return optimistic merchantId when set', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ merchantId: 'merchant-1' as Id<'merchant'> }));
      component['optimisticMerchantId'].set('merchant-2');
      expect(component.displayMerchantId()).toBe('merchant-2');
    });

    it('should return null when optimistic value is explicitly null', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ merchantId: 'merchant-1' as Id<'merchant'> }));
      component['optimisticMerchantId'].set(null);
      expect(component.displayMerchantId()).toBeNull();
    });
  });

  describe('displayIsTransfer computed', () => {
    it('should return true when transaction type is transfer', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ type: 'transfer' }));
      expect(component.displayIsTransfer()).toBe(true);
    });

    it('should return false when transaction type is expense', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ type: 'expense' }));
      expect(component.displayIsTransfer()).toBe(false);
    });

    it('should use optimistic transfer state when set', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ type: 'expense' }));
      component['optimisticIsTransfer'].set(true);
      expect(component.displayIsTransfer()).toBe(true);
    });
  });

  describe('transfer suggestion rejection', () => {
    const suggestedTransfer = {
      transferConfidence: 82,
      accountConfidence: 70,
      suggestedCounterpartAccountId: 'bank-2' as Id<'bankAccount'>,
      detectionReason: 'amount_match',
      status: 'pending' as const,
    };

    it('renders the suggestion card above the amount direction and offers direct rejection', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ suggestedTransfer }));

      fixture.detectChanges();

      const orderedElements = fixture.nativeElement.querySelectorAll(
        '[data-testid="transfer-suggestion-card"], app-amount-sign-toggle'
      );
      const rejectButton = fixture.nativeElement.querySelector(
        '[data-testid="reject-transfer-suggestion"]'
      ) as HTMLElement | null;

      expect(orderedElements).toHaveLength(2);
      expect((orderedElements[0] as HTMLElement).dataset['testid']).toBe('transfer-suggestion-card');
      expect((orderedElements[0] as HTMLElement).textContent).toContain('Possible Transfer');
      expect(rejectButton?.textContent).toContain('Not a Transfer');
    });

    it('marks only the suggestion as rejected after the service succeeds', async () => {
      const transaction = createMockTransaction({
        amount: 366518n,
        bankAccountId: 'bank-1' as Id<'bankAccount'>,
        type: 'regular',
        suggestedTransfer,
      });
      mockTransactionPageService.transaction.set(transaction);

      await component.rejectTransferSuggestionDirectly();

      expect(mockTransactionService.rejectTransferSuggestion).toHaveBeenCalledWith(transaction._id);
      expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith({
        ...transaction,
        suggestedTransfer: {
          ...suggestedTransfer,
          status: 'rejected',
        },
      });
      expect(component.amountSign()).toBe('inflow');
      expect(component.displayBankAccountId()).toBe('bank-1');
      expect(component.displayIsTransfer()).toBe(false);
      expect(component.error()).toBeNull();
      expect(component.savingTransferApproval()).toBe(false);
    });

    it('keeps the suggestion pending and exposes an error when rejection fails', async () => {
      const transaction = createMockTransaction({ suggestedTransfer });
      mockTransactionPageService.transaction.set(transaction);
      mockTransactionService.rejectTransferSuggestion.mockResolvedValueOnce(false);

      await component.rejectTransferSuggestionDirectly();

      expect(mockTransactionPageService.setTransaction).not.toHaveBeenCalled();
      expect(mockTransactionPageService.transaction()?.suggestedTransfer?.status).toBe('pending');
      expect(component.error()).toBe('Failed to reject transfer suggestion');
      expect(component.savingTransferApproval()).toBe(false);
    });

    it('does not apply a stale rejection response to a newly routed transaction', async () => {
      let resolveRejection: (success: boolean) => void = () => undefined;
      mockTransactionService.rejectTransferSuggestion.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRejection = resolve;
          })
      );
      const originalTransaction = createMockTransaction({ suggestedTransfer });
      const newlyRoutedTransaction = createMockTransaction({
        _id: 'tx-2' as Id<'transaction'>,
        suggestedTransfer,
      });
      mockTransactionPageService.transaction.set(originalTransaction);

      const rejection = component.rejectTransferSuggestionDirectly();
      mockTransactionPageService.transaction.set(newlyRoutedTransaction);
      resolveRejection(true);
      await rejection;

      expect(mockTransactionPageService.setTransaction).not.toHaveBeenCalled();
      expect(mockTransactionPageService.transaction()).toBe(newlyRoutedTransaction);
      expect(component.error()).toBeNull();
      expect(component.savingTransferApproval()).toBe(false);
    });
  });

  describe('transfer suggestion approval', () => {
    const suggestedTransfer = {
      transferConfidence: 82,
      accountConfidence: 70,
      suggestedCounterpartAccountId: 'bank-2' as Id<'bankAccount'>,
      detectionReason: 'amount_match',
      status: 'pending' as const,
    };

    it('replaces the page state with the complete server transaction after approval', async () => {
      const transaction = createMockTransaction({ suggestedTransfer });
      const refreshedTransaction = createMockTransaction({
        type: 'transfer',
        merchantId: undefined,
        merchant: null,
        transferPairId: 'tx-pair' as Id<'transaction'>,
        suggestedTransfer: { ...suggestedTransfer, status: 'approved' as const },
      });
      mockTransactionPageService.transaction.set(transaction);
      mockTransactionService.fetchTransactionById.mockResolvedValueOnce(refreshedTransaction);

      await component.onTransferApproved(transaction._id);

      expect(mockTransactionService.fetchTransactionById).toHaveBeenCalledWith(transaction._id);
      expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith(refreshedTransaction);
    });

    it('does not apply a stale approval refresh to a newly routed transaction', async () => {
      let resolveRefresh: (transaction: TransactionWithRelations) => void = () => undefined;
      mockTransactionService.fetchTransactionById.mockImplementationOnce(
        () =>
          new Promise<TransactionWithRelations>((resolve) => {
            resolveRefresh = resolve;
          })
      );
      const originalTransaction = createMockTransaction({ suggestedTransfer });
      const newlyRoutedTransaction = createMockTransaction({
        _id: 'tx-2' as Id<'transaction'>,
        suggestedTransfer,
      });
      const refreshedOriginal = createMockTransaction({
        type: 'transfer',
        suggestedTransfer: { ...suggestedTransfer, status: 'approved' as const },
      });
      mockTransactionPageService.transaction.set(originalTransaction);

      const approval = component.onTransferApproved(originalTransaction._id);
      mockTransactionPageService.transaction.set(newlyRoutedTransaction);
      resolveRefresh(refreshedOriginal);
      await approval;

      expect(mockTransactionPageService.setTransaction).not.toHaveBeenCalled();
      expect(mockTransactionPageService.transaction()).toBe(newlyRoutedTransaction);
    });
  });

  describe('onPayeeChange', () => {
    describe('regular transaction to merchant', () => {
      it('should update merchant via updateTransaction', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-2' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.updateTransaction).toHaveBeenCalledWith(
          'tx-1',
          expect.objectContaining({ merchantId: 'merchant-2' })
        );
      });

      it('should not set reviewStatus when merchant changes', async () => {
        mockTransactionPageService.transaction.set(createMockTransaction({ reviewStatus: 'needs_review' }));
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-2' };
        await component.onPayeeChange(change);

        const updateArgs = mockTransactionService.updateTransaction.mock.calls[0]?.[1] as {
          merchantId?: string | null;
          reviewStatus?: string;
        };
        expect(updateArgs.merchantId).toBe('merchant-2');
        expect(updateArgs.reviewStatus).toBeUndefined();
      });

      it('should set optimistic merchant ID immediately', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-2' };

        // Start the async operation
        const promise = component.onPayeeChange(change);

        // Check optimistic state was set (before promise completes)
        expect(component['optimisticMerchantId']()).toBe('merchant-2');

        await promise;
      });

      it('should clear merchant when selecting no merchant', async () => {
        mockTransactionPageService.transaction.set(
          createMockTransaction({ merchantId: 'merchant-1' as Id<'merchant'> })
        );

        const change: PayeeChangeEvent = { type: 'merchant', id: null };
        await component.onPayeeChange(change);

        expect(mockTransactionService.updateTransaction).toHaveBeenCalledWith(
          'tx-1',
          expect.objectContaining({ merchantId: null })
        );
      });

      it('should create new merchant when pendingName is provided', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: null, pendingName: 'New Store' };
        await component.onPayeeChange(change);

        expect(mockMerchantService.findOrCreateMerchant).toHaveBeenCalledWith('New Store');
        expect(mockTransactionService.updateTransaction).toHaveBeenCalled();
      });

      it('should set pending merchant name for optimistic UI update', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: null, pendingName: 'New Store' };

        const promise = component.onPayeeChange(change);

        expect(component['pendingMerchantName']()).toBe('New Store');

        await promise;
      });
    });

    describe('regular transaction to transfer (convert to transfer)', () => {
      it('should call convertToTransfer when selecting bank account', async () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.convertToTransfer).toHaveBeenCalledWith('tx-1', 'bank-2');
      });

      it('should set optimistic isTransfer to true', async () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };

        const promise = component.onPayeeChange(change);

        expect(component['optimisticIsTransfer']()).toBe(true);
        expect(component['optimisticTransferPairBankAccountId']()).toBe('bank-2');

        await promise;
      });

      it('should refresh transaction after successful conversion', async () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.fetchTransactionById).toHaveBeenCalledWith('tx-1');
        expect(mockTransactionPageService.setTransaction).toHaveBeenCalled();
      });
    });

    describe('transfer to different bank account (update transfer)', () => {
      beforeEach(() => {
        mockTransactionPageService.transaction.set(
          createMockTransaction({
            type: 'transfer',
            amount: -5000n,
            transferPairId: 'tx-pair' as Id<'transaction'>,
            transferPairAccountName: 'Savings',
          })
        );
      });

      it('should call updateTransfer with toAccountId for outflow', async () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.updateTransfer).toHaveBeenCalledWith(
          'tx-1',
          expect.objectContaining({ toAccountId: 'bank-2' })
        );
      });

      it('should call updateTransfer with fromAccountId for inflow', async () => {
        mockTransactionPageService.transaction.set(
          createMockTransaction({
            type: 'transfer',
            amount: 5000n, // positive = inflow
            transferPairId: 'tx-pair' as Id<'transaction'>,
            transferPairAccountName: 'Savings',
          })
        );

        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.updateTransfer).toHaveBeenCalledWith(
          'tx-1',
          expect.objectContaining({ fromAccountId: 'bank-2' })
        );
      });

      it('should set optimistic transfer pair bank account ID', async () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };

        const promise = component.onPayeeChange(change);

        expect(component['optimisticTransferPairBankAccountId']()).toBe('bank-2');

        await promise;
      });
    });

    describe('transfer to merchant (convert from transfer)', () => {
      beforeEach(() => {
        mockTransactionPageService.transaction.set(
          createMockTransaction({
            type: 'transfer',
            amount: -5000n,
            transferPairId: 'tx-pair' as Id<'transaction'>,
            transferPairAccountName: 'Savings',
          })
        );
      });

      it('should call convertFromTransfer then set merchant', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-1' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.convertFromTransfer).toHaveBeenCalledWith('tx-1', expect.any(Array), {
          silent: true,
        });
        expect(mockTransactionService.fetchTransactionById).toHaveBeenCalled();
      });

      it('should set optimistic isTransfer to false', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-1' };

        const promise = component.onPayeeChange(change);

        expect(component['optimisticIsTransfer']()).toBe(false);

        await promise;
      });

      it('should handle new merchant creation during conversion', async () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: null, pendingName: 'New Store' };
        await component.onPayeeChange(change);

        expect(mockTransactionService.convertFromTransfer).toHaveBeenCalled();
        expect(mockMerchantService.findOrCreateMerchant).toHaveBeenCalledWith('New Store');
      });
    });
  });

  describe('transferPairBankAccountId computed', () => {
    it('should return null for non-transfer transactions', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ type: 'expense' }));
      expect(component.transferPairBankAccountId()).toBeNull();
    });

    it('should find bank account by name for transfer transactions', () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          type: 'transfer',
          transferPairId: 'tx-pair' as Id<'transaction'>,
          transferPairAccountName: 'Savings',
        })
      );
      expect(component.transferPairBankAccountId()).toBe('bank-2');
    });

    it('should use optimistic value when set', () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          type: 'transfer',
          transferPairId: 'tx-pair' as Id<'transaction'>,
          transferPairAccountName: 'Savings',
        })
      );
      component['optimisticTransferPairBankAccountId'].set('bank-1');
      expect(component.transferPairBankAccountId()).toBe('bank-1');
    });
  });

  describe('displayMerchantName computed', () => {
    it('should return merchant name from transaction', () => {
      const merchant = createMockMerchant({ _id: 'merchant-1' as Id<'merchant'>, name: 'Amazon' });
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          merchantId: 'merchant-1' as Id<'merchant'>,
          merchantName: 'Amazon',
          merchant,
        })
      );
      expect(component.displayMerchantName()).toBe('Amazon');
    });

    it('should return pending merchant name when set', () => {
      component['pendingMerchantName'].set('New Pending Merchant');
      expect(component.displayMerchantName()).toBe('New Pending Merchant');
    });

    it('should lookup merchant name from optimistic ID', () => {
      component['optimisticMerchantId'].set('merchant-2');
      expect(component.displayMerchantName()).toBe('Walmart');
    });
  });

  describe('error handling', () => {
    it('should revert optimistic state on update error', async () => {
      mockTransactionService.updateTransaction.mockRejectedValue(new Error('Update failed'));

      mockTransactionPageService.transaction.set(createMockTransaction({ merchantId: 'merchant-1' as Id<'merchant'> }));

      const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-2' };

      // This should not throw
      await component.onPayeeChange(change);

      // Should have set error
      expect(component['error']()).toBe('Failed to update merchant');
    });

    it('should revert optimistic state on conversion error', async () => {
      mockTransactionService.convertToTransfer.mockRejectedValue(new Error('Conversion failed'));

      const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };

      await component.onPayeeChange(change);

      expect(component['error']()).toBe('Failed to convert to transfer');
      expect(component['optimisticIsTransfer']()).toBeUndefined();
    });
  });

  describe('concurrent call prevention', () => {
    it('should prevent concurrent merchant updates', async () => {
      component['savingMerchant'].set(true);

      const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-2' };
      await component.onPayeeChange(change);

      expect(mockTransactionService.updateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('form disabled state', () => {
    it('should be disabled when transaction is reconciled', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ status: 'reconciled' }));
      expect(component.isFormDisabled()).toBe(true);
    });

    it('should not be disabled when transaction is cleared', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ status: 'cleared' }));
      expect(component.isFormDisabled()).toBe(false);
    });

    it('keeps the date in a separate due row and disables both rows when deleted', async () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ isDeleted: true }));
      fixture.detectChanges();
      await fixture.whenStable();

      const propertiesRow = fixture.nativeElement.querySelector('[data-testid="properties-row"]');
      const dueRow = fixture.nativeElement.querySelector('[data-testid="due-row"]');
      const statusRow = fixture.nativeElement.querySelector('[data-testid="status-row"]');
      const propertyTriggers = propertiesRow?.querySelectorAll('[data-slot="combobox-trigger"]') ?? [];
      const propertyButtons = propertiesRow?.querySelectorAll('button') ?? [];
      const dueButton = dueRow?.querySelector('button');

      expect(propertiesRow?.querySelector('app-payee-selector')).not.toBeNull();
      expect(propertiesRow?.querySelector(':scope > span')?.textContent).toContain('Properties');
      expect(propertiesRow?.querySelector('app-transaction-date-picker')).toBeNull();
      expect(dueRow?.querySelector(':scope > span')?.textContent).toContain('Due');
      expect(dueRow?.querySelector('app-transaction-date-picker')).not.toBeNull();
      expect(propertiesRow?.nextElementSibling).toBe(dueRow);
      expect(dueRow?.nextElementSibling).toBe(statusRow);
      expect(propertyTriggers.length).toBeGreaterThan(0);
      expect([...propertyButtons].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
      expect(dueButton?.disabled).toBe(true);
    });

    it('ignores property changes while the transaction is deleted', async () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ isDeleted: true }));

      await component.onPayeeChange({ type: 'merchant', id: 'merchant-2' });
      await component.selectBankAccount('bank-2');
      component.selectCategory(null);

      expect(mockTransactionService.updateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('planned transaction linking visibility', () => {
    it('shows the planned section for transfer transactions', () => {
      mockTransactionPageService.transaction.set(createMockTransaction({ type: 'transfer' }));

      expect(component.showPlannedSection()).toBe(true);
    });

    it('shows the assigned due date separately from the transaction posting date', () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-09-16',
          date: '2026-09-14',
        })
      );

      expect(component.linkedPlannedOccurrenceLabel()).toBe('Sep 16, 2026');
    });

    it('restores exact occurrence assignments when a link change is undone and redone', async () => {
      const pushAction = vi.spyOn(TestBed.inject(UndoRedoService), 'pushAction');
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-old' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-08-16',
        })
      );
      mockTransactionService.fetchTransactionById.mockResolvedValue(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-new' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-09-16',
        })
      );

      await component.linkToPlannedTransaction('scheduled-new', false, '2026-09-16');

      expect(mockConvexService.mutation).toHaveBeenLastCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          linkedScheduledTransactionId: 'scheduled-new',
          linkedScheduledOccurrenceDate: '2026-09-16',
        })
      );
      const action = pushAction.mock.calls[0][0] as UndoableAction;
      await action.undo();
      expect(mockConvexService.mutation).toHaveBeenLastCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          linkedScheduledTransactionId: 'scheduled-old',
          linkedScheduledOccurrenceDate: '2026-08-16',
        })
      );
      await action.redo();
      expect(mockConvexService.mutation).toHaveBeenLastCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          linkedScheduledTransactionId: 'scheduled-new',
          linkedScheduledOccurrenceDate: '2026-09-16',
        })
      );
    });

    it('restores the original occurrence when unlinking is undone', async () => {
      const pushAction = vi.spyOn(TestBed.inject(UndoRedoService), 'pushAction');
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-09-16',
        })
      );

      await component.unlinkFromPlannedTransaction();
      const action = pushAction.mock.calls[0][0] as UndoableAction;
      await action.undo();

      expect(mockConvexService.mutation).toHaveBeenLastCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          linkedScheduledTransactionId: 'scheduled-1',
          linkedScheduledOccurrenceDate: '2026-09-16',
        })
      );
    });

    it('preserves the occurrence when an existing link is submitted unchanged', async () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-09-16',
        })
      );

      await component.linkToPlannedTransaction('scheduled-1', true);

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({ linkedScheduledOccurrenceDate: '2026-09-16' })
      );
    });

    it('refreshes a planned link after an edit makes the transaction incompatible', async () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
          scheduledOccurrenceDate: '2026-09-16',
          merchantId: 'merchant-1' as Id<'merchant'>,
        })
      );
      const detached = createMockTransaction({
        merchantId: 'merchant-2' as Id<'merchant'>,
        scheduledTransactionId: undefined,
        scheduledOccurrenceDate: undefined,
      });
      mockTransactionService.fetchTransactionById.mockResolvedValue(detached);

      await component.onPayeeChange({ type: 'merchant', id: 'merchant-2' });

      expect(mockTransactionService.fetchTransactionById).toHaveBeenCalledWith('tx-1');
      expect(mockTransactionPageService.setTransaction).toHaveBeenLastCalledWith(detached);
    });
  });

  describe('needs_review preservation', () => {
    it('should preserve needs_review in local state after bank account edit', async () => {
      const txWithReview = createMockTransaction({ reviewStatus: 'needs_review' });
      mockTransactionPageService.transaction.set(txWithReview);
      mockTransactionService.fetchTransactionById.mockResolvedValue(
        createMockTransaction({ reviewStatus: 'needs_review', bankAccountId: 'bank-2' as Id<'bankAccount'> })
      );

      await component.selectBankAccount('bank-2');

      expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ reviewStatus: 'needs_review' })
      );
      expect(mockTransactionPageService.setTransaction).not.toHaveBeenCalledWith(
        expect.objectContaining({ reviewStatus: 'reviewed' })
      );
    });

    it('should preserve review status when toggling pending status', async () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({ reviewStatus: 'needs_review', status: 'cleared' })
      );

      await component.togglePending();

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          transactionId: 'tx-1',
          status: 'pending',
          preserveReviewStatus: true,
        })
      );
    });
  });

  describe('split amounts', () => {
    it('should save outflow split movements as negative amounts', async () => {
      component.transactionAmountEdit.set(-5000);
      component.localSplits.set([
        { amount: -2500n, categoryId: 'cat-1' as Id<'category'> },
        { amount: -2500n, readyToAssign: true },
      ]);

      await component.handleSaveSplits();

      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          transactionId: 'tx-1',
          movements: [expect.objectContaining({ amount: -2500n }), expect.objectContaining({ amount: -2500n })],
        })
      );
    });

    it('should normalize and save open split movement signs when the transaction sign changes', () => {
      component.isSplitMode.set(true);
      component.transactionAmountEdit.set(-5000);
      component.localSplits.set([{ amount: -2500n }, { amount: -2500n }]);

      component.onSignChange('inflow');

      expect(component.transactionAmountEdit()).toBe(5000);
      expect(component.localSplits()).toEqual([{ amount: 2500n }, { amount: 2500n }]);
      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          transactionId: 'tx-1',
          movements: [expect.objectContaining({ amount: 2500n }), expect.objectContaining({ amount: 2500n })],
        })
      );
    });

    it('should keep local transaction state in single-movement mode after saving one split', async () => {
      mockTransactionPageService.transaction.set(
        createMockTransaction({
          amount: -5000n,
          movements: [
            {
              _creationTime: Date.now(),
              amount: -2500n,
              categoryId: 'cat-1' as Id<'category'>,
              category: null,
              readyToAssign: false,
              sortOrder: 0,
            },
            {
              _creationTime: Date.now(),
              amount: -2500n,
              categoryId: 'cat-2' as Id<'category'>,
              category: null,
              readyToAssign: false,
              sortOrder: 1,
            },
          ],
        })
      );
      component.isSplitMode.set(true);
      component.transactionAmountEdit.set(-5000);
      component.localSplits.set([{ amount: -5000n, categoryId: 'cat-1' as Id<'category'> }]);

      await component.handleSaveSplits();

      expect(component.isSplitMode()).toBe(false);
      expect(component.localSplits()).toEqual([]);
      expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: -5000n,
          movements: [expect.objectContaining({ amount: -5000n, categoryId: 'cat-1' })],
        })
      );
    });
  });
});
