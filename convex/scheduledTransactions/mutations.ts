import { ConvexError, v } from 'convex/values';
import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext } from '../activityLogs/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { getCurrentDateForTimezone } from '../lib/dates';
import { enterScheduledTransaction } from './enter';
import { validateScheduledTransactionTemplate } from './helpers';
import { captureLegacyOccurrenceDates, refreshSchedule, skipOccurrence } from './occurrences';
import { computeNextReminderAt, computeNextRunAt, isValidIsoDate, nextOccurrenceAfter } from './recurrence';
import {
  entryModeValidator,
  getScheduledEntryMode,
  getScheduledTransactionType,
  recurrenceValidator,
  scheduledMovementsValidator,
  scheduledReminderOffsetValidator,
  scheduledTransactionTypeValidator,
} from './types';

async function getOwnedScheduledTransaction(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  scheduledTransactionId: Id<'scheduledTransaction'>,
  includeDeleted = false
): Promise<Doc<'scheduledTransaction'>> {
  const scheduled = await ctx.db.get(scheduledTransactionId);
  if (!scheduled || (!includeDeleted && scheduled.isDeleted)) {
    throw new ConvexError('Scheduled transaction not found');
  }
  if (scheduled.workspaceId !== workspaceId) {
    throw new ConvexError('Access denied to workspace');
  }
  return scheduled;
}

type RestorableScheduledTransaction = Pick<
  Doc<'scheduledTransaction'>,
  'status' | 'entryMode' | 'nextDate' | 'recurrence' | 'anchorDate' | 'reminderEnabled' | 'reminderOffset'
>;

export function buildScheduledTransactionRestorePatch(
  scheduled: RestorableScheduledTransaction,
  timezone: string | undefined,
  now: number
): Partial<Doc<'scheduledTransaction'>> {
  return {
    isDeleted: false,
    deletedAt: undefined,
    nextRunAt:
      scheduled.status === 'active' && getScheduledEntryMode(scheduled) === 'auto'
        ? computeNextRunAt(scheduled.nextDate, timezone)
        : undefined,
    nextReminderAt: computeNextReminderAt({
      nextDate: scheduled.nextDate,
      recurrence: scheduled.recurrence,
      anchorDate: scheduled.anchorDate,
      reminderEnabled: scheduled.reminderEnabled,
      reminderOffset: scheduled.reminderOffset,
      status: scheduled.status,
      timezone,
      now,
    }),
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * Update a scheduled transaction. Re-dating to today/past must be explicit so callers can
 * ask the user before materializing the schedule:
 * - date in the future (workspace timezone): the schedule is re-dated and re-anchored
 * - date today or in the past with enterDue: the transaction is entered into the register with that date;
 *   a recurring schedule advances to its next occurrence after today, a 'once' schedule
 *   completes
 *
 * Entry mode, pause/resume, and reminders:
 * - entryMode 'auto' requires an account
 * - paused: true parks the schedule (no auto entry, no reminders, no overdue); false
 *   resumes it while retaining outstanding bills
 * - resuming automatic entry or enabling it starts automatic creation after today;
 *   outstanding manual bills remain visible for explicit entry or skipping
 */
export const updateScheduledTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    date: v.optional(v.string()),
    transactionType: v.optional(scheduledTransactionTypeValidator),
    bankAccountId: v.optional(v.id('bankAccount')),
    transferToAccountId: v.optional(v.union(v.id('bankAccount'), v.null())),
    merchantId: v.optional(v.union(v.id('merchant'), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    movements: v.optional(scheduledMovementsValidator),
    entryStatus: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
    entryMode: v.optional(entryModeValidator),
    recurrence: v.optional(recurrenceValidator),
    paused: v.optional(v.boolean()),
    reminderEnabled: v.optional(v.boolean()),
    reminderOffset: v.optional(v.union(scheduledReminderOffsetValidator, v.null())),
    enterDue: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const scheduled = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, args.scheduledTransactionId);

    if (scheduled.status === 'completed' && args.date === undefined) {
      throw new ConvexError('Scheduled transaction is completed; provide a new date to reactivate it');
    }

    if (args.date !== undefined && !isValidIsoDate(args.date)) {
      throw new ConvexError('date must be a valid YYYY-MM-DD date');
    }

    if (args.movements?.length === 0) {
      throw new ConvexError('At least one movement is required');
    }

    const workspace = await ctx.db.get(verifiedWorkspaceId);
    const timezone = workspace?.timezone;
    const today = getCurrentDateForTimezone(timezone);
    const shouldEnterDueDate = args.date !== undefined && args.date <= today;
    const transactionType = args.transactionType ?? getScheduledTransactionType(scheduled);

    if (shouldEnterDueDate && args.enterDue !== true) {
      throw new ConvexError(
        'Confirm entering this scheduled transaction before saving a date that is today or earlier'
      );
    }
    if (shouldEnterDueDate && args.paused === true) {
      throw new ConvexError('Cannot pause and enter a scheduled transaction in the same update');
    }

    if (transactionType === 'transfer' && args.merchantId !== undefined && args.merchantId !== null) {
      throw new ConvexError('Transfers do not support merchants');
    }

    const nextBankAccountId = args.bankAccountId ?? scheduled.bankAccountId;
    const nextTransferToAccountId =
      args.transferToAccountId !== undefined ? (args.transferToAccountId ?? undefined) : scheduled.transferToAccountId;
    const nextMovements = args.movements ?? scheduled.movements;
    const rawMerchantId = args.merchantId !== undefined ? (args.merchantId ?? undefined) : scheduled.merchantId;
    const nextMerchantId = transactionType === 'transfer' ? undefined : rawMerchantId;

    await validateScheduledTransactionTemplate(ctx, {
      workspaceId: verifiedWorkspaceId,
      bankAccountId: nextBankAccountId,
      transactionType,
      transferToAccountId: transactionType === 'transfer' ? nextTransferToAccountId : undefined,
      merchantId: nextMerchantId,
      movements: nextMovements,
    });

    const entryMode = args.entryMode ?? getScheduledEntryMode(scheduled);

    // Resolve status: re-dating reactivates, then an explicit paused flag wins
    let status: Doc<'scheduledTransaction'>['status'] = scheduled.status;
    if (args.date !== undefined) {
      status = 'active';
    }
    if (args.paused === true) {
      status = 'paused';
    } else if (args.paused === false && status === 'paused') {
      status = 'active';
    }

    // Resolve schedule dates: re-dating resets the recurrence anchor to the new date
    const recurrence = args.recurrence ?? scheduled.recurrence;
    let anchorDate = scheduled.anchorDate;
    let nextDate = scheduled.nextDate;
    if (args.date !== undefined) {
      anchorDate = args.date;
      nextDate = args.date;
    } else if (recurrence !== scheduled.recurrence) {
      anchorDate = nextDate;
    }

    // Keep unpaid bills visible, while automatic entry starts prospectively when enabled.
    let automaticEntryStartDate = scheduled.automaticEntryStartDate;
    if (args.date !== undefined || recurrence !== scheduled.recurrence) automaticEntryStartDate = undefined;
    if (
      !shouldEnterDueDate &&
      status === 'active' &&
      entryMode === 'auto' &&
      recurrence !== 'once' &&
      nextDate <= today
    ) {
      const resumed = args.paused === false && scheduled.status === 'paused';
      const switchedToAuto = args.entryMode === 'auto' && getScheduledEntryMode(scheduled) === 'manual';
      if (resumed || switchedToAuto)
        automaticEntryStartDate = nextOccurrenceAfter(nextDate, recurrence, anchorDate, today);
    }

    // Reminders: enabling without an offset defaults to a reminder on the due date
    const reminderEnabled = args.reminderEnabled ?? scheduled.reminderEnabled;
    let reminderOffset =
      args.reminderOffset !== undefined ? (args.reminderOffset ?? undefined) : scheduled.reminderOffset;
    if (reminderEnabled && !reminderOffset) {
      reminderOffset = 'on_due_date';
    }

    const patch: Partial<Doc<'scheduledTransaction'>> = {
      transactionType,
      bankAccountId: nextBankAccountId,
      transferToAccountId: transactionType === 'transfer' ? nextTransferToAccountId : undefined,
      merchantId: nextMerchantId,
      entryMode,
      status,
      recurrence,
      anchorDate,
      nextDate,
      ...(args.date !== undefined || (args.recurrence !== undefined && args.recurrence !== scheduled.recurrence)
        ? { scheduleRevision: (scheduled.scheduleRevision ?? 0) + 1, nextUnprocessedDate: nextDate }
        : nextDate !== scheduled.nextDate
          ? { nextUnprocessedDate: nextDate }
          : {}),
      reminderEnabled,
      reminderOffset,
      updatedAt: new Date().toISOString(),
    };
    if (args.notes !== undefined) {
      patch.notes = args.notes ?? undefined;
    }
    if (args.movements !== undefined) {
      patch.movements = nextMovements;
    }
    if (args.entryStatus !== undefined) {
      patch.entryStatus = args.entryStatus;
    }

    // Derived scan fields, recomputed from the final state
    patch.nextRunAt = status === 'active' && entryMode === 'auto' ? computeNextRunAt(nextDate, timezone) : undefined;
    patch.nextReminderAt = computeNextReminderAt({
      nextDate,
      recurrence,
      anchorDate,
      reminderEnabled,
      reminderOffset,
      status,
      timezone,
      now: Date.now(),
    });

    if (patch.scheduleRevision !== undefined) await captureLegacyOccurrenceDates(ctx, scheduled);
    await ctx.db.patch(scheduled._id, patch);
    await refreshSchedule(ctx, scheduled._id);

    if (shouldEnterDueDate) {
      const dueDate = args.date;
      if (dueDate === undefined) {
        throw new ConvexError('date is required to enter a scheduled transaction');
      }
      const updated = await ctx.db.get(scheduled._id);
      if (!updated) {
        throw new ConvexError('Scheduled transaction not found');
      }
      const result = await enterScheduledTransaction(ctx, updated, {
        date: dueDate,
        timezone,
        reviewStatus: 'reviewed',
        advance: 'past_today',
        activityContext: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
      });
      return {
        entered: true as const,
        scheduledTransactionId: scheduled._id,
        transactionId: result.transactionId,
        status: result.status,
        ...(result.nextDate !== undefined && { nextDate: result.nextDate }),
      };
    }

    return {
      entered: false as const,
      scheduledTransactionId: scheduled._id,
      status,
      nextDate,
    };
  },
});

/**
 * Skip exactly the current occurrence. Other unpaid occurrences remain outstanding;
 * a one-time schedule completes.
 */
export const skipScheduledTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    expectedNextDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const scheduled = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, args.scheduledTransactionId);

    if (scheduled.status !== 'active') {
      throw new ConvexError('Scheduled transaction is not active');
    }
    if (args.expectedNextDate !== undefined && args.expectedNextDate !== scheduled.nextDate) {
      throw new ConvexError('This plan has changed. Refresh it before skipping another occurrence');
    }

    const nowIso = new Date().toISOString();
    await ctx.db.insert('scheduledTransactionSkip', {
      workspaceId: verifiedWorkspaceId,
      scheduledTransactionId: scheduled._id,
      scheduleRevision: scheduled.scheduleRevision ?? 0,
      occurrenceDate: scheduled.nextDate,
      expectedAmount: scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n),
      isTransfer: getScheduledTransactionType(scheduled) === 'transfer',
      updatedAt: nowIso,
      isDeleted: false,
    });

    await skipOccurrence(ctx, scheduled);
    const advanced = await ctx.db.get(scheduled._id);
    if (!advanced) throw new ConvexError('Planned transaction not found');
    return {
      scheduledTransactionId: scheduled._id,
      status: advanced.status,
      ...(advanced.status === 'active' ? { nextDate: advanced.nextDate } : {}),
    };
  },
});

/**
 * Enter a scheduled transaction into the register ahead of its due date. The transaction
 * is created with today's date (workspace timezone); a recurring schedule bumps to the
 * next occurrence after its current due date, a 'once' schedule completes.
 */
export const enterScheduledTransactionNow = mutation({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    expectedNextDate: v.optional(v.string()),
  },
  returns: v.object({
    scheduledTransactionId: v.id('scheduledTransaction'),
    transactionId: v.id('transaction'),
    status: v.union(v.literal('active'), v.literal('completed')),
    nextDate: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const scheduled = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, args.scheduledTransactionId);

    if (scheduled.status !== 'active') {
      throw new ConvexError('Scheduled transaction is not active');
    }
    if (args.expectedNextDate !== undefined && args.expectedNextDate !== scheduled.nextDate) {
      throw new ConvexError('This plan has changed. Refresh it before recording another occurrence');
    }

    const workspace = await ctx.db.get(verifiedWorkspaceId);
    const timezone = workspace?.timezone;
    const today = getCurrentDateForTimezone(timezone);

    const result = await enterScheduledTransaction(ctx, scheduled, {
      date: today,
      timezone,
      reviewStatus: 'reviewed',
      advance: 'past_today',
      activityContext: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
    });

    const [entered, advanced, pair] = await Promise.all([
      ctx.db.get(result.transactionId),
      ctx.db.get(scheduled._id),
      result.transferPairTransactionId ? ctx.db.get(result.transferPairTransactionId) : null,
    ]);
    if (entered && advanced) {
      await ctx.db.patch(entered._id, {
        scheduledEntryUndo: {
          nextDate: scheduled.nextDate,
          executionCount: scheduled.executionCount,
          lastEnteredAt: scheduled.lastEnteredAt,
          lastEnteredTransactionId: scheduled.lastEnteredTransactionId,
          scheduleUpdatedAt: advanced.updatedAt,
          transactionUpdatedAt: entered.updatedAt,
          pairUpdatedAt: pair?.updatedAt,
          expiresAt: Date.now() + 60_000,
        },
      });
    }

    return {
      scheduledTransactionId: scheduled._id,
      transactionId: result.transactionId,
      status: result.status,
      ...(result.nextDate !== undefined && { nextDate: result.nextDate }),
    };
  },
});

export const undoScheduledTransactionEntry = mutation({
  args: { workspaceId: v.id('workspace'), transactionId: v.id('transaction') },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { workspaceId, transactionId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const transaction = await ctx.db.get(transactionId);
    const undo = transaction?.scheduledEntryUndo;
    if (
      !transaction ||
      transaction.workspaceId !== verifiedWorkspaceId ||
      transaction.isDeleted ||
      !undo ||
      undo.expiresAt < Date.now() ||
      !transaction.scheduledTransactionId ||
      transaction.source !== 'scheduled' ||
      transaction.updatedAt !== undo.transactionUpdatedAt ||
      transaction.linkedRawTransactionId ||
      transaction.status === 'reconciled'
    ) {
      throw new ConvexError('This entry can no longer be undone. Open the transaction to make changes.');
    }
    const schedule = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, transaction.scheduledTransactionId);
    if (
      schedule.lastEnteredTransactionId !== transactionId ||
      schedule.updatedAt !== undo.scheduleUpdatedAt ||
      schedule.executionCount !== undo.executionCount + 1
    ) {
      throw new ConvexError('This plan has changed since the entry was recorded.');
    }
    if (transaction.transferPairId) {
      const pair = await ctx.db.get(transaction.transferPairId);
      if (
        !pair ||
        pair.workspaceId !== verifiedWorkspaceId ||
        pair.isDeleted ||
        pair.updatedAt !== undo.pairUpdatedAt ||
        pair.scheduledTransactionId !== schedule._id ||
        pair.linkedRawTransactionId ||
        pair.status === 'reconciled'
      ) {
        throw new ConvexError('This transfer has changed since it was recorded.');
      }
    }
    // The existing deletion path reverses balances, envelopes and both transfer sides atomically.
    await ctx.runMutation(api.transactions.deleteTransaction, { workspaceId: verifiedWorkspaceId, transactionId });
    const workspace = await ctx.db.get(verifiedWorkspaceId);
    const restored = { ...schedule, nextDate: undo.nextDate, status: 'active' as const };
    await ctx.db.patch(schedule._id, {
      ...buildScheduledTransactionRestorePatch(restored, workspace?.timezone, Date.now()),
      nextDate: undo.nextDate,
      status: 'active',
      executionCount: undo.executionCount,
      lastEnteredAt: undo.lastEnteredAt,
      lastEnteredTransactionId: undo.lastEnteredTransactionId,
      updatedAt: new Date().toISOString(),
    });
    await refreshSchedule(ctx, schedule._id);
    await ctx.db.patch(transactionId, { scheduledEntryUndo: undefined });
    return { success: true };
  },
});

/**
 * Soft-delete a scheduled transaction. Already-entered transactions are unaffected.
 */
export const deleteScheduledTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const scheduled = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, args.scheduledTransactionId);

    const nowIso = new Date().toISOString();
    await ctx.db.patch(scheduled._id, {
      isDeleted: true,
      deletedAt: nowIso,
      nextRunAt: undefined,
      nextReminderAt: undefined,
      updatedAt: nowIso,
    });

    return { success: true };
  },
});

/**
 * Restore a soft-deleted scheduled transaction and rebuild the derived cron/reminder fields
 * cleared during deletion. Already-entered transactions are unaffected.
 */
export const restoreScheduledTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const scheduled = await getOwnedScheduledTransaction(ctx, verifiedWorkspaceId, args.scheduledTransactionId, true);

    if (!scheduled.isDeleted) {
      return { success: true };
    }

    const workspace = await ctx.db.get(verifiedWorkspaceId);
    const timezone = workspace?.timezone;
    const now = Date.now();

    await ctx.db.patch(scheduled._id, buildScheduledTransactionRestorePatch(scheduled, timezone, now));
    await refreshSchedule(ctx, scheduled._id);

    return { success: true };
  },
});
