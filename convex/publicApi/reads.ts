import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getCurrentYearMonthForTimezone } from '../lib/dates';
import { getEnvelopeMonthStatus } from '../mcp/budgetTools';
import { listCategoryGroupsWithCategories, resolveCategoryNameFromBankAccount } from '../mcp/categoryTools';
import { batchResolveMerchantNames } from '../merchants/helpers';
import { isOnBudgetAccountType } from '../transactions/helpers';
import { listAccessibleWorkspacesForClerkId } from '../workspaces/access';

import {
  ApiError,
  bankAccountToApi,
  categoryToApi,
  formatApiMonth,
  merchantToApi,
  parseApiDate,
  parseApiMonth,
  requireWorkspaceForApi,
  transactionsToApi,
} from './lib';

export const MAX_TRANSACTIONS_PAGE_SIZE = 500;
export const DEFAULT_TRANSACTIONS_PAGE_SIZE = 100;

/** GET /v1/user */
export const getUser = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const userProfile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
      .first();

    if (!userProfile) {
      throw new ApiError(404, 'not_found', 'User profile not found');
    }

    return {
      minorUnit: 0,
      body: {
        user: {
          id: userProfile.clerkId,
          email: userProfile.email,
          name: userProfile.name ?? null,
          default_workspace_id: userProfile.activeWorkspaceId ?? null,
        },
      },
    };
  },
});

/** GET /v1/workspaces */
export const listWorkspaces = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const accessible = await listAccessibleWorkspacesForClerkId(ctx, clerkId);

    return {
      minorUnit: 0,
      body: {
        workspaces: accessible.map(({ workspace, role }) => ({
          id: workspace._id,
          name: workspace.name,
          currency: (workspace.currency ?? 'USD').toUpperCase(),
          timezone: workspace.timezone ?? null,
          role,
          archived: workspace.isArchived ?? false,
        })),
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id} */
export const getWorkspace = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string() },
  handler: async (ctx, { clerkId, workspaceId }) => {
    const { workspace, role, currency, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    return {
      minorUnit,
      body: {
        workspace: {
          id: workspace._id,
          name: workspace.name,
          currency,
          timezone: workspace.timezone ?? null,
          role,
          archived: workspace.isArchived ?? false,
          ready_to_assign: workspace.readyToAssign ?? 0n,
        },
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/accounts */
export const listAccounts = internalQuery({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    includeClosed: v.boolean(),
  },
  handler: async (ctx, { clerkId, workspaceId, includeClosed }) => {
    const { workspace, currency, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect();

    const visible = accounts
      .filter((account) => !account.isDeleted && (includeClosed || !account.isClosed))
      .sort((a, b) => {
        if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    return {
      minorUnit,
      body: {
        currency,
        accounts: visible.map((account) => bankAccountToApi(account, isOnBudgetAccountType(account.accountType))),
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/accounts/{account_id} */
export const getAccount = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), accountId: v.string() },
  handler: async (ctx, { clerkId, workspaceId, accountId }) => {
    const { workspace, currency, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const account = await ctx.db.get(accountId as Id<'bankAccount'>).catch(() => null);
    if (!account || account.isDeleted || account.workspaceId !== workspace._id) {
      throw new ApiError(404, 'not_found', 'Account not found');
    }

    return {
      minorUnit,
      body: {
        currency,
        account: bankAccountToApi(account, isOnBudgetAccountType(account.accountType)),
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/transactions */
export const listTransactions = internalQuery({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    accountId: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(v.string()),
    reviewStatus: v.optional(v.string()),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, currency, minorUnit } = await requireWorkspaceForApi(ctx, args.clerkId, args.workspaceId);

    const sinceDate = args.sinceDate !== undefined ? parseApiDate(args.sinceDate, 'since_date') : undefined;
    const untilDate = args.untilDate !== undefined ? parseApiDate(args.untilDate, 'until_date') : undefined;

    if (args.status !== undefined && !['pending', 'cleared', 'reconciled'].includes(args.status)) {
      throw new ApiError(400, 'bad_request', "status must be one of 'pending', 'cleared', 'reconciled'");
    }
    if (args.reviewStatus !== undefined && !['reviewed', 'needs_review'].includes(args.reviewStatus)) {
      throw new ApiError(400, 'bad_request', "review_status must be 'reviewed' or 'needs_review'");
    }

    let accountId: Id<'bankAccount'> | undefined;
    if (args.accountId !== undefined) {
      const account = await ctx.db.get(args.accountId as Id<'bankAccount'>).catch(() => null);
      if (!account || account.isDeleted || account.workspaceId !== workspace._id) {
        throw new ApiError(404, 'not_found', 'Account not found');
      }
      accountId = account._id;
    }

    const query = accountId
      ? ctx.db.query('transaction').withIndex('by_workspaceId_bankAccountId_date_isDeleted', (q) => {
          const base = q.eq('workspaceId', workspace._id).eq('bankAccountId', accountId);
          const withSince = sinceDate ? base.gte('date', sinceDate) : base;
          return untilDate ? withSince.lte('date', untilDate) : withSince;
        })
      : ctx.db.query('transaction').withIndex('by_workspaceId_date_isDeleted', (q) => {
          const base = q.eq('workspaceId', workspace._id);
          const withSince = sinceDate ? base.gte('date', sinceDate) : base;
          return untilDate ? withSince.lte('date', untilDate) : withSince;
        });

    let page;
    try {
      page = await query.order('desc').paginate({
        numItems: args.limit,
        cursor: args.cursor ?? null,
      });
    } catch {
      throw new ApiError(400, 'bad_request', 'Invalid cursor');
    }

    // The date-range indexes end in isDeleted, which can't be constrained once
    // date is a range — filter in JS instead. Pages may therefore contain fewer
    // than `limit` items even when more results remain; clients should keep
    // following next_cursor until it is null.
    const visible = page.page.filter((transaction) => {
      if (transaction.isDeleted) return false;
      if (args.status && transaction.status !== args.status) return false;
      if (args.reviewStatus && transaction.reviewStatus !== args.reviewStatus) return false;
      if (args.categoryId && !transaction.movements.some((m) => m.categoryId === args.categoryId)) return false;
      return true;
    });

    const transactions = await transactionsToApi(ctx, visible, batchResolveMerchantNames);

    return {
      minorUnit,
      body: {
        currency,
        transactions,
        next_cursor: page.isDone ? null : page.continueCursor,
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/transactions/{transaction_id} */
export const getTransaction = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), transactionId: v.string() },
  handler: async (ctx, { clerkId, workspaceId, transactionId }) => {
    const { workspace, currency, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const transaction = await ctx.db.get(transactionId as Id<'transaction'>).catch(() => null);
    if (!transaction || transaction.workspaceId !== workspace._id) {
      throw new ApiError(404, 'not_found', 'Transaction not found');
    }

    const [mapped] = await transactionsToApi(ctx, [transaction], batchResolveMerchantNames);
    return {
      minorUnit,
      body: { currency, transaction: mapped },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/merchants */
export const listMerchants = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string() },
  handler: async (ctx, { clerkId, workspaceId }) => {
    const { workspace, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect();

    const active = merchants.filter((merchant) => !merchant.isDeleted);
    const names = await batchResolveMerchantNames(ctx, new Set(active.map((merchant) => merchant._id)));

    const mapped = active
      .map((merchant) => merchantToApi(merchant, names.get(merchant._id) ?? null))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    return {
      minorUnit,
      body: { merchants: mapped },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/merchants/{merchant_id} */
export const getMerchant = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), merchantId: v.string() },
  handler: async (ctx, { clerkId, workspaceId, merchantId }) => {
    const { workspace, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const merchant = await ctx.db.get(merchantId as Id<'merchant'>).catch(() => null);
    if (!merchant || merchant.isDeleted || merchant.workspaceId !== workspace._id) {
      throw new ApiError(404, 'not_found', 'Merchant not found');
    }

    const names = await batchResolveMerchantNames(ctx, new Set([merchant._id]));
    return {
      minorUnit,
      body: { merchant: merchantToApi(merchant, names.get(merchant._id) ?? null) },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/categories */
export const listCategories = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string() },
  handler: async (ctx, { clerkId, workspaceId }) => {
    const { workspace, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const grouped = await listCategoryGroupsWithCategories(ctx, workspace._id);

    return {
      minorUnit,
      body: {
        category_groups: grouped.groups.map((group) => ({
          id: group.groupId,
          name: group.name,
          type: group.type,
          system: group.isSystemGroup,
          categories: group.categories.map((category) => ({
            id: category.categoryId,
            name: category.name,
            group_id: group.groupId,
            archived: category.isArchived,
            system: category.isSystemCategory,
            category_type: category.categoryType ?? 'custom',
          })),
        })),
      },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/categories/{category_id} */
export const getCategory = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), categoryId: v.string() },
  handler: async (ctx, { clerkId, workspaceId, categoryId }) => {
    const { workspace, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const category = await ctx.db.get(categoryId as Id<'category'>).catch(() => null);
    if (!category || category.isDeleted || (!category.isSystemCategory && category.workspaceId !== workspace._id)) {
      throw new ApiError(404, 'not_found', 'Category not found');
    }

    let resolvedName = category.name;
    if (category.categoryType === 'credit_card' && category.bankAccountId) {
      const account = await ctx.db.get(category.bankAccountId);
      if (account) {
        resolvedName = resolveCategoryNameFromBankAccount(
          category.name,
          category.categoryType,
          category.bankAccountId,
          new Map([[account._id, account.name]])
        );
      }
    }

    return {
      minorUnit,
      body: { category: categoryToApi(category, resolvedName) },
    };
  },
});

/** GET /v1/workspaces/{workspace_id}/category_groups */
export const listCategoryGroups = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string() },
  handler: async (ctx, { clerkId, workspaceId }) => {
    const { workspace, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const grouped = await listCategoryGroupsWithCategories(ctx, workspace._id);

    return {
      minorUnit,
      body: {
        category_groups: grouped.groups.map((group) => ({
          id: group.groupId,
          name: group.name,
          type: group.type,
          system: group.isSystemGroup,
        })),
      },
    };
  },
});

export function envelopeCategoryToApi(category: {
  categoryId: Id<'category'>;
  name: string;
  isArchived: boolean;
  categoryType: Doc<'category'>['categoryType'];
  assignedAmount: bigint;
  totalSpent: bigint;
  carryoverFromPrevious: bigint;
  available: bigint;
  activity?: bigint;
  target: {
    assignmentNeeded: bigint;
    remainingToAssign: bigint;
    underfundedAmount: bigint;
    overfundedByAmount: bigint;
    fundedRatio: number;
    isSnoozed?: boolean;
  };
}) {
  return {
    id: category.categoryId,
    name: category.name,
    archived: category.isArchived,
    category_type: category.categoryType ?? 'custom',
    assigned: category.assignedAmount,
    activity: category.activity ?? category.totalSpent,
    carryover_from_previous: category.carryoverFromPrevious,
    available: category.available,
    target: {
      assignment_needed: category.target.assignmentNeeded,
      remaining_to_assign: category.target.remainingToAssign,
      underfunded_amount: category.target.underfundedAmount,
      overfunded_by_amount: category.target.overfundedByAmount,
      funded_ratio: category.target.fundedRatio,
      snoozed: category.target.isSnoozed ?? false,
    },
  };
}

/** GET /v1/workspaces/{workspace_id}/months/{month} */
export const getMonth = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), month: v.string() },
  handler: async (ctx, { clerkId, workspaceId, month }) => {
    const { workspace, currency, minorUnit } = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const yearMonth = parseApiMonth(month, 'month');
    const currentYearMonth = getCurrentYearMonthForTimezone(workspace.timezone);

    let status;
    try {
      status = await getEnvelopeMonthStatus(ctx, workspace, yearMonth, currentYearMonth);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Budget month is unavailable';
      throw new ApiError(404, 'not_found', detail);
    }

    return {
      minorUnit,
      body: {
        currency,
        month: {
          month: formatApiMonth(yearMonth),
          ready_to_assign: status.readyToAssign,
          summary: {
            percentage_funded: status.summary.percentageFunded,
            total_target_amount: status.summary.totalTargetAmount,
            total_funded: status.summary.totalFunded,
            total_remaining_to_fund: status.summary.totalRemainingToFund,
            total_overspent: status.summary.totalOverspent,
          },
          category_groups: status.groups.map((group) => ({
            id: group.groupId,
            name: group.name,
            type: group.type,
            categories: group.categories.map((category) => envelopeCategoryToApi(category)),
          })),
        },
      },
    };
  },
});
