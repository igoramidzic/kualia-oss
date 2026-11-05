import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { dateAtHourInTimezoneMs } from '../lib/dates';
import {
  computeNextReminderAt,
  computeNextRunAt,
  isValidIsoDate,
  nextOccurrence,
  nextOccurrenceAfter,
  occurrenceOnOrAfter,
  SCHEDULED_ENTRY_HOUR,
  SCHEDULED_REMINDER_HOUR,
} from './recurrence';
import {
  buildScheduledTransferMovements as buildTransferMovements,
  getScheduledTransactionType as getScheduleType,
  getScheduledTransferAmount as getTransferAmount,
} from './types';

describe('isValidIsoDate', () => {
  it('accepts valid dates', () => {
    expect(isValidIsoDate('2026-07-09')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true); // leap year
  });

  it('rejects malformed or impossible dates', () => {
    expect(isValidIsoDate('07/09/2026')).toBe(false);
    expect(isValidIsoDate('2026-7-9')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false); // not a leap year
  });
});

describe('nextOccurrence', () => {
  it('throws for once', () => {
    expect(() => nextOccurrence('2026-07-09', 'once', '2026-07-09')).toThrow();
  });

  it('steps daily and weekly recurrences', () => {
    expect(nextOccurrence('2026-07-09', 'daily', '2026-07-09')).toBe('2026-07-10');
    expect(nextOccurrence('2026-07-09', 'weekly', '2026-07-09')).toBe('2026-07-16');
    expect(nextOccurrence('2026-07-09', 'every_other_week', '2026-07-09')).toBe('2026-07-23');
    expect(nextOccurrence('2026-07-09', 'every_three_weeks', '2026-07-09')).toBe('2026-07-30');
    expect(nextOccurrence('2026-07-09', 'every_four_weeks', '2026-07-09')).toBe('2026-08-06');
  });

  it('steps every_four_months with anchor-day clamping', () => {
    expect(nextOccurrence('2026-01-31', 'every_four_months', '2026-01-31')).toBe('2026-05-31');
    expect(nextOccurrence('2026-02-28', 'every_four_months', '2025-10-31')).toBe('2026-06-30');
  });

  it('steps weekly across month and year boundaries', () => {
    expect(nextOccurrence('2026-12-28', 'weekly', '2026-12-28')).toBe('2027-01-04');
  });

  it('keeps monthly occurrences pinned to the anchor day through short months', () => {
    const anchor = '2026-01-31';
    const feb = nextOccurrence('2026-01-31', 'monthly', anchor);
    expect(feb).toBe('2026-02-28');
    expect(nextOccurrence(feb, 'monthly', anchor)).toBe('2026-03-31');
  });

  it('steps every_other_month, quarterly and twice_a_year with anchor-day clamping', () => {
    expect(nextOccurrence('2026-01-31', 'every_other_month', '2026-01-31')).toBe('2026-03-31');
    expect(nextOccurrence('2026-01-31', 'quarterly', '2026-01-31')).toBe('2026-04-30');
    expect(nextOccurrence('2026-04-30', 'quarterly', '2026-01-31')).toBe('2026-07-31');
    expect(nextOccurrence('2026-08-31', 'twice_a_year', '2026-08-31')).toBe('2027-02-28');
  });

  it('handles Feb 29 anchors for yearly recurrences', () => {
    const anchor = '2028-02-29';
    const next = nextOccurrence('2028-02-29', 'yearly', anchor);
    expect(next).toBe('2029-02-28');
    expect(nextOccurrence('2031-02-28', 'yearly', anchor)).toBe('2032-02-29');
    expect(nextOccurrence('2028-02-29', 'every_other_year', anchor)).toBe('2030-02-28');
  });

  it('pairs twice_a_month days from the anchor day', () => {
    // Anchor day 5 pairs with the 20th
    expect(nextOccurrence('2026-01-05', 'twice_a_month', '2026-01-05')).toBe('2026-01-20');
    expect(nextOccurrence('2026-01-20', 'twice_a_month', '2026-01-05')).toBe('2026-02-05');
    // Anchor day 20 wraps its partner to the 5th
    expect(nextOccurrence('2026-01-20', 'twice_a_month', '2026-01-20')).toBe('2026-02-05');
    // Anchor day 31 pairs with the 16th and clamps in short months
    expect(nextOccurrence('2026-01-31', 'twice_a_month', '2026-01-31')).toBe('2026-02-16');
    expect(nextOccurrence('2026-02-16', 'twice_a_month', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'twice_a_month', '2026-01-31')).toBe('2026-03-16');
  });
});

describe('nextOccurrenceAfter', () => {
  it('returns the occurrence unchanged when already after the cutoff', () => {
    expect(nextOccurrenceAfter('2026-08-15', 'monthly', '2026-08-15', '2026-07-09')).toBe('2026-08-15');
  });

  it('fast-forwards a stale schedule past the cutoff', () => {
    expect(nextOccurrenceAfter('2026-02-15', 'monthly', '2026-01-15', '2026-07-09')).toBe('2026-07-15');
    expect(nextOccurrenceAfter('2026-07-01', 'weekly', '2026-07-01', '2026-07-09')).toBe('2026-07-15');
  });

  it('advances an occurrence equal to the cutoff', () => {
    expect(nextOccurrenceAfter('2026-07-09', 'daily', '2026-07-09', '2026-07-09')).toBe('2026-07-10');
  });
});

describe('dateAtHourInTimezoneMs / computeNextRunAt', () => {
  it('resolves 7am in fixed-offset timezones', () => {
    // 7am Tokyo (UTC+9) is 22:00 UTC the previous day
    expect(dateAtHourInTimezoneMs('2026-07-15', 7, 'Asia/Tokyo')).toBe(Date.UTC(2026, 6, 14, 22, 0, 0));
  });

  it('respects DST in America/New_York', () => {
    // EST (UTC-5): 7am local = 12:00 UTC
    expect(dateAtHourInTimezoneMs('2026-01-15', 7, 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 12, 0, 0));
    // EDT (UTC-4): 7am local = 11:00 UTC
    expect(dateAtHourInTimezoneMs('2026-07-15', 7, 'America/New_York')).toBe(Date.UTC(2026, 6, 15, 11, 0, 0));
  });

  it('falls back to UTC for missing or invalid timezones', () => {
    expect(dateAtHourInTimezoneMs('2026-07-15', 7, undefined)).toBe(Date.UTC(2026, 6, 15, 7, 0, 0));
    expect(dateAtHourInTimezoneMs('2026-07-15', 7, 'Not/AZone')).toBe(Date.UTC(2026, 6, 15, 7, 0, 0));
  });

  it('computeNextRunAt uses the scheduled entry hour', () => {
    expect(computeNextRunAt('2026-07-15', 'America/New_York')).toBe(
      dateAtHourInTimezoneMs('2026-07-15', SCHEDULED_ENTRY_HOUR, 'America/New_York')
    );
  });
});

describe('computeNextReminderAt', () => {
  const base = {
    nextDate: '2026-08-15',
    recurrence: 'monthly' as const,
    anchorDate: '2026-08-15',
    reminderEnabled: true,
    reminderOffset: '1_day_before' as const,
    status: 'active' as const,
    timezone: 'America/New_York',
  };
  const nyReminderAt = (date: string) => dateAtHourInTimezoneMs(date, SCHEDULED_REMINDER_HOUR, 'America/New_York');

  it('fires reminderOffset days before the next occurrence at the reminder hour', () => {
    const now = Date.UTC(2026, 6, 9, 12, 0, 0);
    expect(computeNextReminderAt({ ...base, now })).toBe(nyReminderAt('2026-08-14'));
    expect(computeNextReminderAt({ ...base, reminderOffset: 'on_due_date', now })).toBe(nyReminderAt('2026-08-15'));
    expect(computeNextReminderAt({ ...base, reminderOffset: '1_week_before', now })).toBe(nyReminderAt('2026-08-08'));
  });

  it('returns undefined when disabled, missing an offset, or not active', () => {
    const now = Date.UTC(2026, 6, 9, 12, 0, 0);
    expect(computeNextReminderAt({ ...base, reminderEnabled: false, now })).toBeUndefined();
    expect(computeNextReminderAt({ ...base, reminderOffset: undefined, now })).toBeUndefined();
    expect(computeNextReminderAt({ ...base, status: 'paused', now })).toBeUndefined();
    expect(computeNextReminderAt({ ...base, status: 'completed', now })).toBeUndefined();
  });

  it('steps to the following occurrence when the reminder moment has passed', () => {
    // Just after the Aug 14 reminder fired: next is Sep 14 (for the Sep 15 occurrence)
    const now = nyReminderAt('2026-08-14') + 1;
    expect(computeNextReminderAt({ ...base, now })).toBe(nyReminderAt('2026-09-14'));
  });

  it('keeps reminding about future occurrences while a manual occurrence sits unentered', () => {
    // nextDate months in the past (ignored manual schedule): reminder lands on the first
    // occurrence whose reminder moment is still ahead of now
    const now = Date.UTC(2026, 6, 9, 12, 0, 0); // Jul 9
    expect(computeNextReminderAt({ ...base, nextDate: '2026-03-15', anchorDate: '2026-03-15', now })).toBe(
      nyReminderAt('2026-07-14')
    );
  });

  it('returns undefined for a once schedule whose reminder moment has passed', () => {
    const now = nyReminderAt('2026-08-14') + 1;
    expect(computeNextReminderAt({ ...base, recurrence: 'once', now })).toBeUndefined();
  });
});

describe('scheduled transfer template helpers', () => {
  it('defaults existing rows without a type to regular', () => {
    expect(getScheduleType({})).toBe('regular');
    expect(getScheduleType({ transactionType: 'transfer' })).toBe('transfer');
  });

  it('stores transfer schedules as a single positive movement with category metadata', () => {
    const categoryId = 'category-1' as Id<'category'>;

    expect(
      buildTransferMovements({
        amount: 12500n,
        categoryId,
        readyToAssign: false,
      })
    ).toEqual([
      {
        amount: 12500n,
        categoryId,
        readyToAssign: false,
      },
    ]);
  });

  it('reads and validates the scheduled transfer amount', () => {
    expect(getTransferAmount([{ amount: 12500n }])).toBe(12500n);
    expect(() => getTransferAmount([])).toThrow('Scheduled transfers must have exactly one movement');
    expect(() => getTransferAmount([{ amount: -12500n }])).toThrow('Scheduled transfer amount must be positive');
    expect(() => buildTransferMovements({ amount: 0n })).toThrow('Transfer amount must be positive');
  });
});

describe('seeking an occurrence without expanding earlier years', () => {
  it.each([
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
  ] as const)('preserves the phase and anchor for %s', (recurrence) => {
    for (const anchor of ['2024-01-31', '2024-02-29', '2024-04-15']) {
      for (const target of ['2024-02-01', '2025-03-17', '2036-02-29']) {
        let expected = anchor;
        while (expected < target) expected = nextOccurrence(expected, recurrence, anchor);
        expect(occurrenceOnOrAfter(anchor, recurrence, anchor, target)).toBe(expected);
      }
    }
  });
  it('jumps centuries of daily plans directly and includes a due-today occurrence', () => {
    expect(occurrenceOnOrAfter('2026-09-06', 'daily', '2026-09-06', '2099-12-01')).toBe('2099-12-01');
    expect(occurrenceOnOrAfter('2026-09-06', 'once', '2026-09-06', '2026-09-06')).toBe('2026-09-06');
    expect(occurrenceOnOrAfter('2026-09-06', 'once', '2026-09-06', '2026-09-07')).toBeUndefined();
  });
});

describe('stale schedule seeking', () => {
  it('finds a future reminder for daily schedules overdue longer than the old scan cap', () => {
    expect(
      computeNextReminderAt({
        nextDate: '2020-01-01',
        anchorDate: '2020-01-01',
        recurrence: 'daily',
        reminderEnabled: true,
        reminderOffset: '1_month_before',
        status: 'active',
        timezone: 'America/New_York',
        now: Date.UTC(2026, 8, 16, 14),
      })
    ).toBe(dateAtHourInTimezoneMs('2026-09-17', SCHEDULED_REMINDER_HOUR, 'America/New_York'));
  });

  it('keeps a due-today reminder before its local firing hour', () => {
    expect(
      computeNextReminderAt({
        nextDate: '2020-01-01',
        anchorDate: '2020-01-01',
        recurrence: 'daily',
        reminderEnabled: true,
        reminderOffset: 'on_due_date',
        status: 'active',
        timezone: 'Asia/Tokyo',
        now: Date.UTC(2026, 8, 15, 23),
      })
    ).toBe(dateAtHourInTimezoneMs('2026-09-16', SCHEDULED_REMINDER_HOUR, 'Asia/Tokyo'));
  });

  it('seeks past centuries without stepping through each daily occurrence', () => {
    expect(nextOccurrenceAfter('1900-01-01', 'daily', '1900-01-01', '2099-12-31')).toBe('2100-01-01');
    expect(nextOccurrenceAfter('1900-01-31', 'twice_a_month', '1900-01-31', '2099-02-16')).toBe('2099-02-28');
  });
});
