import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { countOverspentCategoriesForWorkspace } from '../categoryBudgets/queries';
import { getNavigationAttention } from './queries';

vi.mock('../categoryBudgets/queries', () => ({ countOverspentCategoriesForWorkspace: vi.fn() }));

type RecordData = Record<string, unknown> & { _id: string };
type Attention = {
  workspaceId: string;
  currentMonth: number;
  timezone: string;
  hasOverspending: boolean;
  hasOverassignment: boolean;
  hasMissingCategory: boolean;
  hasMissingPayee: boolean;
  hasNewTransactions: boolean;
};
const handler = (
  getNavigationAttention as unknown as {
    _handler: (ctx: QueryCtx, args: { refreshKey?: string }) => Promise<Attention[]>;
  }
)._handler;

function workspace(id: string, overrides: Record<string, unknown> = {}): RecordData {
  return {
    _id: id,
    _creationTime: 1,
    ownerClerkId: 'owner',
    readyToAssign: 0n,
    timezone: 'UTC',
    isDeleted: false,
    isArchived: false,
    ...overrides,
  };
}

function transaction(id: string, overrides: Record<string, unknown> = {}): RecordData {
  return {
    _id: id,
    workspaceId: 'personal',
    hasUncategorized: false,
    hasMissingPayee: false,
    reviewStatus: 'reviewed',
    isDeleted: false,
    ...overrides,
  };
}

function fixture(records: Record<string, RecordData[]> = {}, subject: string | null = 'owner', deletedUser = false) {
  const tables: Record<string, RecordData[]> = {
    userProfile: [{ _id: 'profile', clerkId: 'owner', isDeleted: deletedUser }],
    workspace: [workspace('personal')],
    ...records,
  };
  const reads: { table: string; index: string; filters: [string, unknown][]; method?: string }[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => (subject ? { subject } : null) },
    db: {
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
      query: (table: string) => {
        const read = { table, index: '', filters: [] as [string, unknown][], method: '' };
        reads.push(read);
        const bounds = {
          eq: (field: string, value: unknown) => {
            read.filters.push([field, value]);
            return bounds;
          },
        };
        const matches = () =>
          (tables[table] ?? []).filter((row) => read.filters.every(([field, value]) => row[field] === value));
        const query = {
          withIndex: (index: string, apply: (q: typeof bounds) => unknown) => {
            read.index = index;
            apply(bounds);
            return query;
          },
          first: async () => {
            read.method = 'first';
            return matches()[0] ?? null;
          },
          collect: async () => {
            read.method = 'collect';
            return matches();
          },
        };
        return query;
      },
    },
  } as unknown as QueryCtx;
  vi.mocked(countOverspentCategoriesForWorkspace).mockResolvedValue(0);
  return { ctx, reads };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('workspace navigation attention', () => {
  it('rejects signed-out and deleted users before reading workspace data', async () => {
    const signedOut = fixture({}, null);
    await expect(handler(signedOut.ctx, {})).rejects.toThrow('Authentication required');
    expect(signedOut.reads).toEqual([]);
    const deleted = fixture({}, 'owner', true);
    await expect(handler(deleted.ctx, {})).rejects.toThrow('User profile not found');
    expect(deleted.reads.map((read) => read.table)).toEqual(['userProfile']);
    expect(countOverspentCategoriesForWorkspace).not.toHaveBeenCalled();
  });

  it('ignores archived, deleted, and inaccessible workspaces', async () => {
    const f = fixture({
      workspace: [
        workspace('personal'),
        workspace('archived', { isArchived: true }),
        workspace('deleted', { isDeleted: true }),
        workspace('private', { ownerClerkId: 'stranger' }),
      ],
      transaction: [transaction('private-issue', { workspaceId: 'private', hasUncategorized: true })],
    });
    const result = await handler(f.ctx, {});
    expect(result.map((value) => value.workspaceId)).toEqual(['personal']);
    expect(result[0].hasMissingCategory).toBe(false);
    expect(countOverspentCategoriesForWorkspace).toHaveBeenCalledTimes(1);
  });

  it('includes active family workspaces through the existing membership access rules', async () => {
    const f = fixture({
      workspace: [workspace('personal'), workspace('shared', { ownerClerkId: 'relative' })],
      familyGroup: [{ _id: 'family', ownerClerkId: 'owner', isDeleted: false }],
      familyGroupMember: [
        { _id: 'owner-member', clerkId: 'owner', familyGroupId: 'family', role: 'owner', isDeleted: false },
        { _id: 'relative-member', clerkId: 'relative', familyGroupId: 'family', role: 'member', isDeleted: false },
      ],
      transaction: [transaction('family-issue', { workspaceId: 'shared', hasMissingPayee: true })],
    });
    const result = await handler(f.ctx, {});
    expect(result.find((value) => value.workspaceId === 'shared')?.hasMissingPayee).toBe(true);
    expect(result.find((value) => value.workspaceId === 'personal')?.hasMissingPayee).toBe(false);
  });

  it.each(['reviewed', 'needs_review'])('detects missing details even when %s', async (reviewStatus) => {
    const f = fixture({
      transaction: [transaction('issue', { reviewStatus, hasUncategorized: true, hasMissingPayee: true })],
    });
    const [result] = await handler(f.ctx, {});
    expect(result.hasMissingCategory).toBe(true);
    expect(result.hasMissingPayee).toBe(true);
    expect(result.hasNewTransactions).toBe(reviewStatus === 'needs_review');
    const reads = f.reads.filter((read) => read.table === 'transaction');
    expect(reads).toHaveLength(3);
    for (const read of reads) {
      expect(read.method).toBe('first');
      expect(read.filters).toContainEqual(['workspaceId', 'personal']);
      expect(read.filters).toContainEqual(['isDeleted', false]);
    }
  });

  it('separates review activity from issues and clears it once reviewed', async () => {
    const item = transaction('new', { reviewStatus: 'needs_review' });
    const f = fixture({ transaction: [item] });
    expect((await handler(f.ctx, {}))[0]).toMatchObject({
      hasNewTransactions: true,
      hasMissingCategory: false,
      hasMissingPayee: false,
    });
    item['reviewStatus'] = 'reviewed';
    expect((await handler(f.ctx, {}))[0].hasNewTransactions).toBe(false);
  });

  it('ignores deleted issues and normal pending transactions', async () => {
    const f = fixture({
      transaction: [
        transaction('deleted', {
          isDeleted: true,
          reviewStatus: 'needs_review',
          hasUncategorized: true,
          hasMissingPayee: true,
        }),
        transaction('pending', { status: 'pending' }),
      ],
    });
    expect((await handler(f.ctx, {}))[0]).toMatchObject({
      hasNewTransactions: false,
      hasMissingCategory: false,
      hasMissingPayee: false,
    });
  });

  it('uses the carryover-aware budget summary in each workspace timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    const f = fixture({
      workspace: [
        workspace('personal', { timezone: 'America/Los_Angeles', readyToAssign: -1n }),
        workspace('sydney', { timezone: 'Australia/Sydney', readyToAssign: 100n }),
      ],
    });
    vi.mocked(countOverspentCategoriesForWorkspace).mockImplementation(async (_ctx, id) => (id === 'sydney' ? 1 : 0));
    const result = await handler(f.ctx, { refreshKey: 'month-change' });
    expect(result.find((value) => value.workspaceId === 'personal')).toMatchObject({
      currentMonth: 202609,
      hasOverassignment: true,
      hasOverspending: false,
    });
    expect(result.find((value) => value.workspaceId === 'sydney')).toMatchObject({
      currentMonth: 202610,
      hasOverassignment: false,
      hasOverspending: true,
    });
    expect(countOverspentCategoriesForWorkspace).toHaveBeenCalledWith(f.ctx, 'personal' as Id<'workspace'>, 202609);
  });
});
