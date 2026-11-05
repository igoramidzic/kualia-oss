import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalQuery, type QueryCtx, query } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { addMonthsToYearMonth } from '../lib/dates';
import { appendLogoDevToken } from '../lib/logoUtils';

import { inferLegacyOccurrenceDate } from './occurrences';
import type { ScheduledTransactionWithRelations } from './queries';
import { nextOccurrence, occurrenceOnOrAfter } from './recurrence';
import { getScheduledTransactionType } from './types';

/**
 * Data feed for the Planned page (list + calendar) on web and iOS. Mirrors the shape of
 * the retired recurring page so the existing monthly/calendar UI
 * adapts with minimal churn:
 * - allPlannedTransactions: every non-deleted schedule (active, paused, completed) with
 *   populated names — month entries reference these by id
 * - plannedByMonth: per-month occurrence entries with a coverage status
 * - monthlySummaries: inflow/outflow expected-vs-paid rollups (transfers excluded)
 *
 * Status vocabulary matches the recurring page exactly:
 * - paid: an occurrence with an entered transaction, shown on its original due date
 * - upcoming: a future occurrence (including due today), synthesized by expanding the
 *   recurrence from nextDate
 * - overdue: an unentered occurrence before today on an active schedule
 * - skipped: an occurrence the user explicitly skipped
 */

export type PlannedCoverageStatus = 'paid' | 'upcoming' | 'overdue' | 'skipped';

export type PlannedMonthlyEntry = {
  scheduledTransactionId: Id<'scheduledTransaction'>;
  /** Original due date, independent of the actual payment date. */
  occurrenceDate: string;
  isTransfer: boolean;
  coverage: {
    status: PlannedCoverageStatus;
    /** Signed movement total of the schedule (negative = expense) */
    expectedAmount: bigint;
    paidAmount: bigint;
    linkedTransactions: { transactionId: Id<'transaction'>; amount: bigint; date: string }[];
  };
  displayDate: string;
};

export type PlannedFlowSummary = {
  totalExpected: bigint;
  totalPaid: bigint;
  totalRemaining: bigint;
  percentPaid: number;
  count: number;
  paidCount: number;
};

export type PlannedMonthlySummary = {
  inflow: PlannedFlowSummary;
  outflow: PlannedFlowSummary;
};

export type PlannedBaseTransaction = ScheduledTransactionWithRelations & {
  merchantLogoUrl?: string | null;
  bankAccountName?: string;
  /** Signed sum of movement amounts */
  totalAmount: bigint;
};

// Bound synthesized history without changing unpaid bills into skipped occurrences.
// Explicitly reopened older occurrences remain visible outside this window.
const MONTHS_BACKWARD = 12;
const MAX_OCCURRENCE_HISTORY = 5000;
const MONTHS_FORWARD = 24;

function safePercent(paid: bigint, expected: bigint): number {
  if (expected <= 0n) {
    return paid > 0n ? 100 : 0;
  }
  const percent = Number((paid * 100n) / expected);
  return Math.max(0, Math.min(100, percent));
}

export async function populatePlannedBase(
  ctx: QueryCtx,
  scheduled: Doc<'scheduledTransaction'>
): Promise<PlannedBaseTransaction> {
  const [populated] = await populatePlannedBases(ctx, [scheduled]);
  return populated;
}

/** Resolve shared display records once, regardless of the number of schedules or split movements. */
export async function populatePlannedBases(
  ctx: QueryCtx,
  schedules: readonly Doc<'scheduledTransaction'>[]
): Promise<PlannedBaseTransaction[]> {
  const merchantIds = new Set(schedules.flatMap((scheduled) => (scheduled.merchantId ? [scheduled.merchantId] : [])));
  const accountIds = new Set(
    schedules.flatMap((scheduled) => [
      scheduled.bankAccountId,
      ...(scheduled.transferToAccountId ? [scheduled.transferToAccountId] : []),
    ])
  );
  const categoryIds = new Set(
    schedules.flatMap((scheduled) =>
      scheduled.movements.flatMap((movement) => (movement.categoryId ? [movement.categoryId] : []))
    )
  );
  const [merchantDocs, accountDocs, categoryDocs] = await Promise.all([
    Promise.all([...merchantIds].map((id) => ctx.db.get(id))),
    Promise.all([...accountIds].map((id) => ctx.db.get(id))),
    Promise.all([...categoryIds].map((id) => ctx.db.get(id))),
  ]);
  const merchants = new Map(merchantDocs.filter((record) => record !== null).map((record) => [record._id, record]));
  const accounts = new Map(accountDocs.filter((record) => record !== null).map((record) => [record._id, record]));
  const categories = new Map(categoryDocs.filter((record) => record !== null).map((record) => [record._id, record]));
  const globalMerchantIds = new Set(
    schedules.flatMap((scheduled) => {
      const merchant = scheduled.merchantId ? merchants.get(scheduled.merchantId) : undefined;
      return merchant?.workspaceId === scheduled.workspaceId && merchant.globalMerchantId
        ? [merchant.globalMerchantId]
        : [];
    })
  );
  const globalMerchantDocs = await Promise.all([...globalMerchantIds].map((id) => ctx.db.get(id)));
  const globalMerchants = new Map(
    globalMerchantDocs.filter((record) => record !== null).map((record) => [record._id, record])
  );

  return schedules.map((scheduled) => {
    const merchantRecord = scheduled.merchantId ? merchants.get(scheduled.merchantId) : undefined;
    const merchant = merchantRecord?.workspaceId === scheduled.workspaceId ? merchantRecord : undefined;
    const globalMerchant = merchant?.globalMerchantId ? globalMerchants.get(merchant.globalMerchantId) : undefined;
    const logoUrl = merchant?.logoUrl === undefined ? globalMerchant?.logoUrl : merchant.logoUrl;
    const bankAccount = accounts.get(scheduled.bankAccountId);
    const transferToAccount = scheduled.transferToAccountId ? accounts.get(scheduled.transferToAccountId) : undefined;
    return {
      ...scheduled,
      transactionType: getScheduledTransactionType(scheduled),
      merchantName: merchant?.name ?? globalMerchant?.name,
      merchantLogoUrl:
        merchant?.visualIdentityMode === 'icon' ? null : (appendLogoDevToken(logoUrl ?? undefined) ?? null),
      bankAccountName: bankAccount?.workspaceId === scheduled.workspaceId ? bankAccount.name : undefined,
      transferToAccountName:
        transferToAccount?.workspaceId === scheduled.workspaceId ? transferToAccount.name : undefined,
      movements: scheduled.movements.map((movement) => {
        const category = movement.categoryId ? categories.get(movement.categoryId) : undefined;
        return {
          ...movement,
          categoryName: category?.workspaceId === scheduled.workspaceId ? category.name : undefined,
        };
      }),
      totalAmount: scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n),
    };
  });
}

export const listPlannedTransactionsData = query({
  args: {
    workspaceId: v.id('workspace'),
    today: v.string(), // ISO date string (e.g., "2026-07-09"), workspace-timezone today
  },
  handler: async (ctx, { workspaceId, today }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return listPlannedTransactionsDataCore(ctx, verifiedWorkspaceId, today, MONTHS_FORWARD);
  },
});

/** Internal version that skips auth; used by the widget HTTP endpoint. */
export const listPlannedTransactionsDataInternal = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    today: v.string(),
    monthsForward: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, today, monthsForward = MONTHS_FORWARD }) => {
    return listPlannedTransactionsDataCore(ctx, workspaceId, today, monthsForward);
  },
});

export async function listPlannedTransactionsDataCore(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  today: string,
  monthsForward: number
) {
  const currentYearMonth = dateToYearMonth(today);
  const maxYearMonth = addMonthsToYearMonth(currentYearMonth, monthsForward);

  const fetched = await ctx.db
    .query('scheduledTransaction')
    .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspaceId).eq('isDeleted', false))
    .collect();

  const allPlannedTransactions = await populatePlannedBases(ctx, fetched);
  const skipHistory = await ctx.db
    .query('scheduledTransactionSkip')
    .withIndex('by_workspaceId_and_occurrenceDate', (q) => q.eq('workspaceId', workspaceId))
    .order('desc')
    .take(5001);

  const plannedByMonth: Record<number, PlannedMonthlyEntry[]> = {};
  let minYearMonth = currentYearMonth;

  const pushEntry = (entry: PlannedMonthlyEntry) => {
    const yearMonth = dateToYearMonth(entry.displayDate);
    if (yearMonth > maxYearMonth) {
      return;
    }
    if (yearMonth < minYearMonth) {
      minYearMonth = yearMonth;
    }
    (plannedByMonth[yearMonth] ??= []).push(entry);
  };

  const occurrenceHistory = await ctx.db
    .query('scheduledTransactionOccurrence')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .order('desc')
    .take(MAX_OCCURRENCE_HISTORY + 1);
  const occurrencesBySchedule = new Map<Id<'scheduledTransaction'>, Doc<'scheduledTransactionOccurrence'>[]>();
  for (const occurrence of occurrenceHistory.slice(0, MAX_OCCURRENCE_HISTORY)) {
    const records = occurrencesBySchedule.get(occurrence.scheduledTransactionId) ?? [];
    records.push(occurrence);
    occurrencesBySchedule.set(occurrence.scheduledTransactionId, records);
  }
  const skipsBySchedule = new Map<Id<'scheduledTransaction'>, Doc<'scheduledTransactionSkip'>[]>();
  for (const skip of skipHistory.slice(0, MAX_OCCURRENCE_HISTORY)) {
    if (skip.isDeleted) continue;
    const records = skipsBySchedule.get(skip.scheduledTransactionId) ?? [];
    records.push(skip);
    skipsBySchedule.set(skip.scheduledTransactionId, records);
  }
  const minimumSyntheticMonth = addMonthsToYearMonth(currentYearMonth, -MONTHS_BACKWARD);
  const minimumSyntheticDate = `${Math.floor(minimumSyntheticMonth / 100)}-${String(minimumSyntheticMonth % 100).padStart(2, '0')}-01`;
  let unenteredHistoryTruncated = false;
  let transactionHistoryTruncated = false;
  let pendingHistoryTruncated = false;

  for (const scheduled of fetched) {
    const isTransfer = getScheduledTransactionType(scheduled) === 'transfer';
    const expectedAmount = scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    const revision = scheduled.scheduleRevision ?? 0;
    // The compatibility feed has one row per schedule/date. A re-dated series owns
    // its due dates even before pending records are materialized; retired payments
    // and skips must not settle or hide those new occurrences.
    const belongsToCurrentRevision = (date: string): boolean =>
      date >= scheduled.anchorDate &&
      occurrenceOnOrAfter(scheduled.anchorDate, scheduled.recurrence, scheduled.anchorDate, date) === date;
    const includeHistory = (date: string, historicalRevision: number): boolean =>
      historicalRevision === revision || !belongsToCurrentRevision(date);
    // Pending bills must not disappear when paid history fills the history limit.
    const pending = await ctx.db
      .query('scheduledTransactionOccurrence')
      .withIndex('by_schedule_revision_status_date', (q) =>
        q.eq('scheduledTransactionId', scheduled._id).eq('scheduleRevision', revision).eq('status', 'pending')
      )
      .take(MAX_OCCURRENCE_HISTORY + 1);
    pendingHistoryTruncated ||= pending.length > MAX_OCCURRENCE_HISTORY;
    const history = [
      ...(occurrencesBySchedule.get(scheduled._id) ?? []),
      ...pending.slice(0, MAX_OCCURRENCE_HISTORY).filter((occurrence) => occurrence.workspaceId === workspaceId),
    ];
    const historyByIdentity = new Map(
      history.map((occurrence) => [`${occurrence.scheduleRevision}:${occurrence.occurrenceDate}`, occurrence])
    );
    const currentOccurrences = new Map(
      history
        .filter((occurrence) => occurrence.scheduleRevision === revision)
        .map((occurrence) => [occurrence.occurrenceDate, occurrence])
    );
    const shownDates = new Set<string>();

    // Only a live linked transaction makes an occurrence paid. The stored occurrence
    // provides its original date and template snapshot; the transaction supplies the
    // actual amount and payment date. Multiple payments cover one occurrence.
    const linked = await ctx.db
      .query('transaction')
      .withIndex('by_scheduledTransactionId', (q) => q.eq('scheduledTransactionId', scheduled._id))
      .order('desc')
      .take(MAX_OCCURRENCE_HISTORY + 1);
    transactionHistoryTruncated ||= linked.length > MAX_OCCURRENCE_HISTORY;
    const paidByDate = new Map<string, PlannedMonthlyEntry>();
    for (const transaction of linked.slice(0, MAX_OCCURRENCE_HISTORY)) {
      if (transaction.isDeleted || transaction.workspaceId !== workspaceId) continue;
      const occurrenceDate = inferLegacyOccurrenceDate(scheduled, transaction);
      const transactionRevision = transaction.scheduledOccurrenceRevision ?? 0;
      if (!includeHistory(occurrenceDate, transactionRevision)) continue;
      const snapshot = historyByIdentity.get(`${transactionRevision}:${occurrenceDate}`);
      const transactionIsTransfer = transaction.type === 'transfer';
      if (transactionIsTransfer && transaction.totalAmount >= 0n) continue;
      const paidAmount = transaction.totalAmount < 0n ? -transaction.totalAmount : transaction.totalAmount;
      const existing = paidByDate.get(occurrenceDate);
      if (existing) {
        existing.coverage.paidAmount += paidAmount;
        existing.coverage.linkedTransactions.push({
          transactionId: transaction._id,
          amount: transaction.totalAmount,
          date: transaction.date,
        });
      } else {
        paidByDate.set(occurrenceDate, {
          scheduledTransactionId: scheduled._id,
          occurrenceDate,
          displayDate: occurrenceDate,
          isTransfer: transactionIsTransfer,
          coverage: {
            status: 'paid',
            // Older rows have no template snapshot. Their actual direction remains
            // authoritative even after the current template changes expense/income.
            expectedAmount: snapshot?.expectedAmount ?? transaction.totalAmount,
            paidAmount,
            linkedTransactions: [
              { transactionId: transaction._id, amount: transaction.totalAmount, date: transaction.date },
            ],
          },
        });
      }
    }
    for (const entry of paidByDate.values()) {
      entry.coverage.linkedTransactions.sort((a, b) => a.date.localeCompare(b.date));
      shownDates.add(entry.occurrenceDate);
      pushEntry(entry);
    }

    const addUnpaidEntry = (occurrence: {
      occurrenceDate: string;
      expectedAmount: bigint;
      isTransfer: boolean;
      status: 'pending' | 'skipped';
    }) => {
      if (shownDates.has(occurrence.occurrenceDate)) return;
      shownDates.add(occurrence.occurrenceDate);
      pushEntry({
        scheduledTransactionId: scheduled._id,
        occurrenceDate: occurrence.occurrenceDate,
        displayDate: occurrence.occurrenceDate,
        isTransfer: occurrence.isTransfer,
        coverage: {
          status:
            occurrence.status === 'skipped' ? 'skipped' : occurrence.occurrenceDate < today ? 'overdue' : 'upcoming',
          expectedAmount: occurrence.expectedAmount,
          paidAmount: 0n,
          linkedTransactions: [],
        },
      });
    };
    // Explicit current pending records win over historical skip records when an
    // occurrence was deliberately reopened. Old revisions never reopen after re-dating.
    if (scheduled.status === 'active') {
      for (const occurrence of currentOccurrences.values()) {
        if (occurrence.status === 'pending') addUnpaidEntry({ ...occurrence, status: 'pending' });
      }
    }
    for (const occurrence of history) {
      if (occurrence.status === 'skipped' && includeHistory(occurrence.occurrenceDate, occurrence.scheduleRevision)) {
        addUnpaidEntry({ ...occurrence, status: 'skipped' });
      }
    }
    for (const skipped of skipsBySchedule.get(scheduled._id) ?? []) {
      if (includeHistory(skipped.occurrenceDate, skipped.scheduleRevision ?? 0)) {
        addUnpaidEntry({ ...skipped, status: 'skipped' });
      }
    }

    if (scheduled.status !== 'active') continue;

    const cursor = scheduled.nextUnprocessedDate ?? scheduled.nextDate;
    unenteredHistoryTruncated ||= cursor < minimumSyntheticDate;
    if (cursor < minimumSyntheticDate && !currentOccurrences.has(cursor)) {
      addUnpaidEntry({ occurrenceDate: cursor, expectedAmount, isTransfer, status: 'pending' });
    }
    // Seek before expanding: an old daily plan cannot consume the whole expansion
    // budget on old dates or label those dates as upcoming.
    let occurrence = occurrenceOnOrAfter(cursor, scheduled.recurrence, scheduled.anchorDate, minimumSyntheticDate);
    while (occurrence !== undefined && dateToYearMonth(occurrence) <= maxYearMonth) {
      const recorded = currentOccurrences.get(occurrence);
      if (recorded?.status !== 'paid' && recorded?.status !== 'skipped') {
        addUnpaidEntry({ occurrenceDate: occurrence, expectedAmount, isTransfer, status: 'pending' });
      }
      occurrence =
        scheduled.recurrence === 'once'
          ? undefined
          : nextOccurrence(occurrence, scheduled.recurrence, scheduled.anchorDate);
    }
  }

  for (const entries of Object.values(plannedByMonth)) {
    entries.sort((a, b) => a.displayDate.localeCompare(b.displayDate));
  }

  // Monthly inflow/outflow summaries; transfers move money between own accounts and are
  // excluded so they don't read as income/expenses
  const monthlySummaries: Record<number, PlannedMonthlySummary> = {};
  for (const [yearMonthStr, entries] of Object.entries(plannedByMonth)) {
    const yearMonth = parseInt(yearMonthStr, 10);
    const flowEntries = entries.filter((entry) => !entry.isTransfer);

    const summarize = (items: PlannedMonthlyEntry[], isInflow: boolean): PlannedFlowSummary => {
      let totalExpected = 0n;
      let totalPaid = 0n;
      let paidCount = 0;
      for (const item of items) {
        if (item.coverage.status === 'skipped') continue;
        if (item.coverage.status === 'paid') {
          totalExpected += item.coverage.paidAmount;
          totalPaid += item.coverage.paidAmount;
          paidCount += 1;
        } else {
          totalExpected += isInflow ? item.coverage.expectedAmount : -item.coverage.expectedAmount;
        }
      }
      return {
        totalExpected,
        totalPaid,
        totalRemaining: totalExpected - totalPaid,
        percentPaid: safePercent(totalPaid, totalExpected),
        count: items.length,
        paidCount,
      };
    };

    monthlySummaries[yearMonth] = {
      inflow: summarize(
        flowEntries.filter((entry) => entry.coverage.expectedAmount > 0n),
        true
      ),
      outflow: summarize(
        flowEntries.filter((entry) => entry.coverage.expectedAmount < 0n),
        false
      ),
    };
  }

  return {
    today,
    availableRange: {
      minYearMonth,
      maxYearMonth,
    },
    allPlannedTransactions,
    plannedByMonth,
    monthlySummaries,
    skippedHistoryTruncated: skipHistory.length > MAX_OCCURRENCE_HISTORY,
    occurrenceHistoryTruncated: occurrenceHistory.length > MAX_OCCURRENCE_HISTORY,
    transactionHistoryTruncated,
    pendingHistoryTruncated,
    unenteredHistoryTruncated,
  };
}
