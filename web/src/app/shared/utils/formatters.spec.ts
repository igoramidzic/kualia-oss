import { describe, expect, it } from 'vitest';

import { formatCurrency } from './formatters';

describe('formatCurrency', () => {
  it('uses currency-specific decimal places for base units', () => {
    expect(formatCurrency(1_193_320n, 'USD')).toBe('$11,933.20');
    expect(formatCurrency(1_193_320n, 'VND')).toBe('₫1,193,320');
  });
});
