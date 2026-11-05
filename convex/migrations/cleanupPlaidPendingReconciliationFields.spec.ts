import { describe, expect, it } from 'vitest';

import { hasLegacyPlaidPendingReconciliationFields } from './cleanupPlaidPendingReconciliationFields';

describe('hasLegacyPlaidPendingReconciliationFields', () => {
  it('finds rows that still need round-one cleanup', () => {
    expect(
      hasLegacyPlaidPendingReconciliationFields({
        pendingReconciliationFingerprint: 'legacy-fingerprint',
      })
    ).toBe(true);
  });

  it('skips rows that are already ready for schema narrowing', () => {
    expect(hasLegacyPlaidPendingReconciliationFields({})).toBe(false);
  });
});
