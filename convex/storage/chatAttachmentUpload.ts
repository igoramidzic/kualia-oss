import type { GenericMutationCtx } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { DataModel } from '../_generated/dataModel';
import { internalMutation, internalQuery, mutation } from '../_generated/server';
import { requireAuth } from '../lib/auth';

/** Per-file cap enforced at upload-record time. Mirrored client-side for instant feedback. */
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 30;

const MAX_FILENAME_LENGTH = 255;
const MAX_MEDIA_TYPE_LENGTH = 100;

async function assertChatUploadRateLimit(ctx: GenericMutationCtx<DataModel>, userId: string): Promise<void> {
  const since = Date.now() - RATE_LIMIT_WINDOW_MS;
  const recent = await ctx.db
    .query('chatAttachment')
    .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId).gte('createdAt', since))
    .collect();
  if (recent.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    throw new ConvexError('Too many chat attachment uploads. Please wait a few minutes and try again.');
  }
}

export const generateChatAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    await assertChatUploadRateLimit(ctx, identity.subject);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Record a chat attachment after the client has POSTed the file to the upload URL. Establishes
 * ownership of the storageId so `sendMessage` can later refuse to read blobs that don't belong
 * to the caller, and enforces the per-file size cap (rejecting the blob if it's oversized so we
 * don't leak storage). Idempotent for the same user — a duplicate call no-ops; a different user
 * trying to claim the same storageId is rejected.
 */
export const recordChatAttachment = mutation({
  args: {
    storageId: v.id('_storage'),
    mediaType: v.string(),
    size: v.number(),
    filename: v.string(),
  },
  handler: async (ctx, { storageId, mediaType, size, filename }) => {
    const identity = await requireAuth(ctx);

    const existing = await ctx.db
      .query('chatAttachment')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first();
    if (existing) {
      if (existing.userId === identity.subject) return;
      throw new ConvexError('Attachment already claimed');
    }

    if (size <= 0 || size > MAX_CHAT_ATTACHMENT_BYTES) {
      await ctx.storage.delete(storageId).catch(() => undefined);
      throw new ConvexError('Attachment exceeds the 10 MB per-file size limit.');
    }

    await assertChatUploadRateLimit(ctx, identity.subject);

    await ctx.db.insert('chatAttachment', {
      storageId,
      userId: identity.subject,
      mediaType: mediaType.slice(0, MAX_MEDIA_TYPE_LENGTH),
      size,
      filename: filename.slice(0, MAX_FILENAME_LENGTH),
      createdAt: Date.now(),
    });
  },
});

/** Lookup used by `aiChat.sendMessage` to verify the caller owns each attached storageId. */
export const getChatAttachmentByStorageId = internalQuery({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    return await ctx.db
      .query('chatAttachment')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first();
  },
});

export const deleteChatAttachment = internalMutation({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { storageId }) => {
    try {
      await ctx.storage.delete(storageId);
    } catch (error) {
      console.error(`Failed to delete chat attachment ${storageId}:`, error);
    }
    const row = await ctx.db
      .query('chatAttachment')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
