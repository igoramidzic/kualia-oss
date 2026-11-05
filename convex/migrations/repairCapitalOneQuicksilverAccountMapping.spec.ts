import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { determineMappingState } from './repairCapitalOneQuicksilverAccountMapping';

const staleLinkId = 'j97ajwdcpcnb4d5tp7rzzyqy8186zerj' as Id<'bankLink'>;
const activeLinkId = 'j97echat2vpewxdqtnd2zrrwvd838fde' as Id<'bankLink'>;
const oldPlaidAccountId = 'kX8RrMarznSvE1MnnL3DTdRjjYp5x5fEvdnd6';
const newPlaidAccountId = 'BrOkQd7P36TBQapVawJnFX5x3jgBqPFvZ7Mdg';

describe('determineMappingState', () => {
  it('recognizes the original and repaired mappings', () => {
    expect(determineMappingState(staleLinkId, oldPlaidAccountId)).toBe('needs_repair');
    expect(determineMappingState(activeLinkId, newPlaidAccountId)).toBe('repaired');
  });

  it('rejects partial or unrelated mapping states', () => {
    expect(determineMappingState(staleLinkId, newPlaidAccountId)).toBe('unexpected');
    expect(determineMappingState(activeLinkId, oldPlaidAccountId)).toBe('unexpected');
  });
});
