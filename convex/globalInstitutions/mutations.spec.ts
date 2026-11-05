import { describe, expect, it } from 'vitest';

import { validateGlobalInstitutionLogoTransferUrl } from './mutations';

describe('validateGlobalInstitutionLogoTransferUrl', () => {
  it.each(['https://example.convex.cloud/api/storage/logo-id', 'https://example.convex.site/api/storage/logo-id'])(
    'allows Convex storage URLs: %s',
    (url) => {
      expect(validateGlobalInstitutionLogoTransferUrl(url).toString()).toBe(url);
    }
  );

  it.each([
    'http://example.convex.cloud/api/storage/logo-id',
    'https://convex.cloud.evil.example/api/storage/logo-id',
    'https://example.convex.cloud:8443/api/storage/logo-id',
    'https://user@example.convex.cloud/api/storage/logo-id',
    'https://example.convex.cloud/not-storage/logo-id',
    'https://127.0.0.1/api/storage/logo-id',
  ])('rejects unsafe transfer URLs: %s', (url) => {
    expect(() => validateGlobalInstitutionLogoTransferUrl(url)).toThrow(
      'Logo transfer URL must be an HTTPS Convex storage URL'
    );
  });
});
