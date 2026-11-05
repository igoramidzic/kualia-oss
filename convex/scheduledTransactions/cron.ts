import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { buildSystemActivityContextForWorkspace } from '../activityLogs/helpers';

import { enterScheduledTransaction } from './enter';
import { automaticOccurrenceDate, refreshSchedule } from './occurrences';
import { computeNextRunAt } from './recurrence';
import { getScheduledEntryMode, getScheduledTransactionType } from './types';

// Upper bound on schedules processed per hourly run; the next run picks up any remainder
const MAX_SCHEDULES_PER_RUN = 200;

// Upper bound on missed occurrences backfilled per schedule per run (keeps a single
// mutation's side-effect work bounded); the next run continues the catch-up
const MAX_CATCH_UP_ENTRIES = 25;

/**
 * Hourly cron: enter due scheduled transactions into the register.
 *
 * Each active schedule stores nextRunAt = 7am (workspace timezone) on its due date, so an
 * hourly scan of nextRunAt <= now enters transactions shortly after 7am local time
 * everywhere. Runs that were missed (downtime) self-heal: overdue schedules stay in the
 * scan window until every missed occurrence has been entered with its historical due date.
 */
export const processDueScheduledTransactions = internalAction({
  args: {},
  handler: async (ctx) => {
    const dueIds = await ctx.runQuery(internal.scheduledTransactions.cron.getDueScheduledTransactions, {
      asOf: Date.now(),
      limit: MAX_SCHEDULES_PER_RUN,
    });

    if (dueIds.length === MAX_SCHEDULES_PER_RUN) {
      console.warn(`[ScheduledTransactionCron] Hit per-run cap of ${MAX_SCHEDULES_PER_RUN}; remainder next run`);
    }

    for (const scheduledTransactionId of dueIds) {
      try {
        await ctx.runMutation(internal.scheduledTransactions.cron.enterDueScheduledTransaction, {
          scheduledTransactionId,
        });
      } catch (error: unknown) {
        console.error(`[ScheduledTransactionCron] Failed to enter ${scheduledTransactionId}:`, error);
      }
    }
  },
});

export const getDueScheduledTransactions = internalQuery({
  args: {
    asOf: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { asOf, limit }) => {
    const due = await ctx.db
      .query('scheduledTransaction')
      .withIndex('by_nextRunAt', (q) => q.gt('nextRunAt', 0).lte('nextRunAt', asOf))
      .take(limit);

    const results: (typeof due)[number]['_id'][] = [];
    for (const scheduled of due) {
      // Manual-mode rows never carry nextRunAt; the mode check is belt-and-braces
      if (scheduled.isDeleted || scheduled.status !== 'active' || getScheduledEntryMode(scheduled) !== 'auto') {
        continue;
      }
      // Skip archived workspaces without touching the schedule; it re-enters the scan
      // window if the workspace is ever unarchived
      const workspace = await ctx.db.get(scheduled.workspaceId);
      if (!workspace || workspace.isArchived) {
        continue;
      }
      results.push(scheduled._id);
    }
    return results;
  },
});

/**
 * Enter one due schedule, backfilling multiple missed occurrences if the cron was down.
 * Re-validates due-ness so a concurrent "enter now" or user edit isn't double-entered.
 */
export const enterDueScheduledTransaction = internalMutation({
  args: {
    scheduledTransactionId: v.id('scheduledTransaction'),
  },
  handler: async (ctx, { scheduledTransactionId }) => {
    let entered = 0;

    while (entered < MAX_CATCH_UP_ENTRIES) {
      const scheduled = await ctx.db.get(scheduledTransactionId);
      if (
        !scheduled ||
        scheduled.isDeleted ||
        scheduled.status !== 'active' ||
        getScheduledEntryMode(scheduled) !== 'auto' ||
        !scheduled.nextRunAt ||
        scheduled.nextRunAt > Date.now()
      ) {
        break;
      }

      // A deleted bank account can never be entered into; complete the schedule instead
      // of retrying every hour forever
      const bankAccount = await ctx.db.get(scheduled.bankAccountId);
      if (!bankAccount || bankAccount.isDeleted) {
        console.warn(`[ScheduledTransactionCron] Bank account gone for ${scheduledTransactionId}; completing schedule`);
        await ctx.db.patch(scheduledTransactionId, {
          status: 'completed',
          nextRunAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        break;
      }

      if (getScheduledTransactionType(scheduled) === 'transfer') {
        const transferToAccount = scheduled.transferToAccountId
          ? await ctx.db.get(scheduled.transferToAccountId)
          : null;
        if (!transferToAccount || transferToAccount.isDeleted) {
          console.warn(
            `[ScheduledTransactionCron] Transfer destination account gone for ${scheduledTransactionId}; completing schedule`
          );
          await ctx.db.patch(scheduledTransactionId, {
            status: 'completed',
            nextRunAt: undefined,
            updatedAt: new Date().toISOString(),
          });
          break;
        }
      }

      const workspace = await ctx.db.get(scheduled.workspaceId);
      const occurrenceDate = await automaticOccurrenceDate(ctx, scheduled);
      if (!occurrenceDate || computeNextRunAt(occurrenceDate, workspace?.timezone) > Date.now()) {
        await refreshSchedule(ctx, scheduled._id);
        break;
      }
      await enterScheduledTransaction(
        ctx,
        { ...scheduled, nextDate: occurrenceDate },
        {
          date: occurrenceDate,
          timezone: workspace?.timezone,
          // Auto-entered rows go through the same review flow as other machine-created
          // transactions (imports, chat); user-initiated entry paths mark 'reviewed'
          reviewStatus: 'needs_review',
          advance: 'single',
          activityContext: await buildSystemActivityContextForWorkspace(
            ctx,
            scheduled.workspaceId,
            'scheduled_transaction',
            scheduled.createdBy
          ),
        }
      );
      entered++;
    }

    return { entered };
  },
});
