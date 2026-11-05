import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { validateTransferAccounts } from '../transactions/helpers';

import { computeNextReminderAt, computeNextRunAt, isValidIsoDate } from './recurrence';
import type {
  EntryMode,
  Recurrence,
  ScheduledMovementInput,
  ScheduledReminderOffset,
  ScheduledTransactionType,
} from './types';
import { getScheduledEntryMode, getScheduledTransactionType, getScheduledTransferAmount } from './types';

export type CreateScheduledTransactionRecordArgs = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  transactionType?: ScheduledTransactionType;
  transferToAccountId?: Id<'bankAccount'>;
  merchantId?: Id<'merchant'>;
  notes?: string;
  entryStatus: 'pending' | 'cleared';
  entryMode?: EntryMode;
  movements: ScheduledMovementInput[];
  recurrence: Recurrence;
  anchorDate: string;
  nextDate: string;
  timezone: string | undefined;
  createdBy?: Id<'userProfile'>;
  reminderEnabled?: boolean;
  reminderOffset?: ScheduledReminderOffset;
  // Seed values for schedules created alongside an already-entered transaction
  // (immediate create with a recurrence)
  executionCount?: number;
  lastEnteredAt?: string;
  lastEnteredTransactionId?: Id<'transaction'>;
};

export async function validateScheduledTransactionTemplate(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    bankAccountId: Id<'bankAccount'>;
    transactionType?: ScheduledTransactionType;
    transferToAccountId?: Id<'bankAccount'>;
    merchantId?: Id<'merchant'>;
    movements: ScheduledMovementInput[];
  }
): Promise<void> {
  const transactionType = getScheduledTransactionType(args);

  if (transactionType === 'transfer') {
    if (!args.transferToAccountId) {
      throw new ConvexError('Destination account is required for scheduled transfers');
    }
    if (args.merchantId) {
      throw new ConvexError('Transfers do not support merchants');
    }
    getScheduledTransferAmount(args.movements);
    await validateTransferAccounts(ctx, args.bankAccountId, args.transferToAccountId, args.workspaceId);
    return;
  }

  if (args.transferToAccountId) {
    throw new ConvexError('Destination account is only supported for scheduled transfers');
  }

  const bankAccount = await ctx.db.get(args.bankAccountId);
  if (!bankAccount || bankAccount.isDeleted) {
    throw new ConvexError('Bank account not found');
  }
  if (bankAccount.workspaceId !== args.workspaceId) {
    throw new ConvexError('Access denied to workspace');
  }

  if (args.movements.length === 0) {
    throw new ConvexError('At least one movement is required');
  }
}

/**
 * Insert a scheduledTransaction row. Workspace access must already have been verified by
 * the caller; this validates the bank account and dates.
 */
export async function createScheduledTransactionRecord(
  ctx: MutationCtx,
  args: CreateScheduledTransactionRecordArgs
): Promise<Id<'scheduledTransaction'>> {
  if (!isValidIsoDate(args.anchorDate) || !isValidIsoDate(args.nextDate)) {
    throw new ConvexError('date must be a valid YYYY-MM-DD date');
  }

  const transactionType = getScheduledTransactionType(args);
  await validateScheduledTransactionTemplate(ctx, {
    workspaceId: args.workspaceId,
    bankAccountId: args.bankAccountId,
    transactionType,
    transferToAccountId: args.transferToAccountId,
    merchantId: args.merchantId,
    movements: args.movements,
  });

  const entryMode = getScheduledEntryMode(args);

  return ctx.db.insert('scheduledTransaction', {
    workspaceId: args.workspaceId,
    bankAccountId: args.bankAccountId,
    transactionType,
    transferToAccountId: transactionType === 'transfer' ? args.transferToAccountId : undefined,
    merchantId: args.merchantId,
    notes: args.notes,
    entryStatus: args.entryStatus,
    entryMode,
    movements: args.movements,
    recurrence: args.recurrence,
    anchorDate: args.anchorDate,
    nextDate: args.nextDate,
    nextRunAt: entryMode === 'auto' ? computeNextRunAt(args.nextDate, args.timezone) : undefined,
    status: 'active',
    executionCount: args.executionCount ?? 0,
    lastEnteredAt: args.lastEnteredAt,
    lastEnteredTransactionId: args.lastEnteredTransactionId,
    reminderEnabled: args.reminderEnabled,
    reminderOffset: args.reminderOffset,
    nextReminderAt: computeNextReminderAt({
      nextDate: args.nextDate,
      recurrence: args.recurrence,
      anchorDate: args.anchorDate,
      reminderEnabled: args.reminderEnabled,
      reminderOffset: args.reminderOffset,
      status: 'active',
      timezone: args.timezone,
      now: Date.now(),
    }),
    createdBy: args.createdBy,
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  });
}

/**
 * Default entry mode for a schedule created on `bankAccountId`: accounts fed by an import
 * pipeline (bank link / FinanceKit) default to manual entry so the imported charge — which
 * may post a day or two after the due date — remains the source of truth; unlinked accounts
 * default to auto entry since nothing else will ever create the transaction.
 */
export async function defaultEntryModeForAccount(
  ctx: MutationCtx,
  bankAccountId: Id<'bankAccount'>
): Promise<EntryMode> {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (bankAccount && (bankAccount.bankLinkAccountId || bankAccount.financeKitAccountId)) {
    return 'manual';
  }
  return 'auto';
}

/**
 * The account a schedule should default to when none can be derived from context:
 * the workspace's default transaction account, else the first account in the user's
 * configured ordering, else the oldest account. Null only when the workspace has no
 * usable accounts at all.
 */
export async function pickDefaultAccountForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>
): Promise<Id<'bankAccount'> | null> {
  const accounts = (
    await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect()
  ).filter((account) => !account.isDeleted && !account.isClosed);
  if (accounts.length === 0) {
    return null;
  }

  const alive = new Set(accounts.map((account) => account._id));
  const workspace = await ctx.db.get(workspaceId);

  if (workspace?.transactionDefaultAccountId && alive.has(workspace.transactionDefaultAccountId)) {
    return workspace.transactionDefaultAccountId;
  }

  const ordering = workspace?.bankAccountOrdering;
  if (ordering) {
    for (const group of ordering.groupOrder) {
      for (const accountId of ordering.accountOrderByGroup[group] ?? []) {
        if (alive.has(accountId)) {
          return accountId;
        }
      }
    }
  }

  accounts.sort((a, b) => a._creationTime - b._creationTime);
  return accounts[0]._id;
}

/**
 * High-confidence matching for imported bank transactions and manual-entry
 * scheduled transactions.
 *
 * Scoring weights (total 100):
 * - Amount match: 35 points
 * - Merchant match: 30 points
 * - Category match: 15 points
 * - Date proximity to the next occurrence: 20 points
 *
 * Account and amount direction must match. Only manual-entry schedules are
 * eligible because auto-entry schedules already create their own transaction.
 */
const SCHEDULED_MATCH_WEIGHTS = {
  amount: 35,
  merchant: 30,
  category: 15,
  dateProximity: 20,
};

export const AUTO_LINK_THRESHOLD = 85;
export const AUTO_LINK_MAX_DAYS_FROM_DUE = 5;

export type ScheduledMatchingCache = {
  scheduledTransactionsByAccount: Map<Id<'bankAccount'>, Doc<'scheduledTransaction'>[]>;
};

export type ScheduledMatchCandidate = {
  scheduledTransaction: Doc<'scheduledTransaction'>;
  confidence: number;
  daysFromDue: number;
  reason: string;
  scores: {
    amount: number;
    merchant: number;
    category: number;
    dateProximity: number;
  };
};

export type ScheduledMatchInput = {
  bankAccountId: Id<'bankAccount'>;
  merchantId?: Id<'merchant'>;
  categoryId?: Id<'category'>;
  amount: bigint;
  date: string;
};

function absoluteAmount(amount: bigint): bigint {
  return amount < 0n ? -amount : amount;
}

function daysBetween(dateA: string, dateB: string): number {
  const millisPerDay = 24 * 60 * 60 * 1000;
  const first = Date.parse(`${dateA}T00:00:00.000Z`);
  const second = Date.parse(`${dateB}T00:00:00.000Z`);
  return Math.abs(Math.round((first - second) / millisPerDay));
}

function isEligibleScheduledTransaction(scheduled: Doc<'scheduledTransaction'>): boolean {
  return (
    !scheduled.isDeleted &&
    scheduled.status === 'active' &&
    getScheduledEntryMode(scheduled) === 'manual' &&
    getScheduledTransactionType(scheduled) === 'regular'
  );
}

export async function initializeScheduledMatchingCache(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<ScheduledMatchingCache> {
  const scheduledTransactions = await ctx.db
    .query('scheduledTransaction')
    .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspaceId).eq('isDeleted', false))
    .collect();

  const scheduledTransactionsByAccount = new Map<Id<'bankAccount'>, Doc<'scheduledTransaction'>[]>();
  for (const scheduled of scheduledTransactions) {
    if (!isEligibleScheduledTransaction(scheduled)) {
      continue;
    }
    const accountSchedules = scheduledTransactionsByAccount.get(scheduled.bankAccountId) ?? [];
    accountSchedules.push(scheduled);
    scheduledTransactionsByAccount.set(scheduled.bankAccountId, accountSchedules);
  }

  return { scheduledTransactionsByAccount };
}

export function removeScheduledMatchingCandidate(
  cache: ScheduledMatchingCache,
  scheduledTransactionId: Id<'scheduledTransaction'>
): void {
  for (const [bankAccountId, scheduledTransactions] of cache.scheduledTransactionsByAccount) {
    const remaining = scheduledTransactions.filter((scheduled) => scheduled._id !== scheduledTransactionId);
    if (remaining.length === 0) {
      cache.scheduledTransactionsByAccount.delete(bankAccountId);
    } else if (remaining.length !== scheduledTransactions.length) {
      cache.scheduledTransactionsByAccount.set(bankAccountId, remaining);
    }
  }
}

export function calculateScheduledMatchScore(
  input: ScheduledMatchInput,
  scheduled: Doc<'scheduledTransaction'>
): ScheduledMatchCandidate | null {
  if (
    !isEligibleScheduledTransaction(scheduled) ||
    scheduled.bankAccountId !== input.bankAccountId ||
    input.amount === 0n
  ) {
    return null;
  }

  const expectedAmount = scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n);
  if (expectedAmount === 0n || input.amount > 0n !== expectedAmount > 0n) {
    return null;
  }

  const daysFromDue = daysBetween(input.date, scheduled.nextDate);
  if (daysFromDue > AUTO_LINK_MAX_DAYS_FROM_DUE) {
    return null;
  }

  const scores = {
    amount: 0,
    merchant: 0,
    category: 0,
    dateProximity: 0,
  };

  const transactionAmount = absoluteAmount(input.amount);
  const plannedAmount = absoluteAmount(expectedAmount);
  if (transactionAmount === plannedAmount) {
    scores.amount = SCHEDULED_MATCH_WEIGHTS.amount;
  } else {
    const maxAmount = transactionAmount > plannedAmount ? transactionAmount : plannedAmount;
    const difference =
      transactionAmount > plannedAmount ? transactionAmount - plannedAmount : plannedAmount - transactionAmount;
    const differencePercent = Number((difference * 100n) / maxAmount);

    if (differencePercent <= 5) {
      scores.amount = Math.round(SCHEDULED_MATCH_WEIGHTS.amount * 0.9);
    } else if (differencePercent <= 10) {
      scores.amount = Math.round(SCHEDULED_MATCH_WEIGHTS.amount * 0.7);
    } else if (differencePercent <= 15) {
      scores.amount = Math.round(SCHEDULED_MATCH_WEIGHTS.amount * 0.4);
    }
  }

  if (scheduled.merchantId && input.merchantId) {
    if (scheduled.merchantId === input.merchantId) {
      scores.merchant = SCHEDULED_MATCH_WEIGHTS.merchant;
    }
  } else if (!scheduled.merchantId) {
    scores.merchant = Math.round(SCHEDULED_MATCH_WEIGHTS.merchant * 0.2);
  }

  const scheduledCategoryIds = scheduled.movements
    .map((movement) => movement.categoryId)
    .filter((categoryId): categoryId is Id<'category'> => categoryId !== undefined);
  if (input.categoryId && scheduledCategoryIds.includes(input.categoryId)) {
    scores.category = SCHEDULED_MATCH_WEIGHTS.category;
  } else if (scheduledCategoryIds.length === 0) {
    scores.category = Math.round(SCHEDULED_MATCH_WEIGHTS.category * 0.2);
  }

  if (daysFromDue === 0) {
    scores.dateProximity = SCHEDULED_MATCH_WEIGHTS.dateProximity;
  } else if (daysFromDue <= 2) {
    scores.dateProximity = Math.round(SCHEDULED_MATCH_WEIGHTS.dateProximity * 0.8);
  } else if (daysFromDue <= 4) {
    scores.dateProximity = Math.round(SCHEDULED_MATCH_WEIGHTS.dateProximity * 0.5);
  } else {
    scores.dateProximity = Math.round(SCHEDULED_MATCH_WEIGHTS.dateProximity * 0.25);
  }

  const confidence = scores.amount + scores.merchant + scores.category + scores.dateProximity;
  const reasonParts: string[] = [];
  if (scores.amount >= SCHEDULED_MATCH_WEIGHTS.amount * 0.8) {
    reasonParts.push('amount matches');
  } else if (scores.amount > 0) {
    reasonParts.push('amount is close');
  }
  if (scores.merchant === SCHEDULED_MATCH_WEIGHTS.merchant) {
    reasonParts.push('same payee');
  }
  if (scores.category === SCHEDULED_MATCH_WEIGHTS.category) {
    reasonParts.push('same category');
  }
  if (daysFromDue === 0) {
    reasonParts.push('on due date');
  } else {
    reasonParts.push(`${daysFromDue} day${daysFromDue === 1 ? '' : 's'} from due`);
  }

  return {
    scheduledTransaction: scheduled,
    confidence,
    daysFromDue,
    reason: reasonParts.join(', '),
    scores,
  };
}

export function findAutoLinkScheduledMatch(
  input: ScheduledMatchInput,
  cache: ScheduledMatchingCache
): ScheduledMatchCandidate | null {
  const candidates = (cache.scheduledTransactionsByAccount.get(input.bankAccountId) ?? [])
    .map((scheduled) => calculateScheduledMatchScore(input, scheduled))
    .filter((candidate): candidate is ScheduledMatchCandidate => candidate !== null)
    .filter((candidate) => candidate.confidence >= AUTO_LINK_THRESHOLD)
    .sort(
      (first, second) =>
        second.confidence - first.confidence ||
        first.daysFromDue - second.daysFromDue ||
        first.scheduledTransaction._creationTime - second.scheduledTransaction._creationTime
    );

  return candidates[0] ?? null;
}
