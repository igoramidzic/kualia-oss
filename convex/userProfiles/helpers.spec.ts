import { describe, expect, it } from 'vitest';

import { nextCheckIn, normalizeProfileName } from './helpers';

describe('normalizeProfileName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeProfileName('  Mary   Ann  ')).toBe('Mary Ann');
  });

  it('omits blank names', () => {
    expect(normalizeProfileName('   ')).toBeUndefined();
    expect(normalizeProfileName(null)).toBeUndefined();
    expect(normalizeProfileName(undefined)).toBeUndefined();
  });
});

describe('daily check-ins', () => {
  it('starts with the first observed day instead of inventing login history', () => {
    expect(nextCheckIn(undefined, 'America/New_York', new Date('2026-09-09T02:00:00Z'))).toEqual({
      days: 1,
      lastDate: '2026-09-08',
      timezone: 'America/New_York',
      startedAt: '2026-09-09T02:00:00.000Z',
    });
  });

  it('deduplicates devices, replays, and UTC midnight in the same account day', () => {
    const first = nextCheckIn(undefined, 'America/New_York', new Date('2026-09-08T22:00:00Z'));
    expect(nextCheckIn(first, 'Asia/Tokyo', new Date('2026-09-09T03:59:59Z'))).toBe(first);
    expect(nextCheckIn(first, 'UTC', new Date('2026-09-09T04:00:00Z'))).toEqual({
      ...first,
      days: 2,
      lastDate: '2026-09-09',
    });
  });

  it('counts visits, not elapsed days or a consecutive streak', () => {
    const first = nextCheckIn(undefined, 'UTC', new Date('2026-09-01T12:00:00Z'));
    expect(nextCheckIn(first, 'UTC', new Date('2026-09-08T12:00:00Z'))).toEqual({
      ...first,
      days: 2,
      lastDate: '2026-09-08',
    });
    expect(nextCheckIn(first, 'UTC', new Date('2026-08-31T12:00:00Z'))).toBe(first);
  });

  it('does not count the repeated hour at the end of daylight saving twice', () => {
    const first = nextCheckIn(undefined, 'America/New_York', new Date('2026-11-01T05:30:00Z'));
    expect(nextCheckIn(first, 'America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe(first);
    expect(nextCheckIn(first, 'UTC', new Date('2026-11-02T05:00:00Z')).days).toBe(2);
  });

  it('uses the shorter local day at the start of daylight saving', () => {
    const first = nextCheckIn(undefined, 'America/New_York', new Date('2026-03-08T05:00:00Z'));
    expect(nextCheckIn(first, 'UTC', new Date('2026-03-09T03:59:59Z'))).toBe(first);
    expect(nextCheckIn(first, 'UTC', new Date('2026-03-09T04:00:00Z')).days).toBe(2);
  });

  it('rejects an invalid initial timezone', () => {
    expect(() => nextCheckIn(undefined, 'invalid/timezone', new Date())).toThrow('valid timezone');
  });
});
