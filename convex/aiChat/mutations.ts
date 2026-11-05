import { abortStream, listStreams } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import { requireAuth, requireWorkspaceAccess } from '../lib/auth';
import { chatAgent } from './agent';

/**
 * Create an empty chat thread owned by the caller and return its id. The client uses this on the
 * first send of a pending-new-chat panel: pre-creating the thread before invoking `sendMessage`
 * lets the panel subscribe to streamMessages/listMessages watchers before deltas start landing,
 * so the assistant reply streams live (instead of materializing all at once after the action
 * returns).
 */
export const createThread = mutation({
  args: { workspaceId: v.optional(v.id('workspace')) },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, { workspaceId }): Promise<{ threadId: string }> => {
    const identity = await requireAuth(ctx);
    if (workspaceId) await requireWorkspaceAccess(ctx, workspaceId);
    const { threadId } = await chatAgent.createThread(ctx, { userId: identity.subject });
    if (workspaceId) {
      await ctx.db.insert('aiChatThreadReadState', { userId: identity.subject, threadId, workspaceId });
    }
    return { threadId };
  },
});

/**
 * Patch a thread's status to 'active' (taskbar) or 'archived' (history).
 * Verifies the caller owns the thread.
 */
export const setThreadStatus = mutation({
  args: {
    threadId: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
  },
  handler: async (ctx, { threadId, status }): Promise<void> => {
    const identity = await requireAuth(ctx);

    const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
    if (meta.userId !== identity.subject) {
      throw new ConvexError('Chat thread not found');
    }

    await chatAgent.updateThreadMetadata(ctx, { threadId, patch: { status } });
  },
});

/**
 * Permanently delete a thread and all of its messages, runs, and streamed deltas.
 * Verifies the caller owns the thread before deletion is scheduled. The agent's
 * delete mutation is async — it pages through related records itself.
 */
export const deleteThread = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, { threadId }): Promise<void> => {
    const identity = await requireAuth(ctx);

    const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
    if (meta.userId !== identity.subject) {
      throw new ConvexError('Chat thread not found');
    }

    await chatAgent.deleteThreadAsync(ctx, { threadId });
  },
});

/**
 * Abort any in-flight streamed assistant response on this thread. Used when the
 * user clicks the stop button while the agent is still generating. The action's
 * delta writer detects the aborted stream on its next addDelta and shuts down
 * the underlying model stream, so the action returns shortly after.
 */
export const stopStream = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, { threadId }): Promise<void> => {
    const identity = await requireAuth(ctx);

    const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
    if (meta.userId !== identity.subject) {
      throw new ConvexError('Chat thread not found');
    }

    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    });
    for (const stream of streams) {
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason: 'user-stopped',
      });
    }
  },
});

/**
 * Mark a thread as read for the calling user. Upserts `lastReadAt = Date.now()` in
 * `aiChatThreadReadState`, which the `listThreads` query reads to compute the per-thread `unread`
 * flag (driving the primary-colored dot on the bottom-bar tab). The web client fires this on
 * select/reopen and clears its optimistic-read override once the watcher confirms.
 */
export const markThreadRead = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, { threadId }): Promise<void> => {
    const identity = await requireAuth(ctx);

    const meta = await chatAgent.getThreadMetadata(ctx, { threadId });
    if (meta.userId !== identity.subject) {
      throw new ConvexError('Chat thread not found');
    }

    const existing = await ctx.db
      .query('aiChatThreadReadState')
      .withIndex('by_userId_threadId', (q) => q.eq('userId', identity.subject).eq('threadId', threadId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastReadAt: now });
    } else {
      await ctx.db.insert('aiChatThreadReadState', {
        userId: identity.subject,
        threadId,
        lastReadAt: now,
      });
    }
  },
});

/**
 * Internal: stamp `lastAssistantAt = Date.now()` for the (userId, threadId) read-state row.
 * Called from `sendMessage` once the agent's streamText resolves with at least one token, so
 * a thread that the user isn't currently viewing gets flagged unread the moment the response
 * lands. Upserts the row when missing.
 */
export const _markThreadAssistantPosted = internalMutation({
  args: {
    userId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, { userId, threadId }): Promise<void> => {
    const existing = await ctx.db
      .query('aiChatThreadReadState')
      .withIndex('by_userId_threadId', (q) => q.eq('userId', userId).eq('threadId', threadId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastAssistantAt: now });
    } else {
      await ctx.db.insert('aiChatThreadReadState', {
        userId,
        threadId,
        lastAssistantAt: now,
      });
    }
  },
});
