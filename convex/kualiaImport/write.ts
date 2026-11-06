import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import {
  buildActivityContextForClerkId,
  recordBankAccountActivity,
  recordCategoryActivity,
  recordMerchantActivity,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import { requireUserProfile } from '../lib/auth';
import schema from '../schema';

const tables = schema.tables;
export const begin = internalMutation({
  args: {
    name: v.string(),
    currency: v.string(),
    requestId: v.string(),
    readyToAssign: v.int64(),
    monthlyIncomeActivity: tables.workspace.validator.fields.monthlyIncomeActivity,
  },
  returns: v.object({ workspaceId: v.id('workspace'), completed: v.boolean() }),
  handler: async (ctx, { name, currency, requestId, readyToAssign, monthlyIncomeActivity }) => {
    const { user } = await requireUserProfile(ctx);
    const existing = await ctx.db
      .query('workspace')
      .withIndex('by_ownerClerkId_kualiaImportRequestId', (q) =>
        q.eq('ownerClerkId', user.subject).eq('kualiaImportRequestId', requestId)
      )
      .unique();
    if (existing) {
      if (existing.kualiaImportPending) throw new ConvexError('This import is already running.');
      if (existing.isDeleted) throw new ConvexError('This imported workspace was deleted.');
      return { workspaceId: existing._id, completed: true };
    }
    const workspaceId = await ctx.db.insert('workspace', {
      ownerClerkId: user.subject,
      name,
      currency,
      readyToAssign,
      monthlyIncomeActivity,
      onboardingCompleted: true,
      transactionDefaultPendingStatus: false,
      isDeleted: true,
      kualiaImportPending: true,
      kualiaImportRequestId: requestId,
      updatedAt: new Date().toISOString(),
    });
    // Covers action timeouts as well as interrupted imports.
    await ctx.scheduler.runAfter(60 * 60 * 1000, internal.kualiaImport.write.discard, { workspaceId });
    return { workspaceId, completed: false };
  },
});

async function importActivity(ctx: MutationCtx, workspaceId: Id<'workspace'>) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace?.kualiaImportPending) throw new Error('Import no longer pending.');
  return buildActivityContextForClerkId(ctx, workspace.ownerClerkId, { type: 'kualia_ui' });
}

export const accounts = internalMutation({
  args: { workspaceId: v.id('workspace'), rows: v.array(tables.bankAccount.validator.omit('workspaceId')) },
  returns: v.array(v.id('bankAccount')),
  handler: async (ctx, { workspaceId, rows }) => {
    const context = await importActivity(ctx, workspaceId);
    return Promise.all(
      rows.map(async (row) => {
        const id = await ctx.db.insert('bankAccount', { ...row, workspaceId });
        await recordBankAccountActivity(ctx, {
          workspaceId,
          context,
          type: 'bank_account_created',
          after: (await ctx.db.get(id)) ?? undefined,
        });
        return id;
      })
    );
  },
});
export const groups = internalMutation({
  args: { workspaceId: v.id('workspace'), rows: v.array(tables.categoryGroup.validator.omit('workspaceId')) },
  returns: v.array(v.id('categoryGroup')),
  handler: (ctx, { workspaceId, rows }) =>
    Promise.all(rows.map((row) => ctx.db.insert('categoryGroup', { ...row, workspaceId }))),
});
export const categories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    rows: v.array(
      v.object({
        category: tables.category.validator.omit('workspaceId'),
        budget: tables.categoryBudget.validator.omit('categoryId', 'workspaceId', 'updatedAt'),
      })
    ),
  },
  returns: v.array(v.id('category')),
  handler: async (ctx, { workspaceId, rows }) => {
    const context = await importActivity(ctx, workspaceId);
    return Promise.all(
      rows.map(async (row) => {
        const id = await ctx.db.insert('category', { ...row.category, workspaceId });
        await ctx.db.insert('categoryBudget', {
          ...row.budget,
          workspaceId,
          categoryId: id,
          updatedAt: new Date().toISOString(),
        });
        await recordCategoryActivity(ctx, {
          workspaceId,
          context,
          type: 'category_created',
          after: (await ctx.db.get(id)) ?? undefined,
        });
        return id;
      })
    );
  },
});
export const merchants = internalMutation({
  args: { workspaceId: v.id('workspace'), rows: v.array(tables.merchant.validator.omit('workspaceId')) },
  returns: v.array(v.id('merchant')),
  handler: async (ctx, { workspaceId, rows }) => {
    const context = await importActivity(ctx, workspaceId);
    return Promise.all(
      rows.map(async (row) => {
        const id = await ctx.db.insert('merchant', { ...row, workspaceId });
        await recordMerchantActivity(ctx, {
          workspaceId,
          context,
          type: 'merchant_created',
          after: (await ctx.db.get(id)) ?? undefined,
        });
        return id;
      })
    );
  },
});
export const transactions = internalMutation({
  args: { workspaceId: v.id('workspace'), rows: v.array(tables.transaction.validator.omit('workspaceId')) },
  returns: v.array(v.id('transaction')),
  handler: async (ctx, { workspaceId, rows }) => {
    const context = await importActivity(ctx, workspaceId);
    return Promise.all(
      rows.map(async (row) => {
        const id = await ctx.db.insert('transaction', { ...row, workspaceId });
        await recordTransactionActivity(ctx, {
          workspaceId,
          context,
          type: 'transaction_created',
          after: (await ctx.db.get(id)) ?? undefined,
        });
        return id;
      })
    );
  },
});
export const link = internalMutation({
  args: { pairs: v.array(v.object({ id: v.id('transaction'), pair: v.id('transaction') })) },
  returns: v.null(),
  handler: async (ctx, { pairs }) => {
    await Promise.all(pairs.map(({ id, pair }) => ctx.db.patch(id, { transferPairId: pair })));
    return null;
  },
});
export const finish = internalMutation({
  args: { workspaceId: v.id('workspace') },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const { user, userProfile } = await requireUserProfile(ctx);
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace?.kualiaImportPending || workspace.ownerClerkId !== user.subject)
      throw new ConvexError('Import is unavailable.');
    await ctx.db.patch(workspaceId, { isDeleted: false, kualiaImportPending: undefined });
    await ctx.db.patch(userProfile._id, { activeWorkspaceId: workspaceId, updatedAt: new Date().toISOString() });
    return null;
  },
});

export const discard = internalMutation({
  args: { workspaceId: v.id('workspace') },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    if (!(await ctx.db.get(workspaceId))?.kualiaImportPending) return null;
    const logs = await ctx.db
      .query('activityLog')
      .withIndex('by_workspaceId_and_occurredAt', (q) => q.eq('workspaceId', workspaceId))
      .take(64);
    let ids: Id<
      'activityLog' | 'transaction' | 'categoryBudget' | 'category' | 'categoryGroup' | 'merchant' | 'bankAccount'
    >[] = logs.map((d) => d._id);
    for (const table of [
      'transaction',
      'categoryBudget',
      'category',
      'categoryGroup',
      'merchant',
      'bankAccount',
    ] as const) {
      if (ids.length) break;
      const rows = await ctx.db
        .query(table)
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(64);
      ids = rows.map((row) => row._id);
    }
    if (ids.length) {
      await Promise.all(ids.map((id) => ctx.db.delete(id)));
      await ctx.scheduler.runAfter(0, internal.kualiaImport.write.discard, { workspaceId });
    } else {
      await ctx.db.delete(workspaceId);
    }
    return null;
  },
});
