import { ConvexError, type Infer, v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../../activityLogs/helpers';
import { activityAttributionValidator } from '../../activityLogs/types';
import { requireUserProfile, requireWorkspaceAccess } from '../../lib/auth';
import { getCurrentDateForTimezone } from '../../lib/dates';
import { createScheduledTransactionRecord, defaultEntryModeForAccount } from '../../scheduledTransactions/helpers';
import { recordInitialOccurrence } from '../../scheduledTransactions/occurrences';
import { isValidIsoDate, nextOccurrence, nextOccurrenceAfter } from '../../scheduledTransactions/recurrence';
import {
  buildScheduledTransferMovements,
  entryModeValidator,
  recurrenceValidator,
} from '../../scheduledTransactions/types';

import { createTransferPair } from '../helpers';
import { buildSnapshotFromTransaction } from '../reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../reconciliation/reconcile';

export type CreateTransferTransactionArgs = {
  workspaceId: Id<'workspace'>;
  fromAccountId: Id<'bankAccount'>;
  toAccountId: Id<'bankAccount'>;
  amount: bigint;
  date: string;
  notes?: string;
  status?: 'pending' | 'cleared';
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  source?: Doc<'transaction'>['source'];
  reviewStatus?: 'reviewed' | 'needs_review';
  scheduledTransactionId?: Id<'scheduledTransaction'>;
};

export type CreateTransferTransactionResult = {
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
};

export async function createTransferTransactionImpl(
  ctx: MutationCtx,
  args: CreateTransferTransactionArgs
): Promise<CreateTransferTransactionResult> {
  if (args.amount <= 0n) {
    throw new ConvexError('Transfer amount must be positive');
  }

  const { fromTransactionId, toTransactionId } = await createTransferPair(ctx, {
    fromAccountId: args.fromAccountId,
    toAccountId: args.toAccountId,
    amount: args.amount,
    date: args.date,
    workspaceId: args.workspaceId,
    notes: args.notes,
    status: args.status,
    categoryId: args.categoryId,
    readyToAssign: args.readyToAssign,
    source: args.source,
    reviewStatus: args.reviewStatus,
    scheduledTransactionId: args.scheduledTransactionId,
  });

  const fromTransaction = await ctx.db.get(fromTransactionId);
  const toTransaction = await ctx.db.get(toTransactionId);

  if (!fromTransaction || !toTransaction) {
    throw new ConvexError('Failed to read back transfer transactions');
  }

  const fromSnapshot = await buildSnapshotFromTransaction(ctx, fromTransaction);
  const toSnapshot = await buildSnapshotFromTransaction(ctx, toTransaction);

  await reconcileTransactionSideEffects(ctx, null, fromSnapshot);
  await reconcileTransactionSideEffects(ctx, null, toSnapshot);

  return { fromTransactionId, toTransactionId };
}

/**
 * Create a transfer transaction between two bank accounts.
 *
 * Matches createRegularTransaction's scheduling contract:
 * - today/past without recurrence returns the source transaction id
 * - future date creates a scheduled transfer instead of entering the register
 * - today/past with recurrence creates the transfer now plus a schedule for the next occurrence
 */
export const transferCreationArgs = v.object({
  workspaceId: v.id('workspace'),
  fromAccountId: v.id('bankAccount'),
  toAccountId: v.id('bankAccount'),
  amount: v.int64(), // Positive number
  date: v.string(),
  notes: v.optional(v.string()),
  status: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
  categoryId: v.optional(v.id('category')),
  readyToAssign: v.optional(v.boolean()),
  recurrence: v.optional(recurrenceValidator),
  entryMode: v.optional(entryModeValidator),
});

export async function createTransferTransactionHandler(ctx: MutationCtx, args: Infer<typeof transferCreationArgs>) {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

  if (!isValidIsoDate(args.date)) {
    throw new ConvexError('date must be a valid YYYY-MM-DD date');
  }

  const { recurrence: recurrenceArg, entryMode: entryModeArg, ...createArgs } = args;
  const recurrence = recurrenceArg ?? 'once';
  const scheduledMovements = buildScheduledTransferMovements({
    amount: args.amount,
    categoryId: args.categoryId,
    readyToAssign: args.readyToAssign,
  });

  const workspace = await ctx.db.get(verifiedWorkspaceId);
  const timezone = workspace?.timezone;
  const today = getCurrentDateForTimezone(timezone);

  if (args.date > today) {
    const { userProfile } = await requireUserProfile(ctx);
    const scheduledTransactionId = await createScheduledTransactionRecord(ctx, {
      workspaceId: verifiedWorkspaceId,
      transactionType: 'transfer',
      bankAccountId: args.fromAccountId,
      transferToAccountId: args.toAccountId,
      notes: args.notes,
      entryStatus: args.status ?? 'pending',
      entryMode: entryModeArg ?? (await defaultEntryModeForAccount(ctx, args.fromAccountId)),
      movements: scheduledMovements,
      recurrence,
      anchorDate: args.date,
      nextDate: args.date,
      timezone,
      createdBy: userProfile._id,
    });
    return { scheduledTransactionId, nextDate: args.date };
  }

  const { fromTransactionId, toTransactionId } = await createTransferTransactionImpl(ctx, {
    ...createArgs,
    workspaceId: verifiedWorkspaceId,
  });
  const createdTransaction = await ctx.db.get(fromTransactionId);
  if (createdTransaction) {
    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_created',
      after: createdTransaction,
    });
  }

  if (recurrence !== 'once') {
    const { userProfile } = await requireUserProfile(ctx);
    const nextDate = nextOccurrenceAfter(
      nextOccurrence(args.date, recurrence, args.date),
      recurrence,
      args.date,
      today
    );
    const scheduledTransactionId = await createScheduledTransactionRecord(ctx, {
      workspaceId: verifiedWorkspaceId,
      transactionType: 'transfer',
      bankAccountId: args.fromAccountId,
      transferToAccountId: args.toAccountId,
      notes: args.notes,
      entryStatus: args.status ?? 'pending',
      entryMode: entryModeArg ?? (await defaultEntryModeForAccount(ctx, args.fromAccountId)),
      movements: scheduledMovements,
      recurrence,
      anchorDate: args.date,
      nextDate,
      timezone,
      createdBy: userProfile._id,
      executionCount: 1,
      lastEnteredAt: new Date().toISOString(),
      lastEnteredTransactionId: fromTransactionId,
    });
    await recordInitialOccurrence(ctx, scheduledTransactionId, fromTransactionId, args.date);
    return {
      transactionId: fromTransactionId,
      transferPairTransactionId: toTransactionId,
      scheduledTransactionId,
      nextDate,
    };
  }

  return fromTransactionId;
}

export const createTransferTransaction = mutation({
  args: transferCreationArgs,
  returns: v.union(
    v.id('transaction'),
    v.object({
      transactionId: v.optional(v.id('transaction')),
      transferPairTransactionId: v.optional(v.id('transaction')),
      scheduledTransactionId: v.id('scheduledTransaction'),
      nextDate: v.string(),
    })
  ),
  handler: createTransferTransactionHandler,
});

/**
 * Internal twin of `createTransferTransaction` used by the MCP action path. Workspace ownership is
 * already verified by the caller (the MCP executor runs `resolveWorkspaceForChatTool` before
 * dispatching). Returns both transaction ids so the MCP response can reference each side.
 */
export const createTransferForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    fromAccountId: v.id('bankAccount'),
    toAccountId: v.id('bankAccount'),
    amount: v.int64(),
    date: v.string(),
    notes: v.optional(v.string()),
    categoryId: v.optional(v.id('category')),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, args): Promise<{ fromTransactionId: Id<'transaction'>; toTransactionId: Id<'transaction'> }> => {
    if (args.amount <= 0n) {
      throw new ConvexError('Transfer amount must be positive');
    }

    const { fromTransactionId, toTransactionId } = await createTransferPair(ctx, {
      fromAccountId: args.fromAccountId,
      toAccountId: args.toAccountId,
      amount: args.amount,
      date: args.date,
      workspaceId: args.workspaceId,
      notes: args.notes,
      status: 'cleared',
      categoryId: args.categoryId,
      readyToAssign: false,
      // Agent-created transfers go to the review queue so the user can verify them before
      // they're considered final. Mirrors how regular MCP imports are inserted needs_review.
      reviewStatus: 'needs_review',
    });

    const fromTransaction = await ctx.db.get(fromTransactionId);
    const toTransaction = await ctx.db.get(toTransactionId);
    if (!fromTransaction || !toTransaction) {
      throw new ConvexError('Failed to read back transfer transactions');
    }

    const fromSnapshot = await buildSnapshotFromTransaction(ctx, fromTransaction);
    const toSnapshot = await buildSnapshotFromTransaction(ctx, toTransaction);
    await reconcileTransactionSideEffects(ctx, null, fromSnapshot);
    await reconcileTransactionSideEffects(ctx, null, toSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: args.workspaceId,
      context: await buildActivityContext(ctx, args.attribution),
      type: 'transaction_created',
      after: fromTransaction,
    });

    return { fromTransactionId, toTransactionId };
  },
});
