import {
  type FunctionArgs,
  type PaginationResult,
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server';
import { v } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, QueryCtx } from '../_generated/server';
import { requireWorkspaceAccess, requireWorkspaceAccessAction } from '../lib/auth';
import * as publicReports from '../reports';
import type { TransactionFeedLookups } from '../transactions/feed';
import { getTransactionFeedLookups } from '../transactions/queries';
import {
  getExplorerEntries,
  getExplorerSummary,
  listExplorerEntries,
  listHistoryEntries,
  toExplorerEntry,
  validateExplorerRange,
} from './explorer';

vi.mock('../lib/auth', async (original) => ({
  ...(await original<typeof import('../lib/auth')>()),
  requireWorkspaceAccess: vi.fn(),
  requireWorkspaceAccessAction: vi.fn(),
}));
vi.mock('../transactions/queries', async (original) => ({
  ...(await original<typeof import('../transactions/queries')>()),
  getTransactionFeedLookups: vi.fn(),
}));

// Convex exposes serialized validators on registered functions; the validator's
// runtime JSON property is intentionally absent from its public TypeScript type.
function validatorJSON(validator: unknown): unknown {
  return (validator as { readonly json: unknown }).json;
}

const workspaceId = 'personal' as Id<'workspace'>;
const accountId = 'cash' as Id<'bankAccount'>;
const merchantId = 'shop' as Id<'merchant'>;
const categoryId = 'food' as Id<'category'>;
const globalId = 'global' as Id<'globalMerchant'>;

function entry(overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: 'one' as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId: accountId,
    date: '2026-09-02',
    dateYearMonth: 202609,
    isDeleted: false,
    status: 'cleared',
    reviewStatus: 'reviewed',
    type: 'regular',
    totalAmount: -800n,
    searchText: '',
    hasUncategorized: false,
    hasMissingPayee: false,
    movements: [
      { amount: -1000n, categoryId, readyToAssign: false, sortOrder: 0 },
      { amount: 200n, categoryId, readyToAssign: false, sortOrder: 1 },
    ],
    ...overrides,
  };
}
function lookups(): TransactionFeedLookups {
  return {
    merchants: new Map(),
    globalMerchants: new Map(),
    categories: new Map(),
    bankAccounts: new Map([
      [
        accountId,
        {
          _id: accountId,
          _creationTime: 1,
          name: 'Cash',
          workspaceId,
          accountType: 'banking_checking',
          currentBalance: 0n,
          isDeleted: false,
          isClosed: false,
        },
      ],
    ]),
    accountLogoUrls: new Map(),
    transferPairAccountIds: new Map(),
  };
}

type Args = FunctionArgs<typeof import('../_generated/api').api.reports.listExplorerEntries>;
type Result = PaginationResult<NonNullable<ReturnType<typeof toExplorerEntry>>>;
const handler = (listExplorerEntries as unknown as { _handler: (ctx: QueryCtx, args: Args) => Promise<Result> })
  ._handler;
type HistoryArgs = FunctionArgs<typeof import('../_generated/api').api.reports.listHistoryEntries>;
const historyHandler = (
  listHistoryEntries as unknown as {
    _handler: (ctx: QueryCtx, args: HistoryArgs) => Promise<Result>;
  }
)._handler;
const args: Args = {
  workspaceId,
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  paginationOpts: { numItems: 200, cursor: null, maximumRowsRead: 200, maximumBytesRead: 1000000 },
};

function context() {
  const conditions: [string, string, unknown][] = [];
  const index = {
    eq: (field: string, value: unknown) => {
      conditions.push(['eq', field, value]);
      return index;
    },
    gte: (field: string, value: unknown) => {
      conditions.push(['gte', field, value]);
      return index;
    },
    lt: (field: string, value: unknown) => {
      conditions.push(['lt', field, value]);
      return index;
    },
  };
  const paginate = vi.fn(async () => ({
    page: [entry(), entry({ type: 'transfer' })],
    isDone: false,
    continueCursor: 'next',
    splitCursor: 'split',
    pageStatus: 'SplitRecommended',
  }));
  const chain = {
    withIndex: vi.fn((_name: string, build: (q: typeof index) => unknown) => {
      build(index);
      return chain;
    }),
    order: vi.fn(() => chain),
    paginate,
  };
  const query = vi.fn(() => chain);
  const ctx = { db: { query, get: vi.fn(async () => ({ timezone: 'America/New_York' })) } } as unknown as QueryCtx;
  return { ctx, query, conditions, chain, paginate };
}

beforeEach(() => {
  vi.mocked(requireWorkspaceAccess).mockReset();
  vi.mocked(requireWorkspaceAccessAction).mockReset();
  vi.mocked(getTransactionFeedLookups).mockReset().mockResolvedValue(lookups());
});

describe('report explorer', () => {
  it('loads all history without date predicates and retains bounded pagination', async () => {
    const { ctx, conditions, paginate } = context();
    await historyHandler(ctx, { workspaceId, paginationOpts: { numItems: 200, cursor: 'older' } });
    expect(conditions).toEqual([
      ['eq', 'workspaceId', workspaceId],
      ['eq', 'isDeleted', false],
    ]);
    expect(paginate).toHaveBeenCalledWith({
      numItems: 200,
      cursor: 'older',
      maximumRowsRead: 200,
      maximumBytesRead: 1_000_000,
    });
  });

  it('retains every public reports endpoint used by released apps', () => {
    expect(publicReports.listExplorerEntries).toBe(listExplorerEntries);
    expect(publicReports.getExplorerSummary).toBe(getExplorerSummary);
    expect(publicReports.getExplorerEntries).toBe(getExplorerEntries);
    expect(publicReports.getSpendingReport).toBeDefined();
    expect(publicReports.getNetWorthReport).toBeDefined();
    expect(publicReports.listHistoryEntries).toBe(listHistoryEntries);
  });

  it('preserves the exact legacy paginated request and response validators', () => {
    const contract = listExplorerEntries as unknown as { exportArgs(): string; exportReturns(): string };
    expect(JSON.parse(contract.exportArgs())).toEqual(
      validatorJSON(
        v.object({
          workspaceId: v.id('workspace'),
          startDate: v.string(),
          endDate: v.string(),
          paginationOpts: paginationOptsValidator,
        })
      )
    );
    const legacyEntry = v.object({
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
    expect(JSON.parse(contract.exportReturns())).toEqual(validatorJSON(paginationResultValidator(legacyEntry)));
  });

  it('preserves the integer-month contracts used by iOS 2.x', () => {
    const legacyArgs = {
      workspaceId: v.id('workspace'),
      monthsBack: v.optional(v.number()),
      currentYearMonth: v.int64(),
    };
    const netWorth = publicReports.getNetWorthReport as unknown as { exportArgs(): string };
    const spending = publicReports.getSpendingReport as unknown as { exportArgs(): string };
    expect(JSON.parse(netWorth.exportArgs())).toEqual(validatorJSON(v.object(legacyArgs)));
    expect(JSON.parse(spending.exportArgs())).toEqual(
      validatorJSON(v.object({ ...legacyArgs, grossDirectional: v.optional(v.boolean()) }))
    );
  });

  it('returns the unchanged legacy page without loading group metadata', async () => {
    const data = lookups();
    const categories = new Map(data.categories);
    categories.set(categoryId, {
      _id: categoryId,
      _creationTime: 1,
      name: 'Food',
      workspaceId,
      categoryGroupId: 'living' as Id<'categoryGroup'>,
      sortOrder: 0,
      isDeleted: false,
    });
    vi.mocked(getTransactionFeedLookups).mockResolvedValue({ ...data, categories });
    const { ctx } = context();
    const result = await handler(ctx, args);
    expect(result).toEqual({
      page: [
        {
          id: 'one',
          date: '2026-09-02',
          accountId: 'cash',
          accountName: 'Cash',
          merchantId: 'unlinked:no merchant',
          merchantName: 'No merchant',
          merchantLogoUrl: null,
          status: 'cleared',
          reviewStatus: 'reviewed',
          notes: null,
          movements: [
            { categoryId: 'food', categoryName: 'Food', amount: '-1000' },
            { categoryId: 'food', categoryName: 'Food', amount: '200' },
          ],
        },
      ],
      isDone: false,
      continueCursor: 'next',
      splitCursor: 'split',
      pageStatus: 'SplitRecommended',
    });
    expect(ctx.db.get).not.toHaveBeenCalled();
  });

  it('checks authorization and page bounds for the new history endpoint independently', async () => {
    const { ctx, query } = context();
    vi.mocked(requireWorkspaceAccess).mockRejectedValueOnce(new Error('Access denied'));
    await expect(historyHandler(ctx, { workspaceId, paginationOpts: args.paginationOpts })).rejects.toThrow(
      'Access denied'
    );
    await expect(historyHandler(ctx, { workspaceId, paginationOpts: { numItems: 201, cursor: null } })).rejects.toThrow(
      '1 to 200 entries'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('enriches movements with workspace-owned groups and prevents foreign group disclosure', async () => {
    const data = lookups();
    const groupId = 'living' as Id<'categoryGroup'>;
    const categories = new Map(data.categories);
    categories.set(categoryId, {
      _id: categoryId,
      _creationTime: 1,
      name: 'Food',
      workspaceId,
      categoryGroupId: groupId,
      sortOrder: 0,
      isDeleted: false,
    });
    const group: Doc<'categoryGroup'> = {
      _id: groupId,
      _creationTime: 1,
      workspaceId,
      name: 'Living',
      type: 'expense',
      sortOrder: 0,
      isDeleted: false,
    };
    vi.mocked(getTransactionFeedLookups).mockResolvedValue({ ...data, categories });
    const { ctx } = context();
    vi.mocked(ctx.db.get).mockResolvedValue(group);
    const result = await historyHandler(ctx, { workspaceId, paginationOpts: args.paginationOpts });
    expect(result.page[0].movements[0]).toMatchObject({ groupId, groupName: 'Living', amount: '-1000' });
    vi.mocked(ctx.db.get).mockResolvedValue({ ...group, workspaceId: 'foreign' as Id<'workspace'> });
    const foreign = await historyHandler(ctx, { workspaceId, paginationOpts: args.paginationOpts });
    expect(foreign.page[0].movements[0]).toMatchObject({ groupId: 'ungrouped', groupName: 'Ungrouped' });
  });

  it('assigns stable system groups to uncategorized and ready-to-assign activity', () => {
    const result = toExplorerEntry(
      entry({
        movements: [
          { amount: 200n, readyToAssign: true, sortOrder: 0 },
          { amount: -100n, readyToAssign: false, sortOrder: 1 },
        ],
      }),
      lookups(),
      new Map()
    );
    expect(result?.movements.map(({ groupId, groupName }) => ({ groupId, groupName }))).toEqual([
      { groupId: 'ready-to-assign', groupName: 'Ready to assign' },
      { groupId: 'ungrouped', groupName: 'Ungrouped' },
    ]);
  });

  it('rejects unauthorized workspaces before reading financial data', async () => {
    vi.mocked(requireWorkspaceAccess).mockRejectedValue(new Error('Access denied'));
    const { ctx, query } = context();
    await expect(handler(ctx, args)).rejects.toThrow('Access denied');
    expect(query).not.toHaveBeenCalled();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(ctx, workspaceId);
  });

  it('scopes the date index, preserves native pagination metadata and forwards bounded options unchanged', async () => {
    const { ctx, conditions, paginate, chain } = context();
    const result = await handler(ctx, args);
    expect(chain.withIndex).toHaveBeenCalledWith('by_workspaceId_isDeleted_date', expect.any(Function));
    expect(conditions).toContainEqual(['eq', 'workspaceId', workspaceId]);
    expect(conditions).toContainEqual(['eq', 'isDeleted', false]);
    expect(conditions).toContainEqual(['gte', 'date', '2026-09-01']);
    expect(paginate).toHaveBeenCalledWith(args.paginationOpts);
    expect(result).toMatchObject({
      isDone: false,
      continueCursor: 'next',
      splitCursor: 'split',
      pageStatus: 'SplitRecommended',
    });
    expect(result.page).toHaveLength(1);
    expect(getTransactionFeedLookups).toHaveBeenCalledWith(ctx, workspaceId, [entry()]);
  });

  it.each(['2026-02-30', 'invalid', '2026-9-01'])('rejects malformed dates: %s', (start) => {
    expect(() => validateExplorerRange(start, '2026-09-05')).toThrow();
  });

  it('allows multi-year windows while bounding each page', async () => {
    expect(() => validateExplorerRange('1990-01-01', '2026-09-05')).not.toThrow();
    expect(() => validateExplorerRange('2026-09-05', '2026-09-01')).toThrow();
    expect(() => validateExplorerRange('2024-02-29', '2026-02-28')).not.toThrow();
    await expect(
      handler(context().ctx, { ...args, paginationOpts: { numItems: 201, cursor: null } })
    ).rejects.toThrow();
  });

  it('excludes transfers, synthetic balances, deleted transactions and inaccessible accounts', () => {
    for (const type of ['transfer', 'starting_balance', 'balance_adjustment'] as const) {
      expect(toExplorerEntry(entry({ type }), lookups())).toBeNull();
    }
    expect(toExplorerEntry(entry({ isDeleted: true }), lookups())).toBeNull();
    expect(toExplorerEntry(entry({ bankAccountId: 'foreign' as Id<'bankAccount'> }), lookups())).toBeNull();
  });

  it('preserves every signed split and full integer precision', () => {
    const result = toExplorerEntry(
      entry({
        movements: [
          { amount: -9223372036854775808n, categoryId, categoryName: 'Food', readyToAssign: false, sortOrder: 0 },
          { amount: 200n, readyToAssign: true, sortOrder: 1 },
          { amount: -300n, readyToAssign: false, sortOrder: 2 },
        ],
      }),
      lookups()
    );
    expect(result?.movements).toEqual([
      { amount: '-9223372036854775808', categoryId, categoryName: 'Food' },
      { amount: '200', categoryId: 'ready-to-assign', categoryName: 'Ready to assign' },
      { amount: '-300', categoryId: 'uncategorized', categoryName: 'Uncategorized' },
    ]);
  });

  it('resolves shared merchant names while respecting an explicitly removed logo', () => {
    const data = lookups();
    const withMerchant: TransactionFeedLookups = {
      ...data,
      merchants: new Map([
        [
          merchantId,
          {
            _id: merchantId,
            _creationTime: 1,
            workspaceId,
            updatedAt: '',
            isDeleted: false,
            globalMerchantId: globalId,
            logoUrl: null,
          },
        ],
      ]),
      globalMerchants: new Map([
        [
          globalId,
          {
            _id: globalId,
            _creationTime: 1,
            name: 'Coffee shop',
            logoUrl: 'https://example.com/logo.png',
          } as Doc<'globalMerchant'>,
        ],
      ]),
    };
    const result = toExplorerEntry(entry({ merchantId }), withMerchant);
    expect(result?.merchantName).toBe('Coffee shop');
    expect(result?.merchantLogoUrl).toBeNull();
  });
});

// Regression coverage for server-side reduction and the one-request mobile contract.
import {
  createReportAccumulator,
  dayCount,
  type ExplorerEntry,
  type ReportFilters,
  type ReportRange,
  type ReportSummary,
  reportBuckets,
  reportReadRanges,
} from './analysis';

const current: ReportRange = { start: '2026-09-01', end: '2026-09-05' };
const comparison: ReportRange = { start: '2026-08-27', end: '2026-08-31' };
const filters: ReportFilters = {
  accountIds: [],
  categoryIds: [],
  merchantIds: [],
  includesPending: false,
  reviewStatus: null,
  categoryId: null,
  merchantId: null,
};
const reportEntry = (overrides: Partial<ExplorerEntry> = {}): ExplorerEntry => {
  const result = toExplorerEntry(entry(), lookups());
  if (!result) throw new Error('Missing test account');
  return { ...result, ...overrides };
};

function summarize(
  entries: ExplorerEntry[],
  kind: 'spending' | 'moneyIn' | 'cashFlow' = 'spending',
  selected = filters
) {
  const accumulator = createReportAccumulator(current, comparison, kind, selected);
  accumulator.consume(entries);
  return accumulator.finish();
}

describe('server report summaries', () => {
  it('keeps gross directions, splits and transaction counts exact across batches', () => {
    const transaction = reportEntry({
      movements: [
        { categoryId: 'food', categoryName: 'Food', amount: '-1000' },
        { categoryId: 'food', categoryName: 'Food', amount: '-300' },
        { categoryId: 'home', categoryName: 'Home', amount: '-500' },
        { categoryId: 'food', categoryName: 'Food', amount: '200' },
      ],
    });
    const accumulator = createReportAccumulator(current, comparison, 'cashFlow', filters);
    accumulator.consume([transaction]);
    accumulator.consume([transaction]);
    const report = accumulator.finish();
    expect(report.totals).toEqual({ outflow: '1800', inflow: '200', count: 1 });
    expect(report.categories.map((row) => [row.amount, row.count])).toEqual([
      ['1300', 1],
      ['500', 1],
    ]);
    expect(report.merchants[0].count).toBe(1);
    expect(report.buckets[1].totals).toEqual(report.totals);
    expect(report.spendingDays).toBe(1);
  });

  it('applies combined account, category, merchant, status, review and drilldown filters', () => {
    const transaction = reportEntry({ merchantId: 'shop' });
    const rows = [
      transaction,
      { ...transaction, id: 'wrong-account' as Id<'transaction'>, accountId: 'other' as Id<'bankAccount'> },
      { ...transaction, id: 'wrong-merchant' as Id<'transaction'>, merchantId: 'other' },
      { ...transaction, id: 'pending' as Id<'transaction'>, status: 'pending' as const },
      { ...transaction, id: 'review' as Id<'transaction'>, reviewStatus: 'needs_review' as const },
    ];
    const selected: ReportFilters = {
      ...filters,
      accountIds: [accountId],
      categoryIds: ['food'],
      merchantIds: ['shop'],
      reviewStatus: 'reviewed',
      categoryId: 'food',
      merchantId: 'shop',
    };
    expect(summarize(rows, 'spending', selected).totals.outflow).toBe('1000');
    expect(summarize(rows, 'spending', { ...selected, includesPending: true }).totals.outflow).toBe('2000');
    expect(summarize(rows, 'spending', { ...selected, categoryId: 'other' }).totals.count).toBe(0);
    // Available filters are independent of the selected lens, including comparison-only activity.
    expect(summarize(rows, 'spending', selected).accounts).toHaveLength(2);
  });

  it('preserves int64 precision even when the report sum exceeds int64', () => {
    const rows = Array.from({ length: 2 }, (_, i) =>
      reportEntry({
        id: `large-${i}` as Id<'transaction'>,
        movements: [{ categoryId: 'food', categoryName: 'Food', amount: '-9223372036854775808' }],
      })
    );
    expect(summarize(rows).totals.outflow).toBe('18446744073709551616');
  });

  it('counts refunds as money in, not as reductions in spending', () => {
    const report = summarize([reportEntry()], 'moneyIn');
    expect(report.totals).toEqual({ outflow: '1000', inflow: '200', count: 1 });
    expect(report.categories[0].amount).toBe('200');
  });

  it('aligns comparison days, includes the end date, and retains zero-activity buckets', () => {
    const report = summarize([
      reportEntry({ date: '2026-09-05' }),
      reportEntry({ id: 'prior' as Id<'transaction'>, date: '2026-08-28' }),
    ]);
    expect(report.buckets).toHaveLength(5);
    expect(report.buckets[4].totals.outflow).toBe('1000');
    expect(report.buckets[1].previous.outflow).toBe('1000');
    expect(report.buckets[2].totals.outflow).toBe('0');
    expect(report.previous.outflow).toBe('1000');
  });

  it('does not read gaps and reads overlapping multi-year comparisons only once', () => {
    const priorYear = { start: '2025-09-01', end: '2025-09-05' };
    const ranges = reportReadRanges(current, priorYear);
    expect(ranges).toHaveLength(4);
    expect(ranges.reduce((sum, range) => sum + dayCount(range), 0)).toBe(10);
    expect(ranges.every((range) => range.end <= priorYear.end || range.start >= current.start)).toBe(true);
    const years = reportReadRanges(
      { start: '2020-01-01', end: '2026-01-01' },
      { start: '2019-01-01', end: '2025-01-01' }
    );
    expect(years.reduce((sum, range) => sum + dayCount(range), 0)).toBe(
      dayCount({ start: '2019-01-01', end: '2026-01-01' })
    );
    const accumulator = createReportAccumulator(
      { start: '2020-01-01', end: '2026-01-01' },
      { start: '2019-01-01', end: '2025-01-01' },
      'spending',
      filters
    );
    accumulator.consume([reportEntry({ date: '2024-01-01' })]);
    expect(accumulator.finish().totals.outflow).toBe('1000');
    expect(accumulator.finish().previous.outflow).toBe('1000');
  });

  it.each([
    { start: '2026-06-08', end: '2026-09-05' },
    { start: '2024-01-15', end: '2026-09-05' },
    { start: '1990-03-15', end: '2026-09-05' },
  ])('keeps charts bounded and continuous for %j', (range) => {
    const buckets = reportBuckets(range);
    expect(buckets.length).toBeLessThanOrEqual(36);
    expect(buckets[0].start).toBe(range.start);
    expect(buckets[buckets.length - 1]?.end).toBe(range.end);
    expect(buckets.reduce((sum, bucket) => sum + dayCount(bucket), 0)).toBe(dayCount(range));
  });

  it('preserves daily pay and bill timing for cash flow over the last 90 days', () => {
    const range = { start: '2026-06-08', end: '2026-09-05' };
    const accumulator = createReportAccumulator(range, comparison, 'cashFlow', filters);
    accumulator.consume([
      reportEntry({
        id: 'pay' as Id<'transaction'>,
        date: '2026-06-08',
        movements: [{ categoryId: 'income', categoryName: 'Income', amount: '10000' }],
      }),
      reportEntry({
        id: 'bill' as Id<'transaction'>,
        date: '2026-06-09',
        movements: [{ categoryId: 'bills', categoryName: 'Bills', amount: '-10000' }],
      }),
    ]);
    const report = accumulator.finish();
    expect(report.buckets).toHaveLength(90);
    expect(report.buckets.every((bucket) => dayCount(bucket.range) === 1)).toBe(true);
    expect(report.buckets[0].totals.inflow).toBe('10000');
    expect(report.buckets[1].totals.outflow).toBe('10000');
    expect(reportBuckets(range, 'spending')).toHaveLength(13);
    expect(reportBuckets(range, 'moneyIn')).toHaveLength(13);
    expect(reportBuckets({ start: '1990-01-01', end: '2026-09-05' }, 'cashFlow').length).toBeLessThanOrEqual(36);
  });

  it('returns compact summaries for thousands of transactions with no transaction rows', () => {
    const report = summarize(
      Array.from({ length: 12000 }, (_, i) => reportEntry({ id: `transaction-${i}` as Id<'transaction'> }))
    );
    expect(report.totals.count).toBe(12000);
    expect(report.totals.outflow).toBe('12000000');
    const json = JSON.stringify(report);
    expect(json).not.toContain('transaction-');
    expect(json.length).toBeLessThan(3000);
  });
});

type SummaryArgs = FunctionArgs<typeof import('../_generated/api').api.reports.getExplorerSummary>;
const summaryHandler = (
  getExplorerSummary as unknown as { _handler: (ctx: ActionCtx, args: SummaryArgs) => Promise<ReportSummary> }
)._handler;
const summaryArgs: SummaryArgs = { workspaceId, range: current, comparison, kind: 'spending', filters };
type DetailArgs = FunctionArgs<typeof import('../_generated/api').api.reports.getExplorerEntries>;
const detailHandler = (
  getExplorerEntries as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: DetailArgs
    ) => Promise<{ page: ExplorerEntry[]; continueCursor: string; isDone: boolean }>;
  }
)._handler;

describe('mobile reporting actions', () => {
  it.each(['spending', 'moneyIn', 'cashFlow'] as const)(
    'keeps the released iOS summary and detail behavior for %s',
    async (kind) => {
      const currentEntry = reportEntry();
      const oldEntry = reportEntry({
        id: 'previous' as Id<'transaction'>,
        date: '2026-08-29',
        movements: [
          { categoryId: 'food', categoryName: 'Uncategorized', amount: '-500' },
          { categoryId: 'food', categoryName: 'Uncategorized', amount: '100' },
        ],
      });
      const runQuery = vi.fn(async (_ref: unknown, range: { startDate: string; endDate: string }) => ({
        page: [currentEntry, oldEntry].filter((entry) => entry.date >= range.startDate && entry.date <= range.endDate),
        continueCursor: '',
        isDone: true,
      }));
      const ctx = { runQuery } as unknown as ActionCtx;
      const summary = await summaryHandler(ctx, { ...summaryArgs, kind });
      expect(Object.keys(summary).sort()).toEqual(
        [
          'range',
          'totals',
          'previous',
          'buckets',
          'categories',
          'merchants',
          'spendingDays',
          'categoryCount',
          'merchantCount',
          'accounts',
          'categoryOptions',
          'merchantOptions',
          'optionsTruncated',
        ].sort()
      );
      expect(summary.totals).toEqual({ outflow: '1000', inflow: '200', count: 1 });
      expect(summary.previous).toEqual({ outflow: '500', inflow: '100', count: 1 });
      expect(summary.categories).toEqual([
        {
          id: 'food',
          name: 'Uncategorized',
          logoURL: null,
          count: 1,
          amount: kind === 'moneyIn' ? '200' : '1000',
          previousAmount: kind === 'moneyIn' ? '100' : '500',
        },
      ]);
      expect(summary.buckets).toHaveLength(5);
      expect(summary.buckets[1].totals).toEqual(summary.totals);
      const detail = await detailHandler(ctx, { workspaceId, range: current, kind, filters, cursor: null, search: '' });
      expect(detail).toEqual({ page: [currentEntry], continueCursor: '', isDone: true });
      expect(detail.page[0].movements[0]).not.toHaveProperty('groupId');
    }
  );

  it('checks workspace authorization before starting summary or detail reads', async () => {
    vi.mocked(requireWorkspaceAccessAction).mockRejectedValue(new Error('Access denied'));
    const runQuery = vi.fn();
    const ctx = { runQuery } as unknown as ActionCtx;
    await expect(summaryHandler(ctx, summaryArgs)).rejects.toThrow('Access denied');
    await expect(
      detailHandler(ctx, { workspaceId, range: current, kind: 'spending', filters, cursor: null, search: '' })
    ).rejects.toThrow('Access denied');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('finishes all internal pages before returning a single complete summary', async () => {
    const runQuery = vi.fn(
      async (_ref: unknown, args: { startDate: string; endDate: string; cursor: string | null }) => {
        if (args.cursor === null) return { page: [], continueCursor: 'next', isDone: false };
        return {
          page: [reportEntry({ id: args.startDate as Id<'transaction'>, date: args.startDate })],
          continueCursor: '',
          isDone: true,
        };
      }
    );
    const result = await summaryHandler({ runQuery } as unknown as ActionCtx, summaryArgs);
    expect(runQuery).toHaveBeenCalledTimes(8);
    expect(result.totals.count + result.previous.count).toBe(4);
    expect(result).not.toHaveProperty('page');
  });

  it('fails the entire report on a failed batch rather than returning partial totals', async () => {
    const runQuery = vi.fn(async () => {
      throw new Error('Read failed');
    });
    await expect(summaryHandler({ runQuery } as unknown as ActionCtx, summaryArgs)).rejects.toThrow('Read failed');
  });

  it('rejects repeated cursors instead of looping forever', async () => {
    const runQuery = vi.fn(async () => ({ page: [], continueCursor: 'same', isDone: false }));
    await expect(summaryHandler({ runQuery } as unknown as ActionCtx, summaryArgs)).rejects.toThrow(
      'Report could not finish'
    );
  });

  it('chases sparse detail matches server-side and applies search without losing full splits', async () => {
    const runQuery = vi.fn(async (_ref: unknown, args: { cursor: string | null; detail: boolean }) => {
      expect(args.detail).toBe(true);
      return args.cursor === null
        ? { page: [reportEntry({ merchantName: 'Other' })], continueCursor: 'next', isDone: false }
        : { page: [reportEntry({ merchantName: 'Coffee' })], continueCursor: 'more', isDone: false };
    });
    const result = await detailHandler({ runQuery } as unknown as ActionCtx, {
      workspaceId,
      range: current,
      kind: 'spending',
      filters,
      cursor: null,
      search: 'COF',
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(result.page).toHaveLength(1);
    expect(result.page[0].movements).toHaveLength(2);
    expect(result.continueCursor).toBe('more');
  });
});
