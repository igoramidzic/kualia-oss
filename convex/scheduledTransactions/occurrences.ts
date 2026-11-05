import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { addDays } from '../lib/dates';
import type { TransactionSnapshot } from '../transactions/reconciliation/types';
import {
  computeNextReminderAt,
  computeNextRunAt,
  isValidIsoDate,
  nextOccurrence,
  occurrenceOnOrAfter,
} from './recurrence';
import { getScheduledEntryMode, getScheduledTransactionType, type Recurrence } from './types';

const periodDays: Record<Recurrence, number> = {
  once: 1,
  daily: 1,
  weekly: 7,
  every_other_week: 14,
  every_three_weeks: 21,
  every_four_weeks: 28,
  twice_a_month: 31,
  monthly: 31,
  every_other_month: 62,
  quarterly: 93,
  every_four_months: 124,
  twice_a_year: 186,
  yearly: 366,
  every_other_year: 732,
};

type Schedule = Doc<'scheduledTransaction'>;
type Occurrence = Doc<'scheduledTransactionOccurrence'>;

/** Choose an occurrence by proximity, with ties going to the earlier bill. No posting-date drift. */
export function nearestOccurrenceDate(
  scheduled: Schedule,
  date: string,
  options: { includeEarlierOccurrences?: boolean } = {}
): string {
  if (scheduled.recurrence === 'once' || (!options.includeEarlierOccurrences && date <= scheduled.anchorDate))
    return scheduled.anchorDate;
  const following = occurrenceOnOrAfter(
    scheduled.anchorDate,
    scheduled.recurrence,
    scheduled.anchorDate,
    date,
    options
  );
  if (!following) return scheduled.anchorDate;
  let previous = occurrenceOnOrAfter(
    scheduled.anchorDate,
    scheduled.recurrence,
    scheduled.anchorDate,
    addDays(date, -periodDays[scheduled.recurrence]),
    options
  );
  while (previous) {
    const next = nextOccurrence(previous, scheduled.recurrence, scheduled.anchorDate);
    if (next >= following) break;
    previous = next;
  }
  if (!previous || previous >= following) return following;
  return Date.parse(date) - Date.parse(previous) <= Date.parse(following) - Date.parse(date) ? previous : following;
}

/** Old clients/rows have no instance key. Prefer captured evidence, then the closest consumed date. */
export function inferLegacyOccurrenceDate(
  scheduled: Schedule,
  transaction: Pick<Doc<'transaction'>, 'date' | 'scheduledEntryUndo' | 'scheduledOccurrenceDate'>
): string {
  if (transaction.scheduledOccurrenceDate) return transaction.scheduledOccurrenceDate;
  if (transaction.scheduledEntryUndo) return transaction.scheduledEntryUndo.nextDate;
  // Legacy template edits could reset the anchor while keeping older payments linked.
  // Project that recurrence backward instead of assigning all older history to the new anchor.
  const options = { includeEarlierOccurrences: true };
  const nearest = nearestOccurrenceDate(scheduled, transaction.date, options);
  const consumedThrough = scheduled.nextUnprocessedDate ?? scheduled.nextDate;
  if (scheduled.recurrence === 'once' || scheduled.executionCount === 0 || nearest < consumedThrough) return nearest;
  return nearestOccurrenceDate(
    scheduled,
    addDays(consumedThrough, -Math.ceil(periodDays[scheduled.recurrence] / 2)),
    options
  );
}

export async function getOccurrence(
  ctx: Pick<QueryCtx, 'db'>,
  scheduled: Schedule,
  date: string,
  revision = scheduled.scheduleRevision ?? 0
) {
  return ctx.db
    .query('scheduledTransactionOccurrence')
    .withIndex('by_schedule_revision_date', (q) =>
      q.eq('scheduledTransactionId', scheduled._id).eq('scheduleRevision', revision).eq('occurrenceDate', date)
    )
    .unique();
}

/** Find the first unresolved forward occurrence without rescanning the transaction register. */
async function forwardDate(ctx: MutationCtx, scheduled: Schedule, start: string): Promise<string | undefined> {
  let date = start;
  for (let i = 0; i < 1000; i++) {
    const occurrence = await getOccurrence(ctx, scheduled, date);
    if (!occurrence || occurrence.status === 'pending') return date;
    if (scheduled.recurrence === 'once') return undefined;
    date = nextOccurrence(date, scheduled.recurrence, scheduled.anchorDate);
  }
  throw new ConvexError('Too many resolved occurrences. Please shorten the schedule range.');
}

/** nextDate is the earliest outstanding bill; the independent cursor keeps auto-entry moving. */
export async function refreshSchedule(ctx: MutationCtx, scheduledId: Id<'scheduledTransaction'>): Promise<void> {
  const scheduled = await ctx.db.get(scheduledId);
  if (!scheduled || scheduled.isDeleted) return;
  const cursor = await forwardDate(ctx, scheduled, scheduled.nextUnprocessedDate ?? scheduled.nextDate);
  const pending = await ctx.db
    .query('scheduledTransactionOccurrence')
    .withIndex('by_schedule_revision_status_date', (q) =>
      q
        .eq('scheduledTransactionId', scheduled._id)
        .eq('scheduleRevision', scheduled.scheduleRevision ?? 0)
        .eq('status', 'pending')
    )
    .first();
  const nextDate = pending && (!cursor || pending.occurrenceDate < cursor) ? pending.occurrenceDate : cursor;
  const status = scheduled.status === 'paused' ? 'paused' : nextDate ? 'active' : 'completed';
  const workspace = await ctx.db.get(scheduled.workspaceId);
  // Reopened occurrences are manual-only. Deleting an auto-entry must never recreate it.
  const autoDate = await automaticOccurrenceDate(ctx, scheduled);
  await ctx.db.patch(scheduled._id, {
    nextDate: nextDate ?? scheduled.nextDate,
    nextUnprocessedDate: cursor ?? scheduled.nextUnprocessedDate ?? scheduled.nextDate,
    status,
    nextRunAt:
      status === 'active' && !workspace?.isArchived && getScheduledEntryMode(scheduled) === 'auto' && autoDate
        ? computeNextRunAt(autoDate, workspace?.timezone)
        : undefined,
    nextReminderAt: computeNextReminderAt({
      ...scheduled,
      nextDate: nextDate ?? scheduled.nextDate,
      status: workspace?.isArchived ? 'paused' : status,
      timezone: workspace?.timezone,
      now: Date.now(),
    }),
    updatedAt: new Date().toISOString(),
  });
}

export async function automaticOccurrenceDate(ctx: MutationCtx, scheduled: Schedule): Promise<string | undefined> {
  const cursor = scheduled.nextUnprocessedDate ?? scheduled.nextDate;
  const start =
    scheduled.automaticEntryStartDate && scheduled.automaticEntryStartDate > cursor
      ? scheduled.automaticEntryStartDate
      : cursor;
  let date = await forwardDate(ctx, scheduled, start);
  for (let i = 0; date && i < 1000; i++) {
    const occurrence = await getOccurrence(ctx, scheduled, date);
    if (!occurrence?.manualOnly) return date;
    if (scheduled.recurrence === 'once') return undefined;
    date = await forwardDate(ctx, scheduled, nextOccurrence(date, scheduled.recurrence, scheduled.anchorDate));
  }
  return undefined;
}

function occurrenceFields(scheduled: Schedule, date: string) {
  return {
    workspaceId: scheduled.workspaceId,
    scheduledTransactionId: scheduled._id,
    scheduleRevision: scheduled.scheduleRevision ?? 0,
    occurrenceDate: date,
    expectedAmount: scheduled.movements.reduce((sum, m) => sum + m.amount, 0n),
    isTransfer: getScheduledTransactionType(scheduled) === 'transfer',
    updatedAt: new Date().toISOString(),
  };
}

async function otherSettlement(
  ctx: MutationCtx,
  scheduled: Schedule,
  transaction: Doc<'transaction'>,
  date: string,
  revision: number
): Promise<Doc<'transaction'> | undefined> {
  const [exact, legacy] = await Promise.all([
    ctx.db
      .query('transaction')
      .withIndex('by_schedule_occurrence', (q) =>
        q.eq('scheduledTransactionId', scheduled._id).eq('scheduledOccurrenceDate', date)
      )
      .take(5001),
    ctx.db
      .query('transaction')
      .withIndex('by_schedule_occurrence', (q) =>
        q.eq('scheduledTransactionId', scheduled._id).eq('scheduledOccurrenceDate', undefined)
      )
      .take(5001),
  ]);
  if (exact.length > 5000 || legacy.length > 5000) {
    throw new ConvexError('This plan has too much legacy history to change safely in one operation');
  }
  const linked = [...exact, ...legacy];
  return linked.find(
    (candidate) =>
      !candidate.isDeleted &&
      candidate.workspaceId === scheduled.workspaceId &&
      candidate._id !== transaction._id &&
      candidate._id !== transaction.transferPairId &&
      (candidate.type !== 'transfer' || candidate.totalAmount < 0n) &&
      (candidate.scheduledOccurrenceRevision ?? 0) === revision &&
      inferLegacyOccurrenceDate(scheduled, candidate) === date
  );
}

export async function settleOccurrence(
  ctx: MutationCtx,
  scheduled: Schedule,
  transaction: Doc<'transaction'>,
  date: string,
  options: { alreadyCounted?: boolean; provenance?: boolean } = {}
): Promise<void> {
  if (transaction.workspaceId !== scheduled.workspaceId) throw new ConvexError('Access denied to workspace');
  const existing = await getOccurrence(ctx, scheduled, date);
  // Tracked or already-counted legacy bills can predate the anchor; new links cannot.
  if (
    !isValidIsoDate(date) ||
    nearestOccurrenceDate(scheduled, date, { includeEarlierOccurrences: !!existing || options.alreadyCounted }) !== date
  ) {
    throw new ConvexError('Choose a valid due date for this planned transaction');
  }
  if (existing?.status === 'skipped') throw new ConvexError('This planned occurrence was skipped');
  if (!existing && (await otherSettlement(ctx, scheduled, transaction, date, scheduled.scheduleRevision ?? 0))) {
    throw new ConvexError('This planned occurrence already has a transaction');
  }
  if (existing?.status === 'paid' && existing.transactionId !== transaction._id) {
    throw new ConvexError('This planned occurrence already has a transaction');
  }
  const fields = { ...occurrenceFields(scheduled, date), status: 'paid' as const, transactionId: transaction._id };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert('scheduledTransactionOccurrence', fields);
  const transactionFields = {
    scheduledTransactionId: scheduled._id,
    scheduledOccurrenceDate: date,
    scheduledOccurrenceRevision: scheduled.scheduleRevision ?? 0,
    ...(options.provenance ? { originScheduledTransactionId: scheduled._id } : {}),
  };
  await ctx.db.patch(transaction._id, transactionFields);
  if (transaction.type === 'transfer' && transaction.transferPairId) {
    const pair = await ctx.db.get(transaction.transferPairId);
    if (pair && pair.workspaceId === scheduled.workspaceId) await ctx.db.patch(pair._id, transactionFields);
  }
  if (existing?.status !== 'paid' && !options.alreadyCounted) {
    await ctx.db.patch(scheduled._id, {
      executionCount: scheduled.executionCount + 1,
      lastEnteredAt: new Date().toISOString(),
      lastEnteredTransactionId: transaction._id,
    });
  }
  await refreshSchedule(ctx, scheduled._id);
}

export async function skipOccurrence(ctx: MutationCtx, scheduled: Schedule): Promise<void> {
  const occurrence = await getOccurrence(ctx, scheduled, scheduled.nextDate);
  if (occurrence?.status === 'paid') throw new ConvexError('This occurrence is already recorded');
  const fields = {
    ...occurrenceFields(scheduled, scheduled.nextDate),
    status: 'skipped' as const,
    transactionId: undefined,
  };
  if (occurrence) await ctx.db.patch(occurrence._id, fields);
  else await ctx.db.insert('scheduledTransactionOccurrence', fields);
  await refreshSchedule(ctx, scheduled._id);
}

/** Capture legacy identity before edits erase the only evidence about its consumed occurrence. */
async function ensureTracked(
  ctx: MutationCtx,
  scheduled: Schedule,
  transaction: Doc<'transaction'>
): Promise<Occurrence> {
  const date = inferLegacyOccurrenceDate(scheduled, transaction);
  const revision = transaction.scheduledOccurrenceRevision ?? 0;
  const existing = await getOccurrence(ctx, scheduled, date, revision);
  if (existing) return existing;
  const id = await ctx.db.insert('scheduledTransactionOccurrence', {
    ...occurrenceFields(scheduled, date),
    scheduleRevision: revision,
    status: 'paid',
    transactionId: transaction._id,
  });
  await ctx.db.patch(transaction._id, {
    scheduledOccurrenceDate: date,
    scheduledOccurrenceRevision: revision,
    ...(transaction.source === 'scheduled' ? { originScheduledTransactionId: scheduled._id } : {}),
  });
  const occurrence = await ctx.db.get(id);
  if (!occurrence) throw new ConvexError('Planned occurrence not found');
  return occurrence;
}

export async function releaseOccurrence(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  unlink: boolean
): Promise<void> {
  if (!transaction.scheduledTransactionId) return;
  const scheduled = await ctx.db.get(transaction.scheduledTransactionId);
  if (!scheduled || scheduled.workspaceId !== transaction.workspaceId) {
    if (unlink) {
      for (const id of [transaction._id, ...(transaction.transferPairId ? [transaction.transferPairId] : [])]) {
        const linked = await ctx.db.get(id);
        if (
          linked?.workspaceId === transaction.workspaceId &&
          linked.scheduledTransactionId === transaction.scheduledTransactionId
        ) {
          await ctx.db.patch(id, {
            scheduledTransactionId: undefined,
            scheduledOccurrenceDate: undefined,
            scheduledOccurrenceRevision: undefined,
            scheduledEntryUndo: undefined,
          });
        }
      }
    }
    return;
  }
  // Both transfer halves represent one settlement. Always release its canonical outflow.
  let canonical = transaction;
  if (transaction.type === 'transfer' && transaction.totalAmount > 0n && transaction.transferPairId) {
    const pair = await ctx.db.get(transaction.transferPairId);
    if (pair && pair.workspaceId === transaction.workspaceId) canonical = pair;
  }
  const occurrence = await ensureTracked(ctx, scheduled, canonical);
  const replacement = await otherSettlement(
    ctx,
    scheduled,
    canonical,
    occurrence.occurrenceDate,
    occurrence.scheduleRevision
  );
  if (occurrence.status === 'paid' && occurrence.transactionId === canonical._id && replacement) {
    await ctx.db.patch(occurrence._id, { transactionId: replacement._id, updatedAt: new Date().toISOString() });
    await ctx.db.patch(replacement._id, {
      scheduledOccurrenceDate: occurrence.occurrenceDate,
      scheduledOccurrenceRevision: occurrence.scheduleRevision,
    });
  }
  if (occurrence.status === 'paid' && occurrence.transactionId === canonical._id && !replacement) {
    await ctx.db.patch(occurrence._id, {
      status: 'pending',
      transactionId: undefined,
      manualOnly: true,
      updatedAt: new Date().toISOString(),
    });
    if (occurrence.scheduleRevision === (scheduled.scheduleRevision ?? 0)) {
      await ctx.db.patch(scheduled._id, {
        executionCount: Math.max(0, scheduled.executionCount - 1),
        ...(scheduled.lastEnteredTransactionId === canonical._id
          ? { lastEnteredTransactionId: undefined, lastEnteredAt: undefined }
          : {}),
      });
    }
  }
  if (unlink) {
    const ids = new Set([
      transaction._id,
      canonical._id,
      ...(canonical.transferPairId ? [canonical.transferPairId] : []),
    ]);
    for (const id of ids) {
      const linked = await ctx.db.get(id);
      if (
        linked?.workspaceId !== scheduled.workspaceId ||
        linked.scheduledTransactionId !== scheduled._id ||
        (linked.scheduledOccurrenceDate !== undefined &&
          linked.scheduledOccurrenceDate !== occurrence.occurrenceDate) ||
        (linked.scheduledOccurrenceRevision ?? occurrence.scheduleRevision) !== occurrence.scheduleRevision
      )
        continue;
      await ctx.db.patch(id, {
        scheduledTransactionId: undefined,
        scheduledOccurrenceDate: undefined,
        scheduledOccurrenceRevision: undefined,
        scheduledEntryUndo: undefined,
        ...(linked.source === 'scheduled' ? { originScheduledTransactionId: scheduled._id } : {}),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  await refreshSchedule(ctx, scheduled._id);
}

/** Reconcile every edit/delete/restore path, including imports, bulk edits and transfer conversions. */
export async function reconcileScheduledOccurrence(
  ctx: MutationCtx,
  before: TransactionSnapshot | null,
  after: TransactionSnapshot | null
): Promise<void> {
  if (before?.type === 'transfer' && before.totalAmount > 0n && (!after || after.type === 'transfer')) return;
  const id = before?.scheduledTransactionId ?? after?.scheduledTransactionId;
  if (!id) return;
  const transactionId = before?.transactionId ?? after?.transactionId;
  if (!transactionId) return;
  const transaction = await ctx.db.get(transactionId);
  const scheduled = await ctx.db.get(id);
  if (!transaction || !scheduled || scheduled.workspaceId !== transaction.workspaceId) return;
  if (before && !after) {
    await releaseOccurrence(
      ctx,
      { ...transaction, ...before, movements: transaction.movements, _id: transactionId },
      false
    );
    return;
  }
  if (before && after) {
    const original = { ...transaction, ...before, movements: transaction.movements, _id: transactionId };
    const occurrenceDate = inferLegacyOccurrenceDate(scheduled, original);
    const incompatible =
      before.type !== after.type ||
      before.bankAccountId !== after.bankAccountId ||
      before.transferPairBankAccountId !== after.transferPairBankAccountId ||
      before.merchantId !== after.merchantId ||
      before.totalAmount < 0n !== after.totalAmount < 0n ||
      after.totalAmount === 0n ||
      (before.date !== after.date &&
        nearestOccurrenceDate(scheduled, after.date, {
          includeEarlierOccurrences: occurrenceDate < scheduled.anchorDate,
        }) !== occurrenceDate);
    if (incompatible || !after.scheduledTransactionId) await releaseOccurrence(ctx, original, true);
    return;
  }
  // Only tracked entries can be restored. Newly materialized entries are settled by their creator.
  if (!before && after && transaction.scheduledOccurrenceDate) {
    const occurrence = await getOccurrence(
      ctx,
      scheduled,
      transaction.scheduledOccurrenceDate,
      transaction.scheduledOccurrenceRevision ?? 0
    );
    if (occurrence?.status === 'pending' && occurrence.scheduleRevision === (scheduled.scheduleRevision ?? 0)) {
      const canonical =
        transaction.type === 'transfer' && transaction.totalAmount > 0n && transaction.transferPairId
          ? await ctx.db.get(transaction.transferPairId)
          : transaction;
      if (canonical) await settleOccurrence(ctx, scheduled, canonical, occurrence.occurrenceDate);
    } else if (
      occurrence?.status === 'skipped' ||
      (occurrence?.status === 'paid' &&
        occurrence.transactionId !== transaction._id &&
        occurrence.transactionId !== transaction.transferPairId)
    ) {
      // Restoring an old entry never steals an occurrence already settled by its replacement.
      await ctx.db.patch(transaction._id, {
        scheduledTransactionId: undefined,
        scheduledOccurrenceDate: undefined,
        scheduledOccurrenceRevision: undefined,
      });
    }
  }
}

/** Seed exact history when a transaction and its new repeating series are created together. */
export async function recordInitialOccurrence(
  ctx: MutationCtx,
  scheduleId: Id<'scheduledTransaction'>,
  transactionId: Id<'transaction'>,
  date: string
): Promise<void> {
  const [scheduled, transaction] = await Promise.all([ctx.db.get(scheduleId), ctx.db.get(transactionId)]);
  if (!scheduled || !transaction) throw new ConvexError('Planned transaction not found');
  await settleOccurrence(ctx, scheduled, transaction, date, { alreadyCounted: true });
}

/** Freeze old clients' inferred identity before a template edit changes the recurrence anchor. */
export async function captureLegacyOccurrenceDates(ctx: MutationCtx, scheduled: Schedule): Promise<void> {
  const transactions = await ctx.db
    .query('transaction')
    .withIndex('by_schedule_occurrence', (q) =>
      q.eq('scheduledTransactionId', scheduled._id).eq('scheduledOccurrenceDate', undefined)
    )
    .take(5001);
  if (transactions.length > 5000)
    throw new ConvexError('This plan needs its legacy history upgraded before changing its recurrence');
  for (const transaction of transactions) {
    if (transaction.workspaceId !== scheduled.workspaceId) continue;
    await ctx.db.patch(transaction._id, {
      scheduledOccurrenceDate: inferLegacyOccurrenceDate(scheduled, transaction),
      scheduledOccurrenceRevision: scheduled.scheduleRevision ?? 0,
      ...(transaction.source === 'scheduled' ? { originScheduledTransactionId: scheduled._id } : {}),
    });
  }
}
