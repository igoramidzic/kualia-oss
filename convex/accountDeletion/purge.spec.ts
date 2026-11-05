import type { FunctionArgs } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildPurgeCompletionUpdates, isDeletionOldEnough, purgeWorkspaceStage } from './purge';

describe('account deletion retention', () => {
  it('only allows rows deleted at or before the monthly cutoff', () => {
    const cutoff = '2026-07-03T12:00:00.000Z';
    expect(isDeletionOldEnough('2026-07-03T12:00:00.000Z', cutoff)).toBe(true);
    expect(isDeletionOldEnough('2026-07-02T12:00:00.000Z', cutoff)).toBe(true);
    expect(isDeletionOldEnough('2026-07-04T12:00:00.000Z', cutoff)).toBe(false);
    expect(isDeletionOldEnough(undefined, cutoff)).toBe(false);
  });

  it('marks the retained profile complete instead of deleting the support tombstone', () => {
    expect(buildPurgeCompletionUpdates('2026-08-03T12:00:00.000Z')).toEqual({
      purgeCompletedAt: '2026-08-03T12:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
    });
  });

  it.each([1, 64])('purges planned occurrence records in bounded workspace batches (%i rows)', async (rowCount) => {
    const rows = Array.from({ length: rowCount }, (_, index) => ({ _id: `occurrence-${index}` }));
    const take = vi.fn(async () => rows);
    const eq = vi.fn();
    const withIndex = vi.fn((_index: string, range: (query: { eq: typeof eq }) => unknown) => {
      range({ eq });
      return { take };
    });
    const query = vi.fn(() => ({ withIndex }));
    const deleteRow = vi.fn();
    const runAfter = vi.fn();
    const ctx = { db: { query, delete: deleteRow }, scheduler: { runAfter } } as unknown as MutationCtx;
    const handler = (
      purgeWorkspaceStage as unknown as {
        _handler: (
          ctx: MutationCtx,
          args: FunctionArgs<typeof internal.accountDeletion.purge.purgeWorkspaceStage>
        ) => Promise<null>;
      }
    )._handler;

    await handler(ctx, {
      userProfileId: 'user-1' as Id<'userProfile'>,
      clerkId: 'clerk-1',
      workspaceId: 'workspace-1' as Id<'workspace'>,
      stage: 'scheduledTransactionOccurrence',
    });

    expect(query).toHaveBeenCalledWith('scheduledTransactionOccurrence');
    expect(withIndex).toHaveBeenCalledWith('by_workspaceId', expect.any(Function));
    expect(eq).toHaveBeenCalledWith('workspaceId', 'workspace-1');
    expect(take).toHaveBeenCalledWith(64);
    expect(deleteRow).toHaveBeenCalledTimes(rowCount);
    expect(deleteRow).toHaveBeenCalledWith('scheduledTransactionOccurrence', 'occurrence-0');
    expect(runAfter).toHaveBeenCalledWith(
      0,
      internal.accountDeletion.purge.purgeWorkspaceStage,
      expect.objectContaining({ stage: rowCount === 64 ? 'scheduledTransactionOccurrence' : 'scheduledTransaction' })
    );
  });
});
