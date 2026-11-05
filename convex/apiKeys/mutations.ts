import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { generateOpaqueToken, sha256Hex } from '../lib/crypto';

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_LABEL_MAX_LENGTH,
  API_KEY_PREFIX,
  MAX_ACTIVE_API_KEYS,
  type ApiKeyScope,
} from './constants';

export async function createApiKeyHandler(
  ctx: MutationCtx,
  { label, readOnly }: { label: string; readOnly?: boolean }
) {
  const identity = await requireAuth(ctx);

  const trimmedLabel = label.trim();
  if (trimmedLabel.length === 0) {
    throw new ConvexError('Key name is required');
  }
  if (trimmedLabel.length > API_KEY_LABEL_MAX_LENGTH) {
    throw new ConvexError(`Key name cannot exceed ${API_KEY_LABEL_MAX_LENGTH} characters`);
  }

  const existingKeys = await ctx.db
    .query('apiKey')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
    .collect();
  const activeCount = existingKeys.filter((key) => !key.revokedAt).length;
  if (activeCount >= MAX_ACTIVE_API_KEYS) {
    throw new ConvexError(`You can have at most ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one to continue.`);
  }

  const rawKey = generateOpaqueToken(API_KEY_PREFIX);
  const tokenHash = await sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
  const scopes: ApiKeyScope[] = readOnly ? ['read'] : ['read', 'write'];
  const createdAt = new Date().toISOString();

  const apiKeyId = await ctx.db.insert('apiKey', {
    tokenHash,
    keyPrefix,
    clerkId: identity.subject,
    label: trimmedLabel,
    scopes,
    createdAt,
  });

  return {
    apiKeyId,
    key: rawKey,
    keyPrefix,
    label: trimmedLabel,
    scopes,
    createdAt,
  };
}

/**
 * Create a personal API key for the public REST API.
 *
 * Returns the raw key exactly once — only its SHA-256 hash is stored, so the
 * settings UI must show/copy the value immediately after creation.
 */
export const createApiKey = mutation({
  args: {
    label: v.string(),
    readOnly: v.optional(v.boolean()),
  },
  handler: createApiKeyHandler,
});

export async function revokeApiKeyHandler(ctx: MutationCtx, { apiKeyId }: { apiKeyId: Id<'apiKey'> }) {
  const identity = await requireAuth(ctx);

  const apiKey = await ctx.db.get(apiKeyId);
  if (!apiKey || apiKey.clerkId !== identity.subject) {
    throw new ConvexError('API key not found');
  }

  if (!apiKey.revokedAt) {
    await ctx.db.patch(apiKeyId, { revokedAt: new Date().toISOString() });
  }

  return { success: true };
}

/**
 * Revoke an API key. Revocation is immediate and permanent — the key can no
 * longer authenticate requests. Idempotent for already-revoked keys.
 */
export const revokeApiKey = mutation({
  args: {
    apiKeyId: v.id('apiKey'),
  },
  handler: revokeApiKeyHandler,
});
