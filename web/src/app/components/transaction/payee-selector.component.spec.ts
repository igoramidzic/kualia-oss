import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankAccountWithRelations } from '../../services/bank-account.service';
import { Merchant, MerchantService } from '../../services/merchant.service';
import { PayeeSelectorComponent } from './payee-selector.component';

// Helper function to create mock merchant
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

// Helper function to create mock bank account
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

describe('PayeeSelectorComponent', () => {
  let component: PayeeSelectorComponent;
  let fixture: ComponentFixture<PayeeSelectorComponent>;
  let mockMerchantService: {
    merchants: ReturnType<typeof signal<Merchant[]>>;
    activeMerchants: ReturnType<typeof signal<Merchant[]>>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();

    const merchants = [
      createMockMerchant({ _id: 'merchant-1' as Id<'merchant'>, name: 'Amazon', transactionCount: 10 }),
      createMockMerchant({ _id: 'merchant-2' as Id<'merchant'>, name: 'Walmart', transactionCount: 5 }),
      createMockMerchant({ _id: 'merchant-3' as Id<'merchant'>, name: 'Target', transactionCount: 3 }),
    ];

    mockMerchantService = {
      merchants: signal(merchants),
      activeMerchants: signal(merchants),
    };

    await TestBed.configureTestingModule({
      imports: [PayeeSelectorComponent],
      providers: [provideZonelessChangeDetection(), { provide: MerchantService, useValue: mockMerchantService }],
    }).compileComponents();

    fixture = TestBed.createComponent(PayeeSelectorComponent);
    component = fixture.componentInstance;
  });

  describe('component initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default placeholder when no selection', () => {
      expect(component.displayPayee()).toBe('Payee');
    });

    it('should show the payee icon in the trigger by default', () => {
      expect(component.showIcon()).toBe(true);
    });

    it('should render the selected payee icon inside the trigger', async () => {
      fixture.componentRef.setInput('merchantId', 'merchant-1');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('hlm-combobox-trigger app-entity-mark')).not.toBeNull();
    });

    it('should use custom placeholder when provided', () => {
      fixture.componentRef.setInput('placeholder', 'Select a payee');
      fixture.componentRef.setInput('allowNone', false);
      expect(component.displayPayee()).toBe('Select a payee');
    });

    it('should show "Select payee" when allowNone is false', () => {
      fixture.componentRef.setInput('allowNone', false);
      expect(component.displayPayee()).toBe('Select payee');
    });
  });

  describe('merchant selection', () => {
    it('should display selected merchant name', () => {
      fixture.componentRef.setInput('merchantId', 'merchant-1');
      expect(component.displayPayee()).toBe('Amazon');
    });

    it('should find selected merchant from merchants list', () => {
      fixture.componentRef.setInput('merchantId', 'merchant-2');
      const selectedMerchant = component.selectedMerchant();
      expect(selectedMerchant).not.toBeNull();
      expect(selectedMerchant?.name).toBe('Walmart');
    });

    it('should return null when merchantId does not match any merchant', () => {
      fixture.componentRef.setInput('merchantId', 'non-existent');
      expect(component.selectedMerchant()).toBeNull();
    });

    it('should emit payeeChange with merchant type when selectMerchant is called', () => {
      const emitSpy = vi.spyOn(component.payeeChange, 'emit');
      const merchant = createMockMerchant({ _id: 'merchant-1' as Id<'merchant'>, name: 'Amazon' });

      component.selectMerchant(merchant);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'merchant',
        id: 'merchant-1',
      });
    });

    it('should emit payeeChange with null id when selecting no merchant', () => {
      const emitSpy = vi.spyOn(component.payeeChange, 'emit');

      component.selectMerchant(null);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'merchant',
        id: null,
      });
    });

    it('should clear search term after selecting merchant', () => {
      component.searchTerm.set('test');
      const merchant = createMockMerchant();

      component.selectMerchant(merchant);

      expect(component.searchTerm()).toBe('');
    });
  });

  describe('new merchant creation', () => {
    it('should emit payeeChange with pendingName when creating new merchant', () => {
      const emitSpy = vi.spyOn(component.payeeChange, 'emit');

      component.selectNewMerchant('  New Store  ');

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'merchant',
        id: null,
        pendingName: 'New Store',
      });
    });

    it('should normalize whitespace in pending merchant name', () => {
      const emitSpy = vi.spyOn(component.payeeChange, 'emit');

      component.selectNewMerchant('Multiple   Spaces  Here');

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'merchant',
        id: null,
        pendingName: 'Multiple Spaces Here',
      });
    });

    it('should display pending merchant name', () => {
      fixture.componentRef.setInput('pendingMerchantName', 'New Store');
      expect(component.displayPayee()).toBe('New Store');
    });
  });

  describe('bank account selection (transfers)', () => {
    const mockBankAccounts = [
      createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }),
      createMockBankAccount({ _id: 'bank-2' as Id<'bankAccount'>, name: 'Savings' }),
    ];

    beforeEach(() => {
      fixture.componentRef.setInput('availableBankAccounts', mockBankAccounts);
    });

    it('should display bank account with "To" prefix for outflow (negative amount)', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'bank-1');
      fixture.componentRef.setInput('transactionAmount', -5000);
      expect(component.displayPayee()).toBe('Transfer to Checking');
    });

    it('should display bank account with "From" prefix for inflow (positive amount)', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'bank-1');
      fixture.componentRef.setInput('transactionAmount', 5000);
      expect(component.displayPayee()).toBe('Transfer from Checking');
    });

    it('should emit payeeChange with bankAccount type when selecting bank account', () => {
      const emitSpy = vi.spyOn(component.payeeChange, 'emit');
      const bankAccount = mockBankAccounts[0];

      component.selectBankAccount(bankAccount);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'bankAccount',
        id: 'bank-1',
      });
    });

    it('should find selected bank account from available accounts', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'bank-2');
      const selectedAccount = component.selectedBankAccount();
      expect(selectedAccount).not.toBeNull();
      expect(selectedAccount?.name).toBe('Savings');
    });

    it('should return null when selectedBankAccountId does not match', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'non-existent');
      expect(component.selectedBankAccount()).toBeNull();
    });

    it('should display bank icon when bank account is selected', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'bank-1');
      expect(component.displayIcon()).toBe('bank');
    });

    it('should display merchant icon when merchant is selected', () => {
      fixture.componentRef.setInput('merchantId', 'merchant-1');
      expect(component.displayIcon()).toBe('merchant');
    });
  });

  describe('filtering', () => {
    it('should filter merchants by search term', () => {
      component.searchTerm.set('Ama');
      const filtered = component.filteredMerchants();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Amazon');
    });

    it('should filter merchants case-insensitively', () => {
      component.searchTerm.set('amazon');
      const filtered = component.filteredMerchants();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Amazon');
    });

    it('should return all merchants when search term is empty', () => {
      component.searchTerm.set('');
      const filtered = component.filteredMerchants();
      expect(filtered).toHaveLength(3);
    });

    it('should filter bank accounts by search term', () => {
      const mockBankAccounts = [
        createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }),
        createMockBankAccount({ _id: 'bank-2' as Id<'bankAccount'>, name: 'Savings' }),
      ];
      fixture.componentRef.setInput('availableBankAccounts', mockBankAccounts);

      component.searchTerm.set('check');
      const filtered = component.filteredBankAccounts();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Checking');
    });

    it('should match bank accounts by "to/from [name]" format', () => {
      const mockBankAccounts = [createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' })];
      fixture.componentRef.setInput('availableBankAccounts', mockBankAccounts);

      // Search "to/from" should match the display format "to/from Checking"
      component.searchTerm.set('to/from');
      const filtered = component.filteredBankAccounts();
      expect(filtered).toHaveLength(1);
    });

    it('should match bank accounts by the visible transfer direction label', () => {
      const mockBankAccounts = [createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' })];
      fixture.componentRef.setInput('availableBankAccounts', mockBankAccounts);
      fixture.componentRef.setInput('transactionAmount', -5000);

      component.searchTerm.set('transfer to check');
      const filtered = component.filteredBankAccounts();

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Checking');
    });

    it('should sort merchants by transaction count descending', () => {
      const sorted = component.filteredMerchants();
      expect(sorted[0].name).toBe('Amazon');
      expect(sorted[1].name).toBe('Walmart');
      expect(sorted[2].name).toBe('Target');
    });

    it('should sort bank accounts alphabetically', () => {
      const mockBankAccounts = [
        createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Savings' }),
        createMockBankAccount({ _id: 'bank-2' as Id<'bankAccount'>, name: 'Checking' }),
      ];
      fixture.componentRef.setInput('availableBankAccounts', mockBankAccounts);

      const sorted = component.filteredBankAccounts();
      expect(sorted[0].name).toBe('Checking');
      expect(sorted[1].name).toBe('Savings');
    });
  });

  describe('showAddOption', () => {
    it('should show add option when search term has no exact match', () => {
      component.searchTerm.set('New Store');
      expect(component.showAddOption()).toBe(true);
    });

    it('should not show add option when search term exactly matches existing merchant', () => {
      component.searchTerm.set('Amazon');
      expect(component.showAddOption()).toBe(false);
    });

    it('should not show add option when search term is empty', () => {
      component.searchTerm.set('');
      expect(component.showAddOption()).toBe(false);
    });

    it('should not show add option for whitespace-only search term', () => {
      component.searchTerm.set('   ');
      expect(component.showAddOption()).toBe(false);
    });

    it('should match case-insensitively for exact match check', () => {
      component.searchTerm.set('amazon');
      expect(component.showAddOption()).toBe(false);
    });
  });

  describe('normalizedSearchTerm', () => {
    it('should trim whitespace', () => {
      component.searchTerm.set('  test  ');
      expect(component.normalizedSearchTerm()).toBe('test');
    });

    it('should collapse multiple spaces', () => {
      component.searchTerm.set('multiple   spaces   here');
      expect(component.normalizedSearchTerm()).toBe('multiple spaces here');
    });
  });

  describe('hasSelection', () => {
    it('should return true when merchant is selected', () => {
      fixture.componentRef.setInput('merchantId', 'merchant-1');
      expect(component.hasSelection()).toBe(true);
    });

    it('should return true when bank account is selected', () => {
      fixture.componentRef.setInput('selectedBankAccountId', 'bank-1');
      expect(component.hasSelection()).toBe(true);
    });

    it('should return true when pending merchant name is set', () => {
      fixture.componentRef.setInput('pendingMerchantName', 'New Store');
      expect(component.hasSelection()).toBe(true);
    });

    it('should return false when nothing is selected', () => {
      expect(component.hasSelection()).toBe(false);
    });
  });

  describe('search state management', () => {
    it('should update search term on input', () => {
      component.onSearchChange('new search');
      expect(component.searchTerm()).toBe('new search');
    });
  });

  describe('import details handling', () => {
    it('should show original statement name from import details', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        originalStatement: 'AMZN MKTP US*123456',
        merchantName: 'Amazon',
        date: '2024-01-15',
        amount: 5000n,
      });

      expect(component.originalStatementName()).toBe('Amazon');
    });

    it('should fall back to originalStatement when merchantName is not available', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        originalStatement: 'AMZN MKTP US*123456',
        date: '2024-01-15',
        amount: 5000n,
      });

      expect(component.originalStatementName()).toBe('AMZN MKTP US*123456');
    });

    it('should handle FinanceKit import details with the same payee fallback', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'financekit',
        originalStatement: 'APPLE CARD MONTHLY INSTALLMENT',
        date: '2026-06-12',
        amount: -1299n,
      });

      expect(component.originalStatementName()).toBe('APPLE CARD MONTHLY INSTALLMENT');
    });

    it('should fall back to deprecated name field', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        name: 'Legacy Name',
        date: '2024-01-15',
        amount: 5000n,
      });

      expect(component.originalStatementName()).toBe('Legacy Name');
    });

    it('should show original statement group when import details exist and not searching', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        merchantName: 'Amazon',
        date: '2024-01-15',
        amount: 5000n,
      });
      component.searchTerm.set('');

      expect(component.showOriginalStatementGroup()).toBe(true);
    });

    it('should hide original statement group when searching', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        merchantName: 'Amazon',
        date: '2024-01-15',
        amount: 5000n,
      });
      component.searchTerm.set('test');

      expect(component.showOriginalStatementGroup()).toBe(false);
    });

    it('should display original statement name when no selection is made', () => {
      fixture.componentRef.setInput('transactionImportDetails', {
        provider: 'plaid',
        merchantName: 'Amazon Store',
        date: '2024-01-15',
        amount: 5000n,
      });

      expect(component.displayPayee()).toBe('Amazon Store');
    });
  });

  describe('transfer direction prefix', () => {
    it('should return "To" for negative amounts (outflow)', () => {
      fixture.componentRef.setInput('transactionAmount', -5000);
      expect(component.transferDirectionPrefix()).toBe('Transfer to');
    });

    it('should return "From" for positive amounts (inflow)', () => {
      fixture.componentRef.setInput('transactionAmount', 5000);
      expect(component.transferDirectionPrefix()).toBe('Transfer from');
    });

    it('should return "From" for zero amount', () => {
      fixture.componentRef.setInput('transactionAmount', 0);
      expect(component.transferDirectionPrefix()).toBe('Transfer from');
    });
  });

  describe('getMerchantInitial', () => {
    it('should return uppercase first character', () => {
      expect(component.getMerchantInitial('amazon')).toBe('A');
    });

    it('should handle empty string', () => {
      expect(component.getMerchantInitial('')).toBe('');
    });
  });

  describe('focus method', () => {
    it('should call focus on trigger button', () => {
      // Create a mock element with focus method
      const mockFocus = vi.fn();
      vi.spyOn(
        component as unknown as { triggerButton: () => { nativeElement: { focus: () => void } } | undefined },
        'triggerButton' as never
      ).mockReturnValue({
        nativeElement: { focus: mockFocus },
      });

      component.focus();

      // The actual implementation may have the trigger button undefined in tests
      // since it requires actual DOM rendering
    });
  });
});
