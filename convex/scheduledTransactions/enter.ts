import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { recordTransactionActivity } from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { createRegularTransactionImpl } from '../transactions/mutations/createRegular';
import { createTransferTransactionImpl } from '../transactions/mutations/createTransfer';
import { settleOccurrence } from './occurrences';

import { getScheduledTransactionType, getScheduledTransferAmount } from './types';

export type EnterScheduledTransactionResult = {
  transactionId: Id<'transaction'>;
  transferPairTransactionId?: Id<'transaction'>;
  status: 'active' | 'completed';
  nextDate?: string;
};

/**
 * Materialize a scheduled transaction into the register as a real transaction, then advance
 * the schedule (or complete it for a 'once' recurrence).
 *
 * Advance policy:
 * - 'single': move exactly one occurrence forward. Used by the cron so that missed
 *   occurrences (e.g. after downtime) are each entered with their own historical due date.
 * - 'past_today': retained for caller compatibility; explicit entry now settles exactly
 *   one occurrence as well. Missed bills are never silently treated as skipped.
 */
export async function enterScheduledTransaction(
  ctx: MutationCtx,
  scheduled: Doc<'scheduledTransaction'>,
  opts: {
    date: string;
    timezone: string | undefined;
    reviewStatus: 'reviewed' | 'needs_review';
    advance: 'single' | 'past_today';
    activityContext?: ActivityContext;
  }
): Promise<EnterScheduledTransactionResult> {
  if (scheduled.isDeleted || scheduled.status !== 'active') {
    throw new ConvexError('Scheduled transaction is not active');
  }

  const bankAccountId = scheduled.bankAccountId;

  let transactionId: Id<'transaction'>;
  let transferPairTransactionId: Id<'transaction'> | undefined;

  if (getScheduledTransactionType(scheduled) === 'transfer') {
    if (!scheduled.transferToAccountId) {
      throw new ConvexError('Destination account is required for scheduled transfers');
    }

    const amount = getScheduledTransferAmount(scheduled.movements);
    const transferMovement = scheduled.movements[0];
    const result = await createTransferTransactionImpl(ctx, {
      workspaceId: scheduled.workspaceId,
      fromAccountId: bankAccountId,
      toAccountId: scheduled.transferToAccountId,
      amount,
      date: opts.date,
      notes: scheduled.notes,
      status: scheduled.entryStatus,
      categoryId: transferMovement?.categoryId,
      readyToAssign: transferMovement?.readyToAssign,
      source: 'scheduled',
      reviewStatus: opts.reviewStatus,
      scheduledTransactionId: scheduled._id,
    });

    transactionId = result.fromTransactionId;
    transferPairTransactionId = result.toTransactionId;
  } else {
    transactionId = await createRegularTransactionImpl(ctx, {
      workspaceId: scheduled.workspaceId,
      bankAccountId,
      date: opts.date,
      movements: scheduled.movements,
      merchantId: scheduled.merchantId,
      notes: scheduled.notes,
      status: scheduled.entryStatus,
      source: 'scheduled',
      reviewStatus: opts.reviewStatus,
      scheduledTransactionId: scheduled._id,
    });
  }

  if (opts.activityContext) {
    const enteredTransaction = await ctx.db.get(transactionId);
    if (enteredTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId: scheduled.workspaceId,
        context: opts.activityContext,
        type: 'scheduled_transaction_entered',
        after: enteredTransaction,
      });
    }
  }

  const entered = await ctx.db.get(transactionId);
  if (!entered) throw new ConvexError('Entered transaction not found');
  await settleOccurrence(ctx, scheduled, entered, scheduled.nextDate, { provenance: true });
  const advanced = await ctx.db.get(scheduled._id);
  if (!advanced) throw new ConvexError('Planned transaction not found');
  return {
    transactionId,
    transferPairTransactionId,
    status: advanced.status === 'completed' ? 'completed' : 'active',
    ...(advanced.status !== 'completed' ? { nextDate: advanced.nextDate } : {}),
  };
}
