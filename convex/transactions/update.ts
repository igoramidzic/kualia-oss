import { ConvexError, v } from 'convex/values';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx, mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { activityAttributionValidator } from '../activityLogs/types';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';
import { getCurrentDateForTimezone } from '../lib/dates';
import { updateMerchantSuggestionsFromTransaction } from '../merchants/helpers';
import {
  createScheduledTransactionRecord,
  defaultEntryModeForAccount,
  findAutoLinkScheduledMatch,
  removeScheduledMatchingCandidate,
  type ScheduledMatchCandidate,
  type ScheduledMatchInput,
  type ScheduledMatchingCache,
} from '../scheduledTransactions/helpers';
import {
  inferLegacyOccurrenceDate,
  nearestOccurrenceDate,
  recordInitialOccurrence,
  releaseOccurrence,
  settleOccurrence,
} from '../scheduledTransactions/occurrences';
import { isValidIsoDate, nextOccurrence, nextOccurrenceAfter } from '../scheduledTransactions/recurrence';
import {
  buildScheduledTransferMovements,
  type EntryMode,
  entryModeValidator,
  getScheduledTransactionType,
  type Recurrence,
  recurrenceValidator,
} from '../scheduledTransactions/types';

import {
  budgetChangeValidator,
  captureBudgetBalances,
  finishBudgetReceipt,
  transactionBudgetTargets,
} from './budgetReceipt';
import { buildTransactionComputedFields, validateMovements, validateTransferAccounts } from './helpers';
import { buildEmbeddedMovements } from './reconciliation/buildMovements';
import { buildSnapshotFromTransaction } from './reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from './reconciliation/reconcile';
import { convertFromTransferInternal, convertToTransferInternal, updateTransferInternal } from './transfer';

export type UpdateTransactionUpdates = {
  type?: 'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment';
  date?: string;
  merchantId?: Id<'merchant'> | null;
  notes?: string | null;
  bankAccountId?: Id<'bankAccount'>;
  movements?: Array<{
    amount: bigint;
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    notes?: string;
  }>;
  // Direct category fields are used when updating transfer pairs. Regular
  // transactions continue to express category changes through movements.
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  fromAccountId?: Id<'bankAccount'>;
  toAccountId?: Id<'bankAccount'>;
  status?: 'pending' | 'cleared' | 'reconciled';
  reviewStatus?: 'reviewed' | 'needs_review';
  preserveReviewStatus?: boolean;
  useOriginalStatement?: boolean;
  // Link to a planned (scheduled) transaction - set to ID to link, null to unlink
  linkedScheduledTransactionId?: Id<'scheduledTransaction'> | null;
  linkedScheduledOccurrenceDate?: string;
  recurrence?: Recurrence;
  entryMode?: EntryMode;
};

type UpdateTransactionResult = {
  success: boolean;
  pairedTransactionId?: Id<'transaction'>;
  scheduledTransactionId?: Id<'scheduledTransaction'>;
  nextDate?: string;
  convertedToScheduled?: boolean;
  deletedTransactionId?: Id<'transaction'>;
  deletedTransferPairTransactionId?: Id<'transaction'>;
};

export type BulkTransactionChanges = {
  merchantId?: Id<'merchant'>;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  bankAccountId?: Id<'bankAccount'>;
  date?: string;
  status?: 'pending' | 'cleared';
  notes?: string | null;
};

/**
 * Build the per-row update used by the common-patch mutation. Category changes
 * preserve each transaction's amount while intentionally collapsing a split
 * into the selected category, which matches the semantics of bulk categorize.
 */
export function buildBulkTransactionUpdates(
  transaction: Doc<'transaction'>,
  changes: BulkTransactionChanges
): UpdateTransactionUpdates {
  const updates: UpdateTransactionUpdates = {};

  if (changes.merchantId !== undefined) {
    updates.merchantId = changes.merchantId;
  }
  if (changes.date !== undefined) {
    updates.date = changes.date;
  }
  if (changes.status !== undefined) {
    updates.status = changes.status;
  }
  if (changes.notes !== undefined) {
    updates.notes = changes.notes;
  }

  if (changes.bankAccountId !== undefined) {
    if (transaction.type === 'transfer') {
      const totalAmount =
        transaction.totalAmount ?? transaction.movements.reduce((sum, movement) => sum + movement.amount, 0n);
      if (totalAmount < 0n) {
        updates.fromAccountId = changes.bankAccountId;
      } else {
        updates.toAccountId = changes.bankAccountId;
      }
    } else {
      updates.bankAccountId = changes.bankAccountId;
    }
  }

  if (changes.categoryId !== undefined || changes.readyToAssign !== undefined) {
    if (transaction.type === 'transfer') {
      updates.categoryId = changes.categoryId;
      updates.readyToAssign = changes.readyToAssign;
    } else {
      const totalAmount =
        transaction.totalAmount ?? transaction.movements.reduce((sum, movement) => sum + movement.amount, 0n);
      updates.movements = [
        {
          amount: totalAmount,
          categoryId: changes.categoryId,
          readyToAssign: changes.readyToAssign,
        },
      ];
    }
  }

  return updates;
}

function toScheduledEntryStatus(status: Doc<'transaction'>['status'] | 'pending' | 'cleared'): 'pending' | 'cleared' {
  return status === 'pending' ? 'pending' : 'cleared';
}

function scheduledMovementsFromTransaction(
  movements: Doc<'transaction'>['movements'] | NonNullable<UpdateTransactionUpdates['movements']>
) {
  return movements.map((movement) => ({
    amount: movement.amount,
    categoryId: movement.categoryId,
    readyToAssign: movement.readyToAssign,
    notes: movement.notes,
  }));
}

function sumMovements(movements: { amount: bigint }[]): bigint {
  return movements.reduce((sum, movement) => sum + movement.amount, 0n);
}

async function softDeleteTransactionAndPair(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>
): Promise<{ deletedTransferPairTransactionId?: Id<'transaction'> }> {
  const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
  const now = new Date().toISOString();
  let deletedTransferPairTransactionId: Id<'transaction'> | undefined;

  if (transaction.type === 'transfer' && transaction.transferPairId) {
    const pairedTransaction = await ctx.db.get(transaction.transferPairId);
    if (pairedTransaction && !pairedTransaction.isDeleted) {
      const pairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);
      await ctx.db.patch(pairedTransaction._id, {
        isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      });
      await reconcileTransactionSideEffects(ctx, pairedSnapshot, null);
      deletedTransferPairTransactionId = pairedTransaction._id;
    }
  }

  await ctx.db.patch(transaction._id, {
    isDeleted: true,
    deletedAt: now,
    updatedAt: now,
  });
  await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);

  return { deletedTransferPairTransactionId };
}

/**
 * Link an entered transaction to a planned occurrence. A transfer pair represents one
 * real-world transfer, so both halves carry the same schedule id while the occurrence is
 * consumed only once using the outflow half as the canonical history transaction.
 */
export async function updateLinkedScheduledTransaction(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  workspaceId: Id<'workspace'>,
  scheduledTransactionId: Id<'scheduledTransaction'> | null,
  occurrenceDate?: string
): Promise<void> {
  let pairedTransaction: Doc<'transaction'> | null = null;

  if (transaction.type === 'transfer') {
    if (!transaction.transferPairId) {
      throw new ConvexError('Transfer pair not found');
    }

    pairedTransaction = await ctx.db.get(transaction.transferPairId);
    if (
      !pairedTransaction ||
      pairedTransaction.isDeleted ||
      pairedTransaction.workspaceId !== workspaceId ||
      pairedTransaction.type !== 'transfer' ||
      pairedTransaction.transferPairId !== transaction._id
    ) {
      throw new ConvexError('Transfer pair not found');
    }
  }

  const linkedTransactions = pairedTransaction ? [transaction, pairedTransaction] : [transaction];
  const canonical =
    transaction.type === 'transfer'
      ? (linkedTransactions.find((linked) => linked.totalAmount < 0n) ?? transaction)
      : transaction;
  if (scheduledTransactionId === null) {
    await releaseOccurrence(ctx, canonical, true);
    return;
  }
  const scheduled = await ctx.db.get(scheduledTransactionId);
  if (!scheduled || scheduled.isDeleted || scheduled.workspaceId !== workspaceId) {
    throw new ConvexError('Planned transaction not found or access denied');
  }
  const alreadyLinked = linkedTransactions.some((linked) => linked.scheduledTransactionId === scheduled._id);
  const linked = linkedTransactions.find((item) => item.scheduledTransactionId === scheduled._id);
  const date =
    occurrenceDate ??
    (alreadyLinked && linked
      ? inferLegacyOccurrenceDate(scheduled, linked)
      : nearestOccurrenceDate(scheduled, canonical.date));
  const sameAssignment = alreadyLinked && linked && date === inferLegacyOccurrenceDate(scheduled, linked);
  // Future template edits never invalidate an unchanged historical assignment.
  if (sameAssignment && linked.scheduledOccurrenceDate) {
    for (const item of linkedTransactions) {
      if (item.scheduledTransactionId !== scheduled._id || item.scheduledOccurrenceDate !== date) {
        await ctx.db.patch(item._id, {
          scheduledTransactionId: scheduled._id,
          scheduledOccurrenceDate: date,
          scheduledOccurrenceRevision: linked.scheduledOccurrenceRevision ?? 0,
        });
      }
    }
    return;
  }
  if (!sameAssignment) {
    if (scheduled.status !== 'active') throw new ConvexError('Choose an active planned transaction');
    if (
      getScheduledTransactionType(scheduled) !== canonical.type ||
      scheduled.bankAccountId !== canonical.bankAccountId ||
      (canonical.type === 'transfer' && scheduled.transferToAccountId !== canonical.transferPairBankAccountId)
    ) {
      throw new ConvexError('Planned transaction must match the transaction type and accounts');
    }
    const expectedAmount = scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    if (
      canonical.totalAmount === 0n ||
      (canonical.type !== 'transfer' && expectedAmount < 0n !== canonical.totalAmount < 0n)
    ) {
      throw new ConvexError('Planned transaction must match the transaction direction');
    }
  }
  if (
    canonical.scheduledTransactionId &&
    (!alreadyLinked || date !== inferLegacyOccurrenceDate(scheduled, canonical))
  ) {
    await releaseOccurrence(ctx, canonical, true);
  }
  const latest = await ctx.db.get(scheduled._id);
  if (!latest) throw new ConvexError('Planned transaction not found');
  await settleOccurrence(ctx, latest, canonical, date, {
    alreadyCounted: alreadyLinked && !linked?.scheduledOccurrenceDate,
  });
}

export async function autoLinkImportedTransactionToScheduledMatch(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  workspaceId: Id<'workspace'>,
  input: ScheduledMatchInput,
  cache: ScheduledMatchingCache
): Promise<ScheduledMatchCandidate | null> {
  const match = findAutoLinkScheduledMatch(input, cache);
  if (!match) {
    return null;
  }

  await updateLinkedScheduledTransaction(
    ctx,
    transaction,
    workspaceId,
    match.scheduledTransaction._id,
    match.scheduledTransaction.nextDate
  );
  removeScheduledMatchingCandidate(cache, match.scheduledTransaction._id);
  return match;
}

async function createRegularScheduleFromTransaction(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  updates: UpdateTransactionUpdates,
  args: {
    workspaceId: Id<'workspace'>;
    recurrence: Recurrence;
    anchorDate: string;
    nextDate: string;
    timezone: string | undefined;
    executionCount?: number;
    lastEnteredAt?: string;
    lastEnteredTransactionId?: Id<'transaction'>;
  }
): Promise<Id<'scheduledTransaction'>> {
  const { userProfile } = await requireUserProfile(ctx);
  const merchantId = updates.merchantId !== undefined ? (updates.merchantId ?? undefined) : transaction.merchantId;
  const notes = updates.notes !== undefined ? (updates.notes ?? undefined) : transaction.notes;

  const scheduleAccountId = updates.bankAccountId ?? transaction.bankAccountId;
  return createScheduledTransactionRecord(ctx, {
    workspaceId: args.workspaceId,
    transactionType: 'regular',
    bankAccountId: scheduleAccountId,
    merchantId,
    notes,
    entryStatus: toScheduledEntryStatus(updates.status ?? transaction.status),
    entryMode: updates.entryMode ?? (await defaultEntryModeForAccount(ctx, scheduleAccountId)),
    movements: scheduledMovementsFromTransaction(updates.movements ?? transaction.movements),
    recurrence: args.recurrence,
    anchorDate: args.anchorDate,
    nextDate: args.nextDate,
    timezone: args.timezone,
    createdBy: userProfile._id,
    executionCount: args.executionCount,
    lastEnteredAt: args.lastEnteredAt,
    lastEnteredTransactionId: args.lastEnteredTransactionId,
  });
}

async function getTransferScheduleTemplate(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  updates: UpdateTransactionUpdates,
  preserveEditorFields = false
): Promise<{
  fromAccountId: Id<'bankAccount'>;
  toAccountId: Id<'bankAccount'>;
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
}> {
  if (transaction.type !== 'transfer' || !transaction.transferPairId) {
    throw new ConvexError('Transfer pair not found');
  }

  const pairedTransaction = await ctx.db.get(transaction.transferPairId);
  if (!pairedTransaction || pairedTransaction.isDeleted) {
    throw new ConvexError('Transfer pair not found');
  }

  const currentAmount = transaction.totalAmount ?? sumMovements(transaction.movements);
  const updatedAmount = updates.movements ? sumMovements(updates.movements) : currentAmount;
  const currentIsFrom = currentAmount < 0n;
  const updatedIsFrom = updatedAmount < 0n;

  let fromTransaction = currentIsFrom ? transaction : pairedTransaction;
  let toTransaction = currentIsFrom ? pairedTransaction : transaction;

  if (updatedAmount !== 0n && updatedIsFrom !== currentIsFrom) {
    const originalFrom = fromTransaction;
    fromTransaction = toTransaction;
    toTransaction = originalFrom;
  }

  const existingTemplateMovement =
    transaction.movements.find((movement) => movement.categoryId !== undefined || movement.readyToAssign) ??
    pairedTransaction.movements.find((movement) => movement.categoryId !== undefined || movement.readyToAssign) ??
    transaction.movements[0] ??
    pairedTransaction.movements[0];
  // Editor amount patches contain only the amount; category changes use the
  // direct fields and must not erase an unchanged category when scheduling.
  const templateMovement = preserveEditorFields
    ? existingTemplateMovement
    : (updates.movements?.[0] ?? existingTemplateMovement);

  const amount = updatedAmount < 0n ? -updatedAmount : updatedAmount;
  const hasCategoryUpdate =
    preserveEditorFields && (updates.categoryId !== undefined || updates.readyToAssign !== undefined);

  return {
    fromAccountId: updates.fromAccountId ?? fromTransaction.bankAccountId,
    toAccountId: updates.toAccountId ?? toTransaction.bankAccountId,
    amount,
    categoryId: hasCategoryUpdate ? updates.categoryId : templateMovement?.categoryId,
    readyToAssign: hasCategoryUpdate ? (updates.readyToAssign ?? false) : templateMovement?.readyToAssign,
    fromTransactionId: fromTransaction._id,
    toTransactionId: toTransaction._id,
  };
}

async function createTransferScheduleFromTransaction(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  updates: UpdateTransactionUpdates,
  args: {
    workspaceId: Id<'workspace'>;
    recurrence: Recurrence;
    anchorDate: string;
    nextDate: string;
    timezone: string | undefined;
    executionCount?: number;
    lastEnteredAt?: string;
  },
  preserveEditorFields = false
): Promise<{
  scheduledTransactionId: Id<'scheduledTransaction'>;
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
}> {
  const { userProfile } = await requireUserProfile(ctx);
  const template = await getTransferScheduleTemplate(ctx, transaction, updates, preserveEditorFields);
  const notes = updates.notes !== undefined ? (updates.notes ?? undefined) : transaction.notes;
  const scheduledTransactionId = await createScheduledTransactionRecord(ctx, {
    workspaceId: args.workspaceId,
    transactionType: 'transfer',
    bankAccountId: template.fromAccountId,
    transferToAccountId: template.toAccountId,
    notes,
    entryStatus: toScheduledEntryStatus(updates.status ?? transaction.status),
    entryMode: updates.entryMode ?? (await defaultEntryModeForAccount(ctx, template.fromAccountId)),
    movements: buildScheduledTransferMovements({
      amount: template.amount,
      categoryId: template.categoryId,
      readyToAssign: template.readyToAssign,
    }),
    recurrence: args.recurrence,
    anchorDate: args.anchorDate,
    nextDate: args.nextDate,
    timezone: args.timezone,
    createdBy: userProfile._id,
    executionCount: args.executionCount,
    lastEnteredAt: args.lastEnteredAt,
    lastEnteredTransactionId: args.executionCount ? template.fromTransactionId : undefined,
  });

  return {
    scheduledTransactionId,
    fromTransactionId: template.fromTransactionId,
    toTransactionId: template.toTransactionId,
  };
}

async function createScheduleFromEnteredTransaction(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  updates: UpdateTransactionUpdates,
  args: {
    workspaceId: Id<'workspace'>;
    recurrence: Recurrence;
    timezone: string | undefined;
    today: string;
  },
  preserveEditorFields = false
): Promise<{ scheduledTransactionId: Id<'scheduledTransaction'>; nextDate: string }> {
  await releaseOccurrence(ctx, transaction, true);

  const nextDate = nextOccurrenceAfter(
    nextOccurrence(transaction.date, args.recurrence, transaction.date),
    args.recurrence,
    transaction.date,
    args.today
  );
  const lastEnteredAt = new Date().toISOString();

  if (transaction.type === 'regular') {
    const scheduledTransactionId = await createRegularScheduleFromTransaction(ctx, transaction, updates, {
      workspaceId: args.workspaceId,
      recurrence: args.recurrence,
      anchorDate: transaction.date,
      nextDate,
      timezone: args.timezone,
      executionCount: 1,
      lastEnteredAt,
      lastEnteredTransactionId: transaction._id,
    });
    await recordInitialOccurrence(ctx, scheduledTransactionId, transaction._id, transaction.date);
    return { scheduledTransactionId, nextDate };
  }

  if (transaction.type === 'transfer') {
    const result = await createTransferScheduleFromTransaction(
      ctx,
      transaction,
      updates,
      {
        workspaceId: args.workspaceId,
        recurrence: args.recurrence,
        anchorDate: transaction.date,
        nextDate,
        timezone: args.timezone,
        executionCount: 1,
        lastEnteredAt,
      },
      preserveEditorFields
    );
    await recordInitialOccurrence(ctx, result.scheduledTransactionId, result.fromTransactionId, transaction.date);
    return { scheduledTransactionId: result.scheduledTransactionId, nextDate };
  }

  throw new ConvexError('Only regular transactions and transfers can be scheduled');
}

/**
 * Update a transaction (supports type conversions and all transaction types)
 */
const updateTransactionArgs = {
  workspaceId: v.id('workspace'),
  transactionId: v.id('transaction'),
  // Optional type for conversion
  type: v.optional(
    v.union(v.literal('regular'), v.literal('transfer'), v.literal('starting_balance'), v.literal('balance_adjustment'))
  ),
  date: v.optional(v.string()),
  merchantId: v.optional(v.union(v.id('merchant'), v.null())),
  notes: v.optional(v.union(v.string(), v.null())),
  // Regular transaction fields
  bankAccountId: v.optional(v.id('bankAccount')),
  movements: v.optional(
    v.array(
      v.object({
        amount: v.int64(),
        categoryId: v.optional(v.id('category')),
        readyToAssign: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      })
    )
  ),
  // Transfer-specific fields
  fromAccountId: v.optional(v.id('bankAccount')),
  toAccountId: v.optional(v.id('bankAccount')),
  // Transaction status
  status: v.optional(v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled'))),
  reviewStatus: v.optional(v.union(v.literal('reviewed'), v.literal('needs_review'))),
  preserveReviewStatus: v.optional(v.boolean()),
  // Use original statement from import details to find/create merchant
  useOriginalStatement: v.optional(v.boolean()),
  // Planned (scheduled) transaction link - set to ID to link, null to unlink
  linkedScheduledTransactionId: v.optional(v.union(v.id('scheduledTransaction'), v.null())),
  linkedScheduledOccurrenceDate: v.optional(v.string()),
  // Schedule recurrence - future dates become scheduled transactions; non-once recurrence
  // on an entered transaction creates the next scheduled occurrence.
  recurrence: v.optional(recurrenceValidator),
  entryMode: v.optional(entryModeValidator),
};

export const updateTransaction = mutation({
  args: updateTransactionArgs,
  handler: async (ctx, { workspaceId, transactionId, ...updates }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const before = await ctx.db.get(transactionId);
    const result = await updateTransactionInternal(ctx, verifiedWorkspaceId, transactionId, updates);
    const after = await ctx.db.get(transactionId);
    if (before && after) {
      await recordTransactionActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'transaction_updated',
        before,
        after,
      });
    }
    return result;
  },
});

/** Atomic editor saves are opt-in so existing clients retain their update behavior. */
export const updateTransactionFromEditor = mutation({
  args: {
    ...v.object(updateTransactionArgs).omit('type').fields,
    type: v.optional(v.union(v.literal('regular'), v.literal('transfer'))),
    includeBudgetChanges: v.optional(v.boolean()),
    categoryId: v.optional(v.id('category')),
    readyToAssign: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    transactionId: v.optional(v.id('transaction')),
    budgetChanges: v.optional(v.array(budgetChangeValidator)),
    pairedTransactionId: v.optional(v.id('transaction')),
    scheduledTransactionId: v.optional(v.id('scheduledTransaction')),
    nextDate: v.optional(v.string()),
    convertedToScheduled: v.optional(v.boolean()),
    deletedTransactionId: v.optional(v.id('transaction')),
    deletedTransferPairTransactionId: v.optional(v.id('transaction')),
  }),
  handler: async (ctx, { workspaceId, transactionId, includeBudgetChanges, type, ...updates }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const before = await ctx.db.get(transactionId);
    if (!before || before.isDeleted || before.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Transaction not found in this workspace');
    }
    const budgetBefore = includeBudgetChanges
      ? await captureBudgetBalances(
          ctx,
          verifiedWorkspaceId,
          await transactionBudgetTargets(
            ctx,
            verifiedWorkspaceId,
            [
              transactionId,
              ...(before.suggestedTransfer?.status === 'linked_pending_approval' &&
              before.suggestedTransfer.matchedTransactionId
                ? [before.suggestedTransfer.matchedTransactionId]
                : []),
            ],
            updates
          )
        )
      : undefined;
    const editedId = await resolveEditorTransferType(ctx, verifiedWorkspaceId, before, type, updates);
    const beforeEdit = editedId === transactionId ? before : await ctx.db.get(editedId);
    const result = await updateTransactionInternal(ctx, verifiedWorkspaceId, editedId, updates, {
      preserveEditorFields: true,
    });
    const after = await ctx.db.get(editedId);
    if (beforeEdit && after) {
      await recordTransactionActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'transaction_updated',
        before: beforeEdit,
        after,
      });
    }
    return {
      ...result,
      transactionId: editedId,
      ...(budgetBefore ? { budgetChanges: await finishBudgetReceipt(ctx, verifiedWorkspaceId, budgetBefore) } : {}),
    };
  },
});

/** Resolve conversion and suggestion approval in the same transaction as all editor fields. */
export async function resolveEditorTransferType(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  before: Doc<'transaction'>,
  type: 'regular' | 'transfer' | undefined,
  updates: UpdateTransactionUpdates
): Promise<Id<'transaction'>> {
  if (
    type === 'transfer' &&
    before.type === 'transfer' &&
    !before.transferPairId &&
    before.suggestedTransfer?.status === 'approved_no_destination'
  ) {
    const counterpart = before.totalAmount > 0n ? updates.fromAccountId : updates.toAccountId;
    if (!counterpart) throw new ConvexError('Choose the other account');
    const approval: { success: boolean; transactionId: Id<'transaction'> } = await ctx.runMutation(
      api.transferDetection.approveTransferSuggestion,
      { workspaceId, transactionId: before._id, counterpartAccountId: counterpart }
    );
    return approval.transactionId;
  }
  if (!type || type === before.type) return before._id;
  if (before.type !== 'regular' && before.type !== 'transfer') {
    throw new ConvexError('Balance entries cannot be converted to transfers');
  }
  if (type === 'regular') {
    await convertFromTransferInternal(ctx, { transactionId: before._id });
    return before._id;
  }

  // Account fields are directional; retain the side the user actually opened.
  const editedAmount = updates.movements?.reduce((sum, movement) => sum + movement.amount, 0n) ?? before.totalAmount;
  if (editedAmount === 0n) throw new ConvexError('Transfer amount must be non-zero');
  const incoming = editedAmount > 0n;
  const changesDirection = incoming !== before.totalAmount > 0n;
  const ownAccount = (incoming ? updates.toAccountId : updates.fromAccountId) ?? before.bankAccountId;
  const counterpart = incoming ? updates.fromAccountId : updates.toAccountId;
  if (!counterpart) throw new ConvexError('Choose the other account');
  await validateTransferAccounts(ctx, ownAccount, counterpart, workspaceId);
  const other = await ctx.db.get(counterpart);
  if (other?.isClosed) throw new ConvexError('Choose an open destination account');

  let transaction = before;
  if (ownAccount !== before.bankAccountId || changesDirection) {
    await updateTransactionInternal(
      ctx,
      workspaceId,
      before._id,
      {
        bankAccountId: ownAccount,
        ...(changesDirection ? { movements: updates.movements } : {}),
        preserveReviewStatus: true,
      },
      { preserveEditorFields: true }
    );
    transaction = (await ctx.db.get(before._id)) ?? before;
  }
  const suggestion = transaction.suggestedTransfer;
  if (suggestion?.status === 'linked_pending_approval' && suggestion.matchedTransactionId) {
    const pair = await ctx.db.get(suggestion.matchedTransactionId);
    if (pair?.bankAccountId === counterpart) {
      await ctx.runMutation(api.transferDetection.approveLinkedTransfer, {
        workspaceId,
        transactionId: before._id,
      });
      return before._id;
    }
  } else if (suggestion?.status === 'pending') {
    const approval: { success: boolean; transactionId: Id<'transaction'> } = await ctx.runMutation(
      api.transferDetection.approveTransferSuggestion,
      { workspaceId, transactionId: before._id, counterpartAccountId: counterpart }
    );
    return approval.transactionId;
  }
  // A different destination declines the old match. Its imported counterpart remains a regular entry.
  if (suggestion?.status === 'linked_pending_approval') {
    await ctx.runMutation(api.transferDetection.rejectTransferSuggestion, {
      workspaceId,
      transactionId: before._id,
    });
  }
  await convertToTransferInternal(ctx, {
    transactionId: before._id,
    toAccountId: counterpart,
    preserveDirection: true,
  });
  return before._id;
}

/**
 * Shared body for `updateTransaction` and the MCP bulk-update path. Workspace access must already
 * have been verified by the caller — this function only re-checks per-row ownership.
 */
export async function updateTransactionInternal(
  ctx: MutationCtx,
  verifiedWorkspaceId: Id<'workspace'>,
  transactionId: Id<'transaction'>,
  updates: UpdateTransactionUpdates,
  options: { preserveEditorFields?: boolean } = {}
): Promise<UpdateTransactionResult> {
  {
    // Get the transaction
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.isDeleted) {
      throw new ConvexError('Transaction not found');
    }

    // Verify transaction belongs to the workspace
    if (transaction.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    if (options.preserveEditorFields) {
      for (const accountId of new Set([updates.bankAccountId, updates.fromAccountId, updates.toAccountId])) {
        if (accountId === undefined) continue;
        const account = await ctx.db.get(accountId);
        if (!account || account.isDeleted || account.workspaceId !== verifiedWorkspaceId) {
          throw new ConvexError('Bank account not found or access denied');
        }
      }
      if (updates.merchantId != null) {
        const merchant = await ctx.db.get(updates.merchantId);
        if (!merchant || merchant.isDeleted || merchant.workspaceId !== verifiedWorkspaceId) {
          throw new ConvexError('Payee not found or access denied');
        }
      }
      const categorySelections = [updates, ...(updates.movements ?? [])];
      for (const selection of categorySelections) {
        if (selection.categoryId !== undefined && selection.readyToAssign === true) {
          throw new ConvexError('A transaction cannot use a category and Ready to Assign at the same time');
        }
      }
      for (const categoryId of new Set(categorySelections.map((selection) => selection.categoryId))) {
        if (categoryId === undefined) continue;
        const category = await ctx.db.get(categoryId);
        if (!category || category.isDeleted || category.workspaceId !== verifiedWorkspaceId) {
          throw new ConvexError('Category not found or access denied');
        }
      }
    }

    // Auto-reject transfer suggestion when user edits the transaction
    // Any edit through updateTransaction implicitly means "this is not a transfer"
    // (Transfer approval happens through separate mutations: approveTransferSuggestion/approveLinkedTransfer)
    const suggestion = transaction.suggestedTransfer;
    const hasActionableSuggestion =
      suggestion && (suggestion.status === 'pending' || suggestion.status === 'linked_pending_approval');

    if (hasActionableSuggestion && suggestion) {
      const now = new Date().toISOString();

      // Reject the transfer suggestion
      await ctx.db.patch(transactionId, {
        suggestedTransfer: {
          transferConfidence: suggestion.transferConfidence,
          detectionReason: suggestion.detectionReason,
          accountConfidence: suggestion.accountConfidence,
          suggestedCounterpartAccountId: suggestion.suggestedCounterpartAccountId,
          matchedTransactionId: suggestion.matchedTransactionId,
          status: 'rejected' as const,
        },
        updatedAt: now,
      });

      // If there's a linked pair, unlink and reject it too
      if (suggestion.status === 'linked_pending_approval' && suggestion.matchedTransactionId) {
        const pairedTransaction = await ctx.db.get(suggestion.matchedTransactionId);
        if (
          pairedTransaction &&
          !pairedTransaction.isDeleted &&
          pairedTransaction.workspaceId === verifiedWorkspaceId &&
          pairedTransaction.suggestedTransfer?.status === 'linked_pending_approval' &&
          pairedTransaction.suggestedTransfer.matchedTransactionId === transactionId
        ) {
          const pairedSuggestion = pairedTransaction.suggestedTransfer;
          await ctx.db.patch(pairedTransaction._id, {
            suggestedTransfer: {
              transferConfidence: pairedSuggestion.transferConfidence,
              detectionReason: pairedSuggestion.detectionReason,
              accountConfidence: pairedSuggestion.accountConfidence,
              suggestedCounterpartAccountId: pairedSuggestion.suggestedCounterpartAccountId,
              matchedTransactionId: undefined,
              status: 'rejected' as const,
            },
            updatedAt: now,
          });

          // Update pending match for paired transaction
          const pairedPendingMatch = await ctx.db
            .query('pendingTransferMatch')
            .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', pairedTransaction._id))
            .first();
          if (pairedPendingMatch) {
            await ctx.db.patch(pairedPendingMatch._id, {
              status: 'user_rejected',
              updatedAt: now,
            });
          }
        }
      }

      // Update pending match record for this transaction
      const pendingMatch = await ctx.db
        .query('pendingTransferMatch')
        .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', transactionId))
        .first();
      if (pendingMatch) {
        await ctx.db.patch(pendingMatch._id, {
          status: 'user_rejected',
          updatedAt: now,
        });
      }
    }

    // Handle type conversion if type parameter is provided and different from current
    if ('type' in updates && updates.type && updates.type !== transaction.type) {
      if (updates.type === 'transfer') {
        // Converting to transfer
        if (!updates.toAccountId) {
          throw new ConvexError('Converting to transfer requires toAccountId');
        }
        return convertToTransferInternal(ctx, {
          transactionId,
          toAccountId: updates.toAccountId,
        });
      } else if (transaction.type === 'transfer') {
        // Converting from transfer to regular/other type
        return convertFromTransferInternal(ctx, {
          transactionId,
        });
      }
      // Other type conversions (e.g., regular <-> starting_balance) fall through
      // to the main update logic below. The type change is applied via patchData.
    }

    // Track the effective transaction type after any conversion
    // This is needed because later code paths may rebuild computed fields and need the updated type
    const effectiveType = 'type' in updates && updates.type ? updates.type : transaction.type;

    if (updates.date !== undefined && !isValidIsoDate(updates.date)) {
      throw new ConvexError('date must be a valid YYYY-MM-DD date');
    }

    const needsScheduleContext = updates.date !== undefined || updates.recurrence !== undefined;
    const workspace = needsScheduleContext ? await ctx.db.get(verifiedWorkspaceId) : null;
    const timezone = workspace?.timezone;
    const today = needsScheduleContext ? getCurrentDateForTimezone(timezone) : null;
    const nextDateForSchedule = updates.date ?? transaction.date;
    const recurrence = updates.recurrence ?? 'once';

    if (
      options.preserveEditorFields &&
      updates.linkedScheduledTransactionId !== undefined &&
      (recurrence !== 'once' || (updates.date !== undefined && today !== null && updates.date > today))
    ) {
      throw new ConvexError('Choose either an existing planned transaction or a new schedule');
    }

    if (updates.date !== undefined && today !== null && updates.date > today) {
      if (transaction.type !== 'regular' && transaction.type !== 'transfer') {
        throw new ConvexError('Only regular transactions and transfers can be scheduled');
      }

      await releaseOccurrence(ctx, transaction, true);

      const scheduledTransactionId =
        transaction.type === 'regular'
          ? await createRegularScheduleFromTransaction(ctx, transaction, updates, {
              workspaceId: verifiedWorkspaceId,
              recurrence,
              anchorDate: nextDateForSchedule,
              nextDate: nextDateForSchedule,
              timezone,
            })
          : (
              await createTransferScheduleFromTransaction(
                ctx,
                transaction,
                updates,
                {
                  workspaceId: verifiedWorkspaceId,
                  recurrence,
                  anchorDate: nextDateForSchedule,
                  nextDate: nextDateForSchedule,
                  timezone,
                },
                options.preserveEditorFields
              )
            ).scheduledTransactionId;

      const { deletedTransferPairTransactionId } = await softDeleteTransactionAndPair(ctx, transaction);

      return {
        success: true,
        convertedToScheduled: true,
        scheduledTransactionId,
        nextDate: nextDateForSchedule,
        deletedTransactionId: transaction._id,
        ...(deletedTransferPairTransactionId !== undefined && { deletedTransferPairTransactionId }),
      };
    }

    // Handle transfer-specific updates (if transaction is a transfer and not converting)
    if (transaction.type === 'transfer' && updates.type !== 'regular') {
      // Calculate amount from movements if provided, otherwise use existing transaction amount
      let transferAmount: bigint | undefined;
      if ('movements' in updates && updates.movements) {
        transferAmount = updates.movements.reduce((sum, m) => sum + m.amount, 0n);
      }

      // If any transfer-specific fields are being updated, use transfer update logic
      // Note: Transfers don't support merchants
      if (
        'fromAccountId' in updates ||
        'toAccountId' in updates ||
        transferAmount !== undefined ||
        'date' in updates ||
        'notes' in updates ||
        'categoryId' in updates ||
        'readyToAssign' in updates
      ) {
        const transferResult = await updateTransferInternal(ctx, {
          transactionId,
          fromAccountId: updates.fromAccountId,
          toAccountId: updates.toAccountId,
          amount: transferAmount,
          date: updates.date,
          notes: 'notes' in updates ? updates.notes : undefined,
          categoryId: updates.categoryId,
          readyToAssign: updates.readyToAssign,
          preserveMovementNotes: options.preserveEditorFields,
        });

        if (options.preserveEditorFields && updates.date !== undefined) {
          const dateYearMonth = dateToYearMonth(updates.date);
          await ctx.db.patch(transactionId, { dateYearMonth });
          if (transaction.transferPairId) {
            await ctx.db.patch(transaction.transferPairId, { dateYearMonth });
          }
        }

        const followUpReviewStatus =
          updates.reviewStatus ??
          (updates.preserveReviewStatus !== true && transaction.reviewStatus === 'needs_review'
            ? 'reviewed'
            : undefined);
        if (
          options.preserveEditorFields &&
          (updates.status !== undefined ||
            followUpReviewStatus !== undefined ||
            updates.linkedScheduledTransactionId !== undefined)
        ) {
          // Apply register metadata within this mutation before creating a recurrence,
          // which must inherit the final status and planned association.
          await updateTransactionInternal(
            ctx,
            verifiedWorkspaceId,
            transactionId,
            {
              ...(updates.status !== undefined && { status: updates.status }),
              ...(followUpReviewStatus !== undefined && { reviewStatus: followUpReviewStatus }),
              ...(updates.linkedScheduledTransactionId !== undefined && {
                linkedScheduledTransactionId: updates.linkedScheduledTransactionId,
                linkedScheduledOccurrenceDate: updates.linkedScheduledOccurrenceDate,
              }),
              preserveReviewStatus: true,
            },
            options
          );
        }

        if (updates.recurrence !== undefined && updates.recurrence !== 'once') {
          const updatedTransfer = await ctx.db.get(transactionId);
          if (!updatedTransfer || updatedTransfer.isDeleted) {
            throw new ConvexError('Transaction not found');
          }
          const schedule = await createScheduleFromEnteredTransaction(
            ctx,
            updatedTransfer,
            { entryMode: updates.entryMode },
            {
              workspaceId: verifiedWorkspaceId,
              recurrence: updates.recurrence,
              timezone,
              today: today ?? getCurrentDateForTimezone(timezone),
            },
            options.preserveEditorFields
          );
          return { ...transferResult, ...schedule };
        }

        if (!options.preserveEditorFields && (updates.status !== undefined || followUpReviewStatus !== undefined)) {
          await updateTransactionInternal(ctx, verifiedWorkspaceId, transactionId, {
            status: updates.status,
            reviewStatus: followUpReviewStatus,
            preserveReviewStatus: true,
          });
        }

        return transferResult;
      }
    }

    // === Regular transaction update logic ===

    // Validate current bank account
    const currentBankAccount = await ctx.db.get(transaction.bankAccountId);
    if (!currentBankAccount || currentBankAccount.isDeleted) {
      throw new ConvexError('Bank account not found');
    }
    if (currentBankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Handle bank account change validation
    let newBankAccount: Doc<'bankAccount'> | null = null;
    if ('bankAccountId' in updates && updates.bankAccountId) {
      newBankAccount = await ctx.db.get(updates.bankAccountId);
      if (!newBankAccount || newBankAccount.isDeleted) {
        throw new ConvexError('New bank account not found');
      }
      if (newBankAccount.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError('Access denied to new bank account');
      }
      if (newBankAccount._id === transaction.bankAccountId) {
        newBankAccount = null; // No change, ignore
      }

      // If this is a transfer transaction, validate that the new bank account
      // is not the same as the paired transaction's bank account
      if (newBankAccount && transaction.type === 'transfer' && transaction.transferPairId) {
        const pairedTransaction = await ctx.db.get(transaction.transferPairId);
        if (pairedTransaction && !pairedTransaction.isDeleted) {
          if (updates.bankAccountId === pairedTransaction.bankAccountId) {
            throw new ConvexError('Cannot transfer to the same account');
          }
        }
      }
    }

    // Validate movements if provided
    if ('movements' in updates && updates.movements) {
      const movementsTotal = updates.movements.reduce((sum, m) => sum + m.amount, 0n);
      validateMovements(movementsTotal, updates.movements);
    }

    // === Build beforeSnapshot BEFORE any mutations ===
    const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

    // === Build patchData ===
    const patchData: Partial<Doc<'transaction'>> & { updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };

    // Type conversion (regular <-> system types)
    if ('type' in updates && updates.type && updates.type !== transaction.type) {
      patchData.type = updates.type;
      const isConvertingToSystemType = updates.type === 'starting_balance' || updates.type === 'balance_adjustment';
      if (isConvertingToSystemType) {
        patchData.merchantId = undefined;
      }
    }

    if ('date' in updates) {
      patchData.date = updates.date;
      patchData.dateYearMonth = dateToYearMonth(updates.date!);
    }

    if ('notes' in updates) {
      patchData.notes = updates.notes === null ? undefined : updates.notes;
    }

    if ('status' in updates) {
      patchData.status = updates.status;

      // For transfers, also update paired transaction's status and reconcile its balance
      if (updates.status && updates.status !== transaction.status) {
        if (transaction.type === 'transfer' && transaction.transferPairId) {
          const pairedTransaction = await ctx.db.get(transaction.transferPairId);
          if (pairedTransaction && !pairedTransaction.isDeleted) {
            const beforePairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);
            await ctx.db.patch(pairedTransaction._id, {
              status: updates.status,
              updatedAt: new Date().toISOString(),
            });
            const updatedPaired = await ctx.db.get(pairedTransaction._id);
            if (updatedPaired) {
              const afterPairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
              await reconcileTransactionSideEffects(ctx, beforePairedSnapshot, afterPairedSnapshot);
            }
          }
        }
      }
    }

    // Auto-approve: When user edits a transaction that needs review, mark it as reviewed
    // unless the caller asks to preserve the current review status.
    const shouldPreserveReviewStatus = updates.preserveReviewStatus === true;
    const shouldAutoApprove =
      !shouldPreserveReviewStatus && transaction.reviewStatus === 'needs_review' && !('reviewStatus' in updates);
    if (shouldAutoApprove) {
      patchData.reviewStatus = 'reviewed';
    } else if ('reviewStatus' in updates) {
      patchData.reviewStatus = updates.reviewStatus;
    }

    // Check if we're marking as reviewed (either explicitly or via auto-approve)
    const isMarkingAsReviewed = patchData.reviewStatus === 'reviewed' && transaction.reviewStatus !== 'reviewed';

    // Clear originalApprovedAmount when approving a transaction
    if (isMarkingAsReviewed && transaction.originalApprovedAmount !== undefined) {
      patchData.originalApprovedAmount = undefined;
    }

    if (isMarkingAsReviewed) {
      // Auto-create merchant when marking as reviewed
      if (transaction.type === 'regular' && !transaction.merchantId && transaction.importDetails) {
        const merchantName = transaction.importDetails.merchantName ?? transaction.importDetails.originalStatement;

        if (merchantName?.trim()) {
          try {
            const normalizedName = merchantName.trim().toLowerCase();
            const existingMerchants = await ctx.db
              .query('merchant')
              .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
              .filter((q) => q.eq(q.field('isDeleted'), false))
              .collect();

            const duplicate = existingMerchants.find((m) => m.name?.toLowerCase() === normalizedName);

            if (duplicate) {
              patchData.merchantId = duplicate._id;
            } else {
              const merchantId = await ctx.db.insert('merchant', {
                name: merchantName.trim(),
                workspaceId: verifiedWorkspaceId,
                isDeleted: false,
                updatedAt: new Date().toISOString(),
              });
              patchData.merchantId = merchantId;
            }
          } catch (error: unknown) {
            console.error('Failed to auto-create merchant during review:', error);
          }
        }
      }
    }

    // Handle useOriginalStatement - find/create merchant from import details
    if (updates.useOriginalStatement && transaction.importDetails) {
      const merchantName = transaction.importDetails.merchantName ?? transaction.importDetails.originalStatement;

      if (merchantName?.trim()) {
        try {
          const normalizedName = merchantName.trim().toLowerCase();
          const existingMerchants = await ctx.db
            .query('merchant')
            .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
            .filter((q) => q.eq(q.field('isDeleted'), false))
            .collect();

          const duplicate = existingMerchants.find((m) => m.name?.toLowerCase() === normalizedName);

          if (duplicate) {
            patchData.merchantId = duplicate._id;
          } else {
            const merchantId = await ctx.db.insert('merchant', {
              name: merchantName.trim(),
              workspaceId: verifiedWorkspaceId,
              isDeleted: false,
              updatedAt: new Date().toISOString(),
            });
            patchData.merchantId = merchantId;
          }
        } catch (error: unknown) {
          console.error('Failed to find/create merchant from original statement:', error);
        }
      }
    }

    // Handle ID fields - only if explicitly provided
    if ('merchantId' in updates) {
      patchData.merchantId = updates.merchantId ?? undefined;
    }

    if ('bankAccountId' in updates && updates.bankAccountId) {
      patchData.bankAccountId = updates.bankAccountId;
    }

    // === Build movements ===
    const existingMovements = transaction.movements ?? [];
    const finalBankAccountId = newBankAccount?._id ?? transaction.bankAccountId;

    if (existingMovements.length === 0 && !('movements' in updates && updates.movements)) {
      throw new ConvexError('Transaction has no movements. Please provide movements in the update.');
    }

    let movementsForPatch: Awaited<ReturnType<typeof buildEmbeddedMovements>>['embeddedMovements'];

    if ('movements' in updates && updates.movements) {
      // Movements explicitly provided - rebuild with new data
      const { embeddedMovements } = await buildEmbeddedMovements(ctx, {
        bankAccountId: finalBankAccountId,
        movements: updates.movements.map((m) => ({
          amount: m.amount,
          categoryId: m.categoryId,
          readyToAssign: m.readyToAssign,
          notes: m.notes,
        })),
        transactionType: effectiveType,
      });
      movementsForPatch = embeddedMovements;
    } else if (newBankAccount) {
      // Bank account changed but movements not provided - rebuild existing movements
      // with the new bank account to handle CC metadata changes automatically
      const { embeddedMovements } = await buildEmbeddedMovements(ctx, {
        bankAccountId: finalBankAccountId,
        movements: existingMovements.map((m) => ({
          amount: m.amount,
          categoryId: m.categoryId,
          readyToAssign: m.readyToAssign,
          notes: m.notes,
        })),
        transactionType: effectiveType,
      });
      movementsForPatch = embeddedMovements;
    } else if ('type' in updates && updates.type && updates.type !== transaction.type) {
      // Type changed (regular <-> system) - rebuild movements to update readyToAssign
      const { embeddedMovements } = await buildEmbeddedMovements(ctx, {
        bankAccountId: finalBankAccountId,
        movements: existingMovements.map((m) => ({
          amount: m.amount,
          categoryId: m.categoryId,
          readyToAssign: m.readyToAssign,
          notes: m.notes,
        })),
        transactionType: effectiveType,
      });
      movementsForPatch = embeddedMovements;
    } else {
      // No movement changes needed - use existing movements as-is for computed fields
      movementsForPatch = existingMovements.map((m, i) => ({
        categoryId: m.categoryId,
        readyToAssign: m.readyToAssign,
        amount: m.amount,
        notes: m.notes,
        sortOrder: m.sortOrder ?? i,
        creditCardTransfer: m.creditCardTransfer,
      }));
    }

    // Build computed fields (searchText, totalAmount, hasUncategorized, hasMissingPayee)
    const effectiveMerchantId =
      'merchantId' in patchData
        ? patchData.merchantId
        : 'merchantId' in updates && updates.merchantId !== null
          ? updates.merchantId
          : transaction.merchantId;

    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: effectiveMerchantId,
      bankAccountId: finalBankAccountId,
      transactionType: effectiveType,
      notes: 'notes' in patchData ? patchData.notes : transaction.notes,
      movements: movementsForPatch,
    });

    // === Apply the patch ===
    await ctx.db.patch(transactionId, {
      ...patchData,
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      // The transfer helper already computes its cross-budget category state.
      // Metadata-only editor updates must not recompute it as a regular transfer.
      hasUncategorized:
        options.preserveEditorFields && transaction.type === 'transfer'
          ? transaction.hasUncategorized
          : computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
    });

    if (updates.linkedScheduledTransactionId !== undefined) {
      const finalTransaction = await ctx.db.get(transactionId);
      if (!finalTransaction) throw new ConvexError('Transaction not found');
      await updateLinkedScheduledTransaction(
        ctx,
        finalTransaction,
        verifiedWorkspaceId,
        updates.linkedScheduledTransactionId,
        updates.linkedScheduledOccurrenceDate
      );
    }

    // === Build afterSnapshot and reconcile ===
    const updatedTransaction = await ctx.db.get(transactionId);
    if (!updatedTransaction) {
      throw new ConvexError('Transaction not found');
    }
    const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
    await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);

    // === Update merchant suggestions (outside reconcile) ===
    const finalMerchantId = effectiveMerchantId;
    if (finalMerchantId) {
      const merchant = await ctx.db.get(finalMerchantId);
      if (merchant) {
        const categoryId =
          'movements' in updates && updates.movements
            ? updates.movements[0]?.categoryId
            : existingMovements[0]?.categoryId;
        const bankAccountId = finalBankAccountId;
        const updatedSuggestions = updateMerchantSuggestionsFromTransaction(
          merchant.suggestedCategoryIds,
          categoryId,
          bankAccountId
        );
        await ctx.db.patch(finalMerchantId, {
          suggestedCategoryIds: updatedSuggestions.suggestedCategoryIds,
          suggestedBankAccountId: updatedSuggestions.suggestedBankAccountId,
        });
      }
    }

    if (updates.recurrence !== undefined && updates.recurrence !== 'once') {
      const schedule = await createScheduleFromEnteredTransaction(
        ctx,
        updatedTransaction,
        { entryMode: updates.entryMode },
        {
          workspaceId: verifiedWorkspaceId,
          recurrence: updates.recurrence,
          timezone,
          today: today ?? getCurrentDateForTimezone(timezone),
        },
        options.preserveEditorFields
      );
      return { success: true, ...schedule };
    }

    return { success: true };
  }
}

/**
 * Apply one set of edits to multiple transactions. Specialized batch
 * mutations remain responsible for approve-only and status-only actions; this
 * mutation powers the shared Edit Details and Categorize surfaces.
 */
export const updateTransactions = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
    merchantId: v.optional(v.id('merchant')),
    categoryId: v.optional(v.id('category')),
    readyToAssign: v.optional(v.boolean()),
    bankAccountId: v.optional(v.id('bankAccount')),
    date: v.optional(v.string()),
    status: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { workspaceId, transactionIds, ...changes }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const hasChanges =
      changes.merchantId !== undefined ||
      changes.categoryId !== undefined ||
      changes.readyToAssign !== undefined ||
      changes.bankAccountId !== undefined ||
      changes.date !== undefined ||
      changes.status !== undefined ||
      changes.notes !== undefined;

    if (!hasChanges) {
      throw new ConvexError('Select at least one field to update');
    }
    if (changes.categoryId !== undefined && changes.readyToAssign === true) {
      throw new ConvexError('A transaction cannot use a category and Ready to Assign at the same time');
    }

    if (changes.merchantId !== undefined) {
      const merchant = await ctx.db.get(changes.merchantId);
      if (!merchant || merchant.isDeleted || merchant.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError('Payee not found or access denied');
      }
    }

    if (changes.categoryId !== undefined) {
      const category = await ctx.db.get(changes.categoryId);
      if (!category || category.isDeleted || category.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError('Category not found or access denied');
      }
    }

    if (changes.bankAccountId !== undefined) {
      const bankAccount = await ctx.db.get(changes.bankAccountId);
      if (!bankAccount || bankAccount.isDeleted || bankAccount.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError('Bank account not found or access denied');
      }
    }

    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });
    let updatedCount = 0;

    for (const transactionId of new Set(transactionIds)) {
      const transaction = await ctx.db.get(transactionId);
      if (!transaction || transaction.isDeleted || transaction.workspaceId !== verifiedWorkspaceId) {
        continue;
      }
      if (changes.merchantId !== undefined && transaction.type !== 'regular') {
        throw new ConvexError('Payee can only be updated on regular transactions');
      }

      await updateTransactionInternal(
        ctx,
        verifiedWorkspaceId,
        transactionId,
        buildBulkTransactionUpdates(transaction, changes)
      );

      const updatedTransaction = await ctx.db.get(transactionId);
      if (updatedTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context,
          type: 'transaction_updated',
          before: transaction,
          after: updatedTransaction,
        });
      }
      updatedCount += 1;
    }

    return { success: true, updatedCount };
  },
});

/**
 * MCP bulk-update entry point. Workspace ownership is verified by the caller; per-row failures do
 * not abort the batch (matches `softDeleteTransactionsForMcp`). Returns the ids that were updated,
 * the ids that could not be found / did not belong to the workspace, and any rows that failed mid
 * update with their error message.
 */
export const updateTransactionsForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    updates: v.array(
      v.object({
        transactionId: v.string(),
        type: v.optional(
          v.union(
            v.literal('regular'),
            v.literal('transfer'),
            v.literal('starting_balance'),
            v.literal('balance_adjustment')
          )
        ),
        date: v.optional(v.string()),
        merchantId: v.optional(v.union(v.id('merchant'), v.null())),
        notes: v.optional(v.union(v.string(), v.null())),
        bankAccountId: v.optional(v.id('bankAccount')),
        movements: v.optional(
          v.array(
            v.object({
              amount: v.int64(),
              categoryId: v.optional(v.id('category')),
              readyToAssign: v.optional(v.boolean()),
              notes: v.optional(v.string()),
            })
          )
        ),
        fromAccountId: v.optional(v.id('bankAccount')),
        toAccountId: v.optional(v.id('bankAccount')),
        status: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
        reviewStatus: v.optional(v.union(v.literal('reviewed'), v.literal('needs_review'))),
      })
    ),
    attribution: activityAttributionValidator,
  },
  handler: async (
    ctx,
    { workspaceId, updates, attribution }
  ): Promise<{
    updated: Id<'transaction'>[];
    notFound: string[];
    failed: Array<{ transactionId: string; message: string }>;
  }> => {
    const updated: Id<'transaction'>[] = [];
    const notFound: string[] = [];
    const failed: Array<{ transactionId: string; message: string }> = [];
    const context = await buildActivityContext(ctx, attribution);

    for (const update of updates) {
      const { transactionId: rawId, ...patch } = update;
      const transaction = await ctx.db.get(rawId as Id<'transaction'>).catch(() => null);
      if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspaceId) {
        notFound.push(rawId);
        continue;
      }

      let updateApplied = false;
      try {
        // The MCP/AI-chat path should NOT auto-approve `needs_review` transactions just because
        // the agent edited them — only in-app edits (where the user actively touches the row)
        // imply approval. Force `preserveReviewStatus` so the row keeps its current review status
        // unless the caller passed `reviewStatus` explicitly.
        await updateTransactionInternal(ctx, workspaceId, transaction._id, {
          ...(patch as UpdateTransactionUpdates),
          preserveReviewStatus: true,
        });
        updateApplied = true;
        const updatedTransaction = await ctx.db.get(transaction._id);
        if (updatedTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId,
            context,
            type: 'transaction_updated',
            before: transaction,
            after: updatedTransaction,
          });
        }
        updated.push(transaction._id);
      } catch (error: unknown) {
        if (updateApplied) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ transactionId: rawId, message });
      }
    }

    return { updated, notFound, failed };
  },
});

/**
 * Update status for multiple transactions in a batch
 * Silently skips reconciled transactions
 */
export const updateTransactionsStatus = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
    status: v.union(v.literal('pending'), v.literal('cleared')),
  },
  handler: async (ctx, { workspaceId, transactionIds, status }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    for (const transactionId of transactionIds) {
      try {
        const transaction = await ctx.db.get(transactionId);
        if (!transaction || transaction.isDeleted) {
          continue;
        }

        // Verify the transaction belongs to the workspace
        if (transaction.workspaceId !== verifiedWorkspaceId) {
          continue;
        }

        // Skip reconciled transactions silently
        if (transaction.status === 'reconciled') {
          continue;
        }

        // Skip if status is already the target
        if (transaction.status === status) {
          continue;
        }

        // Snapshot BEFORE update
        const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

        // Update status
        await ctx.db.patch(transactionId, {
          status,
          updatedAt: new Date().toISOString(),
        });

        // Snapshot AFTER update and reconcile
        const updatedTransaction = await ctx.db.get(transactionId);
        if (updatedTransaction) {
          const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
          await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);
        }

        // Handle transfer pairs - update both sides
        if (transaction.type === 'transfer' && transaction.transferPairId) {
          const pairedTransaction = await ctx.db.get(transaction.transferPairId);
          if (pairedTransaction && !pairedTransaction.isDeleted && pairedTransaction.status !== 'reconciled') {
            const beforePairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);

            await ctx.db.patch(pairedTransaction._id, {
              status,
              updatedAt: new Date().toISOString(),
            });

            const updatedPaired = await ctx.db.get(pairedTransaction._id);
            if (updatedPaired) {
              const afterPairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
              await reconcileTransactionSideEffects(ctx, beforePairedSnapshot, afterPairedSnapshot);
            }
          }
        }

        const activityTransaction = await ctx.db.get(transactionId);
        if (activityTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context,
            type: 'transaction_updated',
            before: transaction,
            after: activityTransaction,
          });
        }
      } catch (error: unknown) {
        console.error('Failed to update transaction status batch atomically:', error);
        throw error;
      }
    }

    return { success: true };
  },
});

/**
 * Approve (mark as reviewed) multiple transactions in a batch.
 * Encapsulates all single-approve logic: auto-create merchant, clear originalApprovedAmount,
 * auto-reject transfer suggestions, rebuild computed fields, and reconcile side effects.
 */
export const approveTransactions = mutation({
  args: {
    workspaceId: v.id('workspace'),
    transactionIds: v.array(v.id('transaction')),
  },
  handler: async (ctx, { workspaceId, transactionIds }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);
    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    for (const transactionId of transactionIds) {
      try {
        const transaction = await ctx.db.get(transactionId);
        if (!transaction || transaction.isDeleted) {
          continue;
        }

        // Verify the transaction belongs to the workspace
        if (transaction.workspaceId !== verifiedWorkspaceId) {
          continue;
        }

        // Skip if already reviewed (with no issues that would make it "need review")
        if (transaction.reviewStatus === 'reviewed' && !transaction.hasUncategorized && !transaction.hasMissingPayee) {
          continue;
        }

        // === Build beforeSnapshot BEFORE any mutations ===
        const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

        // === Auto-reject transfer suggestions ===
        const suggestion = transaction.suggestedTransfer;
        const hasActionableSuggestion =
          suggestion && (suggestion.status === 'pending' || suggestion.status === 'linked_pending_approval');

        if (hasActionableSuggestion && suggestion) {
          const now = new Date().toISOString();

          await ctx.db.patch(transactionId, {
            suggestedTransfer: {
              transferConfidence: suggestion.transferConfidence,
              detectionReason: suggestion.detectionReason,
              accountConfidence: suggestion.accountConfidence,
              suggestedCounterpartAccountId: suggestion.suggestedCounterpartAccountId,
              matchedTransactionId: suggestion.matchedTransactionId,
              status: 'rejected' as const,
            },
            updatedAt: now,
          });

          // If there's a linked pair, unlink and reject it too
          if (suggestion.status === 'linked_pending_approval' && suggestion.matchedTransactionId) {
            const pairedTransaction = await ctx.db.get(suggestion.matchedTransactionId);
            if (pairedTransaction && !pairedTransaction.isDeleted && pairedTransaction.suggestedTransfer) {
              const pairedSuggestion = pairedTransaction.suggestedTransfer;
              await ctx.db.patch(pairedTransaction._id, {
                suggestedTransfer: {
                  transferConfidence: pairedSuggestion.transferConfidence,
                  detectionReason: pairedSuggestion.detectionReason,
                  accountConfidence: pairedSuggestion.accountConfidence,
                  suggestedCounterpartAccountId: pairedSuggestion.suggestedCounterpartAccountId,
                  matchedTransactionId: undefined,
                  status: 'rejected' as const,
                },
                updatedAt: now,
              });

              const pairedPendingMatch = await ctx.db
                .query('pendingTransferMatch')
                .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', pairedTransaction._id))
                .first();
              if (pairedPendingMatch) {
                await ctx.db.patch(pairedPendingMatch._id, {
                  status: 'user_rejected',
                  updatedAt: now,
                });
              }
            }
          }

          const pendingMatch = await ctx.db
            .query('pendingTransferMatch')
            .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', transactionId))
            .first();
          if (pendingMatch) {
            await ctx.db.patch(pendingMatch._id, {
              status: 'user_rejected',
              updatedAt: now,
            });
          }
        }

        // === Auto-create merchant when marking as reviewed ===
        let newMerchantId: typeof transaction.merchantId;
        if (transaction.type === 'regular' && !transaction.merchantId && transaction.importDetails) {
          const merchantName = transaction.importDetails.merchantName ?? transaction.importDetails.originalStatement;

          if (merchantName?.trim()) {
            try {
              const normalizedName = merchantName.trim().toLowerCase();
              const existingMerchants = await ctx.db
                .query('merchant')
                .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
                .filter((q) => q.eq(q.field('isDeleted'), false))
                .collect();

              const duplicate = existingMerchants.find((m) => m.name?.toLowerCase() === normalizedName);

              if (duplicate) {
                newMerchantId = duplicate._id;
              } else {
                newMerchantId = await ctx.db.insert('merchant', {
                  name: merchantName.trim(),
                  workspaceId: verifiedWorkspaceId,
                  isDeleted: false,
                  updatedAt: new Date().toISOString(),
                });
              }
            } catch (error: unknown) {
              console.error('Failed to auto-create merchant during bulk review:', error);
            }
          }
        }

        // === Rebuild computed fields ===
        const existingMovements = transaction.movements ?? [];
        const effectiveMerchantId = newMerchantId ?? transaction.merchantId;

        const computedFields = await buildTransactionComputedFields(ctx, {
          merchantId: effectiveMerchantId,
          bankAccountId: transaction.bankAccountId,
          transactionType: transaction.type,
          notes: transaction.notes,
          movements: existingMovements.map((m, i) => ({
            categoryId: m.categoryId,
            readyToAssign: m.readyToAssign,
            amount: m.amount,
            notes: m.notes,
            sortOrder: m.sortOrder ?? i,
            creditCardTransfer: m.creditCardTransfer,
          })),
        });

        // === Apply the patch ===
        await ctx.db.patch(transactionId, {
          reviewStatus: 'reviewed' as const,
          updatedAt: new Date().toISOString(),
          ...(transaction.originalApprovedAmount !== undefined ? { originalApprovedAmount: undefined } : {}),
          ...(newMerchantId ? { merchantId: newMerchantId } : {}),
          movements: computedFields.movements,
          searchText: computedFields.searchText,
          totalAmount: computedFields.totalAmount,
          hasUncategorized: computedFields.hasUncategorized,
          hasMissingPayee: computedFields.hasMissingPayee,
        });

        // === Build afterSnapshot and reconcile ===
        const updatedTransaction = await ctx.db.get(transactionId);
        if (updatedTransaction) {
          const afterSnapshot = await buildSnapshotFromTransaction(ctx, updatedTransaction);
          await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot);
        }

        // === Update merchant suggestions ===
        if (effectiveMerchantId) {
          const merchant = await ctx.db.get(effectiveMerchantId);
          if (merchant) {
            const categoryId = existingMovements[0]?.categoryId;
            const updatedSuggestions = updateMerchantSuggestionsFromTransaction(
              merchant.suggestedCategoryIds,
              categoryId,
              transaction.bankAccountId
            );
            await ctx.db.patch(effectiveMerchantId, {
              suggestedCategoryIds: updatedSuggestions.suggestedCategoryIds,
              suggestedBankAccountId: updatedSuggestions.suggestedBankAccountId,
            });
          }
        }

        const activityTransaction = await ctx.db.get(transactionId);
        if (activityTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: verifiedWorkspaceId,
            context,
            type: 'transaction_updated',
            before: transaction,
            after: activityTransaction,
          });
        }
      } catch (error: unknown) {
        console.error('Failed to approve transaction batch atomically:', error);
        throw error;
      }
    }

    return { success: true };
  },
});
