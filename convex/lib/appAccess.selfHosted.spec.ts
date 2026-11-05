import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryCtx } from '../_generated/server';
import { resolveAppAccessForClerkId } from './appAccess';

describe('self-hosted access', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('provides app access without billing lookups when explicitly enabled', async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    const query = vi.fn(() => {
      throw new Error('Billing must not be queried');
    });
    const access = await resolveAppAccessForClerkId({ db: { query } } as unknown as QueryCtx, 'local-user');
    expect(access.hasAppAccess).toBe(true);
    expect(access.ownSubscription?.subscriptionType).toBe('lifetime');
    expect(query).not.toHaveBeenCalled();
  });
});
