import type { Recurrence } from 'convex/scheduledTransactions/types';

export type { Recurrence };

/**
 * Display labels for scheduled-transaction recurrence values, in picker order.
 * 'once' means the schedule completes after a single occurrence.
 */
export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'once', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'every_other_week', label: 'Every other week' },
  { value: 'every_three_weeks', label: 'Every 3 weeks' },
  { value: 'every_four_weeks', label: 'Every 4 weeks' },
  { value: 'twice_a_month', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'every_other_month', label: 'Every other month' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'every_four_months', label: 'Every 4 months' },
  { value: 'twice_a_year', label: 'Twice a year' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'every_other_year', label: 'Every other year' },
];

export function recurrenceLabel(recurrence: Recurrence): string {
  return RECURRENCE_OPTIONS.find((option) => option.value === recurrence)?.label ?? recurrence;
}
