import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { BENCHMARK_WORKSPACE_ID } from './benchmark';
import type { ComparisonSample } from './comparison';
import { loadComparisonData } from './comparisonData';

const workspaceId = 'workspace' as Id<'workspace'>;
const categoryId = 'groceries' as Id<'category'>;
type Row = Record<string, unknown>;
class Index {
  filters: Array<{ field: string; value: unknown }> = [];
  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
}
class Query {
  constructor(private rows: Row[]) {}
  withIndex(_name: string, apply: (index: Index) => Index): this {
    const index = apply(new Index());
    this.rows = this.rows.filter((row) => index.filters.every(({ field, value }) => row[field] === value));
    return this;
  }
  order(): this {
    return this;
  }
  async take(limit: number): Promise<Row[]> {
    return this.rows.slice(0, limit);
  }
  async first(): Promise<Row | null> {
    return this.rows[0] ?? null;
  }
}
const handler = (
  loadComparisonData as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { workspaceId: Id<'workspace'>; limit: number; source?: 'benchmark' | 'recent' }
    ) => Promise<{ samples: ComparisonSample[] }>;
  }
)._handler;

function context(raw: Row[], transactions: Row[], workspace: Row | null = { _id: workspaceId }) {
  const query = vi.fn((table: string) => new Query(table === 'transactionImportRaw' ? raw : transactions));
  const runQuery = vi.fn(async () => [
    { group: { name: 'Needs' }, categories: [{ _id: categoryId, name: 'Groceries' }] },
  ]);
  return { ctx: { db: { get: async () => workspace, query }, runQuery } as unknown as QueryCtx, query };
}

const raw = (id: string, overrides: Row = {}): Row => ({
  _id: id,
  workspaceId,
  amount: -1250n,
  originalStatement: 'GROCERY STORE',
  merchantName: 'Grocery Store',
  date: '2026-01-15',
  plaidCategory: ['Shops', 'Groceries'],
  ...overrides,
});
const transaction = (id: string, overrides: Row = {}): Row => ({
  transactionImportRawId: id,
  workspaceId,
  type: 'regular',
  reviewStatus: 'reviewed',
  movements: [{ categoryId }],
  ...overrides,
});

describe('comparison data and expected answers', () => {
  it('scopes samples to the workspace and converts signed cents back to Plaid dollar amounts', async () => {
    const { ctx } = context(
      [raw('purchase'), raw('refund', { amount: 1250n }), raw('other', { workspaceId: 'other' })],
      [transaction('purchase')]
    );
    const { samples } = await handler(ctx, { workspaceId, limit: 20 });
    expect(samples.map((sample) => sample.transaction.amount)).toEqual([12.5, -12.5]);
    expect(samples[0]).toMatchObject({
      expectedSource: 'reviewed_transaction',
      transaction: { expectedCategoryId: categoryId },
    });
    expect(samples[1].expectedSource).toBe('none');
  });

  it('uses a reviewed linked transaction when there is no directly imported transaction', async () => {
    const { ctx } = context([raw('linked')], [transaction('unrelated', { linkedRawTransactionId: 'linked' })]);
    expect((await handler(ctx, { workspaceId, limit: 1 })).samples[0].transaction.expectedCategoryId).toBe(categoryId);
  });

  it('never treats unreviewed, deleted, foreign, split, transfer, or system movements as expected labels', async () => {
    const exclusions: Row[] = [
      { reviewStatus: 'unreviewed' },
      { isDeleted: true },
      { workspaceId: 'other' },
      { type: 'transfer' },
      { movements: [{ categoryId }, { categoryId }] },
      { movements: [{ categoryId: 'archived-or-foreign' }] },
      { movements: [{ categoryId, readyToAssign: true }] },
      { movements: [] },
    ];
    const { ctx } = context(
      exclusions.map((_value, index) => raw(String(index))),
      exclusions.map((value, index) => transaction(String(index), value))
    );
    const { samples } = await handler(ctx, { workspaceId, limit: 20 });
    expect(samples).toHaveLength(exclusions.length);
    expect(samples.every((sample) => sample.expectedSource === 'none')).toBe(true);
    expect(samples.every((sample) => sample.transaction.expectedCategoryId === undefined)).toBe(true);
  });

  it('uses the expense category on reviewed credit-card purchases with budget transfer metadata', async () => {
    const { ctx } = context(
      [raw('card-purchase')],
      [
        transaction('card-purchase', {
          movements: [
            {
              categoryId,
              readyToAssign: false,
              creditCardTransfer: {
                spendingCategoryId: categoryId,
                creditCardCategoryId: 'card-payment-envelope',
              },
            },
          ],
        }),
      ]
    );
    expect((await handler(ctx, { workspaceId, limit: 1 })).samples[0]).toMatchObject({
      expectedSource: 'reviewed_transaction',
      transaction: { expectedCategoryId: categoryId },
    });
  });

  it('loads fixed benchmark inputs without querying changing transactions or categories', async () => {
    const { ctx, query } = context([], [], { _id: BENCHMARK_WORKSPACE_ID });
    const report = await handler(ctx, { workspaceId: BENCHMARK_WORKSPACE_ID, limit: 20, source: 'benchmark' });
    expect(report.samples).toHaveLength(20);
    expect(report.samples.every((sample) => sample.expectedSource === 'benchmark_snapshot')).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('does not load transaction records for a supplied-input comparison', async () => {
    const { ctx, query } = context([], []);
    expect((await handler(ctx, { workspaceId, limit: 0 })).samples).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects absent/deleted workspaces and invalid sample limits before loading records', async () => {
    for (const workspace of [null, { isDeleted: true }]) {
      const { ctx, query } = context([], [], workspace);
      await expect(handler(ctx, { workspaceId, limit: 1 })).rejects.toThrow('Workspace not found');
      expect(query).not.toHaveBeenCalled();
    }
    for (const limit of [-1, 1.5, 51]) {
      const { ctx, query } = context([], []);
      await expect(handler(ctx, { workspaceId, limit })).rejects.toThrow('limit must be an integer');
      expect(query).not.toHaveBeenCalled();
    }
  });
});
