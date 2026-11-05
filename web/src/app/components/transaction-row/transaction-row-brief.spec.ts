import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IconService } from '../../services/icon.service';
import { NavigationService } from '../../services/navigation.service';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionRowBriefComponent } from './transaction-row-brief';

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

describe('TransactionRowBriefComponent', () => {
  let component: TransactionRowBriefComponent;
  let fixture: ComponentFixture<TransactionRowBriefComponent>;
  let mockIconService: IconService;
  let mockNavigationService: NavigationService;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    mockIconService = {
      getIconByName: vi.fn(),
    } as unknown as IconService;

    mockNavigationService = {
      getTransactionRoute: vi.fn((id: string) => ['/', 'workspace', 'transactions', id]),
    } as unknown as NavigationService;

    await TestBed.configureTestingModule({
      imports: [TransactionRowBriefComponent, RouterTestingModule],
      providers: [
        { provide: IconService, useValue: mockIconService },
        { provide: NavigationService, useValue: mockNavigationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionRowBriefComponent);
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

  describe('getDateWidth', () => {
    it('should return w-12 for current year dates', () => {
      const currentYear = new Date().getFullYear();
      const dateString = `${currentYear}-01-15`;
      const result = component.getDateWidth(dateString);
      expect(result).toBe('w-12');
    });

    it('should return w-20 for previous year dates', () => {
      const lastYear = new Date().getFullYear() - 1;
      const dateString = `${lastYear}-01-15`;
      const result = component.getDateWidth(dateString);
      expect(result).toBe('w-20');
    });

    it('should return w-20 for null date', () => {
      const result = component.getDateWidth(null);
      expect(result).toBe('w-20');
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

  describe('getCategoryName', () => {
    it('should return category name from first movement', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            category: {
              _id: 'category-1' as any,
              _creationTime: Date.now(),
              name: 'Groceries',
              orgId: 'org-1',
              isDeleted: false,
            } as any,
          } as any,
        ],
      });

      const result = component.getCategoryName(transaction);
      expect(result).toBe('Groceries');
    });

    it('should return "Ready to Assign" when readyToAssign is true', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            readyToAssign: true,
            category: null,
          } as any,
        ],
      });

      const result = component.getCategoryName(transaction);
      expect(result).toBe('Ready to Assign');
    });

    it('should return "Uncategorized" when no category in movements', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            category: null,
          } as any,
        ],
      });

      const result = component.getCategoryName(transaction);
      expect(result).toBe('Uncategorized');
    });

    it('should return "Uncategorized" when no movements', () => {
      const transaction = createMockTransaction();
      const result = component.getCategoryName(transaction);
      expect(result).toBe('Uncategorized');
    });
  });

  describe('hasCategory', () => {
    it('should return true when transaction has category', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            category: {
              _id: 'category-1' as any,
              _creationTime: Date.now(),
              name: 'Groceries',
              orgId: 'org-1',
              isDeleted: false,
            } as any,
          } as any,
        ],
      });

      const result = component.hasCategory(transaction);
      expect(result).toBe(true);
    });

    it('should return true when readyToAssign is true', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            readyToAssign: true,
            category: null,
          } as any,
        ],
      });

      const result = component.hasCategory(transaction);
      expect(result).toBe(true);
    });

    it('should return false when transaction has no category', () => {
      const transaction = createMockTransaction({
        movements: [
          {
            _id: 'movement-1' as any,
            _creationTime: Date.now(),
            category: null,
          } as any,
        ],
      });

      const result = component.hasCategory(transaction);
      expect(result).toBe(false);
    });

    it('should return false when no movements', () => {
      const transaction = createMockTransaction();
      const result = component.hasCategory(transaction);
      expect(result).toBe(false);
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

    it('should return transfer-to label when type is transfer and amount is negative', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        amount: -5000n,
        transferPairAccountName: 'Savings Account',
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('Transfer to Savings Account');
    });

    it('should return transfer-from label when type is transfer and amount is positive', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        amount: 5000n,
        transferPairAccountName: 'Checking Account',
      });

      const result = component.getMerchantName(transaction);
      expect(result).toBe('Transfer from Checking Account');
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

    it('should return transfer pair logo for transfers', () => {
      const transaction = createMockTransaction({
        type: 'transfer',
        transferPairAccountLogo: 'https://example.com/bank.png',
      });

      const result = component.getTransferPairLogo(transaction);
      expect(result).toBe('https://example.com/bank.png');
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
        type: 'regular',
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
});
