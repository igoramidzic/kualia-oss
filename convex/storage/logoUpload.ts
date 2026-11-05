import { v } from 'convex/values';

import { Id } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Generate an upload URL for the client to upload a file directly to Convex storage
 */
export const generateUploadUrl = mutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Save an uploaded logo file and return its URL
 * Called after the client uploads a file to the generated URL
 */
export const saveUploadedLogo = mutation({
  args: {
    workspaceId: v.id('workspace'),
    storageId: v.id('_storage'),
    entityType: v.union(v.literal('merchant'), v.literal('bankAccount')),
    entityId: v.union(v.id('merchant'), v.id('bankAccount')),
    mimeType: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, { workspaceId, storageId, entityType, entityId, mimeType, fileSize }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    // Validate file size (max 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
    if (fileSize > MAX_FILE_SIZE) {
      // Delete the uploaded file since it's too large
      await ctx.storage.delete(storageId);
      throw new Error('File size exceeds maximum of 5MB');
    }

    // Validate MIME type (only images)
    if (!mimeType.startsWith('image/')) {
      // Delete the uploaded file since it's not an image
      await ctx.storage.delete(storageId);
      throw new Error('Only image files are allowed');
    }

    // Record the upload in our tracking table
    await ctx.db.insert('uploadedFile', {
      storageId,
      workspaceId: verifiedWorkspaceId,
      entityType,
      entityId,
      mimeType,
      fileSize,
      createdAt: Date.now(),
      isOrphaned: false,
    });

    // Get the URL for the uploaded file
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error('Failed to get URL for uploaded file');
    }

    return url;
  },
});

/**
 * Mark existing logo uploads for an entity as orphaned
 * Called internally when a logo is being replaced or removed
 */
export const markLogoOrphaned = internalMutation({
  args: {
    entityType: v.union(v.literal('merchant'), v.literal('bankAccount')),
    entityId: v.union(v.id('merchant'), v.id('bankAccount')),
    newLogoUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { entityType, entityId, newLogoUrl }) => {
    // Find all non-orphaned uploads for this entity
    const uploads = await ctx.db
      .query('uploadedFile')
      .withIndex('by_entityType_entityId', (q) =>
        q.eq('entityType', entityType).eq('entityId', entityId as Id<'merchant'>)
      )
      .filter((q) => q.eq(q.field('isOrphaned'), false))
      .collect();

    // Mark them as orphaned, preserving the upload that matches the new logo URL
    const now = Date.now();
    for (const upload of uploads) {
      if (newLogoUrl) {
        const uploadUrl = await ctx.storage.getUrl(upload.storageId);
        if (uploadUrl === newLogoUrl) {
          continue;
        }
      }
      await ctx.db.patch(upload._id, {
        isOrphaned: true,
        orphanedAt: now,
      });
    }
  },
});
