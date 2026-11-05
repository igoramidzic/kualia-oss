import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { components } from '../_generated/api';
import { type QueryCtx, query } from '../_generated/server';
import { requireAuth, requireWorkspaceAccess } from '../lib/auth';
import { chatAgent } from './agent';
import { parseKualiaContextTag } from './workspaceContextTag';

interface ToolCallSummary {
  toolCallId: string;
  toolName: string;
  state: 'running' | 'success' | 'error';
  /**
   * For batch tools that take an array of items (create/update/delete/restore), the
   * length of that array — surfaced so the UI can pluralize the tool label. Undefined
   * when the input isn't a batch tool or hasn't fully streamed in yet.
   */
  itemCount?: number;
}

interface StreamingMessage {
  streamId: string;
  order: number;
  stepOrder: number;
  status: 'streaming' | 'finished' | 'aborted';
  text: string;
  toolCalls: ToolCallSummary[];
}

interface ThreadSummary {
  threadId: string;
  title: string | null;
  lastUpdatedAt: number;
  /** True when the assistant has posted to this thread since the user last opened it. */
  unread: boolean;
  workspaceId?: string | null;
}

interface ThreadList {
  active: ThreadSummary[];
  archived: ThreadSummary[];
}

const MAX_THREADS = 100;

/**
 * Walk parts in order and fold them into the running text accumulator. Any tool boundary
 * (`tool-input-start`, `tool-input-available`, `tool-call`, `tool-output-available`,
 * `tool-result`) resets the accumulator: pre-tool preamble like "Let me grab that for you…"
 * is discarded, and only text emitted *after* the latest tool boundary reaches the bubble.
 * Without this, the streamed `text` for a multi-step turn ends up as
 * `"Let me grab both at once!Here's what I found…"` because the agent component groups deltas
 * from every step under a single `streamId`.
 */
function applyDeltaPartsToText(parts: unknown[], current: string): string {
  let out = current;
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Record<string, unknown>;
    const type = p['type'];
    if (type === 'text-delta' || type === 'text') {
      if (typeof p['text'] === 'string') out += p['text'];
      else if (typeof p['delta'] === 'string') out += p['delta'];
    } else if (
      type === 'tool-input-start' ||
      type === 'tool-input-available' ||
      type === 'tool-call' ||
      type === 'tool-output-available' ||
      type === 'tool-result'
    ) {
      out = '';
    }
  }
  return out;
}

/**
 * Tools whose primary input is an array of items, keyed by the array field name. Used to
 * surface a count so the UI can pluralize the running/done labels ("Created transaction" vs.
 * "Created 3 transactions"). Read tools like `kualia_list_transactions` are intentionally
 * excluded — their result count isn't known from the input alone.
 */
const BATCH_TOOL_INPUT_FIELDS: Readonly<Record<string, string>> = {
  kualia_create_transactions: 'transactions',
  kualia_update_transactions: 'updates',
  kualia_delete_transactions: 'transactionIds',
  kualia_restore_transactions: 'transactionIds',
};

/**
 * Pull the batch size out of a tool-call's input args. Returns undefined when the tool isn't
 * a known batch tool, when the input hasn't fully streamed in yet, or when the field is
 * malformed. Accepts both `args` (older AI SDK convention) and `input` (newer) shapes.
 */
function extractItemCount(toolName: string, part: Record<string, unknown>): number | undefined {
  const field = BATCH_TOOL_INPUT_FIELDS[toolName];
  if (!field) return undefined;
  const raw = part['input'] ?? part['args'];
  if (!raw || typeof raw !== 'object') return undefined;
  const value = (raw as Record<string, unknown>)[field];
  if (!Array.isArray(value)) return undefined;
  return value.length;
}

/**
 * Walk stream-delta parts and update the per-`toolCallId` running state. Mirrors the AI SDK
 * UI-stream chunk types: `tool-input-start` and `tool-input-available` introduce a call (state
 * stays `running`); `tool-output-available` / `tool-result` resolve it to `success` or `error`.
 * Static `tool-call` chunks (used by some providers) also seed a running entry.
 */
function applyToolPartsToState(parts: unknown[], state: Map<string, ToolCallSummary>): void {
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Record<string, unknown>;
    const type = p['type'];
    const toolCallId = typeof p['toolCallId'] === 'string' ? p['toolCallId'] : null;
    if (!toolCallId) continue;
    if (type === 'tool-input-start' || type === 'tool-input-available' || type === 'tool-call') {
      const toolName = typeof p['toolName'] === 'string' ? p['toolName'] : (state.get(toolCallId)?.toolName ?? '');
      const existing = state.get(toolCallId);
      const resolvedName = existing?.toolName || toolName;
      const itemCount = extractItemCount(resolvedName, p) ?? existing?.itemCount;
      state.set(toolCallId, {
        toolCallId,
        toolName: resolvedName,
        state: existing?.state ?? 'running',
        itemCount,
      });
    } else if (type === 'tool-output-available' || type === 'tool-result') {
      const existing = state.get(toolCallId);
      const isError =
        Boolean(p['isError']) ||
        (typeof p['output'] === 'object' &&
          p['output'] !== null &&
          typeof (p['output'] as Record<string, unknown>)['type'] === 'string' &&
          ((p['output'] as Record<string, unknown>)['type'] as string).startsWith('error'));
      state.set(toolCallId, {
        toolCallId,
        toolName: existing?.toolName ?? (typeof p['toolName'] === 'string' ? p['toolName'] : ''),
        state: isError ? 'error' : 'success',
        itemCount: existing?.itemCount,
      });
    }
  }
}

/**
 * Verify the caller owns this thread (per the agent component's thread.userId).
 * Throws if the thread is not found or owned by another user.
 */
async function requireOwnedThread(ctx: QueryCtx, threadId: string, clerkId: string): Promise<void> {
  const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
  if (meta.userId !== clerkId) {
    throw new ConvexError('Chat thread not found');
  }
}

/**
 * List paginated messages for a chat thread owned by the caller.
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const identity = await requireAuth(ctx);
    await requireOwnedThread(ctx, threadId, identity.subject);

    const result = await chatAgent.listMessages(ctx, {
      threadId,
      paginationOpts,
      excludeToolMessages: false,
    });

    // First pass: scan every message in the page for `tool-result` parts so we can resolve
    // `running → success | error` for the matching `tool-call` parts in the second pass.
    // Tool results may live in role:'tool' messages; tool calls live in role:'assistant'
    // messages. Both surface as a `MessageDoc` with `tool: true`.
    const toolStates = new Map<string, { state: 'success' | 'error'; finishedAt: number }>();
    for (const m of result.page) {
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const p of content) {
        if (typeof p !== 'object' || p === null) continue;
        const part = p as Record<string, unknown>;
        if (part['type'] !== 'tool-result') continue;
        const toolCallId = typeof part['toolCallId'] === 'string' ? part['toolCallId'] : null;
        if (!toolCallId) continue;
        const isError =
          Boolean(part['isError']) ||
          (typeof part['output'] === 'object' &&
            part['output'] !== null &&
            typeof (part['output'] as Record<string, unknown>)['type'] === 'string' &&
            ((part['output'] as Record<string, unknown>)['type'] as string).startsWith('error'));
        toolStates.set(toolCallId, { state: isError ? 'error' : 'success', finishedAt: m._creationTime });
      }
    }

    // Second pass: augment each message with `kind` + `toolCalls`. Messages with a tool-call
    // part become `kind: 'tool'`. Tool-result rows are tagged `kind: 'tool'` too but emit no
    // entries (the call message owns the entry; resolving here would double-count). The text
    // assistant reply and the user prompt remain `kind: 'text'` and render as bubbles.
    const augmented = result.page.map((m) => {
      const content = m.message?.content;
      const toolCalls: Array<ToolCallSummary & { startedAt: number; finishedAt: number | null }> = [];
      let hasToolResultPart = false;
      if (Array.isArray(content)) {
        for (const p of content) {
          if (typeof p !== 'object' || p === null) continue;
          const part = p as Record<string, unknown>;
          if (part['type'] === 'tool-result') {
            hasToolResultPart = true;
            continue;
          }
          if (part['type'] !== 'tool-call') continue;
          const toolCallId = typeof part['toolCallId'] === 'string' ? part['toolCallId'] : null;
          const toolName = typeof part['toolName'] === 'string' ? part['toolName'] : null;
          if (!toolCallId || !toolName) continue;
          const resolved = toolStates.get(toolCallId);
          toolCalls.push({
            toolCallId,
            toolName,
            state: resolved?.state ?? 'running',
            itemCount: extractItemCount(toolName, part),
            startedAt: m._creationTime,
            finishedAt: resolved?.finishedAt ?? null,
          });
        }
      }
      const kind: 'text' | 'tool' = toolCalls.length > 0 || hasToolResultPart || m.tool ? 'tool' : 'text';
      return { ...m, kind, toolCalls };
    });

    return { ...result, page: augmented };
  },
});

/**
 * Returns the current text for any in-progress streaming assistant messages on
 * the thread. The query is reactive — as the agent component writes new deltas,
 * subscribers receive the updated concatenated text.
 *
 * Returns an empty array when the assistant is not currently streaming.
 */
export const streamMessages = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, { threadId }): Promise<StreamingMessage[]> => {
    const identity = await requireAuth(ctx);
    await requireOwnedThread(ctx, threadId, identity.subject);

    const list = await chatAgent.syncStreams(ctx, {
      threadId,
      streamArgs: { kind: 'list' },
      includeStatuses: ['streaming'],
    });

    if (!list || list.kind !== 'list' || list.messages.length === 0) {
      return [];
    }

    const deltasResult = await chatAgent.syncStreams(ctx, {
      threadId,
      streamArgs: {
        kind: 'deltas',
        cursors: list.messages.map((m) => ({ streamId: m.streamId, cursor: 0 })),
      },
      includeStatuses: ['streaming'],
    });

    const accumulated = new Map<string, string>();
    const toolStateByStream = new Map<string, Map<string, ToolCallSummary>>();
    if (deltasResult && deltasResult.kind === 'deltas') {
      const sorted = [...deltasResult.deltas].sort((a, b) => a.start - b.start);
      for (const delta of sorted) {
        const prev = accumulated.get(delta.streamId) ?? '';
        accumulated.set(delta.streamId, applyDeltaPartsToText(delta.parts, prev));
        const toolState = toolStateByStream.get(delta.streamId) ?? new Map<string, ToolCallSummary>();
        applyToolPartsToState(delta.parts, toolState);
        toolStateByStream.set(delta.streamId, toolState);
      }
    }

    return list.messages.map((m) => ({
      streamId: m.streamId,
      order: m.order,
      stepOrder: m.stepOrder,
      status: m.status,
      toolCalls: Array.from(toolStateByStream.get(m.streamId)?.values() ?? []),
      text: accumulated.get(m.streamId) ?? '',
    }));
  },
});

/**
 * Reactive title for a thread. Verifies the caller owns the thread.
 */
export const getThreadInfo = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, { threadId }): Promise<{ title: string | null } | null> => {
    const identity = await requireAuth(ctx);

    const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
    if (meta.userId !== identity.subject) return null;

    return { title: meta.title ?? null };
  },
});

/**
 * Reactive list of the caller's threads, split into active (taskbar) and
 * archived (history) by the agent component's thread.status field. Sorted
 * newest-first within each bucket.
 */
const threadSummaryValidator = v.object({
  threadId: v.string(),
  title: v.union(v.string(), v.null()),
  lastUpdatedAt: v.number(),
  unread: v.boolean(),
  workspaceId: v.optional(v.union(v.string(), v.null())),
});

export const listThreads = query({
  args: { workspaceId: v.optional(v.id('workspace')) },
  returns: v.object({ active: v.array(threadSummaryValidator), archived: v.array(threadSummaryValidator) }),
  handler: async (ctx, { workspaceId }): Promise<ThreadList> => {
    const identity = await requireAuth(ctx);
    if (workspaceId) await requireWorkspaceAccess(ctx, workspaceId);
    const result = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: identity.subject,
      order: 'desc',
      paginationOpts: { numItems: MAX_THREADS, cursor: null },
    });

    // Bound read-state lookups to the returned page rather than loading the user's
    // entire read-state table. New native chats carry their workspace here.
    const summaries = await Promise.all(
      result.page.map(async (thread) => {
        const state = await ctx.db
          .query('aiChatThreadReadState')
          .withIndex('by_userId_threadId', (q) => q.eq('userId', identity.subject).eq('threadId', thread._id))
          .unique();
        let pinnedWorkspaceId: string | null = state?.workspaceId ?? null;
        if (workspaceId && !pinnedWorkspaceId) {
          // Older chats store context in their FIRST user message. Ascending order
          // keeps this correct even after that message leaves the latest transcript page.
          const first = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
            threadId: thread._id,
            order: 'asc',
            excludeToolMessages: true,
            paginationOpts: { numItems: 1, cursor: null },
          });
          const message = first.page[0]?.message;
          if (message?.role === 'user') {
            const text =
              typeof message.content === 'string'
                ? message.content
                : message.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('');
            pinnedWorkspaceId = parseKualiaContextTag(text)?.workspaceId ?? null;
          }
        }
        if (workspaceId && pinnedWorkspaceId !== workspaceId) return null;
        const summary: ThreadSummary = {
          threadId: thread._id,
          title: thread.title ?? null,
          lastUpdatedAt: thread._creationTime,
          unread: (state?.lastAssistantAt ?? 0) > (state?.lastReadAt ?? 0),
          ...(workspaceId ? { workspaceId: pinnedWorkspaceId } : {}),
        };
        return { summary, archived: thread.status === 'archived' };
      })
    );
    const active: ThreadSummary[] = [];
    const archived: ThreadSummary[] = [];
    for (const entry of summaries) {
      if (entry) (entry.archived ? archived : active).push(entry.summary);
    }
    return { active, archived };
  },
});
