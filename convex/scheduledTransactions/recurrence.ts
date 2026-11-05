/**
 * Pure calculation functions for scheduled transaction recurrence.
 * No database dependencies - all functions accept plain objects/primitives.
 */

import {
  addDays,
  addMonths,
  dateAtHourInTimezoneMs,
  getCurrentDateForTimezone,
  getDueDateForMonth,
  getDueDateForYear,
} from '../lib/dates';
import type { Recurrence, ScheduledReminderOffset } from './types';

function getOffsetDays(offset: ScheduledReminderOffset): number {
  switch (offset) {
    case 'on_due_date':
      return 0;
    case '1_day_before':
      return 1;
    case '2_days_before':
      return 2;
    case '1_week_before':
      return 7;
    case '1_month_before':
      return 30;
  }
}

/**
 * Local hour (in the workspace timezone) at which due scheduled transactions are entered
 * into the register. YNAB enters at midnight local time; we intentionally enter in the
 * morning instead so the transaction shows up "when the user wakes up" rather than
 * appearing to post overnight.
 */
export const SCHEDULED_ENTRY_HOUR = 7;

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const [year, month, day] = date.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(year, month);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The two days of the month a twice_a_month schedule falls on, derived from the anchor
 * day: the anchor day and the day 15 days away (wrapped into the same month, matching
 * YNAB's "date picked + 15 days" pairing). Days beyond a short month's end are clamped
 * at occurrence time.
 */
function twiceAMonthDays(anchorDay: number): [number, number] {
  const partner = anchorDay <= 15 ? anchorDay + 15 : anchorDay - 15;
  return anchorDay < partner ? [anchorDay, partner] : [partner, anchorDay];
}

function nextTwiceAMonth(current: string, anchorDate: string): string {
  const anchorDay = Number(anchorDate.split('-')[2]);
  const [dayA, dayB] = twiceAMonthDays(anchorDay);
  const [year, month] = current.split('-').map(Number);

  const months: [number, number][] = [[year, month], month === 12 ? [year + 1, 1] : [year, month + 1]];

  const candidates: string[] = [];
  for (const [y, m] of months) {
    for (const day of [dayA, dayB]) {
      candidates.push(`${y}-${pad(m)}-${pad(Math.min(day, lastDayOfMonth(y, m)))}`);
    }
  }

  // Always exists: next month's earlier day is strictly after `current`
  return candidates.filter((candidate) => candidate > current).sort()[0];
}

/**
 * Step by whole months, re-deriving the day of month from the anchor so occurrences stay
 * pinned to the original day (anchor Jan 31 -> Feb 28 -> Mar 31).
 */
function stepMonths(current: string, months: number, anchorDate: string): string {
  const temp = addMonths(current, months);
  const [year, month] = temp.split('-').map(Number);
  return getDueDateForMonth(anchorDate, year, month);
}

function stepYears(current: string, years: number, anchorDate: string): string {
  const targetYear = Number(current.split('-')[0]) + years;
  return getDueDateForYear(anchorDate, targetYear);
}

/**
 * The occurrence immediately after `current` for a recurring schedule.
 *
 * @param current The occurrence being advanced from (a date produced by this schedule).
 * @param anchorDate The first occurrence as the user set it; pins day-of-month/year for
 *   monthly-style recurrences and the day pair for twice_a_month.
 */
export function nextOccurrence(current: string, recurrence: Recurrence, anchorDate: string): string {
  switch (recurrence) {
    case 'once':
      throw new Error('A once schedule has no next occurrence');
    case 'daily':
      return addDays(current, 1);
    case 'weekly':
      return addDays(current, 7);
    case 'every_other_week':
      return addDays(current, 14);
    case 'every_three_weeks':
      return addDays(current, 21);
    case 'every_four_weeks':
      return addDays(current, 28);
    case 'twice_a_month':
      return nextTwiceAMonth(current, anchorDate);
    case 'monthly':
      return stepMonths(current, 1, anchorDate);
    case 'every_other_month':
      return stepMonths(current, 2, anchorDate);
    case 'quarterly':
      return stepMonths(current, 3, anchorDate);
    case 'every_four_months':
      return stepMonths(current, 4, anchorDate);
    case 'twice_a_year':
      return stepMonths(current, 6, anchorDate);
    case 'yearly':
      return stepYears(current, 1, anchorDate);
    case 'every_other_year':
      return stepYears(current, 2, anchorDate);
  }
}

/**
 * The first occurrence strictly after `afterDate`, starting from a known occurrence.
 * Used to fast-forward a schedule past today (e.g. after "enter now" or when a schedule
 * is re-dated into the past).
 */
export function nextOccurrenceAfter(
  fromOccurrence: string,
  recurrence: Recurrence,
  anchorDate: string,
  afterDate: string
): string {
  const next = occurrenceOnOrAfter(fromOccurrence, recurrence, anchorDate, addDays(afterDate, 1));
  if (next === undefined) throw new Error('A once schedule has no next occurrence');
  return next;
}

/** Seek without expanding intervening years. Legacy history may precede a reset anchor. */
export function occurrenceOnOrAfter(
  from: string,
  recurrence: Recurrence,
  anchor: string,
  start: string,
  options: { includeEarlierOccurrences?: boolean } = {}
): string | undefined {
  if (from >= start && (!options.includeEarlierOccurrences || recurrence === 'once')) return from;
  if (recurrence === 'once') return undefined;
  const daySteps: Partial<Record<Recurrence, number>> = {
    daily: 1,
    weekly: 7,
    every_other_week: 14,
    every_three_weeks: 21,
    every_four_weeks: 28,
  };
  const days = daySteps[recurrence];
  if (days !== undefined) {
    const distance = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    return addDays(from, Math.ceil(distance / days) * days);
  }
  if (recurrence === 'twice_a_month') {
    const first = nextOccurrence(addDays(`${start.slice(0, 7)}-01`, -1), recurrence, anchor);
    return first >= start ? first : nextOccurrence(first, recurrence, anchor);
  }
  const monthSteps: Partial<Record<Recurrence, number>> = {
    monthly: 1,
    every_other_month: 2,
    quarterly: 3,
    every_four_months: 4,
    twice_a_year: 6,
    yearly: 12,
    every_other_year: 24,
  };
  const step = monthSteps[recurrence] ?? 1;
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [startYear, startMonth] = start.split('-').map(Number);
  const distance = (startYear - fromYear) * 12 + startMonth - fromMonth;
  const jumped = stepMonths(from, Math.floor(distance / step) * step, anchor);
  return jumped >= start ? jumped : nextOccurrence(jumped, recurrence, anchor);
}

/**
 * Epoch-ms moment the cron should auto-enter a schedule due on `nextDate`:
 * SCHEDULED_ENTRY_HOUR local time in the workspace timezone on that date.
 */
export function computeNextRunAt(nextDate: string, timezone: string | undefined): number {
  return dateAtHourInTimezoneMs(nextDate, SCHEDULED_ENTRY_HOUR, timezone);
}

/** Local hour reminders fire at. */
export const SCHEDULED_REMINDER_HOUR = 9;

/** Recover the bill date represented by a stored reminder, even if nextDate is overdue. */
export function getReminderOccurrenceDate(
  reminderAt: number,
  offset: ScheduledReminderOffset,
  timezone: string | undefined
): string {
  return addDays(getCurrentDateForTimezone(timezone, new Date(reminderAt)), getOffsetDays(offset));
}

/**
 * Epoch-ms moment of the next due-date reminder: SCHEDULED_REMINDER_HOUR local time,
 * `reminderOffset` days before the first occurrence whose reminder moment is still in the
 * future. Occurrences whose reminder moment has already passed are stepped over (without
 * touching the schedule's stored nextDate), so manual-mode schedules keep getting
 * reminders for future occurrences even while an old occurrence sits unentered.
 *
 * Returns undefined when reminders are off, the schedule is not active, or (for 'once')
 * the single reminder moment has passed.
 */
export function computeNextReminderAt(args: {
  nextDate: string;
  recurrence: Recurrence;
  anchorDate: string;
  reminderEnabled?: boolean;
  reminderOffset?: ScheduledReminderOffset;
  status: 'active' | 'paused' | 'completed';
  timezone: string | undefined;
  now: number;
}): number | undefined {
  if (!args.reminderEnabled || !args.reminderOffset || args.status !== 'active') {
    return undefined;
  }

  const offsetDays = getOffsetDays(args.reminderOffset);
  // Seek directly to the first date that could have a future reminder. This keeps
  // reminders working even when a manual schedule has been overdue for years.
  const earliestDueDate = addDays(getCurrentDateForTimezone(args.timezone, new Date(args.now)), offsetDays);
  let occurrence = occurrenceOnOrAfter(args.nextDate, args.recurrence, args.anchorDate, earliestDueDate);
  while (occurrence !== undefined) {
    const reminderAt = dateAtHourInTimezoneMs(addDays(occurrence, -offsetDays), SCHEDULED_REMINDER_HOUR, args.timezone);
    if (reminderAt > args.now) {
      return reminderAt;
    }
    if (args.recurrence === 'once') {
      return undefined;
    }
    occurrence = nextOccurrence(occurrence, args.recurrence, args.anchorDate);
  }
  return undefined;
}
