import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';

import { API_RATE_LIMIT_MAX_REQUESTS, API_RATE_LIMIT_WINDOW_MS, type ApiKeyScope } from './constants';

export type ApiKeyAuthResult =
  | { ok: false; reason: 'invalid_key' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }
  | {
      ok: true;
      apiKeyId: Id<'apiKey'>;
      apiKeyLabel: string;
      apiKeyPrefix: string;
      clerkId: string;
      scopes: ApiKeyScope[];
      activeWorkspaceId: Id<'workspace'> | undefined;
    };

export function applyRateLimit(apiKey: Doc<'apiKey'>, now: number) {
  const windowStart = apiKey.rateLimitWindowStart ?? 0;
  const inCurrentWindow = now - windowStart < API_RATE_LIMIT_WINDOW_MS;
  const count = inCurrentWindow ? (apiKey.rateLimitWindowCount ?? 0) : 0;

  if (count >= API_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + API_RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { limited: true as const, retryAfterSeconds };
  }

  return {
    limited: false as const,
    patch: {
      rateLimitWindowStart: inCurrentWindow ? windowStart : now,
      rateLimitWindowCount: count + 1,
      lastUsedAt: new Date(now).toISOString(),
    },
  };
}

/**
 * Authenticate a public-API request by bearer-key hash. This is a mutation
 * (not a query) because every successful request also advances the key's
 * fixed-window rate-limit counter and lastUsedAt in the same transaction.
 */
export async function authenticateApiKeyRequestHandler(
  ctx: MutationCtx,
  { tokenHash }: { tokenHash: string }
): Promise<ApiKeyAuthResult> {
  const apiKey = await ctx.db
    .query('apiKey')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .first();

  if (!apiKey || apiKey.revokedAt) {
    return { ok: false, reason: 'invalid_key' };
  }

  const rateLimit = applyRateLimit(apiKey, Date.now());
  if (rateLimit.limited) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: rateLimit.retryAfterSeconds };
  }
  await ctx.db.patch(apiKey._id, rateLimit.patch);

  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', apiKey.clerkId))
    .first();

  return {
    ok: true,
    apiKeyId: apiKey._id,
    apiKeyLabel: apiKey.label,
    apiKeyPrefix: apiKey.keyPrefix,
    clerkId: apiKey.clerkId,
    scopes: apiKey.scopes,
    activeWorkspaceId: userProfile?.activeWorkspaceId,
  };
}

export const authenticateApiKeyRequest = internalMutation({
  args: {
    tokenHash: v.string(),
  },
  handler: authenticateApiKeyRequestHandler,
});
