import { describe, expect, it } from 'vitest';

import { isValidAccountDeletionConfirmation } from './actions';

describe('account deletion confirmation', () => {
  it('requires the exact destructive confirmation phrase', () => {
    expect(isValidAccountDeletionConfirmation('DELETE')).toBe(true);
    expect(isValidAccountDeletionConfirmation('delete')).toBe(false);
    expect(isValidAccountDeletionConfirmation(' DELETE ')).toBe(false);
  });
});
