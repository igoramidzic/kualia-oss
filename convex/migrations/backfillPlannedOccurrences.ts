import { Migrations } from '@convex-dev/migrations';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server';
import {
  getOccurrence,
  inferLegacyOccurrenceDate,
  nearestOccurrenceDate,
  refreshSchedule,
} from '../scheduledTransactions/occurrences';
import { isValidIsoDate } from '../scheduledTransactions/recurrence';

const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: 'migrations/backfillPlannedOccurrences:',
});

type Assignment = {
  schedule: Doc<'scheduledTransaction'>;
  transaction: Doc<'transaction'>;
  pair: Doc<'transaction'> | null;
  date: string;
  revision: number;
  evidence: 'stored' | 'entry_undo' | 'inferred';
};

function needsReview(transaction: Doc<'transaction'>, reason: string): never {
  throw new ConvexError(`Planned history needs review for transaction ${transaction._id}: ${reason}`);
}

/** Resolve once without moving the schedule: later rows must see the same legacy cursor. */
async function assignmentFor(ctx: Pick<QueryCtx, 'db'>, row: Doc<'transaction'>): Promise<Assignment | null> {
  if (!row.scheduledTransactionId) return null;
  const schedule = await ctx.db.get(row.scheduledTransactionId);
  if (!schedule || schedule.workspaceId !== row.workspaceId)
    needsReview(row, 'plan is missing or belongs to another workspace');
  if (!isValidIsoDate(schedule.anchorDate) || !isValidIsoDate(schedule.nextDate) || !isValidIsoDate(row.date)) {
    needsReview(row, 'invalid calendar date');
  }
  if (row.type !== 'regular' && row.type !== 'transfer') needsReview(row, 'unsupported transaction type');

  let transaction = row;
  let pair: Doc<'transaction'> | null = null;
  if (row.type === 'transfer') {
    const other = row.transferPairId ? await ctx.db.get(row.transferPairId) : null;
    if (
      !other ||
      other.workspaceId !== row.workspaceId ||
      other.type !== 'transfer' ||
      other.transferPairId !== row._id ||
      other.scheduledTransactionId !== row.scheduledTransactionId ||
      row.totalAmount === 0n ||
      other.totalAmount !== -row.totalAmount ||
      other.isDeleted !== row.isDeleted
    )
      needsReview(row, 'transfer pair is missing or inconsistent');
    transaction = row.totalAmount < 0n ? row : other;
    pair = row.totalAmount < 0n ? other : row;
    if (
      transaction.scheduledOccurrenceDate &&
      pair.scheduledOccurrenceDate &&
      (transaction.scheduledOccurrenceDate !== pair.scheduledOccurrenceDate ||
        (transaction.scheduledOccurrenceRevision ?? 0) !== (pair.scheduledOccurrenceRevision ?? 0))
    )
      needsReview(row, 'transfer halves refer to different occurrences');
  }

  const captured = transaction.scheduledOccurrenceDate ? transaction : pair?.scheduledOccurrenceDate ? pair : null;
  const evidence = captured
    ? 'stored'
    : transaction.scheduledEntryUndo || pair?.scheduledEntryUndo
      ? 'entry_undo'
      : 'inferred';
  if (!captured && (schedule.scheduleRevision ?? 0) !== 0) {
    needsReview(row, 'the schedule changed before its original occurrence date was captured');
  }
  const date =
    captured?.scheduledOccurrenceDate ??
    inferLegacyOccurrenceDate(schedule, {
      ...transaction,
      scheduledEntryUndo: transaction.scheduledEntryUndo ?? pair?.scheduledEntryUndo,
    });
  if (!isValidIsoDate(date)) needsReview(row, 'invalid occurrence date');
  return { schedule, transaction, pair, date, revision: captured?.scheduledOccurrenceRevision ?? 0, evidence };
}

/** Store payment identity and paid history; never use settlement helpers that advance the cursor here. */
export async function backfillPayment(ctx: MutationCtx, row: Doc<'transaction'>): Promise<void> {
  const assignment = await assignmentFor(ctx, row);
  if (!assignment) return;
  const { schedule, transaction, pair, date, revision, evidence } = assignment;
  for (const payment of pair ? [transaction, pair] : [transaction]) {
    if (
      payment.scheduledOccurrenceDate !== date ||
      payment.scheduledOccurrenceRevision !== revision ||
      (payment.source === 'scheduled' && !payment.originScheduledTransactionId)
    ) {
      await ctx.db.patch(payment._id, {
        scheduledOccurrenceDate: date,
        scheduledOccurrenceRevision: revision,
        ...(payment.source === 'scheduled' && !payment.originScheduledTransactionId
          ? { originScheduledTransactionId: schedule._id }
          : {}),
      });
    }
  }
  if (evidence !== 'stored') {
    console.info('Captured planned occurrence', {
      transactionId: transaction._id,
      date,
      evidence,
      deleted: transaction.isDeleted,
    });
  }
  if (transaction.isDeleted) return;

  const occurrence = await getOccurrence(ctx, schedule, date, revision);
  if (occurrence) {
    if (occurrence.workspaceId !== schedule.workspaceId)
      needsReview(transaction, 'occurrence belongs to another workspace');
    if (occurrence.status !== 'paid')
      needsReview(transaction, 'live payment conflicts with a pending or skipped occurrence');
    if (occurrence.transactionId !== transaction._id) {
      // Old clients allowed multiple payments. Preserve every link and the existing
      // canonical settlement; deletion reconciliation already finds replacements.
      console.warn('Multiple legacy payments share a planned occurrence', {
        scheduledTransactionId: schedule._id,
        date,
        transactionId: transaction._id,
        existingTransactionId: occurrence.transactionId,
      });
    }
    return;
  }
  await ctx.db.insert('scheduledTransactionOccurrence', {
    workspaceId: schedule.workspaceId,
    scheduledTransactionId: schedule._id,
    scheduleRevision: revision,
    occurrenceDate: date,
    status: 'paid',
    transactionId: transaction._id,
    // Old templates have no amount snapshot; preserve actual history, not today's estimate.
    expectedAmount: transaction.totalAmount,
    isTransfer: transaction.type === 'transfer',
    updatedAt: new Date().toISOString(),
  });
}

export async function backfillSkip(ctx: MutationCtx, skip: Doc<'scheduledTransactionSkip'>): Promise<void> {
  if (skip.isDeleted) return;
  const schedule = await ctx.db.get(skip.scheduledTransactionId);
  if (!schedule || schedule.workspaceId !== skip.workspaceId || !isValidIsoDate(skip.occurrenceDate)) {
    throw new ConvexError(`Planned skip history needs review: ${skip._id}`);
  }
  const revision = skip.scheduleRevision ?? 0;
  const existing = await getOccurrence(ctx, schedule, skip.occurrenceDate, revision);
  if (existing) {
    if (existing.workspaceId !== skip.workspaceId)
      throw new ConvexError(`Planned skip has a cross-workspace occurrence: ${skip._id}`);
    // A subsequent payment or deliberate reopening takes precedence over old skip history.
    return;
  }
  await ctx.db.insert('scheduledTransactionOccurrence', {
    workspaceId: skip.workspaceId,
    scheduledTransactionId: schedule._id,
    scheduleRevision: revision,
    occurrenceDate: skip.occurrenceDate,
    status: 'skipped',
    expectedAmount: skip.expectedAmount,
    isTransfer: skip.isTransfer,
    updatedAt: new Date().toISOString(),
  });
}

/** Run only after ALL payments and skips: a deleted duplicate must not reopen a paid bill. */
export async function backfillDeletedPayment(ctx: MutationCtx, row: Doc<'transaction'>): Promise<void> {
  if (!row.isDeleted || !row.scheduledTransactionId) return;
  const assignment = await assignmentFor(ctx, row);
  if (!assignment) return;
  const { schedule, transaction, date, revision } = assignment;
  if (!transaction.scheduledOccurrenceDate) needsReview(row, 'run capturePayments before reopening deleted payments');
  if (
    schedule.isDeleted ||
    revision !== (schedule.scheduleRevision ?? 0) ||
    nearestOccurrenceDate(schedule, date) !== date
  )
    return;
  if (await getOccurrence(ctx, schedule, date, revision)) return;
  await ctx.db.insert('scheduledTransactionOccurrence', {
    workspaceId: schedule.workspaceId,
    scheduledTransactionId: schedule._id,
    scheduleRevision: revision,
    occurrenceDate: date,
    status: 'pending',
    manualOnly: true,
    expectedAmount: transaction.totalAmount,
    isTransfer: transaction.type === 'transfer',
    updatedAt: new Date().toISOString(),
  });
}

export async function refreshBackfilledSchedule(
  ctx: MutationCtx,
  schedule: Doc<'scheduledTransaction'>
): Promise<void> {
  if (schedule.isDeleted) return;
  const history = await ctx.db
    .query('scheduledTransactionOccurrence')
    .withIndex('by_schedule_revision_date', (q) =>
      q.eq('scheduledTransactionId', schedule._id).eq('scheduleRevision', schedule.scheduleRevision ?? 0)
    )
    .first();
  // No evidence is not evidence of an unpaid bill. Preserve unknown completed history.
  if (!history) return;
  await refreshSchedule(ctx, schedule._id);
}

export const capturePayments = migrations.define({ table: 'transaction', batchSize: 25, migrateOne: backfillPayment });
export const captureSkips = migrations.define({
  table: 'scheduledTransactionSkip',
  batchSize: 25,
  migrateOne: backfillSkip,
});
export const reopenDeletedPayments = migrations.define({
  table: 'transaction',
  batchSize: 25,
  migrateOne: backfillDeletedPayment,
});
export const refreshSchedules = migrations.define({
  table: 'scheduledTransaction',
  batchSize: 10,
  migrateOne: refreshBackfilledSchedule,
});

/** Freeze missing identities only; never move a workspace's next bill or reopen deleted history. */
export async function repairLegacyPayment(ctx: MutationCtx, row: Doc<'transaction'>): Promise<void> {
  if (!row.scheduledTransactionId || row.scheduledOccurrenceDate !== undefined) return;
  await backfillPayment(ctx, row);
}

/**
 * Backfill missing occurrence dates across ALL workspaces using the corrected legacy inference.
 * Separate checkpoint from capturePayments so an earlier backfill cannot skip this repair.
 * Preview one page (pass continueCursor as cursor until isDone):
 * pnpm exec convex run migrations/backfillPlannedOccurrences:preview '{"legacyOnly":true}' --prod
 * Apply/resume after deploying:
 * pnpm exec convex run migrations/backfillPlannedOccurrences:repairLegacyOccurrences '{}' --prod
 * Inspect progress: pnpm exec convex run --component migrations lib:getStatus --prod
 * Existing explicit dates are preserved; ambiguous history stops with a transaction ID for review.
 */
export const repairLegacyOccurrences = migrations.define({
  table: 'transaction',
  batchSize: 25,
  migrateOne: repairLegacyPayment,
});

/**
 * Deploy first, then run this series in order. It resumes after failure and is safe to rerun.
 * Read-only preview (one page; pass continueCursor as cursor to see the next page):
 * pnpm exec convex run migrations/backfillPlannedOccurrences:preview '{}' --prod
 * Apply:
 * pnpm exec convex run migrations/backfillPlannedOccurrences:run --prod
 * Status:
 * pnpm exec convex run --component migrations lib:getStatus --prod
 * Missing months with no surviving transaction or skip are deliberately not synthesized.
 */
export const run = migrations.runner([
  internal.migrations.backfillPlannedOccurrences.capturePayments,
  internal.migrations.backfillPlannedOccurrences.captureSkips,
  internal.migrations.backfillPlannedOccurrences.reopenDeletedPayments,
  internal.migrations.backfillPlannedOccurrences.refreshSchedules,
]);

/**
 * Read-only assignment preview, optionally restricted to one plan. The installed migrations
 * component's generic dry run JSON-stringifies documents, which cannot handle bigint amounts.
 * Use this query instead; the component still owns batching, checkpoints and resuming writes.
 */
export const preview = internalQuery({
  args: {
    scheduledTransactionId: v.optional(v.id('scheduledTransaction')),
    cursor: v.optional(v.union(v.string(), v.null())),
    legacyOnly: v.optional(v.boolean()),
  },
  returns: v.object({
    isDone: v.boolean(),
    continueCursor: v.string(),
    transactions: v.array(
      v.object({
        transactionId: v.id('transaction'),
        workspaceId: v.id('workspace'),
        scheduledTransactionId: v.id('scheduledTransaction'),
        transactionDate: v.string(),
        deleted: v.boolean(),
        occurrenceDate: v.union(v.string(), v.null()),
        evidence: v.union(v.literal('stored'), v.literal('entry_undo'), v.literal('inferred'), v.null()),
        error: v.union(v.string(), v.null()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const schedule = args.scheduledTransactionId ? await ctx.db.get(args.scheduledTransactionId) : null;
    if (args.scheduledTransactionId && !schedule) throw new ConvexError('Planned transaction not found');
    const query = schedule
      ? ctx.db
          .query('transaction')
          .withIndex('by_scheduledTransactionId', (q) => q.eq('scheduledTransactionId', schedule._id))
      : ctx.db.query('transaction').withIndex('by_creation_time');
    const page = await query.paginate({ numItems: 25, cursor: args.cursor ?? null });
    const transactions = [];
    for (const transaction of page.page) {
      if (!transaction.scheduledTransactionId) continue;
      if (args.legacyOnly && transaction.scheduledOccurrenceDate !== undefined) continue;
      if (schedule && transaction.workspaceId !== schedule.workspaceId)
        throw new ConvexError('Invalid cross-workspace planned link');
      try {
        const assignment = await assignmentFor(ctx, transaction);
        transactions.push({
          transactionId: transaction._id,
          workspaceId: transaction.workspaceId,
          scheduledTransactionId: transaction.scheduledTransactionId,
          transactionDate: transaction.date,
          deleted: transaction.isDeleted,
          occurrenceDate: assignment?.date ?? null,
          evidence: assignment?.evidence ?? null,
          error: null,
        });
      } catch (error: unknown) {
        if (!(error instanceof ConvexError)) throw error;
        transactions.push({
          transactionId: transaction._id,
          workspaceId: transaction.workspaceId,
          scheduledTransactionId: transaction.scheduledTransactionId,
          transactionDate: transaction.date,
          deleted: transaction.isDeleted,
          occurrenceDate: null,
          evidence: null,
          error: String(error.data),
        });
      }
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, transactions };
  },
});
