import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, query, type QueryCtx } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import {
  normalizeScope,
  OAUTH_GRANT_TYPES,
  OAUTH_RESPONSE_TYPES,
  validateClientId,
  validateRedirectUri,
} from './oauthConfig';

const MAX_OAUTH_CONNECTIONS = 100;

export const getOauthAuthorizationClient = query({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    scope: v.optional(v.string()),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, { clientId, redirectUri, scope, resource }) => {
    await requireAuth(ctx);

    const normalizedClientId = validateClientId(clientId);
    const normalizedRedirectUri = validateRedirectUri(redirectUri);
    const client = await ctx.db
      .query('mcpOauthClient')
      .withIndex('by_clientId', (q) => q.eq('clientId', normalizedClientId))
      .unique();

    if (
      !client ||
      !client.redirectUris.includes(normalizedRedirectUri) ||
      !client.grantTypes.includes(OAUTH_GRANT_TYPES[0]) ||
      !client.responseTypes.includes(OAUTH_RESPONSE_TYPES[0])
    ) {
      throw new ConvexError('OAuth client is not registered for this redirect URI');
    }

    return {
      clientId: client.clientId,
      clientName: client.clientName,
      clientUri: client.clientUri,
      redirectUri: normalizedRedirectUri,
      scopes: normalizeScope(scope),
      resource,
    };
  },
});

interface OauthConnectionSummary {
  clientId: string;
  scopes: string[];
  resource: string | undefined;
  connectedAt: string;
  lastAuthorizedAt: string;
  lastUsedAt: string | null;
}

function latestTimestamp(left: string | null, right: string | undefined): string | null {
  if (!right) {
    return left;
  }
  return !left || right > left ? right : left;
}

function mergeLegacyToken(
  summaries: Map<string, OauthConnectionSummary>,
  token: Doc<'mcpOauthAccessToken'> | Doc<'mcpOauthRefreshToken'>
): void {
  const existing = summaries.get(token.clientId);
  if (!existing) {
    summaries.set(token.clientId, {
      clientId: token.clientId,
      scopes: token.scopes,
      resource: token.resource,
      connectedAt: token.createdAt,
      lastAuthorizedAt: token.createdAt,
      lastUsedAt: token.lastUsedAt ?? null,
    });
    return;
  }

  existing.scopes = [...new Set([...existing.scopes, ...token.scopes])];
  existing.resource = token.createdAt >= existing.lastAuthorizedAt ? token.resource : existing.resource;
  existing.connectedAt = token.createdAt < existing.connectedAt ? token.createdAt : existing.connectedAt;
  existing.lastAuthorizedAt = token.createdAt > existing.lastAuthorizedAt ? token.createdAt : existing.lastAuthorizedAt;
  existing.lastUsedAt = latestTimestamp(existing.lastUsedAt, token.lastUsedAt);
}

export const listOauthConnections = query({
  args: {
    nowMs: v.number(),
  },
  handler: async (ctx, { nowMs }) => {
    const identity = await requireAuth(ctx);
    const storedConnections = await ctx.db
      .query('mcpOauthConnection')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .order('desc')
      .take(MAX_OAUTH_CONNECTIONS);
    const storedClientIds = new Set(storedConnections.map((connection) => connection.clientId));

    const summaries = new Map<string, OauthConnectionSummary>();
    for (const connection of storedConnections) {
      if (connection.revokedAt) {
        continue;
      }

      summaries.set(connection.clientId, {
        clientId: connection.clientId,
        scopes: connection.scopes,
        resource: connection.resource,
        connectedAt: connection.connectedAt,
        lastAuthorizedAt: connection.lastAuthorizedAt,
        lastUsedAt: connection.lastUsedAt ?? null,
      });
    }

    const [legacyRefreshTokens, legacyAccessTokens] = await Promise.all([
      ctx.db
        .query('mcpOauthRefreshToken')
        .withIndex('by_clerkId_revokedAt', (q) => q.eq('clerkId', identity.subject).eq('revokedAt', undefined))
        .order('desc')
        .take(MAX_OAUTH_CONNECTIONS),
      ctx.db
        .query('mcpOauthAccessToken')
        .withIndex('by_clerkId_revokedAt', (q) => q.eq('clerkId', identity.subject).eq('revokedAt', undefined))
        .order('desc')
        .take(MAX_OAUTH_CONNECTIONS),
    ]);

    for (const token of [...legacyRefreshTokens, ...legacyAccessTokens]) {
      if (!storedClientIds.has(token.clientId) && new Date(token.expiresAt).getTime() > nowMs) {
        mergeLegacyToken(summaries, token);
      }
    }

    const clients = new Map<string, Doc<'mcpOauthClient'> | null>();
    await Promise.all(
      [...summaries.keys()].map(async (clientId) => {
        const client = await ctx.db
          .query('mcpOauthClient')
          .withIndex('by_clientId', (q) => q.eq('clientId', clientId))
          .unique();
        clients.set(clientId, client);
      })
    );

    return [...summaries.values()]
      .sort((left, right) => {
        const leftActivity = left.lastUsedAt ?? left.lastAuthorizedAt;
        const rightActivity = right.lastUsedAt ?? right.lastAuthorizedAt;
        return rightActivity.localeCompare(leftActivity);
      })
      .map((connection) => {
        const client = clients.get(connection.clientId);
        return {
          ...connection,
          clientName: client?.clientName,
          clientUri: client?.clientUri,
          redirectUris: client?.redirectUris ?? [],
        };
      });
  },
});

export async function authenticateOauthAccessTokenHandler(ctx: QueryCtx, { tokenHash }: { tokenHash: string }) {
  const token = await ctx.db
    .query('mcpOauthAccessToken')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .first();

  if (!token || token.revokedAt) {
    return null;
  }

  if (new Date(token.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', token.clerkId))
    .first();

  const client = await ctx.db
    .query('mcpOauthClient')
    .withIndex('by_clientId', (q) => q.eq('clientId', token.clientId))
    .first();

  const connection = token.connectionId
    ? await ctx.db.get(token.connectionId)
    : await ctx.db
        .query('mcpOauthConnection')
        .withIndex('by_clerkId_and_clientId', (q) => q.eq('clerkId', token.clerkId).eq('clientId', token.clientId))
        .unique();

  if (token.connectionId && !connection) {
    return null;
  }

  if (connection) {
    const connectionMatches =
      connection.clerkId === token.clerkId &&
      connection.clientId === token.clientId &&
      !connection.revokedAt &&
      (token.connectionId
        ? token.connectionId === connection._id && token.connectionVersion === connection.authorizationVersion
        : token.createdAt >= connection.lastAuthorizedAt);

    if (!connectionMatches) {
      return null;
    }
  }

  return {
    tokenId: token._id,
    clerkId: token.clerkId,
    clientId: token.clientId,
    clientName: client?.clientName,
    scopes: token.scopes,
    activeWorkspaceId: userProfile?.activeWorkspaceId,
  };
}

export const authenticateOauthAccessToken = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  handler: authenticateOauthAccessTokenHandler,
});
