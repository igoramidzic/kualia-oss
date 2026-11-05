import { describe, expect, it } from 'vitest';
import { bucketLabel, formatRelativeShort } from './history-buckets';

describe('bucketLabel', () => {
  // Anchor "now" mid-day so timestamps a few hours back still land on the same calendar day.
  const now = new Date('2026-05-06T15:00:00Z');

  const hoursAgo = (h: number): number => now.getTime() - h * 60 * 60 * 1000;
  const daysAgo = (d: number): number => now.getTime() - d * 24 * 60 * 60 * 1000;

  it('treats earlier the same calendar day as "Today"', () => {
    expect(bucketLabel(hoursAgo(2), now)).toBe('Today');
    expect(bucketLabel(hoursAgo(10), now)).toBe('Today');
  });

  it('treats the prior calendar day as "Yesterday"', () => {
    expect(bucketLabel(daysAgo(1), now)).toBe('Yesterday');
  });

  it('groups 2 to 7 days ago into "Previous 7 days"', () => {
    expect(bucketLabel(daysAgo(2), now)).toBe('Previous 7 days');
    expect(bucketLabel(daysAgo(5), now)).toBe('Previous 7 days');
    expect(bucketLabel(daysAgo(7), now)).toBe('Previous 7 days');
  });

  it('groups 8 to 30 days ago into "Previous 30 days"', () => {
    expect(bucketLabel(daysAgo(8), now)).toBe('Previous 30 days');
    expect(bucketLabel(daysAgo(20), now)).toBe('Previous 30 days');
    expect(bucketLabel(daysAgo(30), now)).toBe('Previous 30 days');
  });

  it('groups older same-year timestamps into "Earlier this year"', () => {
    expect(bucketLabel(daysAgo(60), now)).toBe('Earlier this year');
    expect(bucketLabel(daysAgo(120), now)).toBe('Earlier this year');
  });

  it('groups prior-year timestamps into "Older"', () => {
    expect(bucketLabel(daysAgo(400), now)).toBe('Older');
  });
});

describe('formatRelativeShort', () => {
  const now = Date.parse('2026-05-06T15:00:00Z');
  const ago = (ms: number) => now - ms;

  it('reports "now" for sub-minute deltas', () => {
    expect(formatRelativeShort(ago(0), now)).toBe('now');
    expect(formatRelativeShort(ago(45_000), now)).toBe('now');
  });

  it('formats minutes as "Nm"', () => {
    expect(formatRelativeShort(ago(60_000), now)).toBe('1m');
    expect(formatRelativeShort(ago(45 * 60_000), now)).toBe('45m');
  });

  it('formats hours as "Nh"', () => {
    expect(formatRelativeShort(ago(60 * 60_000), now)).toBe('1h');
    expect(formatRelativeShort(ago(12 * 60 * 60_000), now)).toBe('12h');
  });

  it('formats days as "Nd"', () => {
    expect(formatRelativeShort(ago(24 * 60 * 60_000), now)).toBe('1d');
    expect(formatRelativeShort(ago(2 * 24 * 60 * 60_000), now)).toBe('2d');
  });

  it('formats weeks as "Nw" up to ~30 days', () => {
    expect(formatRelativeShort(ago(7 * 24 * 60 * 60_000), now)).toBe('1w');
    expect(formatRelativeShort(ago(20 * 24 * 60 * 60_000), now)).toBe('2w');
  });

  it('formats months as "Nmo" and years as "Ny"', () => {
    expect(formatRelativeShort(ago(60 * 24 * 60 * 60_000), now)).toBe('2mo');
    expect(formatRelativeShort(ago(400 * 24 * 60 * 60_000), now)).toBe('1y');
  });

  it('clamps future timestamps to "now"', () => {
    expect(formatRelativeShort(now + 5_000, now)).toBe('now');
  });
});
