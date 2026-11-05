import { differenceInCalendarDays } from 'date-fns';

export const HISTORY_BUCKET_ORDER = [
  'Today',
  'Yesterday',
  'Previous 7 days',
  'Previous 30 days',
  'Earlier this year',
  'Older',
] as const;

export type HistoryBucket = (typeof HISTORY_BUCKET_ORDER)[number];

/**
 * Bucket a thread into a date-bucket label based on `lastUpdatedAt`. Newest-first ordering of
 * threads inside each bucket is the caller's responsibility (the parent service already returns
 * threads sorted desc by lastUpdatedAt).
 */
export function bucketLabel(timestampMs: number, now: Date): HistoryBucket {
  const date = new Date(timestampMs);
  // Use differenceInCalendarDays against the caller-provided `now` for every bucket so the
  // function is deterministic and testable. date-fns's `isToday`/`isYesterday` ignore the
  // passed-in `now` and read the system clock, which makes them unsafe here.
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  if (days <= 30) return 'Previous 30 days';
  if (date.getFullYear() === now.getFullYear()) return 'Earlier this year';
  return 'Older';
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Compact relative time, single unit, no decimals. Always reports the past — future timestamps
 * are clamped to "now". Matches the convention seen in chat apps (Twitter/Slack-style).
 */
export function formatRelativeShort(timestampMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - timestampMs);
  if (delta < MINUTE_MS) return 'now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h`;
  if (delta < WEEK_MS) return `${Math.floor(delta / DAY_MS)}d`;
  if (delta < MONTH_MS) return `${Math.floor(delta / WEEK_MS)}w`;
  if (delta < YEAR_MS) return `${Math.floor(delta / MONTH_MS)}mo`;
  return `${Math.floor(delta / YEAR_MS)}y`;
}
