import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createOrRefreshWidgetToken, revokeAllWidgetTokens, updateWidgetTokenLastUsed } from './mutations';

type RecordValue = Record<string, unknown> & { _id: string };
type IndexFilter = { field: string; value: unknown };

class IndexRange {
  readonly filters: IndexFilter[] = [];

  eq(field: string, value: unknown): IndexRange {
    this.filters.push({ field, value });
    return this;
  }
}

const workspaceId = 'workspace_1' as Id<'workspace'>;
const otherWorkspaceId = 'workspace_2' as Id<'workspace'>;
const clerkId = 'owner';
const activeIndex = 'by_clerkId_isRevoked_workspaceId';

function token(id: string, overrides: Partial<Doc<'widgetToken'>> = {}): Doc<'widgetToken'> {
  return {
    _id: id as Id<'widgetToken'>,
    _creationTime: 1,
    clerkId,
    workspaceId,
    token: `secret_${id}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    isRevoked: false,
    ...overrides,
  };
}

function setup(tokens: Doc<'widgetToken'>[], subject: string | null = clerkId) {
  const records = new Map<string, RecordValue[]>([
    ['widgetToken', tokens],
    ['userProfile', [{ _id: 'profile_1', clerkId, email: 'owner@example.com', isDeleted: false }]],
    ['workspace', [workspaceId, otherWorkspaceId].map((_id) => ({ _id, ownerClerkId: clerkId, isDeleted: false }))],
  ]);
  const readToken = vi.fn();
  const patch = vi.fn(async (id: string, fields: Record<string, unknown>) => {
    const record = [...records.values()].flat().find((value) => value._id === id);
    if (!record) throw new Error('Record missing');
    Object.assign(record, fields);
  });
  const insert = vi.fn(async (table: string, fields: Record<string, unknown>) => {
    const record = { _id: `new_${records.get(table)?.length ?? 0}`, ...fields };
    records.get(table)?.push(record);
    return record._id;
  });
  const ctx = {
    auth: { getUserIdentity: async () => (subject === null ? null : { subject }) },
    db: {
      get: async (id: string) => [...records.values()].flat().find((value) => value._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (index: string, callback: (range: IndexRange) => IndexRange) => {
          if (table === 'widgetToken') expect(index).toBe(activeIndex);
          const { filters } = callback(new IndexRange());
          const matching = () =>
            (records.get(table) ?? []).filter((record) => filters.every(({ field, value }) => record[field] === value));
          const read = (record: RecordValue) => {
            if (table === 'widgetToken') readToken(record._id);
            return record;
          };
          return {
            first: async () => {
              const record = matching()[0];
              return record ? read(record) : null;
            },
            async *[Symbol.asyncIterator]() {
              for (const record of matching()) yield read(record);
            },
          };
        },
      }),
      patch,
      insert,
    },
  } as unknown as MutationCtx;
  return { ctx, records, readToken, patch, insert };
}

const issue = (
  createOrRefreshWidgetToken as unknown as {
    _handler: (ctx: MutationCtx, args: { workspaceId: Id<'workspace'>; reuseExisting?: boolean }) => Promise<string>;
  }
)._handler;
const revoke = (revokeAllWidgetTokens as unknown as { _handler: (ctx: MutationCtx) => Promise<null> })._handler;
const recordUse = (
  updateWidgetTokenLastUsed as unknown as {
    _handler: (ctx: MutationCtx, args: { tokenId: Id<'widgetToken'> }) => Promise<null>;
  }
)._handler;

describe('widget token lifecycle', () => {
  it('reuses a credential with one active-token read and no writes despite a long revoked history', async () => {
    const history = Array.from({ length: 2_000 }, (_, index) => token(`old_${index}`, { isRevoked: true }));
    const { ctx, readToken, patch, insert } = setup([...history, token('current')]);

    expect(await issue(ctx, { workspaceId, reuseExisting: true })).toBe('secret_current');
    expect(readToken).toHaveBeenCalledExactlyOnceWith('current');
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('keeps legacy rotation while touching only active credentials in the requested user and workspace', async () => {
    const { ctx, readToken, patch, insert } = setup([
      token('revoked', { isRevoked: true }),
      token('current'),
      token('other_workspace', { workspaceId: otherWorkspaceId }),
      token('other_user', { clerkId: 'other' }),
    ]);

    const result = await issue(ctx, { workspaceId });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    expect(readToken).toHaveBeenCalledExactlyOnceWith('current');
    expect(patch).toHaveBeenCalledExactlyOnceWith('current', { isRevoked: true });
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      'widgetToken',
      expect.objectContaining({ workspaceId, clerkId, token: result, isRevoked: false })
    );
  });

  it('reissues after revocation and never returns another user or workspace credential', async () => {
    const { ctx, patch, insert } = setup([
      token('revoked', { isRevoked: true }),
      token('other_workspace', { workspaceId: otherWorkspaceId }),
      token('other_user', { clerkId: 'other' }),
    ]);

    const result = await issue(ctx, { workspaceId, reuseExisting: true });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    expect(patch).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledOnce();
    expect(await issue(ctx, { workspaceId, reuseExisting: true })).toBe(result);
    expect(insert).toHaveBeenCalledOnce();
  });

  it.each([null, 'removed'])('authorizes before token reuse for identity %s', async (subject) => {
    const { ctx, readToken, patch, insert } = setup([token('current')], subject);
    await expect(issue(ctx, { workspaceId, reuseExisting: true })).rejects.toThrow();
    expect(readToken).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('revokes active credentials across the signed-out user workspaces without touching historical or foreign tokens', async () => {
    const { ctx, readToken, patch } = setup([
      token('revoked', { isRevoked: true }),
      token('current'),
      token('other_workspace', { workspaceId: otherWorkspaceId }),
      token('other_user', { clerkId: 'other' }),
    ]);

    expect(await revoke(ctx)).toBeNull();
    expect(readToken.mock.calls).toEqual([['current'], ['other_workspace']]);
    expect(patch.mock.calls).toEqual([
      ['current', { isRevoked: true }],
      ['other_workspace', { isRevoked: true }],
    ]);
    await revoke(ctx);
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('writes usage at most once per hour even when multiple widget requests checked the old value', async () => {
    const current = token('current');
    const { ctx, patch } = setup([current]);
    await recordUse(ctx, { tokenId: current._id });
    await recordUse(ctx, { tokenId: current._id });
    expect(patch).toHaveBeenCalledOnce();
    expect(current.lastUsedAt).toBeDefined();
  });

  it('does not touch a token revoked between HTTP validation and usage recording', async () => {
    const current = token('current', { isRevoked: true });
    const { ctx, patch } = setup([current]);
    await recordUse(ctx, { tokenId: current._id });
    expect(patch).not.toHaveBeenCalled();
  });
});
