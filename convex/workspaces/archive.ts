import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { requireWorkspaceManagementAccess } from '../lib/auth';
import { refreshSchedule } from '../scheduledTransactions/occurrences';
import { computeNextReminderAt, computeNextRunAt } from '../scheduledTransactions/recurrence';
import { getScheduledEntryMode } from '../scheduledTransactions/types';

const SCHEDULE_SYNC_BATCH_SIZE = 100;

export function scheduledScanFieldsForArchiveState(
  scheduled: Doc<'scheduledTransaction'>,
  args: { isArchived: boolean; timezone: string | undefined; now: number }
): Pick<Doc<'scheduledTransaction'>, 'nextRunAt' | 'nextReminderAt' | 'updatedAt'> {
  const updatedAt = new Date(args.now).toISOString();
  if (args.isArchived) {
    return { nextRunAt: undefined, nextReminderAt: undefined, updatedAt };
  }

  return {
    nextRunAt:
      scheduled.status === 'active' && getScheduledEntryMode(scheduled) === 'auto'
        ? computeNextRunAt(scheduled.nextDate, args.timezone)
        : undefined,
    nextReminderAt: computeNextReminderAt({
      nextDate: scheduled.nextDate,
      recurrence: scheduled.recurrence,
      anchorDate: scheduled.anchorDate,
      reminderEnabled: scheduled.reminderEnabled,
      reminderOffset: scheduled.reminderOffset,
      status: scheduled.status,
      timezone: args.timezone,
      now: args.now,
    }),
    updatedAt,
  };
}

/**
 * Archive or unarchive multiple workspaces
 * Archived workspaces stop syncing and don't send notifications
 */
export const archiveWorkspaces = mutation({
  args: {
    workspaceIds: v.array(v.id('workspace')),
    isArchived: v.boolean(),
  },
  handler: async (ctx, { workspaceIds, isArchived }) => {
    const timestamp = new Date().toISOString();

    // Validate user has access to all workspaces
    for (const workspaceId of workspaceIds) {
      await requireWorkspaceManagementAccess(ctx, workspaceId);

      const workspace = await ctx.db.get(workspaceId);
      if (!workspace || workspace.isDeleted) {
        throw new ConvexError('Workspace not found');
      }
    }

    // Batch update all workspaces
    await Promise.all(
      workspaceIds.map((id) =>
        ctx.db.patch(id, {
          isArchived,
          archivedAt: isArchived ? timestamp : undefined,
          updatedAt: timestamp,
        })
      )
    );

    await Promise.all(
      workspaceIds.map((workspaceId) =>
        ctx.scheduler.runAfter(0, internal.workspaces.archive.syncScheduledTransactionScanFields, {
          workspaceId,
          isArchived,
          cursor: null,
        })
      )
    );

    return { success: true, updatedCount: workspaceIds.length };
  },
});

/**
 * Remove archived schedules from cron indexes and restore their derived scan timestamps
 * when the workspace is unarchived. Pagination keeps large workspaces within mutation
 * limits, and the workspace-state check makes stale jobs harmless if the user toggles
 * archive state again while a batch is running.
 */
export const syncScheduledTransactionScanFields = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    isArchived: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx, args): Promise<{ done: boolean }> => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.isDeleted || (workspace.isArchived ?? false) !== args.isArchived) {
      return { done: true };
    }

    const page = await ctx.db
      .query('scheduledTransaction')
      .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', args.workspaceId).eq('isDeleted', false))
      .paginate({ cursor: args.cursor, numItems: SCHEDULE_SYNC_BATCH_SIZE });
    const now = Date.now();

    await Promise.all(
      page.page.map(async (scheduled) => {
        if (!args.isArchived && scheduled.status === 'active') {
          await refreshSchedule(ctx, scheduled._id);
          return;
        }
        await ctx.db.patch(
          scheduled._id,
          scheduledScanFieldsForArchiveState(scheduled, {
            isArchived: args.isArchived,
            timezone: workspace.timezone,
            now,
          })
        );
      })
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.workspaces.archive.syncScheduledTransactionScanFields, {
        workspaceId: args.workspaceId,
        isArchived: args.isArchived,
        cursor: page.continueCursor,
      });
    }

    return { done: page.isDone };
  },
});
