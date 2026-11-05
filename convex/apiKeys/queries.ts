import { query } from '../_generated/server';
import { requireAuth } from '../lib/auth';

/**
 * List the current user's API keys for the settings page. Never exposes the
 * token hash; only display-safe metadata. Revoked keys are omitted.
 */
export const listApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);

    const keys = await ctx.db
      .query('apiKey')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .collect();

    return keys
      .filter((key) => !key.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((key) => ({
        apiKeyId: key._id,
        label: key.label,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt ?? null,
      }));
  },
});
