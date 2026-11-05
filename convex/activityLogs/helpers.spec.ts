import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import {
  buildAssignmentMoneyMovements,
  recordMerchantActivity,
  snapshotBankAccount,
  snapshotMerchant,
  snapshotTransaction,
} from './helpers';

describe('buildAssignmentMoneyMovements', () => {
  it('represents an equal two-category change as one direct move', () => {
    const movements = buildAssignmentMoneyMovements([
      {
        category: { id: 'category_dining', name: 'Dining Out' },
        previousAssignedAmount: 20_000n,
        assignedAmount: 10_000n,
      },
      {
        category: { id: 'category_fun', name: 'Fun Money' },
        previousAssignedAmount: 5_000n,
        assignedAmount: 15_000n,
      },
    ]);

    expect(movements).toEqual([
      {
        amount: 10_000n,
        from: { type: 'category', category: { id: 'category_dining', name: 'Dining Out' } },
        to: { type: 'category', category: { id: 'category_fun', name: 'Fun Money' } },
        fromAssignedAmount: 20_000n,
        toAssignedAmount: 5_000n,
      },
    ]);
  });

  it('keeps a complex batch as structured movements through Ready to Assign', () => {
    const movements = buildAssignmentMoneyMovements([
      {
        category: { id: 'category_rent', name: 'Rent' },
        previousAssignedAmount: 50_000n,
        assignedAmount: 60_000n,
      },
      {
        category: { id: 'category_food', name: 'Food' },
        previousAssignedAmount: 30_000n,
        assignedAmount: 35_000n,
      },
      {
        category: { id: 'category_fun', name: 'Fun Money' },
        previousAssignedAmount: 10_000n,
        assignedAmount: 7_500n,
      },
    ]);

    expect(movements).toEqual([
      {
        amount: 10_000n,
        from: { type: 'ready_to_assign' },
        to: { type: 'category', category: { id: 'category_rent', name: 'Rent' } },
        toAssignedAmount: 50_000n,
      },
      {
        amount: 5_000n,
        from: { type: 'ready_to_assign' },
        to: { type: 'category', category: { id: 'category_food', name: 'Food' } },
        toAssignedAmount: 30_000n,
      },
      {
        amount: 2_500n,
        from: { type: 'category', category: { id: 'category_fun', name: 'Fun Money' } },
        to: { type: 'ready_to_assign' },
        fromAssignedAmount: 10_000n,
      },
    ]);
  });

  it('omits assignments whose amount did not change', () => {
    expect(
      buildAssignmentMoneyMovements([
        {
          category: { id: 'category_rent', name: 'Rent' },
          previousAssignedAmount: 50_000n,
          assignedAmount: 50_000n,
        },
      ])
    ).toEqual([]);
  });
});

describe('activity snapshots', () => {
  it('keeps mutable account values as immutable display data', () => {
    const account = {
      _id: 'bank_account_1' as Id<'bankAccount'>,
      _creationTime: 1,
      workspaceId: 'workspace_1' as Id<'workspace'>,
      name: 'Everyday Checking',
      notes: 'Primary spending account',
      logoUrl: null,
      visualIdentityMode: 'icon',
      iconName: 'wallet-cards',
      iconColorId: 'blue',
      accountType: 'banking_checking',
      currentBalance: 12_345n,
      isClosed: false,
      isDeleted: false,
    } as Doc<'bankAccount'>;

    expect(snapshotBankAccount(account)).toMatchObject({
      name: 'Everyday Checking',
      notes: 'Primary spending account',
      logoUrl: null,
      visualIdentityMode: 'icon',
      iconName: 'wallet-cards',
      iconColorId: 'blue',
    });
  });

  it('caps very large split transaction snapshots and records the omitted count', async () => {
    const bankAccountId = 'bank_account_1' as Id<'bankAccount'>;
    const movements = Array.from({ length: 205 }, (_, index) => ({
      amount: -100n,
      categoryId: undefined,
      categoryName: undefined,
      readyToAssign: false,
      notes: undefined,
      sortOrder: index,
    }));
    const transaction = {
      _id: 'transaction_1' as Id<'transaction'>,
      _creationTime: 1,
      workspaceId: 'workspace_1' as Id<'workspace'>,
      bankAccountId,
      date: '2026-07-10',
      dateYearMonth: 202607,
      type: 'regular',
      source: 'manual',
      status: 'cleared',
      reviewStatus: 'reviewed',
      movements,
      totalAmount: -20_500n,
      searchText: '',
      hasUncategorized: true,
      hasMissingPayee: true,
      isDeleted: false,
    } as Doc<'transaction'>;
    const ctx = {
      db: {
        get: async (id: string) =>
          id === bankAccountId
            ? ({ _id: bankAccountId, name: 'Checking' } as Pick<Doc<'bankAccount'>, '_id' | 'name'>)
            : null,
      },
    } as unknown as QueryCtx;

    const snapshot = await snapshotTransaction(ctx, transaction);

    expect(snapshot.movements).toHaveLength(200);
    expect(snapshot.movementCount).toBe(205);
    expect(snapshot.movementsTruncated).toBe(true);
  });

  it('stores a resolved merchant name without depending on the live global merchant', async () => {
    const globalMerchantId = 'global_merchant_1' as Id<'globalMerchant'>;
    const merchant = {
      _id: 'merchant_1' as Id<'merchant'>,
      _creationTime: 1,
      workspaceId: 'workspace_1' as Id<'workspace'>,
      globalMerchantId,
      isDeleted: false,
      updatedAt: '2026-07-11T00:00:00.000Z',
    } as Doc<'merchant'>;
    const ctx = {
      db: {
        get: async (id: string) =>
          id === globalMerchantId
            ? ({ _id: globalMerchantId, name: 'Coffee Shop' } as Pick<Doc<'globalMerchant'>, '_id' | 'name'>)
            : null,
      },
    } as unknown as QueryCtx;

    await expect(snapshotMerchant(ctx, merchant)).resolves.toMatchObject({
      id: merchant._id,
      name: 'Coffee Shop',
      isDeleted: false,
    });
  });

  it('records immutable merchant merge details and movement counts', async () => {
    const workspaceId = 'workspace_1' as Id<'workspace'>;
    const source = {
      _id: 'merchant_source' as Id<'merchant'>,
      _creationTime: 1,
      workspaceId,
      name: 'Old Coffee Shop',
      isDeleted: false,
      updatedAt: '2026-07-11T00:00:00.000Z',
    } as Doc<'merchant'>;
    const target = {
      ...source,
      _id: 'merchant_target' as Id<'merchant'>,
      name: 'Coffee Shop',
    };
    const insert = vi.fn().mockResolvedValue('activity_1' as Id<'activityLog'>);
    const ctx = {
      db: {
        get: async (id: string) => (id === workspaceId ? { _id: workspaceId, currency: 'USD' } : null),
        insert,
      },
    } as unknown as MutationCtx;

    await recordMerchantActivity(ctx, {
      workspaceId,
      context: {
        actor: { clerkId: 'user_1', name: 'Taylor' },
        source: { type: 'kualia_ui' },
      },
      type: 'merchant_merged',
      before: source,
      after: { ...source, isDeleted: true },
      mergeTarget: target,
      movedTransactionCount: 3,
      updatedRecurringTransactionCount: 1,
    });

    expect(insert).toHaveBeenCalledWith(
      'activityLog',
      expect.objectContaining({
        type: 'merchant_merged',
        entityType: 'merchant',
        entityId: source._id,
        details: expect.objectContaining({
          kind: 'merchant',
          before: expect.objectContaining({ name: 'Old Coffee Shop' }),
          mergeTarget: expect.objectContaining({ name: 'Coffee Shop' }),
          movedTransactionCount: 3,
          updatedRecurringTransactionCount: 1,
        }),
      })
    );
  });
});
