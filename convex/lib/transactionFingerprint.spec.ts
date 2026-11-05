import { describe, expect, it } from 'vitest';

import { buildImportFingerprint } from './transactionFingerprint';

describe('buildImportFingerprint', () => {
  it('produces the same key for identical inputs', () => {
    const a = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'Starbucks' });
    const b = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'Starbucks' });
    expect(a).toBe(b);
  });

  it('treats merchant variants that standardize to the same value as duplicates', () => {
    const a = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'STARBUCKS Store #4421' });
    const b = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'starbucks' });
    expect(a).toBe(b);
  });

  it('produces distinct keys when sign differs (refund vs charge of the same magnitude)', () => {
    const charge = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'Starbucks' });
    const refund = buildImportFingerprint({ date: '2026-04-15', amount: 4250n, merchantName: 'Starbucks' });
    expect(charge).not.toBe(refund);
  });

  it('produces distinct keys when the date differs', () => {
    const day1 = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: 'Starbucks' });
    const day2 = buildImportFingerprint({ date: '2026-04-16', amount: -4250n, merchantName: 'Starbucks' });
    expect(day1).not.toBe(day2);
  });

  it('handles missing merchant by leaving an empty trailing segment', () => {
    const fingerprint = buildImportFingerprint({ date: '2026-04-15', amount: -4250n, merchantName: undefined });
    expect(fingerprint).toBe('2026-04-15|-4250|');
  });
});
