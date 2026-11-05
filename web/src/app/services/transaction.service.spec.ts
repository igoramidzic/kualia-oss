import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankAccountService } from './bank-account.service';
import { CategoryService } from './category.service';
import { ConvexService } from './convex.service';
import { MerchantService } from './merchant.service';
import { TransactionService, type TransactionWithRelations } from './transaction.service';
import { WorkspaceService } from './workspace.service';

describe('TransactionService', () => {
  let service: TransactionService;

  // Mock services
  let mockConvexService: {
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    watchQuery: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
  };

  let mockWorkspaceService: {
    workspaceId: ReturnType<typeof signal<Id<'workspace'> | null>>;
  };

  let mockCategoryService: {
    categories: ReturnType<typeof signal<{ _id: Id<'category'>; name: string }[]>>;
  };

  let mockBankAccountService: {
    bankAccounts: ReturnType<typeof signal<{ _id: Id<'bankAccount'>; name: string }[]>>;
  };

  let mockMerchantService: {
    merchants: ReturnType<typeof signal<{ _id: Id<'merchant'>; name: string }[]>>;
  };

  it.each(['approveTransactionLink', 'unlinkTransaction'] as const)(
    '%s calls the public transaction linking endpoint',
    async (action) => {
      mockWorkspaceService.workspaceId.set('workspace' as Id<'workspace'>);
      mockConvexService.mutation.mockResolvedValue({ success: true });
      expect(await service[action]('transaction' as Id<'transaction'>)).toBe(true);
      const [reference, args] = mockConvexService.mutation.mock.calls[0];
      expect(getFunctionName(reference)).toBe(`transactionLinking:${action}`);
      expect(args).toMatchObject({ workspaceId: 'workspace', transactionId: 'transaction' });
    }
  );

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock signals and functions
    mockConvexService = {
      isAuthenticated: signal(false),
      watchQuery: vi.fn(() => ({
        subscribe: vi.fn(() => {
          // Return unsubscribe function
          return vi.fn();
        }),
      })),
      getClient: vi.fn(() => ({
        query: vi.fn().mockResolvedValue({ page: [], continueCursor: null, isDone: true }),
      })),
      mutation: vi.fn(),
    };

    mockWorkspaceService = {
      workspaceId: signal<Id<'workspace'> | null>(null),
    };

    mockCategoryService = {
      categories: signal<{ _id: Id<'category'>; name: string }[]>([]),
    };

    mockBankAccountService = {
      bankAccounts: signal<{ _id: Id<'bankAccount'>; name: string }[]>([]),
    };

    mockMerchantService = {
      merchants: signal<{ _id: Id<'merchant'>; name: string }[]>([]),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        TransactionService,
        { provide: ConvexService, useValue: mockConvexService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BankAccountService, useValue: mockBankAccountService },
        { provide: MerchantService, useValue: mockMerchantService },
      ],
    });

    service = TestBed.inject(TransactionService);
  });

  describe('status counts signals', () => {
    it('should initialize with zero needs review count', () => {
      expect(service.needsReviewCount()).toBe(0);
    });

    it('should initialize with zero pending count', () => {
      expect(service.pendingCount()).toBe(0);
    });

    it('should have loading status counts as false initially', () => {
      expect(service.loadingStatusCounts()).toBe(false);
    });

    it('should not mark status counts as loaded before the first response', () => {
      expect(service.hasLoadedStatusCounts()).toBe(false);
    });

    it('should return statusCounts with all counts', () => {
      const counts = service.statusCounts();
      expect(counts).toEqual({
        pendingCount: 0,
        needsReviewCount: 0,
        transferCount: 0,
      });
    });

    it('should initialize with zero transfer count', () => {
      expect(service.transferCount()).toBe(0);
    });
  });

  describe('status counts subscription', () => {
    it('should start watching status counts when authenticated and workspace available', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;

      // Simulate authentication and workspace being available
      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(workspaceId);

      // Force effect to run by getting the service again
      TestBed.flushEffects();

      // Verify watchQuery was called for status counts
      expect(mockConvexService.watchQuery).toHaveBeenCalled();
    });

    it('should not start watching status counts when not authenticated', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;

      mockConvexService.isAuthenticated.set(false);
      mockWorkspaceService.workspaceId.set(workspaceId);

      TestBed.flushEffects();

      // watchQuery should not be called when not authenticated
      expect(mockConvexService.watchQuery).not.toHaveBeenCalled();
    });

    it('should not start watching status counts when no workspace', () => {
      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(null);

      TestBed.flushEffects();

      // watchQuery should not be called when no workspace
      expect(mockConvexService.watchQuery).not.toHaveBeenCalled();
    });

    it('should reset status counts when workspace becomes unavailable', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;

      // Set up authenticated state with workspace
      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(workspaceId);

      TestBed.flushEffects();

      // Now remove workspace
      mockWorkspaceService.workspaceId.set(null);

      TestBed.flushEffects();

      // Counts should be reset to zero
      expect(service.needsReviewCount()).toBe(0);
      expect(service.pendingCount()).toBe(0);
    });

    it('should update status counts when subscription receives data', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      let subscriptionCallback: ((data: { pendingCount: number; needsReviewCount: number }) => void) | null = null;

      // Mock watchQuery to capture the subscription callback
      mockConvexService.watchQuery.mockImplementation(() => ({
        subscribe: (callback: (data: { pendingCount: number; needsReviewCount: number }) => void) => {
          subscriptionCallback = callback;
          return vi.fn();
        },
      }));

      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(workspaceId);

      TestBed.flushEffects();

      // Simulate receiving data from subscription
      if (subscriptionCallback) {
        subscriptionCallback({ needsReviewCount: 5, pendingCount: 3 });
      }

      expect(service.needsReviewCount()).toBe(5);
      expect(service.pendingCount()).toBe(3);
      expect(service.hasLoadedStatusCounts()).toBe(true);
    });
  });

  describe('computed signals derived from status counts', () => {
    it('should update uncategorizedCount computed signal when statusCounts changes', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      let subscriptionCallback: ((data: { uncategorizedCount: number; pendingCount: number }) => void) | null = null;

      mockConvexService.watchQuery.mockImplementation(() => ({
        subscribe: (callback: (data: { uncategorizedCount: number; pendingCount: number }) => void) => {
          subscriptionCallback = callback;
          return vi.fn();
        },
      }));

      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(workspaceId);

      TestBed.flushEffects();

      // Update counts via subscription
      if (subscriptionCallback) {
        subscriptionCallback({ needsReviewCount: 10, pendingCount: 0 });
      }

      expect(service.needsReviewCount()).toBe(10);
    });

    it('should update pendingCount computed signal when statusCounts changes', () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      let subscriptionCallback: ((data: { uncategorizedCount: number; pendingCount: number }) => void) | null = null;

      mockConvexService.watchQuery.mockImplementation(() => ({
        subscribe: (callback: (data: { uncategorizedCount: number; pendingCount: number }) => void) => {
          subscriptionCallback = callback;
          return vi.fn();
        },
      }));

      mockConvexService.isAuthenticated.set(true);
      mockWorkspaceService.workspaceId.set(workspaceId);

      TestBed.flushEffects();

      // Update counts via subscription
      if (subscriptionCallback) {
        subscriptionCallback({ uncategorizedCount: 0, pendingCount: 7 });
      }

      expect(service.pendingCount()).toBe(7);
    });
  });

  describe('filter type handling', () => {
    it('should fetch needs review transactions when filterType is needs_review', async () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      const mockQueryResult = { page: [], continueCursor: null, isDone: true };

      mockConvexService.getClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockQueryResult),
      });

      mockWorkspaceService.workspaceId.set(workspaceId);

      await service.updateFilters({ filterType: 'needs_review' });

      const queryFn = mockConvexService.getClient().query;
      expect(queryFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          needsReview: true,
        })
      );
    });

    it('should fetch pending transactions when filterType is pending', async () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      const mockQueryResult = { page: [], continueCursor: null, isDone: true };

      mockConvexService.getClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockQueryResult),
      });

      mockWorkspaceService.workspaceId.set(workspaceId);

      await service.updateFilters({ filterType: 'pending' });

      const queryFn = mockConvexService.getClient().query;
      expect(queryFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pending: true,
        })
      );
    });

    it('should not include uncategorized or pending flags when filterType is all', async () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      const mockQueryResult = { page: [], continueCursor: null, isDone: true };
      const queryMock = vi.fn().mockResolvedValue(mockQueryResult);

      mockConvexService.getClient.mockReturnValue({
        query: queryMock,
      });

      mockWorkspaceService.workspaceId.set(workspaceId);

      await service.updateFilters({ filterType: 'all' });

      // Verify that the call does NOT have uncategorized: true or pending: true
      expect(queryMock).toHaveBeenCalled();
      const callArgs = queryMock.mock.calls[0][1];
      expect(callArgs.uncategorized).not.toBe(true);
      expect(callArgs.pending).not.toBe(true);
    });
  });

  describe('hasMore behavior with filters', () => {
    it('should set hasMore to false for uncategorized filter (returns all results)', async () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      const mockQueryResult = { page: [], continueCursor: null, isDone: true };

      mockConvexService.getClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockQueryResult),
      });

      mockWorkspaceService.workspaceId.set(workspaceId);

      await service.updateFilters({ filterType: 'uncategorized' });

      expect(service.hasMore()).toBe(false);
    });

    it('should set hasMore to false for pending filter (returns all results)', async () => {
      const workspaceId = 'workspace_123' as Id<'workspace'>;
      const mockQueryResult = { page: [], continueCursor: null, isDone: true };

      mockConvexService.getClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockQueryResult),
      });

      mockWorkspaceService.workspaceId.set(workspaceId);

      await service.updateFilters({ filterType: 'pending' });

      expect(service.hasMore()).toBe(false);
    });
  });

  describe('updateTransaction preserveReviewStatus', () => {
    it('should always send preserveReviewStatus for edit updates', async () => {
      mockWorkspaceService.workspaceId.set('workspace_123' as Id<'workspace'>);
      mockConvexService.mutation.mockResolvedValue(undefined);

      const success = await service.updateTransaction('tx_123' as Id<'transaction'>, {
        notes: 'updated',
      });

      expect(success).toBe(true);
      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: 'workspace_123',
          transactionId: 'tx_123',
          notes: 'updated',
          preserveReviewStatus: true,
        })
      );
    });

    it('should not send reviewStatus when updating a transaction', async () => {
      mockWorkspaceService.workspaceId.set('workspace_123' as Id<'workspace'>);
      mockConvexService.mutation.mockResolvedValue(undefined);

      const success = await service.updateTransaction('tx_123' as Id<'transaction'>, {
        notes: 'updated',
      });

      expect(success).toBe(true);
      const mutationArgs = mockConvexService.mutation.mock.calls[0][1] as {
        preserveReviewStatus?: boolean;
        reviewStatus?: 'needs_review';
      };
      expect(mutationArgs.preserveReviewStatus).toBe(true);
      expect(mutationArgs.reviewStatus).toBeUndefined();
    });
  });

  describe('updateTransactionSchedule', () => {
    it('sends date and recurrence to the update mutation', async () => {
      mockWorkspaceService.workspaceId.set('workspace_123' as Id<'workspace'>);
      mockConvexService.mutation.mockResolvedValue({
        success: true,
        scheduledTransactionId: 'scheduled_123',
        nextDate: '2026-08-15',
      });

      const result = await service.updateTransactionSchedule('tx_123' as Id<'transaction'>, {
        date: '2026-07-20',
        recurrence: 'monthly',
      });

      expect(result?.success).toBe(true);
      expect(mockConvexService.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: 'workspace_123',
          transactionId: 'tx_123',
          date: '2026-07-20',
          recurrence: 'monthly',
          preserveReviewStatus: true,
        })
      );
    });
  });

  describe('openMakeRecurringDialog', () => {
    it('opens a prefilled monthly draft one month after the source transaction date', () => {
      const opener = vi.fn();
      service.setDialogOpener(opener);
      const transaction = {
        _id: 'tx_123' as Id<'transaction'>,
        type: 'regular',
        date: '2099-01-31',
        bankAccountId: 'bank_123' as Id<'bankAccount'>,
        amount: -1250n,
        merchantId: 'merchant_123' as Id<'merchant'>,
        merchantName: 'Coffee',
        notes: 'copied',
        status: 'cleared',
        movements: [
          {
            amount: -1250n,
            categoryId: 'category_123' as Id<'category'>,
            readyToAssign: false,
          },
        ],
      } as unknown as TransactionWithRelations;

      service.openMakeRecurringDialog(transaction);

      expect(opener).toHaveBeenCalledWith({
        bankAccountId: 'bank_123',
        source: 'transaction-details',
        draft: {
          type: 'regular',
          date: '2099-02-28',
          recurrence: 'monthly',
          bankAccountId: 'bank_123',
          amount: -1250n,
          merchantId: 'merchant_123',
          movements: [
            {
              amount: -1250n,
              categoryId: 'category_123',
              readyToAssign: false,
            },
          ],
          notes: 'copied',
          status: 'cleared',
        },
      });
    });
  });
});
