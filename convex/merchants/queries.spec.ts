import type { PaginationOptions } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { listMerchantChoices } from './queries';
import type { MerchantChoice } from './types';

const workspaceId = 'workspace-1' as Id<'workspace'>;
type Row = Record<string, unknown> & { _id: string };
const handler = (
  listMerchantChoices as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { workspaceId: Id<'workspace'>; paginationOpts: PaginationOptions }
    ) => Promise<{
      page: MerchantChoice[];
      isDone: boolean;
      continueCursor: string;
      splitCursor?: string;
      pageStatus?: string;
    }>;
  }
)._handler;

function merchant(id: string, fields: Record<string, unknown> = {}): Row {
  return { _id: id, workspaceId, name: 'Local name', isDeleted: false, ...fields };
}

function setup(merchants: Row[] = [], options: { signedOut?: boolean; deletedUser?: boolean } = {}) {
  const records: Record<string, Row[]> = {
    workspace: [
      { _id: workspaceId, ownerClerkId: 'owner' },
      { _id: 'workspace-foreign', ownerClerkId: 'stranger' },
    ],
    userProfile: [{ _id: 'profile', clerkId: 'owner', isDeleted: options.deletedUser ?? false }],
    merchant: merchants,
    globalMerchant: [{ _id: 'global-1', name: 'Global name', logoUrl: 'https://example.com/global.png' }],
  };
  const paginate = vi.fn();
  const reads: { table: string; index: string; fields: [string, unknown][] }[] = [];
  const get = vi.fn(
    async (id: string) =>
      Object.values(records)
        .flat()
        .find((row) => row._id === id) ?? null
  );
  const ctx = {
    auth: { getUserIdentity: async () => (options.signedOut ? null : { subject: 'owner' }) },
    db: {
      get,
      query: (table: string) => {
        const read = { table, index: '', fields: [] as [string, unknown][] };
        reads.push(read);
        const bounds = {
          eq: (field: string, value: unknown) => {
            read.fields.push([field, value]);
            return bounds;
          },
        };
        const matches = () =>
          (records[table] ?? []).filter((row) => read.fields.every(([field, value]) => row[field] === value));
        const query = {
          withIndex: (index: string, build: (q: typeof bounds) => unknown) => {
            read.index = index;
            build(bounds);
            return query;
          },
          first: async () => matches()[0] ?? null,
          paginate: async (opts: PaginationOptions) => {
            paginate(opts);
            const start = Number(opts.cursor ?? 0);
            const rows = matches();
            return {
              page: rows.slice(start, start + opts.numItems),
              isDone: start + opts.numItems >= rows.length,
              continueCursor: String(start + opts.numItems),
              splitCursor: 'split',
              pageStatus: 'SplitRecommended' as const,
            };
          },
        };
        return query;
      },
    },
  } as unknown as QueryCtx;
  return { ctx, reads, get, paginate };
}

describe('merchant choices', () => {
  it.each(['signed-out', 'deleted-user', 'foreign-workspace'])(
    'rejects %s before reading merchant data',
    async (scenario) => {
      const f = setup([], { signedOut: scenario === 'signed-out', deletedUser: scenario === 'deleted-user' });
      await expect(
        handler(f.ctx, {
          workspaceId: scenario === 'foreign-workspace' ? ('workspace-foreign' as Id<'workspace'>) : workspaceId,
          paginationOpts: { cursor: null, numItems: 200 },
        })
      ).rejects.toThrow();
      expect(f.reads.some((read) => read.table === 'merchant')).toBe(false);
    }
  );

  it('preserves native pagination options and metadata while excluding deleted and foreign rows', async () => {
    const f = setup([
      merchant('deleted', { isDeleted: true }),
      merchant('first'),
      merchant('second'),
      merchant('foreign', { workspaceId: 'workspace-foreign' }),
    ]);
    const paginationOpts = { cursor: null, numItems: 1, maximumRowsRead: 25, endCursor: 'boundary' };
    const first = await handler(f.ctx, { workspaceId, paginationOpts });
    expect(f.paginate).toHaveBeenCalledWith(paginationOpts);
    expect(f.paginate.mock.calls[0][0]).toBe(paginationOpts);
    expect(first).toEqual({
      page: [],
      isDone: false,
      continueCursor: '1',
      splitCursor: 'split',
      pageStatus: 'SplitRecommended',
    });
    const rest = await handler(f.ctx, { workspaceId, paginationOpts: { cursor: first.continueCursor, numItems: 200 } });
    expect(rest.page.map((row) => row._id)).toEqual(['first', 'second']);
    expect(rest.isDone).toBe(true);
    expect(f.reads.filter((read) => read.table === 'merchant')).toEqual([
      { table: 'merchant', index: 'by_workspaceId', fields: [['workspaceId', workspaceId]] },
      { table: 'merchant', index: 'by_workspaceId', fields: [['workspaceId', workspaceId]] },
    ]);
  });

  it('resolves global overrides and suggestions with one shared global read and no transaction or schedule reads', async () => {
    const f = setup([
      merchant('global-default', {
        globalMerchantId: 'global-1',
        name: undefined,
        monthlyStats: { '202609': { totalAmount: -100n, transactionCount: 2n } },
        suggestedCategoryIds: ['category-1'],
        suggestedBankAccountId: 'account-1',
      }),
      merchant('custom', { globalMerchantId: 'global-1', logoUrl: 'https://example.com/custom.png' }),
      merchant('hidden-logo', { globalMerchantId: 'global-1', logoUrl: null }),
      merchant('missing-global', { globalMerchantId: 'missing', name: undefined }),
      merchant('manual', { logoUrl: 'https://example.com/manual.png' }),
    ]);
    const result = await handler(f.ctx, { workspaceId, paginationOpts: { cursor: null, numItems: 200 } });
    expect(result.page.map(({ _id, name, logoUrl }) => ({ _id, name, logoUrl }))).toEqual([
      { _id: 'global-default', name: 'Global name', logoUrl: 'https://example.com/global.png' },
      { _id: 'custom', name: 'Local name', logoUrl: 'https://example.com/custom.png' },
      { _id: 'hidden-logo', name: 'Local name', logoUrl: undefined },
      { _id: 'missing-global', name: '', logoUrl: undefined },
      { _id: 'manual', name: 'Local name', logoUrl: 'https://example.com/manual.png' },
    ]);
    expect(result.page[0]).toEqual({
      _id: 'global-default',
      name: 'Global name',
      logoUrl: 'https://example.com/global.png',
      isDeleted: false,
      suggestedCategoryIds: ['category-1'],
      suggestedBankAccountId: 'account-1',
    });
    expect(f.get.mock.calls.filter(([id]) => id === 'global-1')).toHaveLength(1);
    expect(f.reads.map((read) => read.table)).toEqual(['userProfile', 'merchant']);
  });
});
