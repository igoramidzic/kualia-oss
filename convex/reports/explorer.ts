import {
  type PaginationOptions,
  type PaginationResult,
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { action, internalQuery, type QueryCtx, query } from '../_generated/server';
import { requireWorkspaceAccess, requireWorkspaceAccessAction } from '../lib/auth';
import { appendLogoDevToken } from '../lib/logoUtils';
import type { TransactionFeedLookups } from '../transactions/feed';
import { getTransactionFeedLookups } from '../transactions/queries';
import { reportMerchantIdentity, reportMovementGroup } from '../transactions/reportFilters';

import {
  createReportAccumulator,
  type ExplorerEntry,
  matchesDirection,
  matchingMovements,
  type ReportSummary,
  reportFilters,
  reportKind,
  reportRange,
  reportReadRanges,
  reportSummary,
  validateFilters,
} from './analysis';

const reportEntry = v.object({
  id: v.id('transaction'),
  date: v.string(),
  accountId: v.id('bankAccount'),
  accountName: v.string(),
  merchantId: v.string(),
  merchantName: v.string(),
  merchantLogoUrl: v.union(v.string(), v.null()),
  status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled')),
  reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_review')),
  notes: v.union(v.string(), v.null()),
  movements: v.array(v.object({ categoryId: v.string(), categoryName: v.string(), amount: v.string() })),
});

const historyEntry = reportEntry.extend({
  movements: v.array(
    v.object({
      categoryId: v.string(),
      categoryName: v.string(),
      amount: v.string(),
      groupId: v.optional(v.string()),
      groupName: v.optional(v.string()),
    })
  ),
});

export function validateExplorerRange(startDate: string, endDate: string) {
  const parse = (value: string) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    ) {
      throw new ConvexError('Choose a valid report date.');
    }
    return timestamp;
  };
  const days = (parse(endDate) - parse(startDate)) / 86_400_000;
  if (days < 0) throw new ConvexError('Choose an end date on or after the start date.');
}

export function toExplorerEntry(
  transaction: Doc<'transaction'>,
  lookups: TransactionFeedLookups,
  groups?: ReadonlyMap<Id<'categoryGroup'>, Doc<'categoryGroup'>>
) {
  const account = lookups.bankAccounts.get(transaction.bankAccountId);
  if (transaction.type !== 'regular' || transaction.isDeleted || !account) return null;
  const merchant = transaction.merchantId ? lookups.merchants.get(transaction.merchantId) : undefined;
  const global = merchant?.globalMerchantId ? lookups.globalMerchants.get(merchant.globalMerchantId) : undefined;
  const identity = reportMerchantIdentity(transaction, lookups);
  const logo =
    merchant?.visualIdentityMode === 'icon'
      ? null
      : merchant?.logoUrl === undefined
        ? global?.logoUrl
        : merchant.logoUrl;
  return {
    id: transaction._id,
    date: transaction.date.slice(0, 10),
    accountId: account._id,
    accountName: account.name,
    merchantId: identity.id,
    merchantName: identity.name,
    merchantLogoUrl: appendLogoDevToken(logo ?? undefined) ?? null,
    status: transaction.status,
    reviewStatus: transaction.reviewStatus,
    notes: transaction.notes ?? null,
    movements: transaction.movements.map((movement) => ({
      ...(groups ? reportMovementGroup(movement, lookups, groups) : {}),
      categoryId: movement.readyToAssign ? 'ready-to-assign' : (movement.categoryId ?? 'uncategorized'),
      categoryName: movement.readyToAssign
        ? 'Ready to assign'
        : ((movement.categoryId ? lookups.categories.get(movement.categoryId)?.name : undefined) ??
          movement.categoryName ??
          'Uncategorized'),
      // Decimal strings preserve integer precision across the Swift transport.
      amount: movement.amount.toString(),
    })),
  };
}

/** Shared bounded read. Each batch rechecks membership; no financial rows are
 * returned from the summary action. Date arguments make query caching clock-free. */
async function readEntries(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<'workspace'>;
    startDate?: string;
    endDate?: string;
    paginationOpts: PaginationOptions;
    includeGroups?: boolean;
  }
) {
  await requireWorkspaceAccess(ctx, args.workspaceId);
  if (args.startDate !== undefined || args.endDate !== undefined) {
    if (args.startDate === undefined || args.endDate === undefined) throw new ConvexError('Choose both report dates.');
    validateExplorerRange(args.startDate, args.endDate);
  }
  const page = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_isDeleted_date', (q) => {
      const scope = q.eq('workspaceId', args.workspaceId).eq('isDeleted', false);
      return args.startDate !== undefined && args.endDate !== undefined
        ? scope.gte('date', args.startDate).lt('date', `${args.endDate}~`)
        : scope;
    })
    .order('desc')
    .paginate(args.paginationOpts);
  const regular = page.page.filter((entry) => entry.type === 'regular');
  const lookups = await getTransactionFeedLookups(ctx, args.workspaceId, regular);
  const groups = args.includeGroups ? new Map<Id<'categoryGroup'>, Doc<'categoryGroup'>>() : undefined;
  if (groups) {
    const ids = new Set([...lookups.categories.values()].map((category) => category.categoryGroupId));
    const documents = await Promise.all([...ids].map((id) => ctx.db.get('categoryGroup', id)));
    for (const group of documents) {
      if (group?.workspaceId === args.workspaceId) groups.set(group._id, group);
    }
  }
  return {
    ...page,
    page: regular.flatMap((entry) => {
      const result = toExplorerEntry(entry, lookups, groups);
      return result ? [result] : [];
    }),
  };
}

// Keep this date-scoped contract unchanged for already-released iOS clients.
export const listExplorerEntries = query({
  args: {
    workspaceId: v.id('workspace'),
    startDate: v.string(),
    endDate: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(reportEntry),
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    return readEntries(ctx, {
      ...args,
      paginationOpts: boundedClientPagination(args.paginationOpts),
    });
  },
});

// Rollout order: deploy this additive endpoint first, then release the new iOS
// client. Retain all explorer and legacy spending/net-worth endpoints for older apps.
export const listHistoryEntries = query({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(historyEntry),
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    return readEntries(ctx, {
      ...args,
      includeGroups: true,
      paginationOpts: boundedClientPagination(args.paginationOpts),
    });
  },
});

function boundedClientPagination(options: PaginationOptions): PaginationOptions {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 200) {
    throw new ConvexError('Report pages must contain 1 to 200 entries.');
  }
  return {
    ...options,
    maximumRowsRead: Math.min(options.maximumRowsRead ?? 200, 200),
    maximumBytesRead: Math.min(options.maximumBytesRead ?? 1_000_000, 1_000_000),
  };
}

export const readExplorerBatch = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    startDate: v.string(),
    endDate: v.string(),
    cursor: v.union(v.string(), v.null()),
    detail: v.boolean(),
  },
  returns: paginationResultValidator(reportEntry),
  handler: async (ctx, args) =>
    readEntries(ctx, {
      ...args,
      paginationOpts: {
        numItems: args.detail ? 40 : 512,
        cursor: args.cursor,
        maximumRowsRead: 512,
        maximumBytesRead: 1_000_000,
      },
    }),
});

const summaryArgs = {
  workspaceId: v.id('workspace'),
  range: reportRange,
  comparison: reportRange,
  kind: reportKind,
  filters: reportFilters,
};
export const getExplorerSummary = action({
  args: summaryArgs,
  returns: reportSummary,
  handler: async (ctx, args): Promise<ReportSummary> => {
    await requireWorkspaceAccessAction(ctx, args.workspaceId);
    validateExplorerRange(args.range.start, args.range.end);
    validateExplorerRange(args.comparison.start, args.comparison.end);
    validateFilters(args.filters);
    const accumulator = createReportAccumulator(args.range, args.comparison, args.kind, args.filters);
    await Promise.all(
      reportReadRanges(args.range, args.comparison).map(async (range) => {
        let cursor: string | null = null;
        const cursors = new Set<string>();
        for (;;) {
          const batch: PaginationResult<ExplorerEntry> = await ctx.runQuery(
            internal.reports.explorer.readExplorerBatch,
            {
              workspaceId: args.workspaceId,
              startDate: range.start,
              endDate: range.end,
              cursor,
              detail: false,
            }
          );
          accumulator.consume(batch.page);
          if (batch.isDone) break;
          if (!batch.continueCursor || cursors.has(batch.continueCursor))
            throw new ConvexError('Report could not finish. Please try again.');
          cursor = batch.continueCursor;
          cursors.add(cursor);
        }
      })
    );
    return accumulator.finish();
  },
});

/** On-demand detail. Sparse filters are chased on the server; each response
 * contains at most 40 matches. A bounded scan can return an empty continuation. */
export const getExplorerEntries = action({
  args: {
    workspaceId: v.id('workspace'),
    range: reportRange,
    kind: reportKind,
    filters: reportFilters,
    cursor: v.union(v.string(), v.null()),
    search: v.string(),
  },
  returns: v.object({ page: v.array(reportEntry), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args): Promise<{ page: ExplorerEntry[]; continueCursor: string; isDone: boolean }> => {
    await requireWorkspaceAccessAction(ctx, args.workspaceId);
    validateExplorerRange(args.range.start, args.range.end);
    validateFilters(args.filters);
    if (args.search.length > 200) throw new ConvexError('Use a shorter search.');
    const search = args.search.trim().toLocaleLowerCase('en-US');
    let cursor = args.cursor;
    const cursors = new Set<string>();
    for (let scan = 0; scan < 32; scan++) {
      const batch: PaginationResult<ExplorerEntry> = await ctx.runQuery(internal.reports.explorer.readExplorerBatch, {
        workspaceId: args.workspaceId,
        startDate: args.range.start,
        endDate: args.range.end,
        cursor,
        detail: true,
      });
      const page = batch.page.filter(
        (entry) =>
          matchingMovements(entry, args.filters).some((movement) =>
            matchesDirection(BigInt(movement.amount), args.kind)
          ) &&
          (!search ||
            [entry.merchantName, entry.accountName, entry.notes ?? ''].some((text) =>
              text.toLocaleLowerCase('en-US').includes(search)
            ))
      );
      if (batch.isDone || page.length > 0) return { page, continueCursor: batch.continueCursor, isDone: batch.isDone };
      if (!batch.continueCursor || cursors.has(batch.continueCursor))
        throw new ConvexError('Activity could not finish loading. Please try again.');
      cursor = batch.continueCursor;
      cursors.add(cursor);
    }
    return { page: [], continueCursor: cursor ?? '', isDone: false };
  },
});
