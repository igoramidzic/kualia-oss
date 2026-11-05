import { ConvexError } from 'convex/values';
import { getCurrentDateForTimezone } from '../lib/dates';
import type { CheckIn } from './types';

/** Use server time and retain the first timezone across devices and workspace switches. */
export function nextCheckIn(previous: CheckIn | undefined, timezone: string, now: Date): CheckIn {
  const countingTimezone = previous?.timezone ?? timezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: countingTimezone }).format(now);
  } catch (_error: unknown) {
    throw new ConvexError('Choose a valid timezone.');
  }
  const today = getCurrentDateForTimezone(countingTimezone, now);
  // Replays and simultaneous clients must never count a day twice.
  if (previous && today <= previous.lastDate) return previous;
  return {
    days: (previous?.days ?? 0) + 1,
    lastDate: today,
    timezone: countingTimezone,
    startedAt: previous?.startedAt ?? now.toISOString(),
  };
}

export function normalizeProfileName(name: string | null | undefined): string | undefined {
  const normalized = name?.trim().replace(/\s+/g, ' ');
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}
