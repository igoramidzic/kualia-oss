import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type QueryCtx } from '../_generated/server';

import { computeNextReminderAt, getReminderOccurrenceDate } from './recurrence';
import { getScheduledTransactionType } from './types';

const MAX_REMINDERS_PER_RUN = 200;
const MAX_RESOLVED_REMINDER_LOOKAHEAD = 1000;

/**
 * Hourly cron: send due-date push reminders for scheduled (planned) transactions.
 *
 * Each schedule with reminders enabled stores nextReminderAt = 9am (workspace timezone)
 * `reminderOffset` days before its next occurrence.
 */
export const processScheduledReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const dueReminders = await ctx.runQuery(internal.scheduledTransactions.reminders.getDueScheduledReminders, {
      asOf: now,
      limit: MAX_REMINDERS_PER_RUN,
    });

    if (dueReminders.length === MAX_REMINDERS_PER_RUN) {
      console.warn(`[ScheduledReminderCron] Hit per-run cap of ${MAX_REMINDERS_PER_RUN}; remainder next run`);
    }

    for (const reminder of dueReminders) {
      try {
        if (reminder.sendReminder) {
          await ctx.runAction(internal.notifications.apnsActions.sendPlannedReminderForWorkspace, {
            workspaceId: reminder.workspaceId,
            merchantName: reminder.displayName,
            amount: reminder.amount,
            dueDate: reminder.nextDate,
            reminderType: reminder.reminderOffset,
            scheduledTransactionId: reminder.scheduledTransactionId,
          });
        }

        await ctx.runMutation(internal.scheduledTransactions.reminders.advanceScheduledReminder, {
          scheduledTransactionId: reminder.scheduledTransactionId,
          expectedReminderAt: reminder.reminderAt,
        });
      } catch (error: unknown) {
        console.error(`[ScheduledReminderCron] Failed to process ${reminder.scheduledTransactionId}:`, error);
      }
    }
  },
});

export const getDueScheduledReminders = internalQuery({
  args: {
    asOf: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => listDueScheduledReminders(ctx, args),
});

export async function listDueScheduledReminders(ctx: QueryCtx, args: { asOf: number; limit: number }) {
  // No moving lower bound: failed sends and reminders missed during an outage remain
  // eligible until advanceScheduledReminder runs after a successful send.
  const due = await ctx.db
    .query('scheduledTransaction')
    .withIndex('by_nextReminderAt', (q) => q.gt('nextReminderAt', 0).lte('nextReminderAt', args.asOf))
    .take(args.limit);

  const results = [];
  for (const scheduled of due) {
    if (
      scheduled.isDeleted ||
      scheduled.status !== 'active' ||
      !scheduled.reminderEnabled ||
      !scheduled.reminderOffset ||
      scheduled.nextReminderAt === undefined
    ) {
      continue;
    }

    const workspace = await ctx.db.get(scheduled.workspaceId);
    if (!workspace || workspace.isArchived) {
      continue;
    }

    // Notification label: merchant, transfer destination, or a generic fallback
    let displayName = 'Planned transaction';
    if (scheduled.merchantId) {
      const merchant = await ctx.db.get(scheduled.merchantId);
      displayName = merchant?.name ?? displayName;
    } else if (getScheduledTransactionType(scheduled) === 'transfer' && scheduled.transferToAccountId) {
      const toAccount = await ctx.db.get(scheduled.transferToAccountId);
      displayName = toAccount ? `Transfer to ${toAccount.name}` : 'Transfer';
    }

    const amount = scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    const occurrenceDate = getReminderOccurrenceDate(
      scheduled.nextReminderAt,
      scheduled.reminderOffset,
      workspace.timezone
    );
    const occurrence = await reminderOccurrence(ctx, scheduled, occurrenceDate);

    results.push({
      scheduledTransactionId: scheduled._id,
      workspaceId: scheduled.workspaceId,
      displayName,
      amount,
      nextDate: occurrenceDate,
      reminderOffset: scheduled.reminderOffset,
      reminderAt: scheduled.nextReminderAt,
      // Keep settled rows in the work queue so their stale timestamps advance instead
      // of permanently taking up the cron's first page of due reminders.
      sendReminder: !occurrence || occurrence.status === 'pending',
    });
  }
  return results;
}

async function reminderOccurrence(ctx: Pick<QueryCtx, 'db'>, scheduled: Doc<'scheduledTransaction'>, date: string) {
  const occurrence = await ctx.db
    .query('scheduledTransactionOccurrence')
    .withIndex('by_schedule_revision_date', (q) =>
      q
        .eq('scheduledTransactionId', scheduled._id)
        .eq('scheduleRevision', scheduled.scheduleRevision ?? 0)
        .eq('occurrenceDate', date)
    )
    .unique();
  return occurrence?.workspaceId === scheduled.workspaceId ? occurrence : null;
}

/** Reminder progression is independent of entry progression and never recreates entries. */
export async function computeNextUnresolvedReminderAt(
  ctx: Pick<QueryCtx, 'db'>,
  scheduled: Doc<'scheduledTransaction'>,
  timezone: string | undefined,
  now: number
): Promise<number | undefined> {
  let reminderAt = computeNextReminderAt({ ...scheduled, timezone, now });
  if (!scheduled.reminderOffset) return undefined;
  for (let i = 0; reminderAt !== undefined && i < MAX_RESOLVED_REMINDER_LOOKAHEAD; i++) {
    const date = getReminderOccurrenceDate(reminderAt, scheduled.reminderOffset, timezone);
    const occurrence = await reminderOccurrence(ctx, scheduled, date);
    if (!occurrence || occurrence.status === 'pending') return reminderAt;
    reminderAt = computeNextReminderAt({ ...scheduled, timezone, now: reminderAt });
  }
  // A pathological run of prepaid daily bills remains eligible for future advancement.
  // Due-time checking still suppresses any settled occurrence beyond this bounded scan.
  return reminderAt;
}

export const advanceScheduledReminder = internalMutation({
  args: {
    scheduledTransactionId: v.id('scheduledTransaction'),
    expectedReminderAt: v.optional(v.number()),
  },
  handler: async (ctx, { scheduledTransactionId, expectedReminderAt }) => {
    const scheduled = await ctx.db.get(scheduledTransactionId);
    if (
      !scheduled ||
      scheduled.isDeleted ||
      (expectedReminderAt !== undefined && scheduled.nextReminderAt !== expectedReminderAt)
    ) {
      return;
    }

    const workspace = await ctx.db.get(scheduled.workspaceId);
    // The just-fired reminder moment is in the past, so recomputing from now lands on the
    // following occurrence's reminder (or undefined for 'once')
    await ctx.db.patch(scheduledTransactionId, {
      nextReminderAt: await computeNextUnresolvedReminderAt(ctx, scheduled, workspace?.timezone, Date.now()),
    });
  },
});
