import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { api } from 'convex/_generated/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankAccountService } from '../../services/bank-account.service';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { CurrentMonthService } from '../../services/current-month.service';
import { IconService } from '../../services/icon.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionService } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { TransactionRowComponent } from './transaction-row';

// Helper function to create mock transactions
function createMockTransaction(overrides?: Partial<TransactionWithRelations>): TransactionWithRelations {
  return {
    _id: 'test-transaction-id' as any,
    _creationTime: Date.now(),
    amount: 5000n,
    bankAccount: null,
    merchant: null,
    merchantName: 'Test Merchant',
    merchantLogo: null,
    project: null,
    movements: [],
    transferPairAccountName: null,
    date: '2024-01-15',
    type: 'expense',
    status: 'cleared',
    ...overrides,
  } as TransactionWithRelations;
}

describe('TransactionRowComponent', () => {
  let component: TransactionRowComponent;
  let fixture: ComponentFixture<TransactionRowComponent>;
  let mockIconService: IconService;
  let mockNavigationService: NavigationService;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    mockIconService = {
      getIconByName: vi.fn(),
    } as unknown as IconService;

    mockNavigationService = {
      getTransactionRoute: vi.fn((id: string) => ['/', 'workspace', 'transactions', id]),
      getBankAccountRoute: vi.fn((id: string) => ['/', 'workspace', 'accounts', id]),
      getMerchantRoute: vi.fn((id: string) => ['/', 'workspace', 'merchants', id]),
    } as unknown as NavigationService;

    await TestBed.configureTestingModule({
      imports: [TransactionRowComponent, RouterTestingModule],
      providers: [
        { provide: IconService, useValue: mockIconService },
        { provide: NavigationService, useValue: mockNavigationService },
        {
          provide: TransactionService,
          useValue: {
            updateTransaction: vi.fn().mockResolvedValue(true),
            updateTransactionSchedule: vi.fn().mockResolvedValue({ success: true }),
            openMakeRecurringDialog: vi.fn(),
          },
        },
        { provide: CategoryService, useValue: { categories: signal([]), activeGroups: signal([]) } },
        { provide: BudgetService, useValue: { months: signal([]), readyToAssign: signal(0n) } },
        {
          provide: CurrencyService,
          useValue: {
            format: (amount: bigint | number) =>
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
              }).format(Number(amount) / 100),
          },
        },
        { provide: CurrentMonthService, useValue: { currentYearMonth: signal(202606) } },
        { provide: MerchantService, useValue: { merchants: signal([]), activeMerchants: signal([]) } },
        { provide: BankAccountService, useValue: { bankAccounts: signal([]), activeBankAccounts: signal([]) } },
        { provide: ConvexService, useValue: { mutation: vi.fn() } },
        { provide: WorkspaceService, useValue: { workspaceId: signal('workspace-1') } },
        { provide: UndoRedoService, useValue: { pushAction: vi.fn(), undo: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionRowComponent);
    component = fixture.componentInstance;

    // Set required input using setInput (Angular's way to set input signals in tests)
    fixture.componentRef.setInput('transaction', createMockTransaction());
  });

  describe('formatAmount', () => {
    it('should format positive amount correctly', () => {
      const result = component.formatAmount(5000);
      expect(result.display).toBe('+$50.00');
      expect(result.isPositive).toBe(true);
    });

    it('should format negative amount correctly', () => {
      const result = component.formatAmount(-5000);
      // Negative amounts are formatted without minus sign (only positive gets + prefix)
      expect(result.display).toBe('$50.00');
      expect(result.isPositive).toBe(false);
    });

    it('should handle bigint input', () => {
      const result = component.formatAmount(123456n);
      expect(result.display).toBe('+$1,234.56');
      expect(result.isPositive).toBe(true);
    });

    it('should handle zero amount', () => {
      const result = component.formatAmount(0);
      expect(result.display).toBe('+$0.00');
      expect(result.isPositive).toBe(true);
    });

    it('should handle large amounts', () => {
      const result = component.formatAmount(1000000);
      expect(result.display).toBe('+$10,000.00');
      expect(result.isPositive).toBe(true);
    });
  });

  describe('formatDate', () => {
    it('should format date-only string correctly', () => {
      const result = component.formatDate('2024-01-15');
      expect(result).toMatch(/Jan\s+15/);
    });

    it('should format ISO date string correctly', () => {
      const result = component.formatDate('2024-01-15T10:30:00Z');
      expect(result).toMatch(/Jan\s+15/);
    });

    it('should include year for previous year dates', () => {
      const lastYear = new Date();
      lastYear.setFullYear(lastYear.getFullYear() - 1);
      const dateString = lastYear.toISOString().split('T')[0];
      const result = component.formatDate(dateString);
      expect(result).toContain(lastYear.getFullYear().toString());
    });

    it('should return N/A for null date', () => {
      const result = component.formatDate(null);
      expect(result).toBe('N/A');
    });

    it('should return N/A for invalid date string', () => {
      const result = component.formatDate('invalid-date');
      expect(result).toBe('N/A');
    });
  });

  describe('getBankAccountName', () => {
    it('should return bank account name when available', () => {
      const transaction = createMockTransaction({
        bankAccount: {
          _id: 'bank-1' as any,
          _creationTime: Date.now(),
          name: 'Checking Account',
          workspaceId: 'workspace-1' as any,
          isDeleted: false,
        } as any,
      });

      const result = component.getBankAccountName(transaction);
      expect(result).toBe('Checking Account');
    });

    it('should return "Unknown Account" when bank account is null', () => {
      const transaction = createMockTransaction();
      const result = component.getBankAccountName(transaction);
      expect(result).toBe('Unknown Account');
    });
  });

  describe('category display', () => {
    it('shows every split category and amount without an editable selector', () => {
      const transaction = createMockTransaction({
        type: 'regular',
        amount: -5000n,
        movements: [
          {
            category: { name: 'Groceries' },
            amount: -3200n,
            readyToAssign: false,
            sortOrder: 0,
          },
          {
            category: { name: 'Dining' },
            amount: -1800n,
            readyToAssign: false,
            sortOrder: 1,
          },
        ] as unknown as TransactionWithRelations['movements'],
      });
      fixture.componentRef.setInput('transaction', transaction);

      fixture.detectChanges();

      const tags = Array.from(
        fixture.nativeElement.querySelectorAll<HTMLElement>('[data-testid="transaction-category-tag"]')
      );
      expect(tags).toHaveLength(2);
      expect(tags[0]?.textContent).toContain('Groceries');
      expect(tags[0]?.textContent).toContain('$32.00');
      expect(tags[1]?.textContent).toContain('Dining');
      expect(tags[1]?.textContent).toContain('$18.00');
      expect(fixture.nativeElement.querySelector('app-category-selector')).toBeNull();
    });

    it('keeps the editable category picker for a single movement', () => {
      const movement = {
        category: null,
        amount: -5000n,
        readyToAssign: true,
        sortOrder: 0,
      } as unknown as TransactionWithRelations['movements'][number];
      const transaction = createMockTransaction({ type: 'regular', movements: [movement] });
      fixture.componentRef.setInput('transaction', transaction);

      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-category-selector')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="transaction-category-tag"]')).toBeNull();
    });
  });

  describe('transfer suggestion display', () => {
    it('keeps the imported merchant and category presentation while showing the suggestion badge', () => {
      const merchantId = 'merchant-1' as NonNullable<TransactionWithRelations['merchantId']>;
      const transaction = createMockTransaction({
        type: 'regular',
        merchantId,
        merchant: {
          _id: merchantId,
          name: 'Venmo',
        },
        merchantName: 'Venmo',
        movements: [
          {
            amount: 5000n,
            categoryId: undefined,
            category: null,
            readyToAssign: false,
            sortOrder: 0,
          },
        ] as unknown as TransactionWithRelations['movements'],
        suggestedTransfer: {
          transferConfidence: 80,
          accountConfidence: 60,
          detectionReason: 'name_pattern',
          status: 'pending',
        },
      });
      fixture.componentRef.setInput('transaction', transaction);

      fixture.detectChanges();

      expect(component.displayAsTransfer()).toBe(false);
      expect(component.displayMerchantId()).toBe(merchantId);
      expect(fixture.nativeElement.querySelector('app-payee-selector')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-category-selector')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[title="Transfer suggested"]')).not.toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Transfer suggestion');
    });
  });

  describe('isPending', () => {
    it('should return true when status is pending', () => {
      const transaction = createMockTransaction({
        status: 'pending',
      });

      const result = component.isPending(transaction);
      expect(result).toBe(true);
    });

    it('should return false when status is cleared', () => {
      const transaction = createMockTransaction({
        status: 'cleared',
      });

      const result = component.isPending(transaction);
      expect(result).toBe(false);
    });

    it('should return false when status is reconciled', () => {
      const transaction = createMockTransaction({
        status: 'reconciled',
      });

      const result = component.isPending(transaction);
      expect(result).toBe(false);
    });
  });

  describe('getMerchantName', () => {
    it('should return merchantName when available', () => {
      const transaction = createMockTransaction({
        merchantName: 'Test Store',
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('Test Store');
    });

    it('should return "—" when merchantName is null', () => {
      const transaction = createMockTransaction({
        merchantName: null,
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('—');
    });

    it('should return transfer label when type is transfer', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        transferPairAccountName: 'Savings Account',
        amount: -5000n,
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('Transfer to Savings Account');
    });

    it('should return transfer-from label for positive transfer amount', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        transferPairAccountName: 'Savings Account',
        amount: 5000n,
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('Transfer from Savings Account');
    });
  });

  describe('getMerchantLogo', () => {
    it('should return merchantLogo when available', () => {
      const transaction = createMockTransaction({
        merchantLogo: 'https://example.com/logo.png',
      });

      const result = component.getMerchantLogo(transaction);
      expect(result).toBe('https://example.com/logo.png');
    });

    it('should return null when merchantLogo is null', () => {
      const transaction = createMockTransaction({
        merchantLogo: null,
      });

      const result = component.getMerchantLogo(transaction);
      expect(result).toBeNull();
    });

    it('should return null when type is transfer', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        merchantLogo: 'https://example.com/logo.png',
      });

      const result = component.getMerchantLogo(transaction);
      expect(result).toBeNull();
    });
  });

  describe('isTransfer', () => {
    it('should return true when type is transfer', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
      });

      const result = component.isTransfer(transaction);
      expect(result).toBe(true);
    });

    it('should return false when type is not transfer', () => {
      const transaction = createMockTransaction({
        type: 'expense',
      });

      const result = component.isTransfer(transaction);
      expect(result).toBe(false);
    });
  });

  describe('getInstitutionLogo', () => {
    it('should return institution logo when available', () => {
      const transaction = createMockTransaction({
        bankAccount: {
          _id: 'bank-1' as any,
          _creationTime: Date.now(),
          name: 'Checking',
          workspaceId: 'workspace-1' as any,
          isDeleted: false,
          institution: {
            _id: 'institution-1' as any,
            _creationTime: Date.now(),
            logoUrl: 'https://example.com/institution.png',
            name: 'Bank',
            isDeleted: false,
          } as any,
        } as any,
      });

      const result = component.getInstitutionLogo(transaction);
      expect(result).toBe('https://example.com/institution.png');
    });

    it('should return null when institution logo is not available', () => {
      const transaction = createMockTransaction({
        bankAccount: {
          _id: 'bank-1' as any,
          _creationTime: Date.now(),
          name: 'Checking',
          workspaceId: 'workspace-1' as any,
          isDeleted: false,
          institution: null,
        } as any,
      });

      const result = component.getInstitutionLogo(transaction);
      expect(result).toBeNull();
    });

    it('should return null when bank account is null', () => {
      const transaction = createMockTransaction();
      const result = component.getInstitutionLogo(transaction);
      expect(result).toBeNull();
    });
  });

  describe('getTransactionUrl', () => {
    it('should call navigationService.getTransactionRoute', () => {
      const transactionId = 'test-transaction-id';
      component.getTransactionUrl(transactionId);

      expect(mockNavigationService.getTransactionRoute).toHaveBeenCalledWith(transactionId);
    });

    it('should return route array from navigationService', () => {
      const transactionId = 'test-transaction-id';
      const result = component.getTransactionUrl(transactionId);

      expect(result).toEqual(['/', 'workspace', 'transactions', transactionId]);
    });
  });

  describe('needs_review preservation', () => {
    it('does not set reviewStatus when changing a single category inline', async () => {
      const updateTransaction = vi.spyOn(component['transactionService'], 'updateTransaction').mockResolvedValue(true);
      const transaction = createMockTransaction({
        reviewStatus: 'needs_review',
        movements: [
          {
            category: { _id: 'category-1' },
            amount: 5000n,
            readyToAssign: false,
            sortOrder: 0,
          },
        ] as unknown as TransactionWithRelations['movements'],
      });

      await component.onCategoryChange(transaction, 'category-2');

      expect(updateTransaction).toHaveBeenCalledWith(
        transaction._id,
        expect.objectContaining({
          categoryId: 'category-2',
          readyToAssign: false,
        }),
        expect.any(Array)
      );
      const updateArgs = updateTransaction.mock.calls[0]?.[1] as {
        reviewStatus?: string;
      };
      expect(updateArgs.reviewStatus).toBeUndefined();
    });

    it('should preserve review status when updating status from context menu', async () => {
      fixture.componentRef.setInput(
        'transaction',
        createMockTransaction({
          reviewStatus: 'needs_review',
        })
      );
      const mutation = vi.spyOn(component['convex'], 'mutation').mockResolvedValue(undefined);

      await component.onContextMenuUpdateStatus('pending');

      expect(mutation).toHaveBeenCalledWith(
        api.transactions.updateTransaction,
        expect.objectContaining({
          transactionId: 'test-transaction-id',
          status: 'pending',
          preserveReviewStatus: true,
        })
      );
    });
  });

  describe('scheduled transaction updates', () => {
    it('updates only the date when changing the date', async () => {
      const updateSchedule = vi
        .spyOn(component['transactionService'], 'updateTransactionSchedule')
        .mockResolvedValue({ success: true });
      const transaction = createMockTransaction({
        _id: 'tx-1' as TransactionWithRelations['_id'],
        date: '2026-07-09',
        type: 'regular',
      });

      await component.onDateChange(transaction, new Date(2026, 7, 15));

      expect(updateSchedule).toHaveBeenCalledWith('tx-1', {
        date: '2026-08-15',
      });
    });

    it('opens the make-recurring dialog with the current transaction', () => {
      const openMakeRecurringDialog = vi.spyOn(component['transactionService'], 'openMakeRecurringDialog');
      const transaction = createMockTransaction({
        _id: 'tx-1' as TransactionWithRelations['_id'],
        type: 'regular',
      });

      component.onMakeRecurring(transaction);

      expect(openMakeRecurringDialog).toHaveBeenCalledWith(transaction);
    });
  });
});
