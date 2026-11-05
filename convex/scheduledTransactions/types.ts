import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

export const scheduledTransactionTypeValidator = v.union(v.literal('regular'), v.literal('transfer'));

export type ScheduledTransactionType = 'regular' | 'transfer';

/**
 * Recurrence options for scheduled transactions. Modeled on YNAB's scheduled-transaction
 * frequencies, covering bills, subscriptions, paychecks, and one-off future events.
 * 'once' means the schedule completes after its single occurrence is entered.
 */
export const RECURRENCE_VALUES = [
  'once',
  'daily',
  'weekly',
  'every_other_week',
  'every_three_weeks',
  'every_four_weeks',
  'twice_a_month',
  'monthly',
  'every_other_month',
  'quarterly',
  'every_four_months',
  'twice_a_year',
  'yearly',
  'every_other_year',
] as const;

export type Recurrence = (typeof RECURRENCE_VALUES)[number];

export const recurrenceValidator = v.union(
  v.literal('once'),
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('every_other_week'),
  v.literal('every_three_weeks'),
  v.literal('every_four_weeks'),
  v.literal('twice_a_month'),
  v.literal('monthly'),
  v.literal('every_other_month'),
  v.literal('quarterly'),
  v.literal('every_four_months'),
  v.literal('twice_a_year'),
  v.literal('yearly'),
  v.literal('every_other_year')
);

/**
 * How occurrences reach the register. Missing on a row means 'auto'.
 * - auto: the cron enters the transaction on the due date
 * - manual: the occurrence shows as due/overdue until the user enters or skips it
 */
export const ENTRY_MODE_VALUES = ['auto', 'manual'] as const;

export type EntryMode = (typeof ENTRY_MODE_VALUES)[number];

export const entryModeValidator = v.union(v.literal('auto'), v.literal('manual'));

export function getScheduledEntryMode(scheduled: { entryMode?: EntryMode }): EntryMode {
  return scheduled.entryMode ?? 'auto';
}

/** Due-date reminder offsets. */
export const SCHEDULED_REMINDER_OFFSETS = [
  'on_due_date',
  '1_day_before',
  '2_days_before',
  '1_week_before',
  '1_month_before',
] as const;

export type ScheduledReminderOffset = (typeof SCHEDULED_REMINDER_OFFSETS)[number];

export const scheduledReminderOffsetValidator = v.union(
  v.literal('on_due_date'),
  v.literal('1_day_before'),
  v.literal('2_days_before'),
  v.literal('1_week_before'),
  v.literal('1_month_before')
);

export const scheduledMovementsValidator = v.array(
  v.object({
    amount: v.int64(),
    categoryId: v.optional(v.id('category')),
    readyToAssign: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  })
);

export type ScheduledMovementInput = {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  notes?: string;
};

export function getScheduledTransactionType(args: {
  transactionType?: ScheduledTransactionType;
}): ScheduledTransactionType {
  return args.transactionType ?? 'regular';
}

/**
 * Scheduled transfers store a single positive amount plus the optional category metadata
 * used only when the transfer crosses the budget boundary.
 */
export function buildScheduledTransferMovements(args: {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
}): ScheduledMovementInput[] {
  if (args.amount <= 0n) {
    throw new ConvexError('Transfer amount must be positive');
  }

  return [
    {
      amount: args.amount,
      categoryId: args.categoryId,
      readyToAssign: args.readyToAssign,
    },
  ];
}

export function getScheduledTransferAmount(movements: ScheduledMovementInput[]): bigint {
  if (movements.length !== 1) {
    throw new ConvexError('Scheduled transfers must have exactly one movement');
  }

  const amount = movements[0]?.amount;
  if (amount === undefined || amount <= 0n) {
    throw new ConvexError('Scheduled transfer amount must be positive');
  }

  return amount;
}
