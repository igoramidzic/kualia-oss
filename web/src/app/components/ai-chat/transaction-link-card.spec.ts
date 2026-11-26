import { describe, expect, it } from 'vitest';

import { buildTransactionDetailsPath } from './transaction-link-card';

describe('buildTransactionDetailsPath', () => {
  it('builds an app-relative path instead of a hosted URL', () => {
    expect(buildTransactionDetailsPath('797yc2h1', 'm171b170kk9y5v30')).toBe(
      '/797yc2h1/transactions/m171b170kk9y5v30/details'
    );
  });

  it('encodes path segments', () => {
    expect(buildTransactionDetailsPath('a/b', 'c?d')).toBe('/a%2Fb/transactions/c%3Fd/details');
  });
});
