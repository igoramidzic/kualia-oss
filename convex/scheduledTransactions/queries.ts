import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { getScheduledTransactionType } from './types';

export type ScheduledTransactionWithRelations = Doc<'scheduledTransaction'> & {
  transactionType?: 'regular' | 'transfer';
  merchantName?: string;
  transferToAccountName?: string;
  movements: (Doc<'scheduledTransaction'>['movements'][number] & { categoryName?: string })[];
};

async function populateScheduledTransaction(
  ctx: QueryCtx,
  scheduled: Doc<'scheduledTransaction'>
): Promise<ScheduledTransactionWithRelations> {
  const transactionType = getScheduledTransactionType(scheduled);
  const merchant = scheduled.merchantId ? await ctx.db.get(scheduled.merchantId) : null;
  const transferToAccount = scheduled.transferToAccountId ? await ctx.db.get(scheduled.transferToAccountId) : null;

  const movements = await Promise.all(
    scheduled.movements.map(async (movement) => {
      const category = movement.categoryId ? await ctx.db.get(movement.categoryId) : null;
      return { ...movement, categoryName: category?.name };
    })
  );

  return {
    ...scheduled,
    transactionType,
    merchantName: merchant?.name,
    transferToAccountName: transferToAccount?.name,
    movements,
  };
}

/**
 * List scheduled transactions for a workspace, soonest due first. Completed schedules are
 * excluded unless includeCompleted is set.
 */
export const listScheduledTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ScheduledTransactionWithRelations[]> => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const scheduled = await ctx.db
      .query('scheduledTransaction')
      .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', verifiedWorkspaceId).eq('isDeleted', false))
      .collect();

    const visible = args.includeCompleted ? scheduled : scheduled.filter((s) => s.status === 'active');
    visible.sort((a, b) => a.nextDate.localeCompare(b.nextDate));

    return Promise.all(visible.map((s) => populateScheduledTransaction(ctx, s)));
  },
});

export const getScheduledTransaction = query({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
  },
  handler: async (ctx, args): Promise<ScheduledTransactionWithRelations> => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const scheduled = await ctx.db.get(args.scheduledTransactionId);
    if (!scheduled || scheduled.isDeleted) {
      throw new ConvexError('Scheduled transaction not found');
    }
    if (scheduled.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    return populateScheduledTransaction(ctx, scheduled);
  },
});

/**
 * List the real transactions this schedule has already created (entered), soonest last.
 * Returns raw transaction docs; the web client repopulates them via
 * TransactionService.populateTransactions so the shape matches the rest of the app
 */
export const getLinkedTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<'transaction'>[]> => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const scheduled = await ctx.db.get(args.scheduledTransactionId);
    if (!scheduled || scheduled.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Scheduled transaction not found or access denied');
    }

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_scheduledTransactionId', (q) => q.eq('scheduledTransactionId', args.scheduledTransactionId))
      .collect();

    return transactions
      .filter((t) => !t.isDeleted)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, args.limit ?? 50);
  },
});
