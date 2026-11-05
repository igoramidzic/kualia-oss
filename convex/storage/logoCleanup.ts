import { internalMutation } from '../_generated/server';

/**
 * Cleanup orphaned logo files
 * Deletes files that have been orphaned for more than 7 days
 * Runs weekly via cron job
 */
export const cleanupOrphanedLogos = internalMutation({
  handler: async (ctx) => {
    // 7 days in milliseconds
    const ORPHAN_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - ORPHAN_GRACE_PERIOD;

    // Query orphaned files older than 7 days
    // Process in batches to avoid timeout (max 100 at a time)
    const orphanedFiles = await ctx.db
      .query('uploadedFile')
      .withIndex('by_isOrphaned_orphanedAt', (q) => q.eq('isOrphaned', true).lt('orphanedAt', cutoffTime))
      .take(100);

    let deletedCount = 0;

    for (const file of orphanedFiles) {
      try {
        // Delete from storage
        await ctx.storage.delete(file.storageId);
        // Delete tracking record
        await ctx.db.delete(file._id);
        deletedCount++;
      } catch (error) {
        // Log error but continue with other files
        console.error(`Failed to delete orphaned file ${file._id}:`, error);
      }
    }

    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} orphaned logo files`);
    }

    // Return count for monitoring
    return { deletedCount, hasMore: orphanedFiles.length === 100 };
  },
});
