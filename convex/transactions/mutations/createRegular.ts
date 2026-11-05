import { ConvexError, type Infer, v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { type MutationCtx, mutation } from '../../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../../activityLogs/helpers';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { requireUserProfile, requireWorkspaceAccess } from '../../lib/auth';
import { getCurrentDateForTimezone } from '../../lib/dates';
import { updateMerchantSuggestionsFromTransaction } from '../../merchants/helpers';
import { createScheduledTransactionRecord, defaultEntryModeForAccount } from '../../scheduledTransactions/helpers';
import { recordInitialOccurrence } from '../../scheduledTransactions/occurrences';
import { isValidIsoDate, nextOccurrence, nextOccurrenceAfter } from '../../scheduledTransactions/recurrence';
import { entryModeValidator, recurrenceValidator } from '../../scheduledTransactions/types';

import { buildTransactionComputedFields } from '../helpers';
import { buildEmbeddedMovements } from '../reconciliation/buildMovements';
import { buildSnapshotFromTransaction } from '../reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../reconciliation/reconcile';

export type CreateRegularTransactionArgs = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  date: string;
  movements: Array<{
    amount: bigint;
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    notes?: string;
  }>;
  merchantId?: Id<'merchant'>;
  notes?: string;
  status?: 'pending' | 'cleared';
  source?: Doc<'transaction'>['source'];
  reviewStatus?: 'reviewed' | 'needs_review';
  // Link back to the schedule this transaction was entered from
  scheduledTransactionId?: Id<'scheduledTransaction'>;
};

/**
 * Shared body for creating a regular transaction with category assignments.
 * Workspace access must already have been verified by the caller. Used by the
 * in-app `createRegularTransaction` mutation (source `manual`, auto-reviewed)
 * and the public REST API (defaults to `needs_review`).
 */
export async function createRegularTransactionImpl(
  ctx: MutationCtx,
  args: CreateRegularTransactionArgs
): Promise<Id<'transaction'>> {
  // Validate bank account exists and belongs to workspace
  const bankAccount = await ctx.db.get(args.bankAccountId);
  if (!bankAccount || bankAccount.isDeleted) {
    throw new ConvexError('Bank account not found');
  }

  if (bankAccount.workspaceId !== args.workspaceId) {
    throw new ConvexError('Access denied to workspace');
  }

  // Build movements (NO side effects - just constructs movement data)
  const { embeddedMovements, totalAmount } = await buildEmbeddedMovements(ctx, {
    bankAccountId: args.bankAccountId,
    movements: args.movements,
    transactionType: 'regular',
  });

  // Build computed fields (movements with category names, searchText, totalAmount, hasUncategorized)
  const computedFields = await buildTransactionComputedFields(ctx, {
    merchantId: args.merchantId,
    bankAccountId: args.bankAccountId,
    transactionType: 'regular',
    movements: embeddedMovements,
    notes: args.notes,
  });

  // Determine status (default to cleared)
  const status = args.status ?? 'cleared';

  // Create the transaction
  const transactionId = await ctx.db.insert('transaction', {
    bankAccountId: args.bankAccountId,
    date: args.date,
    merchantId: args.merchantId,
    notes: args.notes,
    status,
    type: 'regular',
    isDeleted: false,
    source: args.source ?? 'manual',
    scheduledTransactionId: args.scheduledTransactionId,
    reviewStatus: args.reviewStatus ?? 'reviewed',
    updatedAt: new Date().toISOString(),
    workspaceId: args.workspaceId,
    dateYearMonth: dateToYearMonth(args.date),
    // Embedded movements and computed fields
    movements: computedFields.movements,
    searchText: computedFields.searchText,
    totalAmount: computedFields.totalAmount,
    hasUncategorized: computedFields.hasUncategorized,
    hasMissingPayee: computedFields.hasMissingPayee,
  });

  // Read back the inserted transaction and reconcile all side effects
  // (handles balance, category spending, RTA, merchant stats)
  const transaction = await ctx.db.get(transactionId);
  if (!transaction) {
    throw new ConvexError('Failed to read back inserted transaction');
  }
  const afterSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
  await reconcileTransactionSideEffects(ctx, null, afterSnapshot);

  // Update merchant suggestions if transaction has a merchant (not part of reconcile)
  if (args.merchantId) {
    const merchant = await ctx.db.get(args.merchantId);
    if (merchant) {
      const categoryId = args.movements[0]?.categoryId;
      const updatedSuggestions = updateMerchantSuggestionsFromTransaction(
        merchant.suggestedCategoryIds,
        categoryId,
        args.bankAccountId
      );
      await ctx.db.patch(args.merchantId, {
        suggestedCategoryIds: updatedSuggestions.suggestedCategoryIds,
        suggestedBankAccountId: updatedSuggestions.suggestedBankAccountId,
      });
    }
  }

  return transactionId;
}

/**
 * Create a regular transaction with category assignments.
 *
 * The date decides where it lands, relative to today in the workspace timezone:
 * - today or past: a real transaction is created (unchanged legacy behavior, returns the
 *   transaction id). If a recurrence is passed, a schedule is also created for the next
 *   occurrence.
 * - future: nothing enters the register; a scheduled transaction is created instead and
 *   auto-entered on its due date. Scheduled entries default to `pending` status since the
 *   money has not moved yet.
 *
 * Returns the plain transaction id for the legacy path (no recurrence, non-future date) so
 * existing clients keep working; the new paths return
 * `{ transactionId?, scheduledTransactionId, nextDate }`.
 */
export const regularCreationArgs = v.object({
  workspaceId: v.id('workspace'),
  bankAccountId: v.id('bankAccount'),
  date: v.string(),
  movements: v.array(
    v.object({
      amount: v.int64(),
      categoryId: v.optional(v.id('category')),
      readyToAssign: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    })
  ),
  merchantId: v.optional(v.id('merchant')),
  notes: v.optional(v.string()),
  status: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
  recurrence: v.optional(recurrenceValidator),
  entryMode: v.optional(entryModeValidator),
});

export async function createRegularTransactionHandler(ctx: MutationCtx, args: Infer<typeof regularCreationArgs>) {
  // Verify workspace access
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

  if (!isValidIsoDate(args.date)) {
    throw new ConvexError('date must be a valid YYYY-MM-DD date');
  }

  const { recurrence: recurrenceArg, entryMode: entryModeArg, ...createArgs } = args;
  const recurrence = recurrenceArg ?? 'once';

  const workspace = await ctx.db.get(verifiedWorkspaceId);
  const timezone = workspace?.timezone;
  const today = getCurrentDateForTimezone(timezone);

  // Future-dated: schedule it instead of entering it — scheduled transactions don't
  // count toward balances or budgets until their due date
  if (args.date > today) {
    const { userProfile } = await requireUserProfile(ctx);
    const scheduledTransactionId = await createScheduledTransactionRecord(ctx, {
      workspaceId: verifiedWorkspaceId,
      transactionType: 'regular',
      bankAccountId: args.bankAccountId,
      merchantId: args.merchantId,
      notes: args.notes,
      entryStatus: args.status ?? 'pending',
      entryMode: entryModeArg ?? (await defaultEntryModeForAccount(ctx, args.bankAccountId)),
      movements: args.movements,
      recurrence,
      anchorDate: args.date,
      nextDate: args.date,
      timezone,
      createdBy: userProfile._id,
    });
    return { scheduledTransactionId, nextDate: args.date };
  }

  const transactionId = await createRegularTransactionImpl(ctx, { ...createArgs, workspaceId: verifiedWorkspaceId });
  const createdTransaction = await ctx.db.get(transactionId);
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
      transactionType: 'regular',
      bankAccountId: args.bankAccountId,
      merchantId: args.merchantId,
      notes: args.notes,
      entryStatus: args.status ?? 'pending',
      entryMode: entryModeArg ?? (await defaultEntryModeForAccount(ctx, args.bankAccountId)),
      movements: args.movements,
      recurrence,
      anchorDate: args.date,
      nextDate,
      timezone,
      createdBy: userProfile._id,
      executionCount: 1,
      lastEnteredAt: new Date().toISOString(),
      lastEnteredTransactionId: transactionId,
    });
    await recordInitialOccurrence(ctx, scheduledTransactionId, transactionId, args.date);
    return { transactionId, scheduledTransactionId, nextDate };
  }

  return transactionId;
}

const regularCreationResult = v.union(
  v.id('transaction'),
  v.object({
    transactionId: v.optional(v.id('transaction')),
    scheduledTransactionId: v.id('scheduledTransaction'),
    nextDate: v.string(),
  })
);

export const createRegularTransaction = mutation({
  args: regularCreationArgs,
  returns: regularCreationResult,
  handler: createRegularTransactionHandler,
});
