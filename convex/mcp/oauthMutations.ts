import type { GenericMutationCtx } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { DataModel, Doc, Id } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { generateOpaqueToken, sha256Base64Url, sha256Hex } from '../lib/crypto';
import {
  formatScopes,
  normalizeGrantTypes,
  normalizeResponseTypes,
  normalizeScope,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTH_CODE_TTL_SECONDS,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_GRANT_TYPES,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_RESPONSE_TYPES,
  OAUTH_TOKEN_ENDPOINT_AUTH_METHOD,
  plusSecondsIso,
  validateClientId,
  validateCodeChallenge,
  validateCodeChallengeMethod,
  validateCodeVerifier,
  validateRedirectUri,
  validateTokenEndpointAuthMethod,
} from './oauthConfig';

export type OAuthTokenErrorCode = 'invalid_request' | 'invalid_grant' | 'unsupported_grant_type';

export interface OAuthTokenError {
  code: OAuthTokenErrorCode;
  description: string;
}

interface OAuthIssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

interface OAuthTokenFailure {
  ok: false;
  error: OAuthTokenError;
}

interface OAuthTokenSuccess {
  ok: true;
  tokens: OAuthIssuedTokens;
}

type OAuthTokenResponse = OAuthTokenFailure | OAuthTokenSuccess;
type MutationCtx = GenericMutationCtx<DataModel>;

interface OAuthConnectionGrant {
  connectionId: Id<'mcpOauthConnection'>;
  connectionVersion: number;
}

function isExpired(isoTimestamp: string): boolean {
  return new Date(isoTimestamp).getTime() <= Date.now();
}

async function generateUniqueToken(
  ctx: MutationCtx,
  tableName: 'mcpOauthAccessToken' | 'mcpOauthRefreshToken',
  prefix: string
): Promise<{ token: string; tokenHash: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateOpaqueToken(prefix);
    const tokenHash = await sha256Hex(token);

    const existingToken = await ctx.db
      .query(tableName)
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first();

    if (!existingToken) {
      return { token, tokenHash };
    }
  }

  throw new ConvexError('Failed to generate a unique OAuth token');
}

async function issueOAuthTokens(
  ctx: MutationCtx,
  args: {
    clerkId: string;
    clientId: string;
    connectionId: Id<'mcpOauthConnection'>;
    connectionVersion: number;
    scopes: string[];
    resource: string | undefined;
    nowMs: number;
  }
): Promise<OAuthIssuedTokens> {
  const { token: accessToken, tokenHash: accessTokenHash } = await generateUniqueToken(
    ctx,
    'mcpOauthAccessToken',
    'kualia_oat_'
  );

  const { token: refreshToken, tokenHash: refreshTokenHash } = await generateUniqueToken(
    ctx,
    'mcpOauthRefreshToken',
    'kualia_ort_'
  );

  const createdAt = new Date(args.nowMs).toISOString();
  const accessTokenExpiresAt = plusSecondsIso(args.nowMs, OAUTH_ACCESS_TOKEN_TTL_SECONDS);
  const refreshTokenExpiresAt = plusSecondsIso(args.nowMs, OAUTH_REFRESH_TOKEN_TTL_SECONDS);

  await ctx.db.insert('mcpOauthAccessToken', {
    tokenHash: accessTokenHash,
    clerkId: args.clerkId,
    clientId: args.clientId,
    connectionId: args.connectionId,
    connectionVersion: args.connectionVersion,
    scopes: args.scopes,
    resource: args.resource,
    expiresAt: accessTokenExpiresAt,
    createdAt,
  });

  await ctx.db.insert('mcpOauthRefreshToken', {
    tokenHash: refreshTokenHash,
    clerkId: args.clerkId,
    clientId: args.clientId,
    connectionId: args.connectionId,
    connectionVersion: args.connectionVersion,
    scopes: args.scopes,
    resource: args.resource,
    expiresAt: refreshTokenExpiresAt,
    createdAt,
  });

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    scope: formatScopes(args.scopes),
  };
}

async function getOauthConnection(
  ctx: MutationCtx,
  clerkId: string,
  clientId: string
): Promise<Doc<'mcpOauthConnection'> | null> {
  return await ctx.db
    .query('mcpOauthConnection')
    .withIndex('by_clerkId_and_clientId', (q) => q.eq('clerkId', clerkId).eq('clientId', clientId))
    .unique();
}

async function invalidatePendingOauthAuthorizationCodes(
  ctx: MutationCtx,
  clerkId: string,
  clientId: string,
  invalidatedAt: string
): Promise<void> {
  const pendingAuthorizationCodes = await ctx.db
    .query('mcpOauthAuthorizationCode')
    .withIndex('by_clerkId_and_clientId_and_consumedAt_and_expiresAt', (q) =>
      q.eq('clerkId', clerkId).eq('clientId', clientId).eq('consumedAt', undefined).gt('expiresAt', invalidatedAt)
    )
    .collect();

  for (const authorizationCode of pendingAuthorizationCodes) {
    await ctx.db.patch(authorizationCode._id, { consumedAt: invalidatedAt });
  }
}

async function authorizeOauthConnection(
  ctx: MutationCtx,
  args: {
    clerkId: string;
    clientId: string;
    scopes: string[];
    resource: string | undefined;
    authorizedAt: string;
  }
): Promise<OAuthConnectionGrant> {
  const existingConnection = await getOauthConnection(ctx, args.clerkId, args.clientId);

  if (existingConnection) {
    const authorizationVersion = existingConnection.authorizationVersion + 1;
    await ctx.db.patch(existingConnection._id, {
      authorizationVersion,
      scopes: args.scopes,
      resource: args.resource,
      connectedAt: existingConnection.revokedAt ? args.authorizedAt : existingConnection.connectedAt,
      lastAuthorizedAt: args.authorizedAt,
      lastUsedAt: existingConnection.revokedAt ? undefined : existingConnection.lastUsedAt,
      revokedAt: undefined,
    });

    return {
      connectionId: existingConnection._id,
      connectionVersion: authorizationVersion,
    };
  }

  const connectionId = await ctx.db.insert('mcpOauthConnection', {
    clerkId: args.clerkId,
    clientId: args.clientId,
    authorizationVersion: 1,
    scopes: args.scopes,
    resource: args.resource,
    connectedAt: args.authorizedAt,
    lastAuthorizedAt: args.authorizedAt,
  });

  return {
    connectionId,
    connectionVersion: 1,
  };
}

function tokenMatchesConnection(
  token: Pick<Doc<'mcpOauthRefreshToken'>, 'clerkId' | 'clientId' | 'connectionId' | 'connectionVersion' | 'createdAt'>,
  connection: Doc<'mcpOauthConnection'>
): boolean {
  if (
    token.clerkId !== connection.clerkId ||
    token.clientId !== connection.clientId ||
    connection.revokedAt !== undefined
  ) {
    return false;
  }

  if (token.connectionId || token.connectionVersion !== undefined) {
    return token.connectionId === connection._id && token.connectionVersion === connection.authorizationVersion;
  }

  return token.createdAt >= connection.lastAuthorizedAt;
}

async function getOrCreateLegacyOauthConnection(
  ctx: MutationCtx,
  token: Pick<
    Doc<'mcpOauthRefreshToken'>,
    'clerkId' | 'clientId' | 'connectionId' | 'connectionVersion' | 'scopes' | 'resource' | 'createdAt'
  >
): Promise<OAuthConnectionGrant | null> {
  const existingConnection = await getOauthConnection(ctx, token.clerkId, token.clientId);
  if (existingConnection) {
    return tokenMatchesConnection(token, existingConnection)
      ? {
          connectionId: existingConnection._id,
          connectionVersion: existingConnection.authorizationVersion,
        }
      : null;
  }

  const connectionId = await ctx.db.insert('mcpOauthConnection', {
    clerkId: token.clerkId,
    clientId: token.clientId,
    authorizationVersion: 1,
    scopes: token.scopes,
    resource: token.resource,
    connectedAt: token.createdAt,
    lastAuthorizedAt: token.createdAt,
  });

  return {
    connectionId,
    connectionVersion: 1,
  };
}

function sanitizeOptionalText(input: string | undefined, fieldName: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length > 200) {
    throw new ConvexError(`${fieldName} is too long`);
  }

  return trimmed;
}

export const registerOauthClient = internalMutation({
  args: {
    redirectUris: v.array(v.string()),
    grantTypes: v.optional(v.array(v.string())),
    responseTypes: v.optional(v.array(v.string())),
    tokenEndpointAuthMethod: v.optional(v.string()),
    clientName: v.optional(v.string()),
    clientUri: v.optional(v.string()),
  },
  handler: async (ctx, { redirectUris, grantTypes, responseTypes, tokenEndpointAuthMethod, clientName, clientUri }) => {
    if (redirectUris.length === 0) {
      throw new ConvexError('redirect_uris must include at least one URI');
    }

    const normalizedRedirectUris = [...new Set(redirectUris.map((item) => validateRedirectUri(item)))];
    const normalizedGrantTypes = normalizeGrantTypes(grantTypes);
    const normalizedResponseTypes = normalizeResponseTypes(responseTypes);
    const normalizedTokenEndpointAuthMethod = validateTokenEndpointAuthMethod(tokenEndpointAuthMethod);
    const normalizedClientName = sanitizeOptionalText(clientName, 'client_name');
    const normalizedClientUri = clientUri ? validateRedirectUri(clientUri) : undefined;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clientId = generateOpaqueToken('kualia_client_');

      const existingClient = await ctx.db
        .query('mcpOauthClient')
        .withIndex('by_clientId', (q) => q.eq('clientId', clientId))
        .first();

      if (existingClient) {
        continue;
      }

      const createdAt = new Date().toISOString();
      await ctx.db.insert('mcpOauthClient', {
        clientId,
        redirectUris: normalizedRedirectUris,
        grantTypes: normalizedGrantTypes,
        responseTypes: normalizedResponseTypes,
        tokenEndpointAuthMethod: normalizedTokenEndpointAuthMethod,
        clientName: normalizedClientName,
        clientUri: normalizedClientUri,
        createdAt,
      });

      return {
        clientId,
        redirectUris: normalizedRedirectUris,
        grantTypes: normalizedGrantTypes,
        responseTypes: normalizedResponseTypes,
        tokenEndpointAuthMethod: normalizedTokenEndpointAuthMethod,
        clientName: normalizedClientName,
        clientUri: normalizedClientUri,
        clientIdIssuedAtSeconds: Math.floor(new Date(createdAt).getTime() / 1000),
      };
    }

    throw new ConvexError('Failed to register OAuth client');
  },
});

export const createOauthAuthorizationCode = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    codeChallengeMethod: v.string(),
    scope: v.optional(v.string()),
    resource: v.optional(v.string()),
    consent: v.literal('approved'),
  },
  handler: async (ctx, { clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, resource }) => {
    const identity = await requireAuth(ctx);

    const normalizedClientId = validateClientId(clientId);
    const normalizedRedirectUri = validateRedirectUri(redirectUri);
    const normalizedCodeChallenge = validateCodeChallenge(codeChallenge);
    validateCodeChallengeMethod(codeChallengeMethod);
    const normalizedScopes = normalizeScope(scope);
    const oauthClient = await ctx.db
      .query('mcpOauthClient')
      .withIndex('by_clientId', (q) => q.eq('clientId', normalizedClientId))
      .first();

    if (!oauthClient) {
      throw new ConvexError('OAuth client is not registered');
    }

    if (!oauthClient.redirectUris.includes(normalizedRedirectUri)) {
      throw new ConvexError('redirect_uri is not registered for this client');
    }

    if (!oauthClient.grantTypes.includes(OAUTH_GRANT_TYPES[0])) {
      throw new ConvexError('OAuth client is not allowed to use authorization_code grant');
    }

    if (!oauthClient.responseTypes.includes(OAUTH_RESPONSE_TYPES[0])) {
      throw new ConvexError('OAuth client is not allowed to use response_type code');
    }

    if (oauthClient.tokenEndpointAuthMethod !== OAUTH_TOKEN_ENDPOINT_AUTH_METHOD) {
      throw new ConvexError('OAuth client token endpoint auth method is not supported');
    }

    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = plusSecondsIso(nowMs, OAUTH_AUTH_CODE_TTL_SECONDS);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rawCode = generateOpaqueToken('kualia_oac_');
      const codeHash = await sha256Hex(rawCode);

      const existingCode = await ctx.db
        .query('mcpOauthAuthorizationCode')
        .withIndex('by_codeHash', (q) => q.eq('codeHash', codeHash))
        .first();

      if (existingCode) {
        continue;
      }

      await ctx.db.insert('mcpOauthAuthorizationCode', {
        codeHash,
        clerkId: identity.subject,
        clientId: normalizedClientId,
        redirectUri: normalizedRedirectUri,
        codeChallenge: normalizedCodeChallenge,
        codeChallengeMethod: OAUTH_CODE_CHALLENGE_METHOD,
        scopes: normalizedScopes,
        resource,
        expiresAt,
        createdAt,
      });

      return {
        code: rawCode,
        expiresAt,
      };
    }

    throw new ConvexError('Failed to generate a unique authorization code');
  },
});

export const exchangeAuthorizationCode = internalMutation({
  args: {
    codeHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeVerifier: v.string(),
  },
  handler: async (ctx, { codeHash, clientId, redirectUri, codeVerifier }): Promise<OAuthTokenResponse> => {
    let normalizedClientId: string;
    let normalizedRedirectUri: string;
    let normalizedCodeVerifier: string;

    try {
      normalizedClientId = validateClientId(clientId);
      normalizedRedirectUri = validateRedirectUri(redirectUri);
      normalizedCodeVerifier = validateCodeVerifier(codeVerifier);
    } catch (error: unknown) {
      const description = error instanceof ConvexError ? String(error.data) : 'Invalid authorization request';
      return {
        ok: false,
        error: {
          code: 'invalid_request',
          description,
        },
      };
    }

    const authCode = await ctx.db
      .query('mcpOauthAuthorizationCode')
      .withIndex('by_codeHash', (q) => q.eq('codeHash', codeHash))
      .first();

    if (!authCode) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'Authorization code is invalid',
        },
      };
    }

    if (authCode.clientId !== normalizedClientId || authCode.redirectUri !== normalizedRedirectUri) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'Authorization code does not match client',
        },
      };
    }

    if (authCode.consumedAt) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'Authorization code has already been used',
        },
      };
    }

    if (isExpired(authCode.expiresAt)) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'Authorization code has expired',
        },
      };
    }

    if (authCode.codeChallengeMethod !== OAUTH_CODE_CHALLENGE_METHOD) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'Unsupported code challenge method',
        },
      };
    }

    const computedCodeChallenge = await sha256Base64Url(normalizedCodeVerifier);
    if (computedCodeChallenge !== authCode.codeChallenge) {
      return {
        ok: false,
        error: {
          code: 'invalid_grant',
          description: 'PKCE verification failed',
        },
      };
    }

    const nowMs = Date.now();
    const authorizedAt = new Date(nowMs).toISOString();
    await ctx.db.patch(authCode._id, {
      consumedAt: authorizedAt,
    });

    const connection = await authorizeOauthConnection(ctx, {
      clerkId: authCode.clerkId,
      clientId: authCode.clientId,
      scopes: authCode.scopes,
      resource: authCode.resource,
      authorizedAt,
    });

    const tokens = await issueOAuthTokens(ctx, {
      clerkId: authCode.clerkId,
      clientId: authCode.clientId,
      connectionId: connection.connectionId,
      connectionVersion: connection.connectionVersion,
      scopes: authCode.scopes,
      resource: authCode.resource,
      nowMs,
    });

    return {
      ok: true,
      tokens,
    };
  },
});

export async function refreshOauthTokensHandler(
  ctx: MutationCtx,
  { refreshTokenHash, clientId }: { refreshTokenHash: string; clientId: string }
): Promise<OAuthTokenResponse> {
  let normalizedClientId: string;
  try {
    normalizedClientId = validateClientId(clientId);
  } catch (error: unknown) {
    const description = error instanceof ConvexError ? String(error.data) : 'Invalid token refresh request';
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        description,
      },
    };
  }

  const refreshToken = await ctx.db
    .query('mcpOauthRefreshToken')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', refreshTokenHash))
    .first();

  if (!refreshToken || refreshToken.revokedAt || isExpired(refreshToken.expiresAt)) {
    return {
      ok: false,
      error: {
        code: 'invalid_grant',
        description: 'Refresh token is invalid or expired',
      },
    };
  }

  if (refreshToken.clientId !== normalizedClientId) {
    return {
      ok: false,
      error: {
        code: 'invalid_grant',
        description: 'Refresh token does not belong to this client',
      },
    };
  }

  const connection = await getOrCreateLegacyOauthConnection(ctx, refreshToken);
  if (!connection) {
    return {
      ok: false,
      error: {
        code: 'invalid_grant',
        description: 'MCP connection has been revoked or replaced',
      },
    };
  }

  const nowMs = Date.now();
  await ctx.db.patch(refreshToken._id, {
    revokedAt: new Date(nowMs).toISOString(),
    lastUsedAt: new Date(nowMs).toISOString(),
  });

  const tokens = await issueOAuthTokens(ctx, {
    clerkId: refreshToken.clerkId,
    clientId: refreshToken.clientId,
    connectionId: connection.connectionId,
    connectionVersion: connection.connectionVersion,
    scopes: refreshToken.scopes,
    resource: refreshToken.resource,
    nowMs,
  });

  return {
    ok: true,
    tokens,
  };
}

export const refreshOauthTokens = internalMutation({
  args: {
    refreshTokenHash: v.string(),
    clientId: v.string(),
  },
  handler: refreshOauthTokensHandler,
});

export const touchOauthAccessTokenLastUsed = internalMutation({
  args: {
    tokenId: v.id('mcpOauthAccessToken'),
  },
  handler: async (ctx, { tokenId }) => {
    const token = await ctx.db.get(tokenId);
    if (!token || token.revokedAt) {
      return;
    }

    const connection = await getOrCreateLegacyOauthConnection(ctx, token);
    if (!connection) {
      return;
    }

    const lastUsedAt = new Date().toISOString();

    await ctx.db.patch(tokenId, {
      connectionId: connection.connectionId,
      connectionVersion: connection.connectionVersion,
      lastUsedAt,
    });
    await ctx.db.patch(connection.connectionId, {
      lastUsedAt,
    });
  },
});

export async function revokeOauthConnectionHandler(
  ctx: MutationCtx,
  { clientId }: { clientId: string }
): Promise<{ success: true }> {
  const identity = await requireAuth(ctx);
  const normalizedClientId = validateClientId(clientId);
  const existingConnection = await getOauthConnection(ctx, identity.subject, normalizedClientId);
  const revokedAt = new Date().toISOString();

  if (existingConnection) {
    if (!existingConnection.revokedAt) {
      await ctx.db.patch(existingConnection._id, { revokedAt });
    }
    await invalidatePendingOauthAuthorizationCodes(ctx, identity.subject, normalizedClientId, revokedAt);
    return { success: true };
  }

  const latestRefreshToken = await ctx.db
    .query('mcpOauthRefreshToken')
    .withIndex('by_clerkId_and_clientId', (q) => q.eq('clerkId', identity.subject).eq('clientId', normalizedClientId))
    .order('desc')
    .first();
  const latestAccessToken = latestRefreshToken
    ? null
    : await ctx.db
        .query('mcpOauthAccessToken')
        .withIndex('by_clerkId_and_clientId', (q) =>
          q.eq('clerkId', identity.subject).eq('clientId', normalizedClientId)
        )
        .order('desc')
        .first();
  const token = latestRefreshToken ?? latestAccessToken;

  if (!token) {
    throw new ConvexError('MCP connection not found');
  }

  await ctx.db.insert('mcpOauthConnection', {
    clerkId: identity.subject,
    clientId: normalizedClientId,
    authorizationVersion: 1,
    scopes: token.scopes,
    resource: token.resource,
    connectedAt: token.createdAt,
    lastAuthorizedAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt,
  });
  await invalidatePendingOauthAuthorizationCodes(ctx, identity.subject, normalizedClientId, revokedAt);

  return { success: true };
}

export const revokeOauthConnection = mutation({
  args: {
    clientId: v.string(),
  },
  handler: revokeOauthConnectionHandler,
});

export const revokeOauthTokenByHash = internalMutation({
  args: {
    tokenHash: v.string(),
    tokenTypeHint: v.optional(v.union(v.literal('access_token'), v.literal('refresh_token'))),
  },
  handler: async (ctx, { tokenHash, tokenTypeHint }) => {
    const nowIso = new Date().toISOString();

    if (tokenTypeHint !== 'refresh_token') {
      const accessToken = await ctx.db
        .query('mcpOauthAccessToken')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .first();

      if (accessToken && !accessToken.revokedAt) {
        await ctx.db.patch(accessToken._id, {
          revokedAt: nowIso,
        });
        return;
      }
    }

    if (tokenTypeHint !== 'access_token') {
      const refreshToken = await ctx.db
        .query('mcpOauthRefreshToken')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .first();

      if (refreshToken && !refreshToken.revokedAt) {
        await ctx.db.patch(refreshToken._id, {
          revokedAt: nowIso,
          lastUsedAt: nowIso,
        });
      }
    }
  },
});
