import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { sha256Hex } from '../lib/crypto';
import { APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, TRANSACTIONS_WRITE_SCOPE } from './tools';

const MCP_SUPPORTED_SCOPES = [APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, TRANSACTIONS_WRITE_SCOPE] as const;
const MCP_SUPPORTED_SCOPES_STRING = MCP_SUPPORTED_SCOPES.join(' ');

function jsonResponse(payload: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

function oauthResponse(payload: unknown, status = 200): Response {
  return jsonResponse(payload, status, {
    'cache-control': 'no-store',
    pragma: 'no-cache',
  });
}

function oauthError(error: string, errorDescription: string, status = 400): Response {
  return oauthResponse(
    {
      error,
      error_description: errorDescription,
    },
    status
  );
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Base URL cannot be empty');
  }

  const parsed = new URL(trimmed);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function getAppBaseUrl(request: Request): string {
  const configured = process.env['KUALIA_APP_URL'];
  if (configured && configured.trim().length > 0) {
    try {
      return normalizeBaseUrl(configured);
    } catch {
      // Ignore malformed env and fall back to host-based default.
    }
  }

  const requestUrl = new URL(request.url);
  const isLocal = requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1';
  return isLocal ? 'http://localhost:3000' : 'https://app.kualia.com';
}

function getOAuthServerMetadata(request: Request) {
  const requestUrl = new URL(request.url);
  const issuer = `${requestUrl.protocol}//${requestUrl.host}`;

  return {
    issuer,
    // Keep the advertised endpoint issuer-bound for clients that reject cross-origin
    // authorization endpoints. The handler redirects browsers to the app consent UI.
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    registrationEndpoint: `${issuer}/oauth/register`,
    resourceMetadataEndpoint: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    resource: `${issuer}/mcp`,
  };
}

function getOAuthAuthorizationRedirectUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL('/oauth/authorize', getAppBaseUrl(request));
  redirectUrl.search = requestUrl.search;
  return redirectUrl.toString();
}

function parseFormBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function getRequiredParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

export function getMcpWwwAuthenticateHeader(request: Request): string {
  const metadata = getOAuthServerMetadata(request);
  return [
    'Bearer realm="kualia-mcp"',
    `resource_metadata="${metadata.resourceMetadataEndpoint}"`,
    `scope="${MCP_SUPPORTED_SCOPES_STRING}"`,
  ].join(', ');
}

export async function handleOAuthProtectedResourceMetadataGet(_ctx: ActionCtx, request: Request): Promise<Response> {
  const metadata = getOAuthServerMetadata(request);

  return jsonResponse({
    resource: metadata.resource,
    authorization_servers: [metadata.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
  });
}

export async function handleOAuthAuthorizationServerMetadataGet(_ctx: ActionCtx, request: Request): Promise<Response> {
  const metadata = getOAuthServerMetadata(request);

  return jsonResponse({
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    revocation_endpoint: metadata.revocationEndpoint,
    registration_endpoint: metadata.registrationEndpoint,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
  });
}

export async function handleOAuthAuthorizeGet(_ctx: ActionCtx, request: Request): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      location: getOAuthAuthorizationRedirectUrl(request),
      'cache-control': 'no-store',
      pragma: 'no-cache',
    },
  });
}

export async function handleOAuthTokenPost(ctx: ActionCtx, request: Request): Promise<Response> {
  let params: URLSearchParams;
  try {
    const rawBody = await request.text();
    params = parseFormBody(rawBody);
  } catch {
    return oauthError('invalid_request', 'Request body must be application/x-www-form-urlencoded');
  }

  const grantType = getRequiredParam(params, 'grant_type');
  const clientId = getRequiredParam(params, 'client_id');

  if (!grantType) {
    return oauthError('invalid_request', 'grant_type is required');
  }

  if (!clientId) {
    return oauthError('invalid_request', 'client_id is required');
  }

  if (grantType === 'authorization_code') {
    const code = getRequiredParam(params, 'code');
    const redirectUri = getRequiredParam(params, 'redirect_uri');
    const codeVerifier = getRequiredParam(params, 'code_verifier');

    if (!code) {
      return oauthError('invalid_request', 'code is required');
    }

    if (!redirectUri) {
      return oauthError('invalid_request', 'redirect_uri is required');
    }

    if (!codeVerifier) {
      return oauthError('invalid_request', 'code_verifier is required');
    }

    const codeHash = await sha256Hex(code);
    const result = await ctx.runMutation(internal.mcp.oauthMutations.exchangeAuthorizationCode, {
      codeHash,
      clientId,
      redirectUri,
      codeVerifier,
    });

    if (!result.ok) {
      return oauthError(result.error.code, result.error.description);
    }

    return oauthResponse({
      access_token: result.tokens.accessToken,
      token_type: result.tokens.tokenType,
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken,
      scope: result.tokens.scope,
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = getRequiredParam(params, 'refresh_token');
    if (!refreshToken) {
      return oauthError('invalid_request', 'refresh_token is required');
    }

    const refreshTokenHash = await sha256Hex(refreshToken);
    const result = await ctx.runMutation(internal.mcp.oauthMutations.refreshOauthTokens, {
      refreshTokenHash,
      clientId,
    });

    if (!result.ok) {
      return oauthError(result.error.code, result.error.description);
    }

    return oauthResponse({
      access_token: result.tokens.accessToken,
      token_type: result.tokens.tokenType,
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken,
      scope: result.tokens.scope,
    });
  }

  return oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
}

export async function handleOAuthRegisterPost(ctx: ActionCtx, request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return oauthError('invalid_client_metadata', 'Request body must be JSON');
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return oauthError('invalid_client_metadata', 'Registration payload must be an object');
  }

  const redirectUrisRaw = (payload as Record<string, unknown>)['redirect_uris'];
  if (!Array.isArray(redirectUrisRaw) || redirectUrisRaw.some((item) => typeof item !== 'string')) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be a string array');
  }

  const grantTypesRaw = (payload as Record<string, unknown>)['grant_types'];
  if (
    grantTypesRaw !== undefined &&
    (!Array.isArray(grantTypesRaw) || grantTypesRaw.some((item) => typeof item !== 'string'))
  ) {
    return oauthError('invalid_client_metadata', 'grant_types must be a string array');
  }

  const responseTypesRaw = (payload as Record<string, unknown>)['response_types'];
  if (
    responseTypesRaw !== undefined &&
    (!Array.isArray(responseTypesRaw) || responseTypesRaw.some((item) => typeof item !== 'string'))
  ) {
    return oauthError('invalid_client_metadata', 'response_types must be a string array');
  }

  const tokenEndpointAuthMethodRaw = (payload as Record<string, unknown>)['token_endpoint_auth_method'];
  if (tokenEndpointAuthMethodRaw !== undefined && typeof tokenEndpointAuthMethodRaw !== 'string') {
    return oauthError('invalid_client_metadata', 'token_endpoint_auth_method must be a string');
  }

  const clientNameRaw = (payload as Record<string, unknown>)['client_name'];
  if (clientNameRaw !== undefined && typeof clientNameRaw !== 'string') {
    return oauthError('invalid_client_metadata', 'client_name must be a string');
  }

  const clientUriRaw = (payload as Record<string, unknown>)['client_uri'];
  if (clientUriRaw !== undefined && typeof clientUriRaw !== 'string') {
    return oauthError('invalid_client_metadata', 'client_uri must be a string');
  }

  try {
    const result = await ctx.runMutation(internal.mcp.oauthMutations.registerOauthClient, {
      redirectUris: redirectUrisRaw,
      grantTypes: grantTypesRaw,
      responseTypes: responseTypesRaw,
      tokenEndpointAuthMethod: tokenEndpointAuthMethodRaw,
      clientName: clientNameRaw,
      clientUri: clientUriRaw,
    });

    return oauthResponse(
      {
        client_id: result.clientId,
        client_id_issued_at: result.clientIdIssuedAtSeconds,
        redirect_uris: result.redirectUris,
        grant_types: result.grantTypes,
        response_types: result.responseTypes,
        token_endpoint_auth_method: result.tokenEndpointAuthMethod,
        ...(result.clientName ? { client_name: result.clientName } : {}),
        ...(result.clientUri ? { client_uri: result.clientUri } : {}),
      },
      201
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Client registration failed';
    return oauthError('invalid_client_metadata', message);
  }
}

export async function handleOAuthRevokePost(ctx: ActionCtx, request: Request): Promise<Response> {
  let params: URLSearchParams;
  try {
    const rawBody = await request.text();
    params = parseFormBody(rawBody);
  } catch {
    return oauthError('invalid_request', 'Request body must be application/x-www-form-urlencoded');
  }

  const token = getRequiredParam(params, 'token');
  if (!token) {
    return oauthError('invalid_request', 'token is required');
  }

  const tokenTypeHintRaw = params.get('token_type_hint');
  const tokenTypeHint =
    tokenTypeHintRaw === 'access_token' || tokenTypeHintRaw === 'refresh_token' ? tokenTypeHintRaw : undefined;

  const tokenHash = await sha256Hex(token);
  await ctx.runMutation(internal.mcp.oauthMutations.revokeOauthTokenByHash, {
    tokenHash,
    tokenTypeHint,
  });

  return new Response(null, { status: 200 });
}
