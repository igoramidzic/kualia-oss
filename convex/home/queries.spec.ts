import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getHomeDashboard } from './queries';
import type { HomeDashboard } from './types';

const handler = (
  getHomeDashboard as unknown as {
    _handler: (ctx: QueryCtx, args: { workspaceId: Id<'workspace'> }) => Promise<HomeDashboard>;
  }
)._handler;
const workspaceId = 'personal' as Id<'workspace'>;
function fixture(subject: string | null = 'owner', deleted = false) {
  const reads: { table: string; index: string; filters: [string, unknown][]; limit?: number }[] = [];
  const query = vi.fn((table: string) => {
    const record = { table, index: '', filters: [] as [string, unknown][], limit: undefined as number | undefined };
    reads.push(record);
    const range = {
      eq: (key: string, value: unknown) => {
        record.filters.push([key, value]);
        return range;
      },
      gte: (key: string, value: unknown) => {
        record.filters.push([key, value]);
        return range;
      },
      lt: (key: string, value: unknown) => {
        record.filters.push([key, value]);
        return range;
      },
    };
    const builder = {
      withIndex: (name: string, apply: (bounds: typeof range) => unknown) => {
        record.index = name;
        apply(range);
        return builder;
      },
      first: async () => (table === 'userProfile' ? { isDeleted: deleted } : null),
      order: () => builder,
      take: async (limit: number) => {
        record.limit = limit;
        return [];
      },
    };
    return builder;
  });
  const get = vi.fn(async () => ({
    _id: workspaceId,
    name: 'Personal',
    ownerClerkId: 'owner',
    timezone: 'America/New_York',
    currency: 'usd',
    isDeleted: false,
  }));
  const ctx = {
    auth: { getUserIdentity: async () => (subject ? { subject } : null) },
    db: { query, get },
  } as unknown as QueryCtx;
  return { ctx, reads, get };
}
afterEach(() => vi.useRealTimers());
describe('home:getHomeDashboard access and query boundaries', () => {
  it('rejects unauthenticated requests before reading financial data', async () => {
    const f = fixture(null);
    await expect(handler(f.ctx, { workspaceId })).rejects.toThrow('Authentication required');
    expect(f.reads).toEqual([]);
    expect(f.get).not.toHaveBeenCalled();
  });
  it('rejects another user without family access before reading accounts or transactions', async () => {
    const f = fixture('stranger');
    await expect(handler(f.ctx, { workspaceId })).rejects.toThrow('Access denied');
    expect(f.reads.every((r) => ['userProfile', 'familyGroupMember'].includes(r.table))).toBe(true);
  });
  it('rejects deleted users', async () => {
    const f = fixture('owner', true);
    await expect(handler(f.ctx, { workspaceId })).rejects.toThrow('account has been deleted');
  });
  it('bounds every financial query and scopes indexes to the requested workspace', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T02:00:00Z'));
    const f = fixture();
    const result = await handler(f.ctx, { workspaceId });
    expect(result.today).toBe('2026-09-05');
    const financial = f.reads.filter((r) => r.table !== 'userProfile');
    expect(financial).toHaveLength(5);
    for (const read of financial) {
      expect(read.filters).toContainEqual(['workspaceId', workspaceId]);
      expect(read.limit).toBeGreaterThan(0);
      expect(read.limit).toBeLessThanOrEqual(2001);
    }
  });
});
