import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionService } from '../../services/transaction.service';
import { WorkspaceService } from '../../services/workspace.service';
import { TransactionComponent } from './transaction';
import { TransactionPageService } from './transaction-page.service';

// Mock window.matchMedia for sidebar service
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Helper function to create mock transactions
function createMockTransaction(overrides?: Partial<TransactionWithRelations>): TransactionWithRelations {
  return {
    _id: 'test-transaction-id-12345678' as any,
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
    ...overrides,
  } as TransactionWithRelations;
}

describe('TransactionComponent', () => {
  let component: TransactionComponent;
  let fixture: ComponentFixture<TransactionComponent>;
  let mockTransactionService: TransactionService;
  let mockTransactionPageService: TransactionPageService;
  let mockNavigationService: NavigationService;
  let mockWorkspaceService: WorkspaceService;
  let mockMerchantService: MerchantService;
  let mockDialogService: HlmDialogService;
  let mockActivatedRoute: ActivatedRoute;
  let mockRouter: Router;
  let paramMapSubject: BehaviorSubject<Map<string, string>>;
  let routerEventsSubject: Subject<any>;

  beforeEach(async () => {
    // Reset TestBed to ensure clean state in CI/CD environment
    TestBed.resetTestingModule();

    // Create subjects for route params and router events
    paramMapSubject = new BehaviorSubject(new Map<string, string>());
    routerEventsSubject = new Subject<any>();

    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn((key: string) => {
            return paramMapSubject.value.get(key) ?? null;
          }),
        },
      },
      paramMap: paramMapSubject.asObservable(),
    } as unknown as ActivatedRoute;

    mockTransactionService = {
      getTransactionById: vi.fn(),
    } as unknown as TransactionService;

    mockNavigationService = {
      navigateToTransactions: vi.fn(),
    } as unknown as NavigationService;

    mockWorkspaceService = {
      workspaceId: signal('workspace-123' as any),
      workspace: signal({ _id: 'workspace-123', currency: 'USD' }),
    } as unknown as WorkspaceService;

    mockMerchantService = {
      merchants: signal([]),
    } as unknown as MerchantService;

    mockDialogService = {
      open: vi.fn(),
    } as unknown as HlmDialogService;

    await TestBed.configureTestingModule({
      imports: [TransactionComponent, RouterTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: TransactionService, useValue: mockTransactionService },
        TransactionPageService, // Provide the real service
        { provide: NavigationService, useValue: mockNavigationService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: MerchantService, useValue: mockMerchantService },
        { provide: HlmDialogService, useValue: mockDialogService },
      ],
    }).compileComponents();

    // Get the Router from RouterTestingModule and assign events observable directly
    // Router.events is a plain Observable property, not a getter, so we assign it directly
    // instead of using vi.spyOn() with 'get' which would fail
    mockRouter = TestBed.inject(Router);
    Object.defineProperty(mockRouter, 'events', {
      value: routerEventsSubject.asObservable(),
      writable: true,
      configurable: true,
    });

    fixture = TestBed.createComponent(TransactionComponent);
    component = fixture.componentInstance;

    // Get the actual service instance used by the component
    // The component has its own instance because TransactionPageService is provided in the component
    // We need to access it through the component's injector
    mockTransactionPageService = fixture.debugElement.injector.get(TransactionPageService);

    // Spy on the service methods - vi.spyOn preserves original implementation by default
    vi.spyOn(mockTransactionPageService, 'setTransaction');
    vi.spyOn(mockTransactionPageService, 'setLoading');
    vi.spyOn(mockTransactionPageService, 'setTransactionAmountEdit');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('component initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should read transaction ID from route params', () => {
      const transactionId = 'j1234567890abcdef';
      paramMapSubject.next(new Map([['id', transactionId]]));

      component.ngOnInit();

      expect(mockActivatedRoute.snapshot.paramMap.get('id')).toBe(transactionId);
    });

    it('should fetch transaction when ID is present in route', async () => {
      const transactionId = 'j1234567890abcdef';
      const mockTransaction = createMockTransaction();
      paramMapSubject.next(new Map([['id', transactionId]]));
      vi.mocked(mockTransactionService.getTransactionById).mockResolvedValue(mockTransaction);

      component.ngOnInit();

      // Wait for async operations - need to wait for the promise to resolve
      await vi.waitFor(
        () => {
          expect(mockTransactionService.getTransactionById).toHaveBeenCalledWith(transactionId);
        },
        { timeout: 1000 }
      );

      // Wait a bit more for setTransaction to be called
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTransactionPageService.setTransaction).toHaveBeenCalledWith(mockTransaction);
    });

    it('should set loading state during fetch', async () => {
      const transactionId = 'j1234567890abcdef';
      const mockTransaction = createMockTransaction();
      paramMapSubject.next(new Map([['id', transactionId]]));
      vi.mocked(mockTransactionService.getTransactionById).mockResolvedValue(mockTransaction);

      component.ngOnInit();

      // Check loading was set to true
      expect(mockTransactionPageService.setLoading).toHaveBeenCalledWith(true);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check loading was set to false
      expect(mockTransactionPageService.setLoading).toHaveBeenCalledWith(false);
    });

    it('should not fetch transaction when ID is not present', () => {
      paramMapSubject.next(new Map());

      component.ngOnInit();

      expect(mockTransactionService.getTransactionById).not.toHaveBeenCalled();
    });
  });

  describe('formatAmount', () => {
    it('should format amount correctly from cents to dollars', () => {
      const result = component.formatAmount(5000);
      expect(result).toBe('$50.00');
    });

    it('should format negative amounts correctly', () => {
      const result = component.formatAmount(-5000);
      expect(result).toBe('-$50.00');
    });

    it('should format zero amount correctly', () => {
      const result = component.formatAmount(0);
      expect(result).toBe('$0.00');
    });

    it('should format large amounts correctly', () => {
      const result = component.formatAmount(123456);
      expect(result).toBe('$1,234.56');
    });

    it('should always show 2 decimal places', () => {
      const result = component.formatAmount(100);
      expect(result).toBe('$1.00');
    });
  });

  describe('getTransactionIdShort', () => {
    it('should return last 8 characters of transaction ID', () => {
      const result = component.getTransactionIdShort('very-long-transaction-id-12345678');
      expect(result).toBe('12345678');
    });

    it('should return full ID if shorter than 8 characters', () => {
      const shortId = 'abc123';
      const result = component.getTransactionIdShort(shortId);
      expect(result).toBe(shortId);
    });

    it('should return exactly 8 characters for long IDs', () => {
      const result = component.getTransactionIdShort('transaction-id-that-is-very-long-12345678');
      expect(result).toBe('12345678');
      expect(result.length).toBe(8);
    });
  });

  describe('getMerchantName', () => {
    it('should return merchantName when available', () => {
      const mockTransaction = createMockTransaction({
        merchantName: 'Test Store',
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.getMerchantName();
      expect(result).toBe('Test Store');
    });

    it('should return null when merchantName is not available', () => {
      const mockTransaction = createMockTransaction({
        merchantName: null,
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.getMerchantName();
      expect(result).toBeNull();
    });

    it('should return null when transaction is null', () => {
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      const result = component.getMerchantName();
      expect(result).toBeNull();
    });
  });

  describe('getTransactionDisplay', () => {
    it('should return formatted display with merchant name and amount', () => {
      const mockTransaction = createMockTransaction({
        merchantName: 'Test Merchant',
        _id: 'test-id-12345678' as any,
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.getTransactionDisplay();

      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('Test Merchant');
      expect(result?.amount).toBe('$50.00');
    });

    it('should truncate merchant name longer than 24 characters', () => {
      const mockTransaction = createMockTransaction({
        merchantName: 'This is a very long merchant name that exceeds 24 characters',
        _id: 'test-id-12345678' as any,
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.getTransactionDisplay();

      expect(result).not.toBeNull();
      expect(result?.prefix).toContain('...');
      expect(result?.prefix.length).toBeLessThanOrEqual(27); // 24 + '...'
    });

    it('should use transaction ID short when merchant name is not available', () => {
      const mockTransaction = createMockTransaction({
        merchantName: null,
        _id: 'test-id-12345678' as any,
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.getTransactionDisplay();

      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('12345678');
    });

    it('should use edit amount from service', () => {
      const mockTransaction = createMockTransaction({
        merchantName: 'Test Merchant',
        _id: 'test-id-12345678' as any,
      });
      mockTransactionPageService.setTransaction(mockTransaction);
      mockTransactionPageService.setTransactionAmountEdit(7500);
      fixture.detectChanges();

      const result = component.getTransactionDisplay();

      expect(result?.amount).toBe('$75.00');
    });

    it('should return null when transaction is null', () => {
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      const result = component.getTransactionDisplay();

      expect(result).toBeNull();
    });
  });

  describe('error computed signal', () => {
    it('should return null when loading', () => {
      mockTransactionPageService.setLoading(true);
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      const result = component.error();

      expect(result).toBeNull();
    });

    it('should return error message when not loading and no transaction', () => {
      mockTransactionPageService.setLoading(false);
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      const result = component.error();

      expect(result).toBe('Transaction not found');
    });

    it('should return null when transaction exists', () => {
      const mockTransaction = createMockTransaction();
      mockTransactionPageService.setLoading(false);
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      const result = component.error();

      expect(result).toBeNull();
    });
  });

  describe('openDeleteDialog', () => {
    it('should open delete dialog with transaction', () => {
      const mockTransaction = createMockTransaction();
      const mockDialogRef = {
        close: vi.fn(),
      };
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      vi.mocked(mockDialogService.open).mockReturnValue(mockDialogRef as any);

      component.openDeleteDialog();

      expect(mockDialogService.open).toHaveBeenCalled();
      const callArgs = vi.mocked(mockDialogService.open).mock.calls[0];
      const config = callArgs[1] as { context?: { transaction?: TransactionWithRelations } };
      expect(config?.context?.transaction).toEqual(mockTransaction);
    });

    it('should not open dialog when transaction is null', () => {
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      component.openDeleteDialog();

      expect(mockDialogService.open).not.toHaveBeenCalled();
    });

    it('should navigate to transactions list after successful deletion', async () => {
      const mockTransaction = createMockTransaction();
      const mockDialogRef = {
        close: vi.fn(),
      };

      // Mock the transaction service to return the transaction
      vi.mocked(mockTransactionService.getTransactionById).mockResolvedValue(mockTransaction);

      mockTransactionPageService.setTransaction(mockTransaction);
      mockTransactionPageService.setLoading(false);
      fixture.detectChanges();

      // Initialize component so transactionInitialized gets set to true
      const transactionId = mockTransaction._id;
      paramMapSubject.next(new Map([['id', transactionId]]));
      component.ngOnInit();

      // Wait for initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      let dialogConfig: any;
      vi.mocked(mockDialogService.open).mockImplementation((component: any, config: any) => {
        dialogConfig = config;
        return mockDialogRef as any;
      });

      component.openDeleteDialog();

      // Verify dialog was opened
      expect(mockDialogService.open).toHaveBeenCalled();

      // Trigger the callback with successful deletion
      if (dialogConfig?.context?.onClose) {
        dialogConfig.context.onClose(true);
      }

      // Simulate Convex removing the deleted transaction from query results
      // This triggers the effect that navigates away
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      // Wait for effect to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockNavigationService.navigateToTransactions).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalled();
    });

    it('should not navigate when deletion is cancelled', () => {
      const mockTransaction = createMockTransaction();
      const mockDialogRef = {
        close: vi.fn(),
      };
      mockTransactionPageService.setTransaction(mockTransaction);
      fixture.detectChanges();

      let dialogConfig: any;
      vi.mocked(mockDialogService.open).mockImplementation((component: any, config: any) => {
        dialogConfig = config;
        return mockDialogRef as any;
      });

      component.openDeleteDialog();

      // Verify dialog was opened
      expect(mockDialogService.open).toHaveBeenCalled();

      // Trigger the callback with cancellation
      if (dialogConfig?.context?.onClose) {
        dialogConfig.context.onClose(false);
      }

      expect(mockNavigationService.navigateToTransactions).not.toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalled();
    });
  });

  describe('effect navigation on deletion', () => {
    it('should navigate away when transaction is deleted after initialization', async () => {
      const mockTransaction = createMockTransaction();
      mockTransactionPageService.setTransaction(mockTransaction);
      mockTransactionPageService.setLoading(false);
      fixture.detectChanges();

      // Initialize component
      const transactionId = 'j1234567890abcdef';
      paramMapSubject.next(new Map([['id', transactionId]]));
      component.ngOnInit();

      // Wait for initialization check
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Simulate transaction being deleted (set to null)
      mockTransactionPageService.setTransaction(null);
      fixture.detectChanges();

      // Wait for effect to run
      await new Promise((resolve) => setTimeout(resolve, 150));

      // The effect should navigate away
      // Note: This test verifies the effect logic exists, actual navigation may need more setup
      expect(mockNavigationService.navigateToTransactions).toHaveBeenCalled();
    });
  });
});
