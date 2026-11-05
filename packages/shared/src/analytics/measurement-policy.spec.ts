import { describe, expect, it } from 'vitest';
import { measurementPolicyResponse } from './measurement-policy';

describe('retired web ad measurement endpoint', () => {
  it('always disables measurement for cached clients and prevents caching', async () => {
    const response = measurementPolicyResponse();
    expect(await response.json()).toEqual({ eligible: false, policy: 'us-opt-out-v1' });
    for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) {
      expect(response.headers.get(name)).toContain('no-store');
    }
  });
});
