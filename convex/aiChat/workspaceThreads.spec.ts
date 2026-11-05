import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { createThread as registeredCreate } from './mutations';
import { listThreads as registeredList } from './queries';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), create: vi.fn() }));
vi.mock('../lib/auth', () => ({ requireAuth: mocks.auth, requireWorkspaceAccess: mocks.access }));
vi.mock('./agent', () => ({ chatAgent: { createThread: mocks.create } }));

const workspaceId = 'personal' as Id<'workspace'>;
const otherWorkspaceId = 'shared' as Id<'workspace'>;
type Summary = { threadId: string; workspaceId?: string | null; unread: boolean };
const list = (
  registeredList as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { workspaceId?: Id<'workspace'> }
    ) => Promise<{ active: Summary[]; archived: Summary[] }>;
  }
)._handler;
const create = (
  registeredCreate as unknown as {
    _handler: (ctx: MutationCtx, args: { workspaceId?: Id<'workspace'> }) => Promise<{ threadId: string }>;
  }
)._handler;

type IndexProbe = { eq: (field: string, value: string) => IndexProbe };
type ReadState = { workspaceId?: string; lastReadAt?: number; lastAssistantAt?: number };
function setup() {
  const states = new Map<string, ReadState>();
  const messages = new Map<string, unknown>();
  const threads = [
    { _id: 'native', _creationTime: 3, status: 'active' },
    { _id: 'legacy', _creationTime: 2, status: 'archived' },
    { _id: 'other', _creationTime: 1, status: 'active' },
    { _id: 'unknown', _creationTime: 0, status: 'active' },
  ];
  states.set('native', { workspaceId, lastAssistantAt: 10, lastReadAt: 5 });
  states.set('other', { workspaceId: otherWorkspaceId });
  messages.set('legacy', {
    role: 'user',
    content: `<kualia-context>{"workspaceId":"personal","workspaceName":"Personal"}</kualia-context>\nHello`,
  });
  const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if ('userId' in args) {
      expect(args['userId']).toBe('user-1');
      return { page: threads };
    }
    expect(args['order']).toBe('asc');
    expect(args['paginationOpts']).toEqual({ numItems: 1, cursor: null });
    const message = messages.get(String(args['threadId']));
    return { page: message ? [{ message }] : [] };
  });
  const insert = vi.fn();
  const ctx = {
    runQuery,
    db: {
      insert,
      query: () => ({
        withIndex: (_index: string, apply: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          let thread = '';
          const q: IndexProbe = {
            eq: (field: string, value: string): IndexProbe => {
              if (field === 'userId') expect(value).toBe('user-1');
              if (field === 'threadId') thread = value;
              return q;
            },
          };
          apply(q);
          return { unique: async () => states.get(thread) ?? null };
        },
      }),
    },
  } as unknown as QueryCtx & MutationCtx;
  return { ctx, states, messages, runQuery, insert };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ subject: 'user-1' });
  mocks.access.mockResolvedValue({ workspaceId });
  mocks.create.mockResolvedValue({ threadId: 'new' });
});

describe('workspace-scoped chat history', () => {
  it('includes only matching new and legacy chats, preserving archived/unread state', async () => {
    const { ctx, runQuery } = setup();
    const result = await list(ctx, { workspaceId });
    expect(result.active).toEqual([expect.objectContaining({ threadId: 'native', workspaceId, unread: true })]);
    expect(result.archived).toEqual([expect.objectContaining({ threadId: 'legacy', workspaceId })]);
    expect(mocks.access).toHaveBeenCalledWith(ctx, workspaceId);
    expect(runQuery).toHaveBeenCalledTimes(3); // Catalog plus only two unclassified threads.
  });

  it('reads context from multipart first messages and omits another workspace', async () => {
    const { ctx, messages } = setup();
    messages.set('legacy', {
      role: 'user',
      content: [
        { type: 'text', text: '<kualia-context>{"workspaceId":"shared","workspaceName":"Shared"}</kualia-context>' },
      ],
    });
    expect((await list(ctx, { workspaceId })).archived).toEqual([]);
  });

  it('keeps unscoped callers compatible without reading message bodies', async () => {
    const { ctx, runQuery } = setup();
    const result = await list(ctx, {});
    expect(result.active).toHaveLength(3);
    expect(result.archived).toHaveLength(1);
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects inaccessible workspaces before reading threads', async () => {
    const { ctx, runQuery } = setup();
    mocks.access.mockRejectedValueOnce(new Error('Access denied'));
    await expect(list(ctx, { workspaceId: otherWorkspaceId })).rejects.toThrow('Access denied');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('requires authentication before reading threads', async () => {
    const { ctx, runQuery } = setup();
    mocks.auth.mockRejectedValueOnce(new Error('Authentication required'));
    await expect(list(ctx, { workspaceId })).rejects.toThrow('Authentication required');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('pins new native chats to the verified workspace', async () => {
    const { ctx, insert } = setup();
    expect(await create(ctx, { workspaceId })).toEqual({ threadId: 'new' });
    expect(mocks.access).toHaveBeenCalledWith(ctx, workspaceId);
    expect(insert).toHaveBeenCalledWith('aiChatThreadReadState', { userId: 'user-1', threadId: 'new', workspaceId });
  });

  it('keeps thread creation compatible for clients without a workspace argument', async () => {
    const { ctx, insert } = setup();
    expect(await create(ctx, {})).toEqual({ threadId: 'new' });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not create a thread when workspace access fails', async () => {
    const { ctx, insert } = setup();
    mocks.access.mockRejectedValueOnce(new Error('Access denied'));
    await expect(create(ctx, { workspaceId: otherWorkspaceId })).rejects.toThrow('Access denied');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
