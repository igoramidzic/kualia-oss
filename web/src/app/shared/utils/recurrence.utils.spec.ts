import { describe, expect, it } from 'vitest';
import { RECURRENCE_OPTIONS, recurrenceLabel } from './recurrence.utils';

describe('recurrence.utils', () => {
  it('covers every backend recurrence value exactly once', () => {
    const values = RECURRENCE_OPTIONS.map((option) => option.value);
    expect(values).toEqual([
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
    ]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('maps values to display labels', () => {
    expect(recurrenceLabel('once')).toBe('Never');
    expect(recurrenceLabel('every_other_week')).toBe('Every other week');
    expect(recurrenceLabel('every_three_weeks')).toBe('Every 3 weeks');
    expect(recurrenceLabel('every_four_weeks')).toBe('Every 4 weeks');
    expect(recurrenceLabel('every_four_months')).toBe('Every 4 months');
    expect(recurrenceLabel('twice_a_month')).toBe('Twice a month');
    expect(recurrenceLabel('quarterly')).toBe('Quarterly');
  });

  it('has a non-empty label for every option', () => {
    for (const option of RECURRENCE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(recurrenceLabel(option.value)).toBe(option.label);
    }
  });
});
