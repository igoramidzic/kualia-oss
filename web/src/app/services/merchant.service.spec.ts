import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';
import { MerchantService } from './merchant.service';
import { WorkspaceService } from './workspace.service';

describe('MerchantService', () => {
  let service: MerchantService;
  let mockConvexService: {
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    watchQuery: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
  };
  let mockWorkspaceService: {
    workspaceId: ReturnType<typeof signal<Id<'workspace'> | null>>;
  };

  beforeEach(() => {
    mockConvexService = {
      isAuthenticated: signal(false),
      watchQuery: vi.fn(() => ({
        subscribe: vi.fn(() => vi.fn()),
      })),
      mutation: vi.fn(),
      getClient: vi.fn(() => ({
        query: vi.fn(),
      })),
    };
    mockWorkspaceService = {
      workspaceId: signal<Id<'workspace'> | null>('workspace_1' as Id<'workspace'>),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MerchantService,
        { provide: ConvexService, useValue: mockConvexService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: LocalAuthService, useValue: {} },
      ],
    });

    service = TestBed.inject(MerchantService);
  });

  it('calls deleteMerchant without a target for direct deletion', async () => {
    mockConvexService.mutation.mockResolvedValue({
      success: true,
      movedTransactionCount: 0,
      updatedRecurringTransactionCount: 0,
    });

    await service.deleteMerchant('merchant_1' as Id<'merchant'>);

    expect(mockConvexService.mutation).toHaveBeenCalledWith(api.merchants.deleteMerchant, {
      workspaceId: 'workspace_1',
      merchantId: 'merchant_1',
      targetMerchantId: undefined,
    });
  });

  it('passes a target merchant when deleting with moved references', async () => {
    mockConvexService.mutation.mockResolvedValue({
      success: true,
      movedTransactionCount: 3,
      updatedRecurringTransactionCount: 1,
    });

    await service.deleteMerchant('merchant_source' as Id<'merchant'>, 'merchant_target' as Id<'merchant'>);

    expect(mockConvexService.mutation).toHaveBeenCalledWith(api.merchants.deleteMerchant, {
      workspaceId: 'workspace_1',
      merchantId: 'merchant_source',
      targetMerchantId: 'merchant_target',
    });
  });

  it('throws when no workspace is selected', async () => {
    mockWorkspaceService.workspaceId.set(null);

    await expect(service.deleteMerchant('merchant_1' as Id<'merchant'>)).rejects.toThrow('No workspace selected');
    expect(mockConvexService.mutation).not.toHaveBeenCalled();
  });

  it('surfaces ConvexError messages from deleteMerchant', async () => {
    mockConvexService.mutation.mockRejectedValue({
      data: 'Merchant has transactions or planned transactions. Please choose another merchant to move them to before deleting.',
    });

    await expect(service.deleteMerchant('merchant_1' as Id<'merchant'>)).rejects.toThrow('choose another merchant');
  });
});
