import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { ConvexError, compareValues, type Value } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { requireUserProfile } from '../lib/auth';
import { getWorkspaceAccessForClerkId } from '../workspaces/access';
import { listTransactionFeed } from './queries';

vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  requireUserProfile: vi.fn(),
}));
vi.mock('../workspaces/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workspaces/access')>()),
  getWorkspaceAccessForClerkId: vi.fn(),
}));

type FeedArgs = FunctionArgs<typeof api.transactions.listTransactionFeed>;
type FeedResult = FunctionReturnType<typeof api.transactions.listTransactionFeed>;
type TransactionField = keyof Doc<'transaction'>;
type Condition = { field: TransactionField; value: Value; comparison?: 'gte' | 'lte' | 'gt' | 'lt' };

const workspaceId = 'workspace' as Id<'workspace'>;
const otherWorkspaceId = 'other-workspace' as Id<'workspace'>;
const accountId = 'checking' as Id<'bankAccount'>;
const otherAccountId = 'savings' as Id<'bankAccount'>;
const workspace: Doc<'workspace'> = {
  _id: workspaceId,
  _creationTime: 1,
  name: 'Personal',
  ownerClerkId: 'signed-in-user',
  currency: 'usd',
  timezone: 'America/New_York',
  transactionDefaultPendingStatus: false,
};

const handler = (
  listTransactionFeed as unknown as {
    _handler: (ctx: QueryCtx, args: FeedArgs) => Promise<FeedResult>;
  }
)._handler;

function account(overrides: Partial<Doc<'bankAccount'>> = {}): Doc<'bankAccount'> {
  return {
    _id: accountId,
    _creationTime: 1,
    workspaceId,
    name: 'Daily checking',
    accountType: 'banking_checking',
    currentBalance: 5_000n,
    isClosed: false,
    isDeleted: false,
    ...overrides,
  };
}

function transaction(id: string, date: string, overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    date,
    dateYearMonth: 202609,
    type: 'regular',
    status: 'cleared',
    reviewStatus: 'reviewed',
    isDeleted: false,
    movements: [],
    totalAmount: -1_250n,
    searchText: '',
    hasUncategorized: false,
    hasMissingPayee: false,
    ...overrides,
  };
}

function setup() {
  const categories = new Map<Id<'category'>, Doc<'category'>>();
  const groups = new Map<Id<'categoryGroup'>, Doc<'categoryGroup'>>();
  const merchants = new Map<Id<'merchant'>, Doc<'merchant'>>();
  const accounts = new Map<Id<'bankAccount'>, Doc<'bankAccount'>>([
    [accountId, account()],
    [otherAccountId, account({ _id: otherAccountId, name: 'Savings', accountType: 'banking_savings' })],
  ]);
  const rows = [
    transaction('checking-older', '2026-09-01'),
    transaction('savings-recent', '2026-09-03', { bankAccountId: otherAccountId }),
    transaction('checking-recent', '2026-09-04'),
    transaction('deleted', '2026-09-05', { isDeleted: true }),
    transaction('foreign', '2026-09-05', { workspaceId: otherWorkspaceId }),
  ];
  const indexConditions: Condition[] = [];
  type Predicate = (row: Doc<'transaction'>) => boolean;
  const filterConditions: Predicate[] = [];
  const indexBuilder = {
    gt: (field: TransactionField, value: Value) => {
      indexConditions.push({ field, value, comparison: 'gt' });
      return indexBuilder;
    },
    lt: (field: TransactionField, value: Value) => {
      indexConditions.push({ field, value, comparison: 'lt' });
      return indexBuilder;
    },
    gte: (field: TransactionField, value: string) => {
      indexConditions.push({ field, value, comparison: 'gte' });
      return indexBuilder;
    },
    lte: (field: TransactionField, value: string) => {
      indexConditions.push({ field, value, comparison: 'lte' });
      return indexBuilder;
    },
    eq: (field: TransactionField, value: Value) => {
      indexConditions.push({ field, value });
      return indexBuilder;
    },
  };
  const filterBuilder = {
    field: (field: TransactionField) => field,
    eq:
      (field: string, value: unknown): Predicate =>
      (row) => {
        const actual =
          field === 'suggestedTransfer.status' ? row.suggestedTransfer?.status : row[field as TransactionField];
        return actual === value;
      },
    or:
      (...conditions: Predicate[]): Predicate =>
      (row) =>
        conditions.some((condition) => condition(row)),
    and:
      (...conditions: Predicate[]): Predicate =>
      (row) =>
        conditions.every((condition) => condition(row)),
  };
  const metadata = {
    isDone: false,
    continueCursor: 'next-account-page',
    splitCursor: 'split-account-page',
    pageStatus: 'SplitRecommended' as const,
  };
  const paginate = vi.fn(async (options: FeedArgs['paginationOpts']) => {
    const conditions = indexConditions;
    const page = rows
      .filter((row) =>
        conditions.every(({ field, value, comparison }) => {
          if (comparison && typeof value === 'string') {
            return comparison === 'gte' ? String(row[field]) >= value : String(row[field]) <= value;
          }
          return row[field] === value;
        })
      )
      .filter((row) => filterConditions.every((condition) => condition(row)))
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, options.numItems);
    return { ...metadata, page };
  });
  const order = vi.fn(() => ({ paginate }));
  const filter = vi.fn((callback: (builder: typeof filterBuilder) => Predicate) => {
    filterConditions.push(callback(filterBuilder));
    return { order, filter };
  });
  const budget = { read: 0, beforeRead: undefined as (() => Promise<void>) | undefined };
  const withIndex = vi.fn((_name: string, callback: (builder: typeof indexBuilder) => unknown) => {
    indexConditions.length = 0;
    filterConditions.length = 0;
    const conditionStart = indexConditions.length;
    callback(indexBuilder);
    const ownConditions = indexConditions.slice(conditionStart);
    const matchesIndex = (row: Doc<'transaction'>) =>
      ownConditions.every(({ field, value, comparison }) => {
        const difference = compareValues(row[field] as Value, value);
        switch (comparison) {
          case 'gt':
            return difference > 0;
          case 'gte':
            return difference >= 0;
          case 'lt':
            return difference < 0;
          case 'lte':
            return difference <= 0;
          default:
            return difference === 0;
        }
      });
    return {
      filter,
      order: (direction: 'asc' | 'desc') => ({
        ...order(),
        async *[Symbol.asyncIterator]() {
          const sorted = rows
            .filter(matchesIndex)
            .sort(
              (left, right) =>
                (direction === 'desc' ? -1 : 1) *
                (left.date.localeCompare(right.date) ||
                  left._creationTime - right._creationTime ||
                  left._id.localeCompare(right._id))
            );
          for (const row of sorted) {
            budget.read++;
            yield row;
          }
        },
      }),
      async *[Symbol.asyncIterator]() {
        for (const row of rows.filter((row) => ownConditions.every(({ field, value }) => row[field] === value))) {
          budget.read++;
          await budget.beforeRead?.();
          yield row;
        }
      },
    };
  });
  const query = vi.fn(() => ({ withIndex }));
  const get = vi.fn(
    async (id: string) =>
      accounts.get(id as Id<'bankAccount'>) ??
      categories.get(id as Id<'category'>) ??
      groups.get(id as Id<'categoryGroup'>) ??
      merchants.get(id as Id<'merchant'>) ??
      null
  );
  const ctx = {
    db: { query, get },
  } as unknown as QueryCtx;

  vi.mocked(requireUserProfile).mockResolvedValue({
    user: { subject: workspace.ownerClerkId },
    userProfile: { activeWorkspaceId: workspaceId },
  } as Awaited<ReturnType<typeof requireUserProfile>>);
  vi.mocked(getWorkspaceAccessForClerkId).mockResolvedValue({
    workspace,
    ownerClerkId: workspace.ownerClerkId,
    kind: 'owner',
    role: 'admin',
  });
  return {
    ctx,
    accounts,
    categories,
    groups,
    merchants,
    rows,
    query,
    get,
    withIndex,
    indexConditions,
    order,
    paginate,
    metadata,
    budget,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('account transaction feed', () => {
  it('starts the ordinary page while filter queues are still loading', async () => {
    const { ctx, rows, budget, paginate } = setup();
    rows.push(transaction('review', '2026-09-04', { reviewStatus: 'needs_review' }));
    let releaseQueue!: () => void;
    const blockedQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    budget.beforeRead = () => blockedQueue;
    const pending = handler(ctx, {
      workspaceId,
      includeFilterTransactions: true,
      includeDeletionPreviews: false,
      paginationOpts: { numItems: 40, cursor: null },
    });
    try {
      await vi.waitFor(() => expect(paginate).toHaveBeenCalledOnce());
    } finally {
      releaseQueue();
    }
    const result = await pending;
    expect(result.filterCounts).toEqual({ needsReview: 1, transfers: 0, pending: 0 });
    expect(result.transactions.page).toHaveLength(4);
  });

  it('paginates the review queue while counting missing categories and payees without double-counting', async () => {
    const { ctx, rows, paginate } = setup();
    for (let index = 0; index < 85; index++) {
      rows.push(transaction(`review-${index}`, '2026-09-01', { reviewStatus: 'needs_review', hasUncategorized: true }));
    }
    rows.push(
      transaction('uncategorized', '2026-09-02', { hasUncategorized: true }),
      transaction('missing-payee', '2026-09-02', { hasMissingPayee: true }),
      transaction('overlap', '2026-09-02', {
        hasMissingPayee: true,
        hasUncategorized: true,
        reviewStatus: 'needs_review',
      }),
      transaction('pending-review', '2026-09-03', { status: 'pending', reviewStatus: 'needs_review' }),
      transaction('pending', '2026-09-03', { status: 'pending' }),
      transaction('transfer', '2026-09-04', { type: 'transfer' }),
      transaction('suggestion', '2026-09-05', {
        reviewStatus: 'needs_review',
        suggestedTransfer: {
          status: 'pending',
          transferConfidence: 95,
          detectionReason: 'Bank transfer',
        },
      }),
      transaction('deleted', '2026-09-06', { isDeleted: true, hasUncategorized: true, hasMissingPayee: true }),
      transaction('other-workspace', '2026-09-06', {
        workspaceId: otherWorkspaceId,
        hasUncategorized: true,
        hasMissingPayee: true,
      })
    );
    const base = {
      workspaceId,
      paginationOpts: { numItems: 40, cursor: null },
      includeDeletionPreviews: false,
      includeFilterCounts: true,
      includeFilterTransactions: true,
    };
    const review = await handler(ctx, { ...base, filter: 'needs_review' });
    expect(review.transactions.page).toHaveLength(40);
    expect(review.transactions.page[0].id).toBe('suggestion');
    expect(review.transactions.isDone).toBe(false);
    expect(review.transactions.continueCursor).toBe('next-account-page');
    expect(review.filterCounts).toEqual({ needsReview: 90, transfers: 2, pending: 1 });
    expect(review.filterTransactions?.needsReview).toHaveLength(90);
    expect(review.filterTransactions?.needsReview.some((row) => row.id === 'missing-payee')).toBe(true);
    expect(review.filterTransactions?.pending.map((row) => row.id)).toEqual(['pending']);
    expect(paginate).toHaveBeenCalledOnce();
    expect(review.transactions.page.some((row) => row.id === 'uncategorized')).toBe(true);
    expect(review.transactions.page.some((row) => row.id === 'missing-payee')).toBe(true);
    expect(new Set(review.transactions.page.map((row) => row.id)).size).toBe(40);
    const transfers = await handler(ctx, { ...base, filter: 'transfers' });
    expect(transfers.transactions.page.map((row) => row.id)).toEqual(['suggestion', 'transfer']);
    const pending = await handler(ctx, { ...base, filter: 'pending' });
    expect(pending.transactions.page.map((row) => row.id)).toEqual(['pending']);
  });

  it('preloads every filtered queue in the first live page without expanding All history', async () => {
    const { ctx, rows, paginate } = setup();
    for (let index = 0; index < 85; index++) {
      rows.push(transaction(`old-review-${index}`, '2020-01-01', { hasUncategorized: true }));
    }
    rows.push(
      transaction('old-pending', '2020-01-02', { status: 'pending' }),
      transaction('old-transfer', '2020-01-03', { type: 'transfer' }),
      transaction('foreign-review', '2020-01-01', { workspaceId: otherWorkspaceId, hasUncategorized: true }),
      transaction('deleted-review', '2020-01-01', { isDeleted: true, hasUncategorized: true })
    );
    const result = await handler(ctx, {
      workspaceId,
      includeFilterTransactions: true,
      paginationOpts: { numItems: 1, cursor: null },
      includeDeletionPreviews: false,
    });
    expect(result.transactions.page).toHaveLength(1);
    expect(result.transactions.isDone).toBe(false);
    expect(result.filterTransactions?.needsReview).toHaveLength(85);
    expect(result.filterTransactions?.transfers.map((row) => row.id)).toEqual(['old-transfer']);
    expect(result.filterTransactions?.pending.map((row) => row.id)).toEqual(['old-pending']);
    expect(result.filterCounts).toEqual({ needsReview: 85, transfers: 1, pending: 1 });
    expect(paginate).toHaveBeenCalledOnce();
  });

  it('scopes counts and the full filter set to the selected account and dates', async () => {
    const { ctx, rows } = setup();
    rows.push(
      transaction('inside', '2026-09-04', { reviewStatus: 'needs_review' }),
      transaction('outside-date', '2026-09-03', { reviewStatus: 'needs_review' }),
      transaction('outside-account', '2026-09-04', { reviewStatus: 'needs_review', bankAccountId: otherAccountId })
    );
    const result = await handler(ctx, {
      workspaceId,
      bankAccountId: accountId,
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      filter: 'needs_review',
      includeFilterCounts: true,
      paginationOpts: { numItems: 40, cursor: null },
      includeDeletionPreviews: false,
    });
    expect(result.transactions.page.map((row) => row.id)).toEqual(['inside']);
    expect(result.filterCounts).toEqual({ needsReview: 1, transfers: 0, pending: 0 });
  });

  it('returns counts on All without fetching the rest of its paginated history', async () => {
    const { ctx, rows, paginate } = setup();
    rows.push(transaction('review', '2026-09-04', { reviewStatus: 'needs_review' }));
    const result = await handler(ctx, {
      workspaceId,
      includeFilterCounts: true,
      paginationOpts: { numItems: 40, cursor: null },
      includeDeletionPreviews: false,
    });
    expect(result.filterCounts?.needsReview).toBe(1);
    expect(result.transactions.page.map((row) => row.id)).toEqual([
      'checking-recent',
      'review',
      'savings-recent',
      'checking-older',
    ]);
    expect(paginate).toHaveBeenCalledOnce();
    expect(result.transactions.isDone).toBe(false);
  });

  it.each(['rows', 'bytes'])(
    'abandons oversized preloads at the %s budget while preserving ordinary pagination',
    async (limit) => {
      const { ctx, rows, budget, paginate } = setup();
      for (let index = 0; index < 500; index++) {
        rows.push(
          transaction(`review-${index}`, '2026-09-01', {
            reviewStatus: 'needs_review',
            // UTF-8 payloads exercise Convex's byte accounting, including int64 movements and system fields.
            ...(limit === 'bytes' ? { notes: '💳'.repeat(49_750) } : {}),
          })
        );
      }
      const result = await handler(ctx, {
        workspaceId,
        includeFilterCounts: true,
        includeFilterTransactions: true,
        paginationOpts: { numItems: 40, cursor: null },
        includeDeletionPreviews: false,
      });
      expect(result.filterSetsComplete).toBe(false);
      expect(result.filterCounts).toBeUndefined();
      expect(result.filterTransactions).toBeUndefined();
      expect(result.transactions.page).toHaveLength(40);
      expect(budget.read).toBe(limit === 'bytes' ? 6 : 301);
      expect(paginate).toHaveBeenCalledExactlyOnceWith({
        numItems: 40,
        cursor: null,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    }
  );

  it('bounds selected filters without scanning other queues or accepting oversized read limits', async () => {
    const { ctx, budget, paginate } = setup();
    await handler(ctx, {
      workspaceId,
      filter: 'needs_review',
      includeDeletionPreviews: false,
      paginationOpts: {
        numItems: 40,
        cursor: 'older',
        endCursor: 'end',
        maximumRowsRead: 100_000,
        maximumBytesRead: 100_000_000,
      },
    });
    expect(budget.read).toBe(0);
    expect(paginate).toHaveBeenCalledExactlyOnceWith({
      numItems: 40,
      cursor: 'older',
      endCursor: 'end',
      maximumRowsRead: 200,
      maximumBytesRead: 1_000_000,
    });
  });

  it.each([false, true])('returns category portions for a bounded month (credit card: %s)', async (isCreditCard) => {
    const { ctx, categories, rows } = setup();
    const categoryId = 'groceries' as Id<'category'>;
    categories.set(categoryId, {
      _id: categoryId,
      _creationTime: 1,
      workspaceId,
      name: 'Groceries',
      categoryGroupId: 'group' as Id<'categoryGroup'>,
      sortOrder: 0,
      isDeleted: false,
    });
    const creditCardTransfer = isCreditCard
      ? { creditCardCategoryId: 'amex' as Id<'category'>, spendingCategoryId: categoryId }
      : undefined;
    const movements = [
      { categoryId, amount: -300n, readyToAssign: false, sortOrder: 0, creditCardTransfer },
      { categoryId, amount: 50n, readyToAssign: false, sortOrder: 1, creditCardTransfer },
      { amount: -1000n, readyToAssign: true, sortOrder: 2 },
    ];
    rows.push(transaction('split', '2026-09-02', { movements }));
    rows.push(transaction('past-month', '2026-08-31', { movements }));
    rows.push(transaction('deleted-split', '2026-09-02', { movements, isDeleted: true }));
    rows.push(transaction('foreign-split', '2026-09-02', { movements, workspaceId: otherWorkspaceId }));
    const result = await handler(ctx, {
      workspaceId,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeDeletionPreviews: false,
      search: { text: '', categoryId },
      paginationOpts: { numItems: 100, cursor: null, maximumRowsRead: 200, maximumBytesRead: 1_000_000 },
    });
    expect(result.transactions.page).toHaveLength(1);
    expect(result.transactions.page[0]).toMatchObject({
      id: 'split',
      amount: -1250n,
      categoryActivity: { amount: '-250', outflow: '300', inflow: '50' },
    });
  });

  it('returns only live transactions in the requested account and workspace, newest first', async () => {
    const { ctx, withIndex, indexConditions, order } = setup();
    const result = await handler(ctx, { bankAccountId: accountId, paginationOpts: { numItems: 50, cursor: null } });

    expect(result.transactions.page.map((item) => item.id)).toEqual(['checking-recent', 'checking-older']);
    expect(result.transactions.page[0]).toMatchObject({
      bankAccountType: 'banking_checking',
      bankAccountName: 'Daily checking',
    });
    expect(withIndex).toHaveBeenCalledWith('by_workspaceId_bankAccountId_date_isDeleted', expect.any(Function));
    expect(indexConditions).toEqual([
      { field: 'workspaceId', value: workspaceId },
      { field: 'bankAccountId', value: accountId },
    ]);
    expect(order).toHaveBeenCalledWith('desc');
    expect(result.workspace).toEqual({
      id: workspaceId,
      name: 'Personal',
      currencyCode: 'USD',
      minorUnit: 2,
      timezoneIdentifier: 'America/New_York',
    });
  });

  it('preloads deletion feedback by default and supports opting out', async () => {
    const { ctx, paginate, metadata } = setup();
    const row = transaction('income', '2026-09-04', {
      totalAmount: 100n,
      movements: [{ amount: 100n, readyToAssign: true, sortOrder: 0 }],
    });
    paginate.mockResolvedValue({ ...metadata, page: [row] });
    const args = { workspaceId, paginationOpts: { numItems: 50, cursor: null } };
    expect((await handler(ctx, { ...args, includeDeletionPreviews: false })).transactions.page[0]).not.toHaveProperty(
      'deletionBudgetChanges'
    );
    expect((await handler(ctx, args)).transactions.page[0].deletionBudgetChanges).toEqual([
      { name: 'Ready to Assign', before: 0n, after: -100n },
    ]);
  });

  it('forwards all native pagination options and preserves continuation and page-splitting metadata', async () => {
    const { ctx, paginate, metadata } = setup();
    const paginationOpts: FeedArgs['paginationOpts'] = {
      numItems: 1,
      cursor: 'previous-account-page',
      endCursor: 'bounded-account-page',
      maximumRowsRead: 100,
      maximumBytesRead: 65_536,
      id: 7,
    };
    const result = await handler(ctx, { workspaceId, bankAccountId: accountId, paginationOpts });

    expect(paginate).toHaveBeenCalledExactlyOnceWith(paginationOpts);

    expect(result.transactions).toMatchObject(metadata);
    expect(result.transactions.page.map((item) => item.id)).toEqual(['checking-recent']);
  });

  it('keeps closed account history available', async () => {
    const { ctx, accounts } = setup();
    accounts.set(accountId, account({ isClosed: true }));
    const result = await handler(ctx, { bankAccountId: accountId, paginationOpts: { numItems: 50, cursor: null } });
    expect(result.transactions.page).toHaveLength(2);
  });

  it.each(['missing', 'deleted', 'foreign'] as const)(
    'rejects a %s account before querying transactions',
    async (kind) => {
      const { ctx, accounts, query } = setup();
      if (kind === 'missing') accounts.delete(accountId);
      if (kind === 'deleted') accounts.set(accountId, account({ isDeleted: true }));
      if (kind === 'foreign') accounts.set(accountId, account({ workspaceId: otherWorkspaceId }));

      await expect(
        handler(ctx, { workspaceId, bankAccountId: accountId, paginationOpts: { numItems: 50, cursor: null } })
      ).rejects.toThrow('Account not found in this workspace');
      expect(query).not.toHaveBeenCalled();
    }
  );

  it('checks workspace access before reading the account or transactions', async () => {
    const { ctx, query, get } = setup();
    vi.mocked(getWorkspaceAccessForClerkId).mockResolvedValue(null);

    await expect(
      handler(ctx, {
        workspaceId: otherWorkspaceId,
        bankAccountId: accountId,
        paginationOpts: { numItems: 50, cursor: null },
      })
    ).rejects.toThrow('Access denied');
    expect(getWorkspaceAccessForClerkId).toHaveBeenCalledExactlyOnceWith(ctx, otherWorkspaceId, 'signed-in-user');
    expect(get).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('requires authentication before reading any account data', async () => {
    const { ctx, query, get } = setup();
    vi.mocked(requireUserProfile).mockRejectedValue(new ConvexError('Authentication required'));
    await expect(
      handler(ctx, { bankAccountId: accountId, paginationOpts: { numItems: 50, cursor: null } })
    ).rejects.toThrow('Authentication required');
    expect(getWorkspaceAccessForClerkId).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves the unfiltered feed across all accounts in the active workspace', async () => {
    const { ctx, withIndex, indexConditions } = setup();
    const result = await handler(ctx, { paginationOpts: { numItems: 50, cursor: null } });

    expect(result.transactions.page.map((item) => item.id)).toEqual([
      'checking-recent',
      'savings-recent',
      'checking-older',
    ]);
    expect(withIndex).toHaveBeenCalledWith('by_workspaceId_isDeleted_date', expect.any(Function));
    expect(indexConditions).toEqual([
      { field: 'workspaceId', value: workspaceId },
      { field: 'isDeleted', value: false },
    ]);
  });
});

describe('paginated transaction search', () => {
  const paginationOpts = { numItems: 100, cursor: null, maximumRowsRead: 5_000, maximumBytesRead: 4_000_000 };

  it('drills into report categories, groups and merchants using the matching split and inclusive dates', async () => {
    const { ctx, categories, groups, merchants, rows } = setup();
    const categoryId = 'groceries' as Id<'category'>;
    const groupId = 'living' as Id<'categoryGroup'>;
    const merchantId = 'shop' as Id<'merchant'>;
    categories.set(categoryId, {
      _id: categoryId,
      _creationTime: 1,
      workspaceId,
      name: 'Groceries',
      categoryGroupId: groupId,
      isDeleted: false,
      sortOrder: 0,
    });
    groups.set(groupId, {
      _id: groupId,
      _creationTime: 1,
      workspaceId,
      name: 'Living',
      type: 'expense',
      isDeleted: false,
      sortOrder: 0,
    });
    merchants.set(merchantId, {
      _id: merchantId,
      _creationTime: 1,
      workspaceId,
      name: 'Shop',
      isDeleted: false,
      updatedAt: '2026-09-25T00:00:00Z',
    });
    const split = transaction('split', '2026-09-30T23:59:59Z', {
      merchantId,
      totalAmount: -100n,
      movements: [
        { categoryId, amount: 200n, readyToAssign: false, sortOrder: 0 },
        { amount: -300n, readyToAssign: false, sortOrder: 1 },
      ],
    });
    rows.splice(
      0,
      rows.length,
      split,
      { ...split, _id: 'before' as Id<'transaction'>, date: '2026-08-31' },
      { ...split, _id: 'after' as Id<'transaction'>, date: '2026-10-01' },
      { ...split, _id: 'pending' as Id<'transaction'>, status: 'pending' },
      { ...split, _id: 'starting' as Id<'transaction'>, type: 'starting_balance' },
      { ...split, _id: 'transfer' as Id<'transaction'>, type: 'transfer' },
      {
        ...split,
        _id: 'wrong-split' as Id<'transaction'>,
        movements: [
          { categoryId, amount: -200n, readyToAssign: false, sortOrder: 0 },
          { amount: 300n, readyToAssign: false, sortOrder: 1 },
        ],
      }
    );
    const query = (search: NonNullable<FeedArgs['search']>) =>
      handler(ctx, {
        workspaceId,
        paginationOpts,
        includeDeletionPreviews: false,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        search: { reportActivity: true, flow: 'inflow', ...search },
      });
    expect((await query({ text: '', categoryId })).transactions.page.map((row) => row.id)).toEqual(['split']);
    expect((await query({ text: '', groupId })).transactions.page.map((row) => row.id)).toEqual(['split']);
    expect((await query({ text: '', merchantId })).transactions.page.map((row) => row.id).sort()).toEqual([
      'split',
      'wrong-split',
    ]);
    expect(
      (await query({ text: '', groupId: 'ungrouped', flow: 'outflow' })).transactions.page.map((row) => row.id)
    ).toEqual(['split']);
  });

  it('matches exact unlinked report merchants and system groups without matching linked namesakes', async () => {
    const { ctx, merchants, rows } = setup();
    const merchantId = 'shop' as Id<'merchant'>;
    merchants.set(merchantId, {
      _id: merchantId,
      _creationTime: 1,
      workspaceId,
      name: 'Shop',
      isDeleted: false,
      updatedAt: '2026-09-25T00:00:00Z',
    });
    const base = transaction('unlinked', '2026-09-01', {
      plaidMerchantName: ' SHOP ',
      totalAmount: 100n,
      movements: [{ readyToAssign: true, amount: 100n, sortOrder: 0 }],
    });
    rows.splice(
      0,
      rows.length,
      base,
      { ...base, _id: 'linked' as Id<'transaction'>, merchantId },
      { ...base, _id: 'similar' as Id<'transaction'>, plaidMerchantName: 'Shop two' }
    );
    const result = await handler(ctx, {
      workspaceId,
      paginationOpts,
      includeDeletionPreviews: false,
      search: {
        text: '',
        unlinkedMerchantName: 'shop',
        groupId: 'ready-to-assign',
        flow: 'inflow',
        reportActivity: true,
      },
    });
    expect(result.transactions.page.map((row) => row.id)).toEqual(['unlinked']);
  });

  it('rejects foreign group and merchant filters before reading transactions', async () => {
    const { ctx, groups, merchants, query } = setup();
    const groupId = 'foreign-group' as Id<'categoryGroup'>;
    const merchantId = 'foreign-merchant' as Id<'merchant'>;
    groups.set(groupId, {
      _id: groupId,
      _creationTime: 1,
      workspaceId: otherWorkspaceId,
      name: 'Private',
      type: 'expense',
      isDeleted: false,
      sortOrder: 0,
    });
    merchants.set(merchantId, {
      _id: merchantId,
      _creationTime: 1,
      workspaceId: otherWorkspaceId,
      name: 'Private',
      updatedAt: '2026-09-25T00:00:00Z',
      isDeleted: false,
    });
    await expect(handler(ctx, { workspaceId, paginationOpts, search: { text: '', groupId } })).rejects.toThrow(
      'Group not found'
    );
    await expect(handler(ctx, { workspaceId, paginationOpts, search: { text: '', merchantId } })).rejects.toThrow(
      'Merchant not found'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 26 sparse matches in one request and reads shared display records once', async () => {
    const { ctx, rows, paginate, get, budget } = setup();
    rows.splice(
      0,
      rows.length,
      ...Array.from({ length: 2_600 }, (_, index) =>
        transaction(`row-${index}`, '2020-02-29', {
          _creationTime: index,
          notes: index % 100 === 0 ? 'Birthday dinner' : 'Other purchase',
        })
      )
    );
    const args: FeedArgs = {
      workspaceId,
      includeDeletionPreviews: false,
      search: { text: 'birthday checking' },
      paginationOpts,
    };
    const result = await handler(ctx, args);
    expect(result.transactions.page).toHaveLength(26);
    expect(result.transactions.isDone).toBe(true);
    expect(paginate).not.toHaveBeenCalled();
    expect(budget.read).toBe(2_600);
    expect(get.mock.calls.filter(([id]) => id === accountId)).toHaveLength(1);
  });

  it('returns all 26 split-category matches together and preserves their category amounts', async () => {
    const { ctx, categories, rows, get } = setup();
    const categoryId = 'groceries' as Id<'category'>;
    categories.set(categoryId, {
      _id: categoryId,
      _creationTime: 1,
      workspaceId,
      name: 'Groceries',
      categoryGroupId: 'group' as Id<'categoryGroup'>,
      isDeleted: false,
      sortOrder: 0,
      isArchived: false,
    });
    rows.splice(
      0,
      rows.length,
      ...Array.from({ length: 2_600 }, (_, index) =>
        transaction(`row-${index}`, '2026-08-31', {
          _creationTime: index,
          movements: index % 100 === 0 ? [{ categoryId, amount: -200n, readyToAssign: false, sortOrder: 0 }] : [],
        })
      )
    );
    const args: FeedArgs = {
      workspaceId,
      includeDeletionPreviews: false,
      search: { text: '', categoryId },
      paginationOpts,
    };
    const september = await handler(ctx, { ...args, startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(september.transactions).toMatchObject({ page: [], isDone: true });
    get.mockClear();
    const all = await handler(ctx, args);
    expect(all.transactions.page).toHaveLength(26);
    expect(all.transactions.isDone).toBe(true);
    expect(all.transactions.page.every((item) => item.categoryActivity?.amount === '-200')).toBe(true);
    expect(get.mock.calls.filter(([id]) => id === accountId)).toHaveLength(1);
  });

  it('paginates by matches with stable ordering for transactions sharing a date', async () => {
    const { ctx, rows } = setup();
    rows.splice(
      0,
      rows.length,
      ...Array.from({ length: 125 }, (_, index) =>
        transaction(`row-${index}`, '2026-09-01', { _creationTime: index, notes: 'Match' })
      )
    );
    const args: FeedArgs = {
      workspaceId,
      includeDeletionPreviews: false,
      search: { text: 'match' },
      paginationOpts,
    };
    const first = await handler(ctx, args);
    const next = await handler(ctx, {
      ...args,
      paginationOpts: { ...paginationOpts, cursor: first.transactions.continueCursor },
    });
    expect(first.transactions.page).toHaveLength(100);
    expect(first.transactions.isDone).toBe(false);
    expect(next.transactions.page).toHaveLength(25);
    expect(next.transactions.isDone).toBe(true);
    expect([...first.transactions.page, ...next.transactions.page].map((item) => item.id)).toEqual(
      Array.from({ length: 125 }, (_, index) => `row-${124 - index}`)
    );
  });

  it('resumes after reaching the byte limit', async () => {
    const { ctx } = setup();
    const args: FeedArgs = {
      workspaceId,
      includeDeletionPreviews: false,
      search: { text: '' },
      paginationOpts: { ...paginationOpts, maximumBytesRead: 1 },
    };
    const first = await handler(ctx, args);
    expect(first.transactions.page.map((item) => item.id)).toEqual(['checking-recent']);
    expect(first.transactions.isDone).toBe(false);
    const next = await handler(ctx, {
      ...args,
      paginationOpts: { ...paginationOpts, cursor: first.transactions.continueCursor },
    });
    expect(next.transactions.page.map((item) => item.id)).toEqual(['savings-recent', 'checking-older']);
    expect(next.transactions.isDone).toBe(true);
  });

  it('keeps a continuation at the scan bound and finds older notes without duplicates', async () => {
    const { ctx, rows } = setup();
    rows.splice(
      0,
      rows.length,
      transaction('newest', '2026-09-04'),
      transaction('middle', '2026-09-03'),
      transaction('old-match', '2020-02-29', { notes: 'Birthday dinner' })
    );
    const args: FeedArgs = {
      workspaceId,
      includeDeletionPreviews: false,
      search: { text: 'birthday checking' },
      paginationOpts: { ...paginationOpts, maximumRowsRead: 2 },
    };
    const empty = await handler(ctx, args);
    expect(empty.transactions.page).toEqual([]);
    expect(empty.transactions.isDone).toBe(false);
    const next = await handler(ctx, {
      ...args,
      paginationOpts: { ...args.paginationOpts, cursor: empty.transactions.continueCursor },
    });
    expect(next.transactions.page.map((item) => item.id)).toEqual(['old-match']);
    expect(next.transactions.isDone).toBe(true);
  });

  it('uses account and date indexes together with text and status filters', async () => {
    const { ctx, indexConditions } = setup();
    const result = await handler(ctx, {
      workspaceId,
      bankAccountId: accountId,
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      includeDeletionPreviews: false,
      search: { text: 'checking', status: 'cleared', flow: 'outflow' },
      paginationOpts,
    });
    expect(result.transactions.page.map((item) => item.id)).toEqual(['checking-older']);
    expect(indexConditions).toContainEqual({ field: 'bankAccountId', value: accountId });
    expect(indexConditions).toContainEqual({ field: 'date', value: '2026-09-02', comparison: 'lte' });
  });

  it('requires workspace access before search reads and excludes foreign/deleted transactions', async () => {
    const { ctx, query } = setup();
    const args = { workspaceId, search: { text: '' }, paginationOpts, includeDeletionPreviews: false };
    expect((await handler(ctx, args)).transactions.page.map((item) => item.id)).toEqual([
      'checking-recent',
      'savings-recent',
      'checking-older',
    ]);
    query.mockClear();
    vi.mocked(getWorkspaceAccessForClerkId).mockResolvedValue(null);
    await expect(handler(ctx, args)).rejects.toThrow('Access denied');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([{}, { maximumRowsRead: -1 }, { maximumRowsRead: 5_001 }, { maximumBytesRead: 4_000_001 }])(
    'rejects missing or excessive scan bounds %j',
    async (overrides) => {
      const { ctx, query } = setup();
      await expect(
        handler(ctx, {
          workspaceId,
          search: { text: 'coffee' },
          paginationOpts: Object.keys(overrides).length
            ? { ...paginationOpts, ...overrides }
            : { numItems: 50, cursor: null },
        })
      ).rejects.toThrow('bounded pagination');
      expect(query).not.toHaveBeenCalled();
    }
  );

  it('rejects an unavailable category and oversized search before scanning transactions', async () => {
    const { ctx, query } = setup();
    await expect(
      handler(ctx, {
        workspaceId,
        search: { text: '', categoryId: 'foreign-category' as Id<'category'> },
        paginationOpts,
      })
    ).rejects.toThrow('Category not found');
    await expect(handler(ctx, { workspaceId, search: { text: 'a'.repeat(301) }, paginationOpts })).rejects.toThrow(
      '300 characters'
    );
    expect(query).not.toHaveBeenCalled();
  });
});

describe('calendar transaction date filtering', () => {
  it.each([undefined, accountId])('filters an inclusive day before pagination, account %s', async (bankAccountId) => {
    const { ctx, indexConditions } = setup();
    const result = await handler(ctx, {
      workspaceId,
      bankAccountId,
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(result.transactions.page.map((item) => item.id)).toEqual(['checking-older']);
    expect(indexConditions).toContainEqual({ field: 'date', value: '2026-09-01', comparison: 'gte' });
    expect(indexConditions).toContainEqual({ field: 'date', value: '2026-09-01', comparison: 'lte' });
  });

  it('excludes deleted and foreign transactions inside the selected dates', async () => {
    const { ctx } = setup();
    const result = await handler(ctx, {
      workspaceId,
      startDate: '2026-09-03',
      endDate: '2026-09-05',
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(result.transactions.page.map((item) => item.id)).toEqual(['checking-recent', 'savings-recent']);
  });

  it.each([
    ['2026-02-30', '2026-09-05'],
    ['2026-09-06', '2026-09-05'],
    ['2026-09-01', 'invalid'],
  ])('rejects invalid range %s to %s before querying', async (startDate, endDate) => {
    const { ctx, query } = setup();
    await expect(
      handler(ctx, { workspaceId, startDate, endDate, paginationOpts: { numItems: 50, cursor: null } })
    ).rejects.toThrow('valid transaction date range');
    expect(query).not.toHaveBeenCalled();
  });
});
