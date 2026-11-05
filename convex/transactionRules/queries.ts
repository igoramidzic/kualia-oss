import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

import { evaluateRuleWithCache, getMerchantName } from './helpers';
import { conditionsValidator, type TransactionRule } from './types';

export const listRules = query({
  args: {
    workspaceId: v.id('workspace'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, includeDeleted = false }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const rules = await ctx.db
      .query('transactionRule')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    return rules.filter((rule) => includeDeleted || !rule.isDeleted).sort((a, b) => a.priority - b.priority);
  },
});

export const countMatchingTransactions = query({
  args: {
    conditions: conditionsValidator,
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { conditions, workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Pre-cache merchant names to avoid N+1 query problem
    const merchantNameCache = new Map<Id<'merchant'>, string | undefined>();

    // Collect unique merchant IDs from transactions
    const uniqueMerchantIds = new Set<Id<'merchant'>>();
    for (const transaction of transactions) {
      if (transaction.merchantId) {
        uniqueMerchantIds.add(transaction.merchantId);
      }
    }

    // Fetch all merchant names in advance
    for (const merchantId of uniqueMerchantIds) {
      const name = await getMerchantName(ctx, merchantId);
      merchantNameCache.set(merchantId, name);
    }

    const tempRule: TransactionRule = {
      _id: '' as Id<'transactionRule'>,
      _creationTime: 0,
      name: '',
      workspaceId,
      isActive: true,
      priority: 0,
      conditions,
      actions: {},
      createdAt: '',
      updatedAt: '',
      isDeleted: false,
    };

    let count = 0;
    for (const transaction of transactions) {
      // Use cached merchant name for better performance
      if (await evaluateRuleWithCache(ctx, transaction, tempRule, merchantNameCache)) {
        count++;
      }
    }

    return count;
  },
});
