import { describe, expect, it } from 'vitest';

import { getReportSectionAmounts } from './directional';

describe('getReportSectionAmounts', () => {
  it('preserves the legacy net contract when the client does not opt in', () => {
    expect(getReportSectionAmounts(85_000n, 233_134n)).toEqual({
      inflow: 0n,
      outflow: 148_134n,
    });
    expect(getReportSectionAmounts(800n, 1_000n)).toEqual({
      inflow: 0n,
      outflow: 200n,
    });
  });

  it('returns both gross directions for updated clients', () => {
    expect(getReportSectionAmounts(85_000n, 233_134n, true)).toEqual({
      inflow: 85_000n,
      outflow: 233_134n,
    });
    expect(getReportSectionAmounts(800n, 1_000n, true)).toEqual({
      inflow: 800n,
      outflow: 1_000n,
    });
  });
});
