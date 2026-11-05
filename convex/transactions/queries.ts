import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, getDocumentSize, v } from 'convex/values';

import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Doc, Id, TableNames } from '../_generated/dataModel';
import { type QueryCtx, query } from '../_generated/server';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';
import { isValidIsoDate } from '../scheduledTransactions/recurrence';
import { getWorkspaceAccessForClerkId } from '../workspaces/access';
import {
  getFeedDeletionBudgetChanges,
  getFeedDeletionTransactions,
  getTransactionFeedAccountLogos,
  MAX_TRANSACTION_FEED_PAGE_SIZE,
  type TransactionFeedLookups,
  toTransactionFeedItems,
  transactionFeedItemValidator,
} from './feed';
import {
  MAX_TRANSACTION_SEARCH_BYTES,
  MAX_TRANSACTION_SEARCH_ROWS,
  searchTransactionFeedPage,
  transactionCategoryActivity,
  transactionFeedSearchValidator,
  transactionMatchesFeedFilters,
} from './feedSearch';
import { populateTransaction, populateTransactionsBatch } from './helpers';
import { transactionMatchesReportFlow } from './reportFilters';

const transactionFeedWorkspaceValidator = v.object({
  id: v.id('workspace'),
  name: v.string(),
  currencyCode: v.string(),
  minorUnit: v.number(),
  timezoneIdentifier: v.union(v.string(), v.null()),
});

async function resolveTransactionFeedWorkspace(
  ctx: QueryCtx,
  requestedWorkspaceId: Id<'workspace'> | undefined
): Promise<Doc<'workspace'> | null> {
  const { user, userProfile } = await requireUserProfile(ctx);
  const workspaceId = requestedWorkspaceId ?? userProfile.activeWorkspaceId;

  if (!workspaceId) {
    return null;
  }

  const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, user.subject);
  if (!access) {
    throw new ConvexError('Access denied: You do not have access to this workspace');
  }

  return access.workspace;
}

export async function getTransactionFeedLookups(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  transactions: readonly Doc<'transaction'>[],
  readDocument: <T extends TableNames>(id: Id<T>) => Promise<Doc<T> | null> = (id) => ctx.db.get(id),
  includeLogos = true
): Promise<TransactionFeedLookups> {
  const merchantIds = new Set<Id<'merchant'>>();
  const bankAccountIds = new Set<Id<'bankAccount'>>();
  const transferLogoAccountIds = new Set<Id<'bankAccount'>>();
  const categoryIds = new Set<Id<'category'>>();
  const transferPairAccountIds = new Map<Id<'transaction'>, Id<'bankAccount'>>();
  const transactionsById = new Map(transactions.map((transaction) => [transaction._id, transaction]));

  // Older transfers may predate the denormalized counterpart account ID.
  const unresolvedPairs = transactions.filter(
    (transaction) =>
      transaction.type === 'transfer' && transaction.transferPairId && !transaction.transferPairBankAccountId
  );
  const pairedTransactions = await Promise.all(
    unresolvedPairs.map((transaction) =>
      transaction.transferPairId
        ? (transactionsById.get(transaction.transferPairId) ?? readDocument(transaction.transferPairId))
        : null
    )
  );
  for (const [index, paired] of pairedTransactions.entries()) {
    const transaction = unresolvedPairs[index];
    if (
      paired &&
      paired.workspaceId === workspaceId &&
      !paired.isDeleted &&
      paired.type === 'transfer' &&
      paired.transferPairId === transaction._id
    ) {
      transferPairAccountIds.set(transaction._id, paired.bankAccountId);
      bankAccountIds.add(paired.bankAccountId);
      transferLogoAccountIds.add(paired.bankAccountId);
    }
  }

  const unresolvedSuggestions = transactions.filter(
    (transaction) =>
      transaction.suggestedTransfer?.status === 'linked_pending_approval' &&
      transaction.suggestedTransfer.matchedTransactionId &&
      !transaction.suggestedTransfer.suggestedCounterpartAccountId
  );
  const suggestedPairs = await Promise.all(
    unresolvedSuggestions.map((transaction) => {
      const id = transaction.suggestedTransfer?.matchedTransactionId;
      return id ? (transactionsById.get(id) ?? readDocument(id)) : null;
    })
  );
  for (const [index, pair] of suggestedPairs.entries()) {
    const transaction = unresolvedSuggestions[index];
    if (
      pair &&
      pair.workspaceId === workspaceId &&
      !pair.isDeleted &&
      pair.type === 'regular' &&
      pair.bankAccountId !== transaction.bankAccountId &&
      pair.totalAmount === -transaction.totalAmount &&
      pair.suggestedTransfer?.status === 'linked_pending_approval' &&
      pair.suggestedTransfer.matchedTransactionId === transaction._id
    ) {
      transferPairAccountIds.set(transaction._id, pair.bankAccountId);
      bankAccountIds.add(pair.bankAccountId);
    }
  }

  for (const transaction of transactions) {
    if (transaction.merchantId) {
      merchantIds.add(transaction.merchantId);
    }
    bankAccountIds.add(transaction.bankAccountId);
    if (transaction.suggestedTransfer?.suggestedCounterpartAccountId) {
      bankAccountIds.add(transaction.suggestedTransfer.suggestedCounterpartAccountId);
    }
    if (transaction.transferPairBankAccountId) {
      bankAccountIds.add(transaction.transferPairBankAccountId);
    }
    if (transaction.type === 'transfer') {
      transferLogoAccountIds.add(transaction.bankAccountId);
      if (transaction.transferPairBankAccountId) {
        transferLogoAccountIds.add(transaction.transferPairBankAccountId);
      }
    }
    for (const movement of transaction.movements) {
      if (movement.categoryId) {
        categoryIds.add(movement.categoryId);
      }
    }
  }

  const [merchantDocs, bankAccountDocs, categoryDocs] = await Promise.all([
    Promise.all([...merchantIds].map((id) => readDocument(id))),
    Promise.all([...bankAccountIds].map((id) => readDocument(id))),
    Promise.all([...categoryIds].map((id) => readDocument(id))),
  ]);

  const merchants = new Map<Id<'merchant'>, Doc<'merchant'>>();
  for (const merchant of merchantDocs) {
    if (merchant && !merchant.isDeleted && merchant.workspaceId === workspaceId) {
      merchants.set(merchant._id, merchant);
    }
  }

  const bankAccounts = new Map<Id<'bankAccount'>, Doc<'bankAccount'>>();
  for (const bankAccount of bankAccountDocs) {
    if (bankAccount && !bankAccount.isDeleted && bankAccount.workspaceId === workspaceId) {
      bankAccounts.set(bankAccount._id, bankAccount);
    }
  }

  const categories = new Map<Id<'category'>, Doc<'category'>>();
  for (const category of categoryDocs) {
    if (
      category &&
      !category.isDeleted &&
      (category.isSystemCategory === true || category.workspaceId === workspaceId)
    ) {
      categories.set(category._id, category);
    }
  }

  const globalMerchantIds = new Set<Id<'globalMerchant'>>();
  for (const merchant of merchants.values()) {
    if (merchant.globalMerchantId) {
      globalMerchantIds.add(merchant.globalMerchantId);
    }
  }

  const [globalMerchantDocs, accountLogoUrls] = await Promise.all([
    Promise.all([...globalMerchantIds].map((id) => readDocument(id))),
    includeLogos
      ? getTransactionFeedAccountLogos(ctx, new Map([...bankAccounts].filter(([id]) => transferLogoAccountIds.has(id))))
      : new Map<Id<'bankAccount'>, string | null>(),
  ]);
  const globalMerchants = new Map<Id<'globalMerchant'>, Doc<'globalMerchant'>>();
  for (const globalMerchant of globalMerchantDocs) {
    if (globalMerchant) {
      globalMerchants.set(globalMerchant._id, globalMerchant);
    }
  }

  return { merchants, globalMerchants, bankAccounts, categories, accountLogoUrls, transferPairAccountIds };
}

const transactionFeedFilterValidator = v.union(v.literal('needs_review'), v.literal('transfers'), v.literal('pending'));
const transactionFeedFilterCountsValidator = v.object({
  needsReview: v.number(),
  transfers: v.number(),
  pending: v.number(),
});

// Use the same indexed sets as status badges, with exact feed membership.
// Preload complete small queues only. Larger queues use bounded native pagination.
async function getTransactionFeedFilterSets(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  scope: { bankAccountId?: Id<'bankAccount'>; startDate?: string; endDate?: string }
) {
  const queries = [
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
      ),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_type_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('type', 'transfer').eq('isDeleted', false)
      ),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
      ),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_status_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('status', 'pending').eq('isDeleted', false)
      ),
    ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
        q.eq('workspaceId', workspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
      ),
  ];
  const sets: Doc<'transaction'>[][] = [];
  let rowsRead = 0;
  let bytesRead = 0;
  for (const query of queries) {
    const rows: Doc<'transaction'>[] = [];
    for await (const transaction of query) {
      rowsRead++;
      // These indexed reads have no database filters: every document read is yielded.
      // The SDK uses Convex's document byte accounting, avoiding a metrics syscall per row.
      bytesRead += getDocumentSize(transaction);
      // Reserve room for the ordinary page, display lookups, and deletion previews.
      // Never present a truncated queue or a partial count as complete.
      if (rowsRead > 300 || bytesRead > 1_000_000) return undefined;
      rows.push(transaction);
    }
    sets.push(rows);
  }
  const [review, transfers, uncategorized, pending, missingPayee] = sets;
  const inScope = (transaction: Doc<'transaction'>) =>
    (!scope.bankAccountId || transaction.bankAccountId === scope.bankAccountId) &&
    (!scope.startDate || transaction.date >= scope.startDate) &&
    (!scope.endDate || transaction.date <= scope.endDate);
  const suggestions = review.filter((transaction) =>
    transactionMatchesFeedFilters(transaction, {
      text: '',
      flow: 'transfer',
      includeSuggestedTransfers: true,
    })
  );
  return {
    needs_review: [
      ...new Map(
        [...review, ...uncategorized, ...missingPayee].map((transaction) => [transaction._id, transaction])
      ).values(),
    ].filter(inScope),
    transfers: [
      ...new Map([...transfers, ...suggestions].map((transaction) => [transaction._id, transaction])).values(),
    ].filter(inScope),
    pending: pending.filter((transaction) => transaction.reviewStatus === 'reviewed' && inScope(transaction)),
  };
}

/**
 * List the authenticated user's active transactions as a compact, display-ready feed.
 * Related display data is resolved only for the current page.
 */
export const listTransactionFeed = query({
  args: {
    workspaceId: v.optional(v.id('workspace')),
    bankAccountId: v.optional(v.id('bankAccount')),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
    includeDeletionPreviews: v.optional(v.boolean()),
    search: v.optional(transactionFeedSearchValidator),
    filter: v.optional(transactionFeedFilterValidator),
    includeFilterCounts: v.optional(v.boolean()),
    includeFilterTransactions: v.optional(v.boolean()),
  },
  returns: v.object({
    workspace: v.union(transactionFeedWorkspaceValidator, v.null()),
    transactions: paginationResultValidator(transactionFeedItemValidator),
    filterCounts: v.optional(transactionFeedFilterCountsValidator),
    filterSetsComplete: v.optional(v.boolean()),
    filterTransactions: v.optional(
      v.object({
        needsReview: v.array(transactionFeedItemValidator),
        transfers: v.array(transactionFeedItemValidator),
        pending: v.array(transactionFeedItemValidator),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const workspace = await resolveTransactionFeedWorkspace(ctx, args.workspaceId);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > MAX_TRANSACTION_FEED_PAGE_SIZE
    ) {
      throw new ConvexError(`Transaction feed page size must be between 1 and ${MAX_TRANSACTION_FEED_PAGE_SIZE}`);
    }

    if (args.filter && args.search) {
      throw new ConvexError('Choose either a feed filter or search');
    }
    if (args.search && args.search.text.length > 300) {
      throw new ConvexError('Keep your search under 300 characters');
    }
    // Bound the source scan separately from the number of matching results.
    if (
      args.search &&
      (!Number.isInteger(args.paginationOpts.maximumRowsRead) ||
        (args.paginationOpts.maximumRowsRead ?? 0) < 1 ||
        (args.paginationOpts.maximumRowsRead ?? 0) > MAX_TRANSACTION_SEARCH_ROWS ||
        !Number.isInteger(args.paginationOpts.maximumBytesRead) ||
        (args.paginationOpts.maximumBytesRead ?? 0) < 1 ||
        (args.paginationOpts.maximumBytesRead ?? 0) > MAX_TRANSACTION_SEARCH_BYTES)
    ) {
      throw new ConvexError('Transaction search requires bounded pagination');
    }
    if (
      (args.startDate !== undefined && !isValidIsoDate(args.startDate)) ||
      (args.endDate !== undefined && !isValidIsoDate(args.endDate)) ||
      (args.startDate !== undefined && args.endDate !== undefined && args.startDate > args.endDate)
    ) {
      throw new ConvexError('Choose a valid transaction date range');
    }
    if (!workspace) {
      return {
        workspace: null,
        filterSetsComplete: true,
        ...(args.includeFilterTransactions
          ? { filterTransactions: { needsReview: [], transfers: [], pending: [] } }
          : {}),
        ...(args.filter || args.includeFilterCounts || args.includeFilterTransactions
          ? { filterCounts: { needsReview: 0, transfers: 0, pending: 0 } }
          : {}),
        transactions: {
          page: [],
          continueCursor: '',
          isDone: true,
        },
      };
    }

    const bankAccountId = args.bankAccountId;
    const categoryId = args.search?.categoryId;
    if (categoryId && categoryId !== 'uncategorized' && categoryId !== 'ready-to-assign') {
      const category = await ctx.db.get(categoryId);
      if (
        !category ||
        (category.isDeleted && !args.search?.reportActivity) ||
        (!category.isSystemCategory && category.workspaceId !== workspace._id)
      ) {
        throw new ConvexError('Category not found in this workspace');
      }
    }
    const groupId = args.search?.groupId;
    if (groupId && groupId !== 'ungrouped' && groupId !== 'ready-to-assign') {
      const group = await ctx.db.get(groupId);
      if (!group || group.workspaceId !== workspace._id) throw new ConvexError('Group not found in this workspace');
    }
    if (args.search?.merchantId) {
      const merchant = await ctx.db.get(args.search.merchantId);
      if (!merchant || merchant.isDeleted || merchant.workspaceId !== workspace._id)
        throw new ConvexError('Merchant not found in this workspace');
    }
    if (bankAccountId) {
      const account = await ctx.db.get(bankAccountId);
      if (!account || account.isDeleted || account.workspaceId !== workspace._id) {
        throw new ConvexError('Account not found in this workspace');
      }
    }
    const wantsFilterSets = args.includeFilterCounts || args.includeFilterTransactions;
    const currencyCode = (workspace.currency ?? 'USD').toUpperCase();
    const minorUnit = getCurrencyDecimals(currencyCode);
    // Text can join the same account, merchant or category thousands of times.
    // Cache reads (including missing records) for this query, then reuse them for display.
    const documents = new Map<string, Promise<unknown>>();
    const readDocument = <T extends TableNames>(id: Id<T>): Promise<Doc<T> | null> => {
      let document = documents.get(id);
      if (!document) {
        document = ctx.db.get(id);
        documents.set(id, document);
      }
      return document as Promise<Doc<T> | null>;
    };
    const filterSetsPromise = wantsFilterSets ? getTransactionFeedFilterSets(ctx, workspace._id, args) : undefined;
    const transactionQuery = bankAccountId
      ? ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_bankAccountId_date_isDeleted', (q) => {
            const scoped = q.eq('workspaceId', workspace._id).eq('bankAccountId', bankAccountId);
            if (args.startDate && args.endDate) return scoped.gte('date', args.startDate).lte('date', args.endDate);
            if (args.startDate) return scoped.gte('date', args.startDate);
            if (args.endDate) return scoped.lte('date', args.endDate);
            return scoped;
          })
          .filter((q) => q.eq(q.field('isDeleted'), false))
      : ctx.db.query('transaction').withIndex('by_workspaceId_isDeleted_date', (q) => {
          const scoped = q.eq('workspaceId', workspace._id).eq('isDeleted', false);
          if (args.startDate && args.endDate) return scoped.gte('date', args.startDate).lte('date', args.endDate);
          if (args.startDate) return scoped.gte('date', args.startDate);
          if (args.endDate) return scoped.lte('date', args.endDate);
          return scoped;
        });
    const filteredQuery = args.filter
      ? transactionQuery.filter((q) => {
          if (args.filter === 'needs_review') {
            // Match the legacy iOS review queue, including reviewed missing payees.
            return q.or(
              q.eq(q.field('reviewStatus'), 'needs_review'),
              q.eq(q.field('hasUncategorized'), true),
              q.eq(q.field('hasMissingPayee'), true)
            );
          }
          if (args.filter === 'pending') {
            return q.and(q.eq(q.field('status'), 'pending'), q.eq(q.field('reviewStatus'), 'reviewed'));
          }
          return q.or(
            q.eq(q.field('type'), 'transfer'),
            q.and(
              q.eq(q.field('reviewStatus'), 'needs_review'),
              q.or(
                q.eq(q.field('suggestedTransfer.status'), 'pending'),
                q.eq(q.field('suggestedTransfer.status'), 'linked_pending_approval')
              )
            )
          );
        })
      : transactionQuery;
    const [filterSets, transactions] = await Promise.all([
      filterSetsPromise,
      args.search
        ? searchTransactionFeedPage(ctx, workspace._id, { ...args, search: args.search }, minorUnit, (rows) =>
            getTransactionFeedLookups(ctx, workspace._id, rows, readDocument, false)
          )
        : filteredQuery.order('desc').paginate({
            ...args.paginationOpts,
            maximumRowsRead: Math.min(args.paginationOpts.maximumRowsRead ?? 200, 200),
            maximumBytesRead: Math.min(args.paginationOpts.maximumBytesRead ?? 1_000_000, 1_000_000),
          }),
    ]);
    const filterCounts = filterSets
      ? {
          needsReview: filterSets.needs_review.length,
          transfers: filterSets.transfers.length,
          pending: filterSets.pending.length,
        }
      : undefined;
    const candidates = transactions.page;
    // Hydrate each transaction once, even if it belongs to several filters.
    // The first live page keeps these complete queues ready for instant switches.
    const displayTransactions =
      args.includeFilterTransactions && filterSets
        ? [
            ...new Map(
              [...candidates, ...Object.values(filterSets).flat()].map((transaction) => [transaction._id, transaction])
            ).values(),
          ]
        : candidates;
    const previewTransactions =
      args.includeDeletionPreviews !== false
        ? await getFeedDeletionTransactions(ctx, workspace._id, displayTransactions)
        : displayTransactions;
    const lookups = await getTransactionFeedLookups(ctx, workspace._id, previewTransactions, readDocument);
    const previews =
      args.includeDeletionPreviews !== false
        ? await getFeedDeletionBudgetChanges(ctx, workspace, previewTransactions, lookups)
        : undefined;
    const matches = candidates;
    const categoryActivity = new Map(
      categoryId && categoryId !== 'uncategorized' && categoryId !== 'ready-to-assign'
        ? matches.map((transaction) => [transaction._id, transactionCategoryActivity(transaction, categoryId)] as const)
        : []
    );

    const filterTransactions =
      args.includeFilterTransactions && filterSets
        ? (() => {
            const itemsById = new Map(
              toTransactionFeedItems(displayTransactions, lookups).map((item) => [
                item.id,
                {
                  ...item,
                  ...(previews ? { deletionBudgetChanges: previews.get(item.transferGroupId ?? item.id) ?? [] } : {}),
                },
              ])
            );
            const items = (transactions: Doc<'transaction'>[]) =>
              transactions
                .sort(
                  (left, right) =>
                    right.date.localeCompare(left.date) ||
                    right._creationTime - left._creationTime ||
                    right._id.localeCompare(left._id)
                )
                .map((transaction) => itemsById.get(transaction._id)!);
            return {
              needsReview: items(filterSets.needs_review),
              transfers: items(filterSets.transfers),
              pending: items(filterSets.pending),
            };
          })()
        : undefined;

    return {
      workspace: {
        id: workspace._id,
        name: workspace.name,
        currencyCode,
        minorUnit,
        timezoneIdentifier: workspace.timezone ?? null,
      },
      ...(wantsFilterSets ? { filterSetsComplete: filterSets !== undefined } : {}),
      ...(filterCounts ? { filterCounts } : {}),
      ...(filterTransactions ? { filterTransactions } : {}),
      transactions: {
        ...transactions,
        page: toTransactionFeedItems(matches, lookups).map((item) => ({
          ...item,
          ...(categoryActivity.has(item.id) ? { categoryActivity: categoryActivity.get(item.id) } : {}),
          ...(previews ? { deletionBudgetChanges: previews.get(item.transferGroupId ?? item.id) ?? [] } : {}),
        })),
      },
    };
  },
});

/**
 * Get a single transaction by ID
 */
export const getTransaction = query({
  args: {
    workspaceId: v.id('workspace'),
    transactionId: v.id('transaction'),
  },
  handler: async (ctx, { workspaceId, transactionId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const transaction = await ctx.db.get(transactionId);
    if (!transaction) {
      return null;
    }

    // Verify workspace access
    if (transaction.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    return await populateTransaction(ctx, transaction);
  },
});

/**
 * Get all transactions for a workspace without pagination or filtering.
 * Returns all transactions with populated relations, sorted by date descending.
 * Filtering should be done on the client side.
 */
export const listAllTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Fetch all non-deleted transactions for the workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_date_isDeleted', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Sort by date (newest first), then by creation time
    const sortedTransactions = transactions.sort((a, b) => {
      const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      return b._creationTime - a._creationTime;
    });

    // Batch populate all related data
    return await populateTransactionsBatch(ctx, sortedTransactions);
  },
});

/**
 * Get all transactions for a workspace with embedded movements.
 * Returns raw transaction data with movements array - frontend handles population
 * of bank accounts, merchants, categories using already-cached service data.
 * Now much faster since movements are embedded directly on transactions.
 */
export const listAllTransactionsRaw = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Fetch all non-deleted transactions (movements are now embedded)
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_date_isDeleted', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Sort transactions by date (newest first), then by creation time
    const sortedTransactions = transactions.sort((a, b) => {
      const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      return b._creationTime - a._creationTime;
    });

    // Movements are already embedded on transactions
    return sortedTransactions;
  },
});

/**
 * Get all transactions for a workspace with pagination
 * Uses Convex's built-in pagination API with optional filters
 * Returns raw transactions with embedded movements array - frontend handles population
 *
 * Filter options:
 * - uncategorized: If true, only return transactions with uncategorized movements (no pagination, small result set)
 * - pending: If true, only return pending transactions (no pagination, small result set)
 * - bankAccountId: Filter by bank account (paginated)
 * - merchantId: Filter by merchant (paginated)
 * - search: Full-text search (custom cursor pagination)
 */
export const listTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
    merchantId: v.optional(v.id('merchant')),
    bankAccountId: v.optional(v.id('bankAccount')),
    search: v.optional(v.string()),
    pending: v.optional(v.literal(true)), // Filter for pending transactions only
    needsReview: v.optional(v.literal(true)), // Filter for needs_review transactions (includes uncategorized + missing payee)
    transfer: v.optional(v.literal(true)), // Filter for transfer transactions only
    excludeReconciled: v.optional(v.literal(true)), // Exclude reconciled transactions
  },
  handler: async (
    ctx,
    {
      workspaceId,
      paginationOpts,
      merchantId,
      bankAccountId,
      search,
      pending,
      needsReview,
      transfer,
      excludeReconciled,
    }
  ) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const hasSearch = search && search.trim();

    // SEARCH PATH: Use search index with custom cursor pagination
    if (hasSearch) {
      const searchResults = await ctx.db
        .query('transaction')
        .withSearchIndex('search_transactions', (q) => {
          let sq = q.search('searchText', search.trim()).eq('workspaceId', verifiedWorkspaceId).eq('isDeleted', false);
          if (pending === true) {
            sq = sq.eq('status', 'pending');
          }
          return sq;
        })
        .take(1000);

      // Apply needsReview filter if requested (post-filter since it's a complex OR condition)
      // needsReview includes: reviewStatus='needs_review' OR (reviewed AND hasUncategorized) OR (reviewed AND hasMissingPayee)
      let filteredResults = searchResults;
      if (needsReview === true) {
        filteredResults = searchResults.filter(
          (t) =>
            t.reviewStatus === 'needs_review' ||
            (t.reviewStatus === 'reviewed' && t.hasUncategorized === true) ||
            (t.reviewStatus === 'reviewed' && t.hasMissingPayee === true)
        );
      }

      // Exclude reconciled transactions if requested
      if (excludeReconciled === true) {
        filteredResults = filteredResults.filter((t) => t.status !== 'reconciled');
      }

      // Sort by date (newest first), then by creation time for consistent ordering
      const sortedResults = filteredResults.sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b._creationTime - a._creationTime;
      });

      // Apply custom cursor pagination for search results
      let transactionsToPaginate = sortedResults;
      if (paginationOpts.cursor) {
        const [cursorDate, cursorId] = paginationOpts.cursor.split('|');
        if (cursorDate) {
          const cursorDateTime = new Date(cursorDate).getTime();
          transactionsToPaginate = sortedResults.filter((t) => {
            const tDate = new Date(t.date).getTime();
            return tDate < cursorDateTime || (tDate === cursorDateTime && cursorId && t._id < cursorId);
          });
        }
      }

      const pageTransactions = transactionsToPaginate.slice(0, paginationOpts.numItems + 1);
      const hasMore = pageTransactions.length > paginationOpts.numItems;
      const page = pageTransactions.slice(0, paginationOpts.numItems);
      const continueCursor =
        hasMore && page.length > 0 ? `${page[page.length - 1].date}|${page[page.length - 1]._id}` : null;

      return { page, continueCursor, isDone: !hasMore };
    }

    // PENDING PATH: Small result set, no pagination needed
    if (pending === true) {
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_status_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('status', 'pending').eq('isDeleted', false)
        )
        .filter((q) => q.eq(q.field('reviewStatus'), 'reviewed'))
        .collect();

      // Sort by date (newest first), then by creation time - include ALL pending transactions (transfers can be pending)
      const sorted = transactions.sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b._creationTime - a._creationTime;
      });

      return { page: sorted, continueCursor: null, isDone: true };
    }

    // NEEDS_REVIEW PATH: Includes reviewStatus='needs_review', hasUncategorized=true, hasMissingPayee=true
    // Small result set, no pagination needed
    if (needsReview === true) {
      // Fetch three sets in parallel and deduplicate
      const [needsReviewTransactions, uncategorizedTransactions, missingPayeeTransactions] = await Promise.all([
        // 1. Transactions explicitly marked as needs_review
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
          )
          .collect(),
        // 2. Reviewed transactions with uncategorized movements
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
          )
          .collect()
          .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
        // 3. Reviewed transactions with missing payee
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
          )
          .collect()
          .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
      ]);

      // Deduplicate by transaction ID using a Map to preserve transaction objects
      const transactionMap = new Map<string, (typeof needsReviewTransactions)[0]>();
      needsReviewTransactions.forEach((t) => transactionMap.set(t._id, t));
      uncategorizedTransactions.forEach((t) => transactionMap.set(t._id, t));
      missingPayeeTransactions.forEach((t) => transactionMap.set(t._id, t));

      // Sort by date (newest first), then by creation time
      const sorted = Array.from(transactionMap.values()).sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b._creationTime - a._creationTime;
      });

      return { page: sorted, continueCursor: null, isDone: true };
    }

    // TRANSFER PATH: Small result set, no pagination needed
    if (transfer === true) {
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_type_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('type', 'transfer').eq('isDeleted', false)
        )
        .filter((q) => q.eq(q.field('reviewStatus'), 'reviewed'))
        .collect();

      // Sort by date (newest first), then by creation time for consistent ordering
      const sorted = transactions.sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b._creationTime - a._creationTime;
      });

      return { page: sorted, continueCursor: null, isDone: true };
    }

    // PAGINATED PATHS: Use Convex's built-in pagination

    if (bankAccountId) {
      // Bank account filter - paginated by date
      const result = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_bankAccountId_date_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('bankAccountId', bankAccountId)
        )
        .filter((q) =>
          excludeReconciled === true
            ? q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('status'), 'reconciled'))
            : q.eq(q.field('isDeleted'), false)
        )
        .order('desc')
        .paginate(paginationOpts);

      return result;
    }

    if (merchantId) {
      // Merchant filter - paginated
      const result = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_merchantId', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('merchantId', merchantId)
        )
        .filter((q) =>
          excludeReconciled === true
            ? q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('status'), 'reconciled'))
            : q.eq(q.field('isDeleted'), false)
        )
        .order('desc')
        .paginate(paginationOpts);

      return result;
    }

    // DEFAULT PATH: All transactions - paginated by date
    const result = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_date_isDeleted', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) =>
        excludeReconciled === true
          ? q.and(
              q.eq(q.field('isDeleted'), false),
              q.neq(q.field('reviewStatus'), 'rejected'),
              q.neq(q.field('status'), 'reconciled')
            )
          : q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('reviewStatus'), 'rejected'))
      )
      .order('desc')
      .paginate(paginationOpts);

    return result;
  },
});

/**
 * Get transaction statistics for a workspace
 */
export const getTransactionStats = query({
  args: {
    workspaceId: v.id('workspace'),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, startDate, endDate }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get bank accounts for this workspace
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const bankAccountIds = bankAccounts.map((a) => a._id);

    if (bankAccountIds.length === 0) {
      return {
        totalTransactions: 0,
        totalAmount: 0,
        organizationStats: null,
      };
    }

    // Get transactions for this org
    let transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Filter by date range
    transactions = transactions.filter((t) => {
      if (startDate && t.date < startDate) return false;
      if (endDate && t.date > endDate) return false;
      return true;
    });

    // Calculate total amount from embedded totalAmount or movements
    const totalAmount = transactions.reduce(
      (sum, t) => sum + (t.totalAmount ?? t.movements?.reduce((s, m) => s + m.amount, 0n) ?? 0n),
      0n
    );

    return {
      totalTransactions: transactions.length,
      totalAmount,
      organizationStats: {
        workspaceId: verifiedWorkspaceId,
        transactionCount: transactions.length,
        totalAmount,
      },
    };
  },
});

/**
 * Get all archived (soft-deleted) transactions for a workspace
 */
export const listArchivedTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get all bank accounts for the workspace
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .collect();

    const orgBankAccountIds = bankAccounts.map((account) => account._id);

    if (orgBankAccountIds.length === 0) {
      return [];
    }

    // Get all deleted transactions for this org
    const orgTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), true))
      .collect();

    // Sort by deletion date (newest first)
    const sortedTransactions = orgTransactions.sort((a, b) => {
      if (!a.deletedAt && !b.deletedAt) return 0;
      if (!a.deletedAt) return 1;
      if (!b.deletedAt) return -1;
      return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
    });

    // Populate all related data using the helper function
    return await Promise.all(sortedTransactions.map((t) => populateTransaction(ctx, t)));
  },
});

/**
 * Get the most recent transactions for a workspace
 */
export const listRecentTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, limit = 5 }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get all transactions for this org
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Sort by date (newest first), then by creation time
    const sortedTransactions = transactions
      .sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b._creationTime - a._creationTime;
      })
      .slice(0, limit);

    // Populate all related data
    return await Promise.all(sortedTransactions.map((t) => populateTransaction(ctx, t)));
  },
});

/**
 * @deprecated Use listTransactions with reactive pagination instead
 * Watch specific transactions by their IDs for real-time updates
 * Used for progressive subscription model where we only subscribe to loaded transactions
 * Returns transactions with embedded movements in the same order as the input IDs
 */
export const watchTransactionsByIds = query({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
  },
  handler: async (ctx, { workspaceId, transactionIds }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    if (transactionIds.length === 0) {
      return [];
    }

    // Fetch all requested transactions in parallel
    const transactionResults = await Promise.all(
      transactionIds.map(async (id) => {
        const transaction = await ctx.db.get(id);
        // Verify workspace access and that transaction is not deleted
        if (!transaction || transaction.isDeleted || transaction.workspaceId !== verifiedWorkspaceId) {
          return null;
        }
        return transaction;
      })
    );

    // Filter out null values (deleted or unauthorized transactions)
    const validTransactions = transactionResults.filter((t): t is NonNullable<typeof t> => t !== null);

    if (validTransactions.length === 0) {
      return [];
    }

    // Return transactions with embedded movements, preserving input order
    // Movements are already embedded on transactions - no separate fetch needed
    return transactionIds
      .map((id) => {
        const transaction = validTransactions.find((t) => t._id === id);
        if (!transaction) return null;
        return transaction;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  },
});

/**
 * Get all transaction movements for a specific category
 * Useful for category drill-down and reporting
 * Now searches embedded movements array instead of separate table
 */
export const listMovementsByCategory = query({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, categoryId, startDate, endDate }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Get all transactions for this workspace (movements are embedded)
    let transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Apply date filters
    if (startDate) {
      transactions = transactions.filter((t) => t.date >= startDate);
    }
    if (endDate) {
      transactions = transactions.filter((t) => t.date <= endDate);
    }

    // Filter to transactions that have movements with the specified categoryId
    const transactionsWithCategory = transactions.filter(
      (t) => t.movements && t.movements.some((m) => m.categoryId === categoryId)
    );

    // Fetch category once
    const category = await ctx.db.get(categoryId);

    // Build results - one entry per matching movement
    const results = await Promise.all(
      transactionsWithCategory.map(async (transaction) => {
        const populatedTransaction = await populateTransaction(ctx, transaction);
        const matchingMovements = transaction.movements?.filter((m) => m.categoryId === categoryId) ?? [];

        return matchingMovements.map((movement) => ({
          movement: {
            ...movement,
            transactionId: transaction._id,
            workspaceId: verifiedWorkspaceId,
            category: category?.isDeleted ? null : category,
          },
          transaction: populatedTransaction,
        }));
      })
    );

    // Flatten the results array
    return results.flat();
  },
});

/**
 * Get transactions for a specific month with optional filtering
 * Uses dateYearMonth index for efficient month-based queries
 * Filtering is done in-memory (small result set ~50 transactions per month)
 * Returns raw transactions - iOS will populate relations client-side
 *
 * Filter options (mutually exclusive):
 * - categoryId: Filter by a specific category (or special system IDs)
 *   - 'system:uncategorized': Transactions with uncategorized movements (no categoryId, not readyToAssign)
 *   - 'system:income': Transactions with readyToAssign movements (income)
 * - categoryGroupId: Filter by all categories in a group (or special system IDs)
 *   - 'system:uncategorized-group': Same as system:uncategorized
 * - merchantId: Filter by merchant (or special system IDs)
 *   - 'system:unknown-merchant': Transactions with missing payee (no merchantId)
 */
export const listTransactionsByMonth = query({
  args: {
    workspaceId: v.id('workspace'),
    dateYearMonth: v.optional(v.number()), // YYYYMM format (e.g., 202512). Omit to fetch all months.
    endYearMonth: v.optional(v.number()), // Optional end month for range queries (YYYYMM format)
    categoryId: v.optional(v.union(v.id('category'), v.string())), // Allow string for system IDs
    categoryGroupId: v.optional(v.union(v.id('categoryGroup'), v.string())), // Allow string for system IDs
    merchantId: v.optional(v.union(v.id('merchant'), v.string())), // Allow string for system IDs
    flow: v.optional(v.union(v.literal('inflow'), v.literal('outflow'))),
  },
  handler: async (ctx, { workspaceId, dateYearMonth, endYearMonth, categoryId, categoryGroupId, merchantId, flow }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Check for special system IDs
    const isUncategorized = categoryId === 'system:uncategorized' || categoryGroupId === 'system:uncategorized-group';
    const isIncome = categoryId === 'system:income' || categoryGroupId === 'system:income-group';
    const isUnknownMerchant = merchantId === 'system:unknown-merchant';

    // If filtering by a real group (not system ID), first get all category IDs in that group
    let categoryIdsInGroup: Set<string> | null = null;
    if (categoryGroupId && !categoryGroupId.startsWith('system:')) {
      const categoriesInGroup = await ctx.db
        .query('category')
        .withIndex('by_workspaceId_categoryGroupId', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('categoryGroupId', categoryGroupId as Id<'categoryGroup'>)
        )
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();
      categoryIdsInGroup = new Set(categoriesInGroup.map((c) => c._id));
    }

    // Fetch transactions using index - all months, month range, or single month
    let transactions;
    if (dateYearMonth === undefined) {
      // All time: fetch all transactions for the workspace
      transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_dateYearMonth_isDeleted', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();
    } else if (endYearMonth) {
      transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_dateYearMonth_isDeleted', (q) =>
          q
            .eq('workspaceId', verifiedWorkspaceId)
            .gte('dateYearMonth', dateYearMonth)
            .lte('dateYearMonth', endYearMonth)
        )
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();
    } else {
      transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_dateYearMonth_isDeleted', (q) =>
          q.eq('workspaceId', verifiedWorkspaceId).eq('dateYearMonth', dateYearMonth).eq('isDeleted', false)
        )
        .collect();
    }

    // Filter by special system categories
    if (isUncategorized) {
      // Uncategorized: use the pre-computed hasUncategorized field (already excludes transfers)
      transactions = transactions.filter((t) => t.hasUncategorized === true);
    } else if (isIncome) {
      // Income (Ready to Assign): movements with readyToAssign === true
      // Exclude starting_balance and balance_adjustment transactions as they are not real income
      // (matching the logic in transactionMovement/helpers.ts for monthlyIncomeActivity)
      transactions = transactions.filter(
        (t) =>
          t.movements &&
          t.movements.some((m) => m.readyToAssign === true) &&
          t.type !== 'starting_balance' &&
          t.type !== 'balance_adjustment'
      );
    } else if (categoryId && !categoryId.startsWith('system:')) {
      // Filter by regular category if provided (in-memory, small result set ~50 transactions)
      transactions = transactions.filter((t) => t.movements && t.movements.some((m) => m.categoryId === categoryId));
    } else if (categoryIdsInGroup) {
      // Filter by category group if provided
      transactions = transactions.filter(
        (t) => t.movements && t.movements.some((m) => m.categoryId && categoryIdsInGroup.has(m.categoryId))
      );
    }

    // Filter by merchant
    if (isUnknownMerchant) {
      // Unknown merchant: transactions with missing payee (hasMissingPayee === true)
      transactions = transactions.filter((t) => t.hasMissingPayee === true);
    } else if (merchantId && !merchantId.startsWith('system:')) {
      transactions = transactions.filter((t) => t.merchantId === merchantId);
    }

    transactions = transactions.filter((transaction) =>
      transactionMatchesReportFlow(transaction, flow, {
        categoryId: categoryId && !categoryId.startsWith('system:') ? categoryId : undefined,
        categoryIdsInGroup,
        isIncome,
        isUncategorized,
        merchantId: merchantId ? merchantId.toString() : undefined,
      })
    );

    // Sort by date descending, then by creation time
    const sortedTransactions = transactions.sort((a, b) => {
      const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      return b._creationTime - a._creationTime;
    });

    return sortedTransactions;
  },
});

/**
 * Get transaction status counts for a workspace
 * Returns counts for pending and needs review transactions
 * Used for displaying badges and indicators in the UI
 *
 * "Needs Review" includes:
 * - Transactions with reviewStatus='needs_review' (explicitly marked)
 * - Reviewed transactions with hasUncategorized=true (missing category)
 * - Reviewed transactions with hasMissingPayee=true (missing payee)
 */
export const getTransactionStatusCounts = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Count pending reviewed transactions only
    const pendingCount = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_status_isDeleted', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('status', 'pending').eq('isDeleted', false)
      )
      .collect()
      .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed').length);

    // Count transactions that need review (combines multiple criteria)
    // Fetch three sets in parallel and deduplicate by transaction ID
    const [needsReviewTransactions, uncategorizedTransactions, missingPayeeTransactions, transferCount] =
      await Promise.all([
        // 1. Transactions explicitly marked as needs_review
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
          )
          .collect(),
        // 2. Reviewed transactions with uncategorized movements
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
          )
          .collect()
          .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
        // 3. Reviewed transactions with missing payee
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
          )
          .collect()
          .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
        // 4. Transfer transactions (reviewed only)
        ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_type_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('type', 'transfer').eq('isDeleted', false)
          )
          .collect()
          .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed').length),
      ]);

    // Deduplicate by transaction ID
    const needsReviewIds = new Set<string>();
    needsReviewTransactions.forEach((t) => needsReviewIds.add(t._id));
    uncategorizedTransactions.forEach((t) => needsReviewIds.add(t._id));
    missingPayeeTransactions.forEach((t) => needsReviewIds.add(t._id));

    return {
      pendingCount,
      needsReviewCount: needsReviewIds.size,
      transferCount,
    };
  },
});
