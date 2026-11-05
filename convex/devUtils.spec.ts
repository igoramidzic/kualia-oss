import { describe, expect, it } from 'vitest';

import {
  deleteAllTransactionData,
  importGlobalInstitutions,
  testDailyNotification,
  updateBankLinkStatus,
  validateWorkspaceBudgets,
} from './devUtils';

describe('development utility visibility', () => {
  it.each([
    ['deleteAllTransactionData', deleteAllTransactionData],
    ['testDailyNotification', testDailyNotification],
    ['updateBankLinkStatus', updateBankLinkStatus],
    ['validateWorkspaceBudgets', validateWorkspaceBudgets],
    ['importGlobalInstitutions', importGlobalInstitutions],
  ])('keeps %s internal-only', (_name, registeredFunction) => {
    expect((registeredFunction as unknown as { isInternal?: boolean }).isInternal).toBe(true);
  });
});
