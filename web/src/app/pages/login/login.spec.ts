import { describe, expect, it } from 'vitest';
import { safeAuthRedirect } from './login';

describe('password sign-in redirect', () => {
  it('preserves local destinations and refuses external redirects', () => {
    expect(safeAuthRedirect('/workspaces?tab=mine')).toBe('/workspaces?tab=mine');
    for (const value of [null, 'https://example.com', '//example.com', '/\\example.com']) {
      expect(safeAuthRedirect(value)).toBe('/');
    }
  });
});
